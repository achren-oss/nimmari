import { beforeAll, afterAll, beforeEach, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { mkdtempSync, rmSync } from "node:fs";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
const state = vi.hoisted(() => ({ db: null as unknown, email: vi.fn() }));
vi.mock("@/db", () => ({ get db() { return state.db; } }));
vi.mock("@/lib/api-auth", () => ({
  getApiIdentity: async (req: Request) => ({ userId: req.headers.get("owner") ?? "a" }),
  getAgentIdentity: async (req: Request) => ({ identity: { userId: req.headers.get("owner") ?? "a", scope: "regular" } }),
}));
vi.mock("@/lib/rate-limit", () => ({ signRateLimit: () => null, signRateLimitWithCount: () => ({ response: null, count: 1 }) }));
vi.mock("@/lib/email", () => ({ sendSigningEmail: state.email }));
import { GET as signerRead } from "@/app/api/sign/[token]/route";
import { GET as list } from "@/app/api/documents/route";
import { POST as send } from "@/app/api/documents/[id]/send/route";
import { POST as reissue } from "@/app/api/documents/[id]/signers/[slot]/reissue/route";
import { POST as resend } from "@/app/api/documents/[id]/resend/route";
import { GET as history } from "@/app/api/webhooks/deliveries/route";
import { GET as docHistory } from "@/app/api/documents/[id]/webhooks/route";
import { POST as redeliver } from "@/app/api/webhooks/deliveries/[id]/redeliver/route";
import { processDeliveries, deliveryValues } from "../webhook-outbox";
import { generateWebhookSignature, isSafeWebhookUrl } from "../webhook";
const directory = mkdtempSync("/tmp/nimmari-v14-test-");
const client = createClient({ url: `file:${directory}/db` });
const db = drizzle(client, { schema });
state.db = db;
const params = (id = "doc") => ({ params: Promise.resolve({ id }) });
const req = (body?: object, key?: string, owner = "a", query = "") => new Request(`http://localhost/api${query}`, { method: body ? "POST" : "GET", headers: { owner, ...(key ? { "Idempotency-Key": key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
const body = { email: "alex@example.com", name: "Alex Example", notify: false };
beforeAll(async () => { await migrate(db, { migrationsFolder: "drizzle" }); });
afterAll(() => { client.close(); rmSync(directory, { recursive: true, force: true }); });
beforeEach(async () => {
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
  state.email.mockReset().mockResolvedValue({ sent: true });
  await db.delete(schema.webhookDelivery); await db.delete(schema.sendIdempotency); await db.delete(schema.signingSession); await db.delete(schema.field); await db.delete(schema.document); await db.delete(schema.user);
  const now = new Date(1700000000000);
  for (const id of ["a", "b"]) await db.insert(schema.user).values({ id, name: "Example", email: `${id}@example.com`, createdAt: now, updatedAt: now });
  for (const [id, ownerId, status] of [["doc", "a", "draft"], ["doc2", "a", "sent"], ["secret", "b", "draft"]] as const) await db.insert(schema.document).values({ id, ownerId, status, title: id, createdAt: now, updatedAt: now, notify: false });
  await db.insert(schema.field).values({ id: "f", documentId: "doc", type: "text", name: "name" });
});
it("lists only owner documents, paginates ties, filters statuses and validates cursors", async () => {
  const first = await (await list(req(undefined, undefined, "a", "?limit=1"))).json();
  expect(first.documents.map((d: { id: string }) => d.id)).toEqual(["doc2"]);
  const second = await (await list(req(undefined, undefined, "a", `?limit=1&cursor=${first.nextCursor}`))).json();
  expect(second.documents.map((d: { id: string }) => d.id)).toEqual(["doc"]); expect(second.nextCursor).toBeNull();
  expect((await (await list(req(undefined, undefined, "b"))).json()).documents.map((d: { id: string }) => d.id)).toEqual(["secret"]);
  expect((await (await list(req(undefined, undefined, "a", "?status=sent,draft"))).json()).documents).toHaveLength(2);
  for (const query of ["?status=no", "?cursor=bad", "?limit=101", "?limit=0"]) expect((await list(req(undefined, undefined, "a", query))).status).toBe(400);
});
it("replays identical sends, rejects different bodies and serializes concurrent duplicates", async () => {
  const responses = await Promise.all([send(req(body, "key"), params()), send(req(body, "key"), params())]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  expect(await responses[0].json()).toEqual(await responses[1].json());
  expect(await db.select().from(schema.signingSession)).toHaveLength(1);
  expect((await send(req({ ...body, name: "Other Example" }, "key"), params())).status).toBe(422);
  expect(state.email).not.toHaveBeenCalled();
  expect((await send(req(body, "key", "b"), params())).status).toBe(404);
});
it("rotates an expired slot token, refuses signed/waiting slots and resends without new slots", async () => {
  const original = await (await send(req(body), params())).json();
  await db.update(schema.signingSession).set({ expiresAt: new Date(0) });
  const slotParams = { params: Promise.resolve({ id: "doc", slot: original.signingSessionId }) };
  const fresh = await (await reissue(req({ notify: false }), slotParams)).json();
  expect(fresh.url).not.toBe(original.url);
  expect((await signerRead(req(), { params: Promise.resolve({ token: original.url.split("/").pop() }) })).status).toBe(404);
  expect((await signerRead(req(), { params: Promise.resolve({ token: fresh.url.split("/").pop() }) })).status).toBe(200);
  expect((await db.select().from(schema.signingSession).where(eq(schema.signingSession.token, original.url.split("/").pop())))).toHaveLength(0);
  expect((await db.select().from(schema.signingSession).where(eq(schema.signingSession.token, fresh.url.split("/").pop())))).toHaveLength(1);
  expect((await resend(req({ signers: [original.key, original.signingSessionId], notify: false }), params())).status).toBe(400);
  expect((await resend(req({ notify: false }), params())).status).toBe(200);
  expect(await db.select().from(schema.signingSession)).toHaveLength(1);
  await db.update(schema.signingSession).set({ signedAt: new Date() });
  expect((await reissue(req({}), slotParams)).status).toBe(409);
  expect((await reissue(req({}, undefined, "b"), slotParams)).status).toBe(404);
});
it("claims once, retries with backoff, preserves HMAC and exposes only owner history", async () => {
  vi.stubEnv("NIMMARI_WEBHOOK_SECRET", "synthetic-secret");
  const payload = { event: "document.completed" };
  const values = deliveryValues({ id: "doc", ownerId: "a", webhookUrl: "https://example.com/hook" }, "document.completed", payload);
  await db.insert(schema.webhookDelivery).values(values);
  const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 500 })); vi.stubGlobal("fetch", fetcher);
  await Promise.all([processDeliveries("a"), processDeliveries("a")]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  let [row] = await db.select().from(schema.webhookDelivery);
  expect(row.attemptCount).toBe(1); expect(row.status).toBe("pending"); expect(row.nextAttemptAt.getTime() - row.updatedAt.getTime()).toBeGreaterThanOrEqual(60000);
  expect(fetcher.mock.calls[0][1].headers).toMatchObject({ "X-Puumerkki-Signature": generateWebhookSignature(JSON.stringify(payload), "synthetic-secret"), "X-Nimmari-Delivery-Id": values.id, "X-Nimmari-Attempt": "1" });
  expect((await (await history(req(undefined, undefined, "b"))).json()).deliveries).toHaveLength(0);
  expect((await docHistory(req(undefined, undefined, "b"), params())).status).toBe(404);
  expect((await (await history(req())).json()).deliveries).toHaveLength(1);
  await db.update(schema.webhookDelivery).set({ nextAttemptAt: new Date(0), attemptCount: 5 });
  await processDeliveries("a");
  [row] = await db.select().from(schema.webhookDelivery); expect(row.status).toBe("failed"); expect(row.attemptCount).toBe(6);
  expect((await redeliver(req({}, undefined, "b"), params(values.id))).status).toBe(404);
  fetcher.mockResolvedValue(new Response("", { status: 200 }));
  expect((await redeliver(req({}), params(values.id))).status).toBe(200);
  [row] = await db.select().from(schema.webhookDelivery); expect(row.status).toBe("delivered");
});

it("blocks private destinations, preserves existing public HTTP, and permits explicit local tests", () => {
  vi.stubEnv("NODE_ENV", "production");
  for (const url of ["http://example.com/hook", "https://localhost./hook", "https://127.1/hook", "https://10.1.2.3/hook", "https://[::1]/hook", "https://[fc01::1]/hook", "https://[::ffff:127.0.0.1]/hook", "https://user:pass@example.com/hook"]) expect(isSafeWebhookUrl(url), url).toBe(false);
  expect(isSafeWebhookUrl("http://example.com/hook", true)).toBe(true);
  expect(isSafeWebhookUrl("https://[2606:4700:4700::1111]/hook")).toBe(true);
  vi.stubEnv("NIMMARI_WEBHOOK_ALLOW_PRIVATE", "1");
  expect(isSafeWebhookUrl("http://127.0.0.1:3334/hook")).toBe(true);
});
it("enforces sequential turns and returns token-free signer summaries", async () => {
  await send(req({ signers: [{ key: "first", email: "first@example.com", order: 0 }, { key: "second", email: "second@example.com", order: 1 }], notify: false }), params());
  const waiting = { params: Promise.resolve({ id: "doc", slot: "second" }) };
  expect((await reissue(req({}), waiting)).status).toBe(409);
  expect((await resend(req({ signers: ["second"], notify: false }), params())).status).toBe(409);
  const result = await (await resend(req({ notify: false }), params())).json();
  expect(result.signers).toHaveLength(1); expect(result.signers[0].key).toBe("first");
  const listed = await (await list(req())).json();
  const doc = listed.documents.find((d: { id: string }) => d.id === "doc");
  expect(doc.signers).toHaveLength(2); expect(JSON.stringify(doc)).not.toContain('"token"');
  await db.update(schema.signingSession).set({ signedAt: new Date() }).where(eq(schema.signingSession.signerKey, "first"));
  expect((await reissue(req({}), waiting)).status).toBe(200);
});
it("emails an idempotent send once and replays after signing has started", async () => {
  await db.update(schema.document).set({ notify: true }).where(eq(schema.document.id, "doc"));
  const requests = await Promise.all([send(req({ ...body, notify: true }, "emailed"), params()), send(req({ ...body, notify: true }, "emailed"), params())]);
  const original = await requests[0].json();
  expect(await requests[1].json()).toEqual(original);
  expect(state.email).toHaveBeenCalledTimes(1);
  await db.update(schema.signingSession).set({ signedAt: new Date() });
  await db.update(schema.document).set({ status: "completed" }).where(eq(schema.document.id, "doc"));
  expect(await (await send(req({ ...body, notify: true }, "emailed"), params())).json()).toEqual(original);
  expect(state.email).toHaveBeenCalledTimes(1);
});
it.each(["completed", "cancelled", "declined"] as const)("refuses reissue on %s documents", async (status) => {
  const original = await (await send(req(body), params())).json();
  await db.update(schema.document).set({ status }).where(eq(schema.document.id, "doc"));
  expect((await reissue(req({}), { params: Promise.resolve({ id: "doc", slot: original.signingSessionId }) })).status).toBe(409);
});
it("honors lease expiry and refuses manual redelivery while a worker owns the lease", async () => {
  const row = deliveryValues({ id: "doc", ownerId: "a", webhookUrl: "https://example.com/hook" }, "document.cancelled", { event: "document.cancelled" });
  await db.insert(schema.webhookDelivery).values({ ...row, leaseToken: "another-worker", leaseUntil: new Date(Date.now() + 60000) });
  const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 200 })); vi.stubGlobal("fetch", fetcher);
  expect(await processDeliveries("a")).toEqual({ processed: 0 });
  expect((await redeliver(req({}), params(row.id))).status).toBe(409);
  expect(fetcher).not.toHaveBeenCalled();
  await db.update(schema.webhookDelivery).set({ leaseUntil: new Date(0) });
  expect(await processDeliveries("b")).toEqual({ processed: 0 });
  expect(await processDeliveries("a")).toEqual({ processed: 1 });
});
