import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { PDFDocument, PDFName, PDFDict } from "pdf-lib";
import { OPS, Util, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";

const state = vi.hoisted(() => ({ db: null as unknown, webhook: vi.fn(), email: vi.fn(), rateLimit: { response: null as Response | null, count: 1 as number | null } }));
vi.mock("resend", () => ({ Resend: class { emails = { send: state.email }; } }));
vi.mock("@/db", () => ({ get db() { return state.db; } }));
vi.mock("@/lib/api-auth", () => ({ getApiIdentity: async () => ({ userId: "owner" }) }));
vi.mock("@/lib/rate-limit", () => ({ signRateLimit: () => null, signRateLimitWithCount: () => state.rateLimit }));
vi.mock("@/lib/render-pdf", () => ({ renderHtmlToPdf: async () => {
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create(); pdf.addPage(); return pdf.save();
} }));
vi.mock("@/lib/webhook", () => ({ sendWebhook: state.webhook }));
import { POST as sign, GET as readSign } from "@/app/api/sign/[token]/route";
import { POST as cancel } from "@/app/api/documents/[id]/cancel/route";
import { POST as decline } from "@/app/api/sign/[token]/decline/route";
import { GET as readPdf } from "@/app/api/sign/[token]/pdf/route";
import { POST as send } from "@/app/api/documents/[id]/send/route";
import { PUT as putFields } from "@/app/api/documents/[id]/fields/route";
import { GET as readDocument } from "@/app/api/documents/[id]/route";
import { GET as documentPdf } from "@/app/api/documents/[id]/pdf/route";
import { rebuildSignedArtifact } from "@/lib/rebuild-signed-artifact";

const directory = mkdtempSync("/tmp/nimmari-test-");
const client = createClient({ url: `file:${directory}/test.db` });
const db = drizzle(client, { schema });
const SIG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";
const tokenParams = (token: string) => ({ params: Promise.resolve({ token }) });
const docParams = () => ({ params: Promise.resolve({ id: "doc" }) });
const request = (body?: object) => new Request("http://localhost/api", { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}) });

beforeAll(async () => {
  state.db = db;
  for (const file of readdirSync("drizzle").filter((f) => f.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(`drizzle/${file}`, "utf8").split(";").map((s) => s.replace(/--[^\n]*/g, "").trim()).filter(Boolean)) await client.execute(statement);
  }
});
afterAll(() => { client.close(); rmSync(directory, { recursive: true, force: true }); });
beforeEach(async () => {
  vi.unstubAllEnvs();
  state.email.mockReset().mockResolvedValue({ data: { id: "email" }, error: null });
  state.webhook.mockReset().mockResolvedValue({ success: true });
  await db.delete(schema.field); await db.delete(schema.signingSession); await db.delete(schema.document); await db.delete(schema.user);
  const now = new Date();
  const pdf = await PDFDocument.create(); pdf.addPage([800, 842]);
  await db.insert(schema.user).values({ id: "owner", name: "Owner", email: "owner@example.com", createdAt: now, updatedAt: now });
  await db.insert(schema.document).values({ id: "doc", ownerId: "owner", title: "Contract", pdf: Buffer.from(await pdf.save()), status: "sent", notify: false, webhookUrl: "https://example.com/hook", createdAt: now, updatedAt: now });
  for (let i = 0; i < 3; i++) {
    await db.insert(schema.signingSession).values({ id: `s${i}`, documentId: "doc", recipientEmail: `signer${i}@example.com`, token: `t${i}`, createdAt: now, expiresAt: new Date(Date.now() + 86400000) });
    await db.insert(schema.field).values({ id: `f${i}`, documentId: "doc", type: "signature", assignedToSignerEmail: `signer${i}@example.com`, page: 0, x: 40, y: 100 + i * 80, width: 150, height: 50 });
  }
});

describe("signing lifecycle on libsql", () => {
  it("rebuilds all three signatures independently of session/field order, with one seal", async () => {
    // Exercise concurrent route persistence, then rebuild across input order.
    const responses = await Promise.all([0, 1, 2].map((i) => sign(request({ values: {}, signaturePng: SIG }), tokenParams(`t${i}`))));
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    const [doc] = await db.select().from(schema.document);
    expect(doc.status).toBe("completed");
    const fields = await db.select().from(schema.field);
    const sessions = await db.select().from(schema.signingSession);
    for (const bytes of [doc.signedPdf as Uint8Array, (await rebuildSignedArtifact(doc, fields.reverse(), sessions.reverse())).signedPdf!]) {
      const loaded = await PDFDocument.load(bytes);
      const resources = loaded.getPage(0).node.Resources()!;
      const objects = resources.lookup(PDFName.of("XObject"), PDFDict);
      // Each PNG may include an alpha mask; count page image references, not masks.
      expect(objects.keys()).toHaveLength(3);
      expect(loaded.getPageCount()).toBe(2);
      const parsed = await getDocument({ data: new Uint8Array(bytes) }).promise;
      let text = "";
      for (let p = 1; p <= parsed.numPages; p++) text += (await (await parsed.getPage(p)).getTextContent()).items.map((item) => "str" in item ? item.str : "").join(" ");
      expect(text.match(/Sealed/g)).toHaveLength(1);
      for (let i = 0; i < 3; i++) expect(text.match(new RegExp(`signer${i}@example.com`, "g"))).toHaveLength(1);
      await parsed.destroy();
    }
    expect(state.webhook).toHaveBeenCalledTimes(1);
  });
  it("cancel invalidates GET and POST tokens and rejects repeated cancellation", async () => {
    expect((await cancel(request({ reason: "Withdrawn" }), docParams())).status).toBe(200);
    expect((await readSign(request(), tokenParams("t1"))).status).toBe(410);
    expect((await sign(request({ values: {}, signaturePng: SIG }), tokenParams("t1"))).status).toBe(410);
    expect((await cancel(request(), docParams())).status).toBe(409);
    expect(state.webhook.mock.calls[0][1]).toMatchObject({ event: "document.cancelled", reason: "Withdrawn" });
  });
  it("decline records reason, blocks other tokens and emits the event", async () => {
    expect((await decline(request({ reason: "Disagree" }), tokenParams("t0"))).status).toBe(200);
    const [doc] = await db.select().from(schema.document);
    expect(doc.status).toBe("declined");
    const [session] = await db.select().from(schema.signingSession).where(eq(schema.signingSession.id, "s0"));
    expect(session.declinedAt).toBeInstanceOf(Date); expect(session.declineReason).toBe("Disagree");
    expect((await readSign(request(), tokenParams("t1"))).status).toBe(410);
    expect((await sign(request({ values: {}, signaturePng: SIG }), tokenParams("t1"))).status).toBe(410);
    expect(state.webhook.mock.calls[0][1]).toMatchObject({ event: "document.declined", reason: "Disagree", document: { status: "declined" } });
  });
  it("blocks new signers after signing starts", async () => {
    await sign(request({ values: {}, signaturePng: SIG }), tokenParams("t0"));
    const response = await send(request({ email: "new@example.com" }), docParams());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Signing has already started; signers cannot be added." });
  });
  it("keeps signed-copy access while blocking unsigned PDF tokens after cancellation", async () => {
    await sign(request({ values: {}, signaturePng: SIG }), tokenParams("t0"));
    await cancel(request(), docParams());
    expect((await readPdf(request(), tokenParams("t0"))).status).toBe(200);
    expect((await readPdf(request(), tokenParams("t1"))).status).toBe(410);
    expect((await sign(request(), tokenParams("t0"))).status).toBe(410);
  });
  it("rebuilds HTML documents with all persisted signatures", async () => {
    await db.update(schema.document).set({ kind: "html", htmlSource: '<html><body><div data-pm-field="sig0" data-pm-type="signature"></div><div data-pm-field="sig1" data-pm-type="signature"></div><div data-pm-field="sig2" data-pm-type="signature"></div></body></html>' });
    for (let i = 0; i < 3; i++) await db.update(schema.field).set({ name: `sig${i}` }).where(eq(schema.field.id, `f${i}`));
    const responses = await Promise.all([0, 1, 2].map((i) => sign(request({ values: {}, signaturePng: SIG }), tokenParams(`t${i}`))));
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    const [doc] = await db.select().from(schema.document);
    expect(doc.status).toBe("completed");
    expect(doc.signedHtml!.split(SIG)).toHaveLength(4);
    for (let i = 0; i < 3; i++) expect(doc.signedHtml).toContain(`signer${i}@example.com`);
  });
  it("rejects decline reasons over 1000 characters and signed-session declines", async () => {
    expect((await decline(request({ reason: "x".repeat(1001) }), tokenParams("t0"))).status).toBe(400);
    await sign(request({ values: {}, signaturePng: SIG }), tokenParams("t0"));
    expect((await decline(request({}), tokenParams("t0"))).status).toBe(409);
  });
  it("rejects duplicate email sessions", async () => {
    expect((await send(request({ email: "signer0@example.com" }), docParams())).status).toBe(400);
  });
});

async function prepareRoles(keys = true) {
  await db.delete(schema.signingSession);
  await db.update(schema.document).set({ status: "draft", auditTimezone: "Europe/Helsinki" });
  const fields = ["seller", "guarantor"].flatMap((key, index) => [
    { type: "signature", name: `${key}-signature`, page: 0, x: 40 + index * 300, y: 100, width: 150, height: 50, assignedToSignerEmail: "same@example.com", ...(keys ? { assignedSignerKey: key } : {}) },
    { type: "text", name: `${key}-private`, page: 0, x: 40 + index * 300, y: 200, width: 150, height: 30, privateForOtherSigners: true, assignedToSignerEmail: "same@example.com", ...(keys ? { assignedSignerKey: key } : {}) },
  ]);
  expect((await putFields(request({ fields }), docParams())).status).toBe(200);
  const response = await send(request({ notify: false, signers: [
    { email: "same@example.com", key: "seller" },
    { email: "same@example.com", key: "guarantor" },
  ] }), docParams());
  return response;
}

async function pdfText(bytes: Uint8Array) {
  const parsed = await getDocument({ data: new Uint8Array(bytes) }).promise;
  let text = "";
  for (let p = 1; p <= parsed.numPages; p++) text += (await (await parsed.getPage(p)).getTextContent()).items.map((item) => "str" in item ? item.str : "").join(" ");
  await parsed.destroy();
  return text;
}

describe("per-session field assignment", () => {
  it("rejects duplicate emails when any field relies on email alone", async () => {
    const response = await prepareRoles(false);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("keys/roles");
    expect(await db.select().from(schema.signingSession)).toHaveLength(0);
  });

  it("signs only the current slot, masks by key, and seals both sessions once", async () => {
    const response = await prepareRoles();
    expect(response.status).toBe(200);
    const sent = await response.json();
    expect(sent.signers.map((s: { key: string }) => s.key)).toEqual(["seller", "guarantor"]);
    const sessions = await db.select().from(schema.signingSession);
    const seller = sessions.find((s) => s.signerKey === "seller")!;
    const guarantor = sessions.find((s) => s.signerKey === "guarantor")!;
    const fields = await db.select().from(schema.field);
    const privateSeller = fields.find((f) => f.name === "seller-private")!;
    const privateGuarantor = fields.find((f) => f.name === "guarantor-private")!;
    const sellerSignature = fields.find((f) => f.name === "seller-signature")!;
    const guarantorSignature = fields.find((f) => f.name === "guarantor-signature")!;
    const payload = await (await readSign(request(), tokenParams(seller.token))).json();
    expect(payload.signerKey).toBe("seller");
    expect(payload.fields.map((f: { assignedSignerKey: string }) => f.assignedSignerKey)).toEqual(["seller", "seller"]);
    expect((await sign(request({ signaturePng: SIG, values: {} }), tokenParams(seller.token))).status).toBe(400);
    expect((await sign(request({ signaturePng: SIG, values: { [privateSeller.id]: "SELLER-SECRET", [privateGuarantor.id]: "tampered" } }), tokenParams(seller.token))).status).toBe(200);
    let [doc] = await db.select().from(schema.document);
    expect(doc.status).toBe("sent");
    const persisted = await db.select().from(schema.field);
    expect(persisted.find((f) => f.id === privateGuarantor.id)!.value).toBeNull();
    expect(persisted.find((f) => f.id === guarantorSignature.id)!.value).toBeNull();
    expect(persisted.find((f) => f.id === sellerSignature.id)!.value).toBe(SIG);
    const partial = await PDFDocument.load(doc.signedPdf as Uint8Array);
    expect(partial.getPage(0).node.Resources()!.lookup(PDFName.of("XObject"), PDFDict).keys()).toHaveLength(1);
    for (const response of [
      await readPdf(request(), tokenParams(guarantor.token)),
      await documentPdf(new Request(`http://localhost/api?t=${guarantor.token}`), docParams()),
      await documentPdf(new Request(`http://localhost/api?t=${guarantor.token}&signed=1`), docParams()),
    ]) {
      expect(response.status).toBe(200);
      const text = await pdfText(new Uint8Array(await response.arrayBuffer()));
      expect(text).not.toContain("SELLER-SECRET");
      expect(text).toContain("************");
    }
    const ownCopy = await readPdf(request(), tokenParams(seller.token));
    expect(await pdfText(new Uint8Array(await ownCopy.arrayBuffer()))).toContain("SELLER-SECRET");
    expect((await sign(request({ signaturePng: SIG, values: { [privateGuarantor.id]: "GUARANTOR-SECRET" } }), tokenParams(guarantor.token))).status).toBe(200);
    [doc] = await db.select().from(schema.document);
    expect(doc.status).toBe("completed");
    const loaded = await PDFDocument.load(doc.signedPdf as Uint8Array);
    expect(loaded.getPageCount()).toBe(2);
    expect(loaded.getPage(0).node.Resources()!.lookup(PDFName.of("XObject"), PDFDict).keys()).toHaveLength(2);
    const text = await pdfText(doc.signedPdf as Uint8Array);
    expect(text.match(/same@example.com/g)).toHaveLength(2);
    expect(text.match(/Sealed/g)).toHaveLength(1);
    expect(text).toContain("Europe/Helsinki");
    expect(text).toContain("SELLER-SECRET");
    expect(text).toContain("GUARANTOR-SECRET");
    const parsed = await getDocument({ data: new Uint8Array(doc.signedPdf as Uint8Array) }).promise;
    const ops = await (await parsed.getPage(1)).getOperatorList();
    let transform = [1, 0, 0, 1, 0, 0];
    const stack: number[][] = [];
    const imagePositions: number[][] = [];
    ops.fnArray.forEach((op, index) => {
      if (op === OPS.save) stack.push([...transform]);
      if (op === OPS.restore) transform = stack.pop()!;
      if (op === OPS.transform) transform = Util.transform(transform, ops.argsArray[index]);
      if (op === OPS.paintImageXObject) imagePositions.push([...transform]);
    });
    expect(imagePositions.sort((a, b) => a[4] - b[4])).toEqual([[50, 0, 0, 50, 90, 692], [50, 0, 0, 50, 390, 692]]);
    await parsed.destroy();
    const ownerPayload = await (await readDocument(request(), docParams())).json();
    expect(ownerPayload.signingSessions.map((s: { signerKey: string }) => s.signerKey)).toEqual(["seller", "guarantor"]);
    expect(ownerPayload.fields.every((f: { assignedSignerKey: string }) => !!f.assignedSignerKey)).toBe(true);
  });

  it("isolates HTML signatures and submitted values for duplicate-email roles", async () => {
    expect((await prepareRoles()).status).toBe(200);
    await db.update(schema.document).set({ kind: "html", htmlSource: '<div data-pm-field="seller-signature" data-pm-type="signature" data-pm-signer-key="seller"></div><input data-pm-field="seller-private" data-pm-signer-key="seller"><div data-pm-field="guarantor-signature" data-pm-type="signature" data-pm-role="guarantor"></div><input data-pm-field="guarantor-private" data-pm-role="guarantor">' });
    const sessions = await db.select().from(schema.signingSession);
    for (const key of ["seller", "guarantor"]) {
      const session = sessions.find((s) => s.signerKey === key)!;
      const response = await sign(request({ values: { [`${key}-private`]: key, ...(key === "seller" ? { "guarantor-private": "tampered" } : {}) }, signaturePng: SIG }), tokenParams(session.token));
      expect(response.status).toBe(200);
      const [doc] = await db.select().from(schema.document);
      expect(doc.signedHtml!.split(SIG)).toHaveLength(key === "seller" ? 2 : 3);
      if (key === "seller") {
        const otherFields = await db.select().from(schema.field);
        expect(otherFields.filter((f) => f.assignedSignerKey === "guarantor").every((f) => f.value === null)).toBe(true);
      } else {
        expect(doc.status).toBe("completed");
        expect(doc.signedHtml!.match(/same@example.com/g)).toHaveLength(2);
      }
    }
  });

  it("generates stable default keys and rejects reused explicit keys", async () => {
    await db.delete(schema.signingSession);
    expect((await send(request({ signers: [{ email: "a@example.com" }, { email: "b@example.com" }] }), docParams())).status).toBe(200);
    expect((await db.select().from(schema.signingSession)).map((s) => s.signerKey)).toEqual(["signer-0", "signer-1"]);
    expect((await send(request({ signers: [{ email: "c@example.com", key: "signer-0" }] }), docParams())).status).toBe(400);
    expect((await send(request({ email: "c@example.com" }), docParams())).status).toBe(200);
    expect((await db.select().from(schema.signingSession)).map((s) => s.signerKey)).toEqual(["signer-0", "signer-1", "signer-2"]);
  });

  it("keeps legacy email-only PDF rendering byte-for-byte equivalent with default session keys", async () => {
    await sign(request({ values: {}, signaturePng: SIG }), tokenParams("t0"));
    const [doc] = await db.select().from(schema.document);
    const fields = await db.select().from(schema.field);
    const sessions = await db.select().from(schema.signingSession);
    // pdf-lib updates metadata dates on load; both rebuilds need the same clock.
    // Leave async timers real so PDF serialization can yield normally.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
      const legacy = await rebuildSignedArtifact(doc, fields, sessions);
      const keyed = await rebuildSignedArtifact(doc, fields, sessions.map((s, index) => ({ ...s, signerKey: `signer-${index}` })));
      expect(legacy.signedPdf).not.toBeNull();
      expect(keyed.signedPdf).toEqual(legacy.signedPdf);
    } finally {
      vi.useRealTimers();
    }
  });

  it("populates only signed keyed sessions even when unsigned fields contain values", async () => {
    expect((await prepareRoles()).status).toBe(200);
    const [doc] = await db.select().from(schema.document);
    const fields = await db.select().from(schema.field);
    const sessions = await db.select().from(schema.signingSession);
    const artifact = await rebuildSignedArtifact(doc, fields.map((f) => ({ ...f, value: f.type === "signature" ? SIG : "UNSIGNED-VALUE" })), sessions.map((s) => ({ ...s, signedAt: s.signerKey === "seller" ? new Date() : null })));
    const loaded = await PDFDocument.load(artifact.signedPdf!);
    expect(loaded.getPage(0).node.Resources()!.lookup(PDFName.of("XObject"), PDFDict).keys()).toHaveLength(1);
  });
});

describe("post-signing email outcomes", () => {
  it.each([
    { configured: false, notify: true, enabled: true, calls: 0, copy: false, sender: false },
    { configured: true, notify: false, enabled: true, calls: 0, copy: false, sender: false },
    { configured: true, notify: true, enabled: false, calls: 1, copy: false, sender: true },
    { configured: true, notify: true, enabled: true, calls: 2, copy: true, sender: true },
  ])("reports actual notices for $configured/$notify/$enabled", async ({ configured, notify, enabled, calls, copy, sender }) => {
    vi.stubEnv("RESEND_API_KEY", configured ? "test-key" : "");
    vi.stubEnv("RESEND_FROM", configured ? "test@example.com" : "");
    await db.update(schema.document).set({ notify });
    await db.update(schema.signingSession).set({ inviteEmailEnabled: enabled });
    const response = await sign(request({ values: {}, signaturePng: SIG }), tokenParams("t0"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, copyEmailSent: copy, senderEmailSent: sender });
    expect(state.email).toHaveBeenCalledTimes(calls);
    if (!enabled && calls) expect(state.email.mock.calls[0][0].to).toBe("owner@example.com");
  });

  it.each(["copy", "sender"])("does not claim a failed %s email was sent", async (failed) => {
    vi.stubEnv("RESEND_API_KEY", "test-key");
    vi.stubEnv("RESEND_FROM", "test@example.com");
    await db.update(schema.document).set({ notify: true });
    state.email.mockImplementation(async ({ to }: { to: string }) => {
      if (to === (failed === "copy" ? "signer0@example.com" : "owner@example.com")) {
        if (failed === "sender") throw new Error("Network failure");
        return { data: null, error: { message: "Provider rejected send" } };
      }
      return { data: { id: "email" }, error: null };
    });
    const response = await sign(request({ values: {}, signaturePng: SIG }), tokenParams("t0"));
    expect(await response.json()).toEqual({ ok: true, copyEmailSent: failed !== "copy", senderEmailSent: failed !== "sender" });
  });
});

it("adds signing GET debug counts to allowed and limited responses only when enabled", async () => {
  const original = process.env.NIMMARI_RATE_LIMIT_DEBUG;
  try {
    process.env.NIMMARI_RATE_LIMIT_DEBUG = "1";
    const allowed = await readSign(new Request("http://localhost"), tokenParams("missing-debug-token"));
    expect(allowed.status).toBe(404);
    expect(allowed.headers.get("X-RateLimit-Count")).toBe("1");
    expect(allowed.headers.get("X-RateLimit-IpKey")).toMatch(/^[0-9a-f]{8}$/);
    expect(allowed.headers.has("X-RateLimit-Ip")).toBe(false);
    const publicResponse = await readSign(new Request("http://localhost", { headers: { "x-real-ip": "8.8.8.8" } }), tokenParams("missing-debug-token"));
    expect(publicResponse.headers.get("X-RateLimit-IpKey")).toMatch(/^[0-9a-f]{8}$/);
    expect(publicResponse.headers.has("X-RateLimit-Ip")).toBe(false);
    state.rateLimit = { response: Response.json({ error: "Too many requests" }, { status: 429 }), count: 61 };
    const limited = await readSign(new Request("http://localhost"), tokenParams("missing-debug-token"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("X-RateLimit-Count")).toBe("61");
    state.rateLimit = { response: null, count: 1 };
    process.env.NIMMARI_RATE_LIMIT_DEBUG = "0";
    expect((await readSign(new Request("http://localhost"), tokenParams("missing-debug-token"))).headers.has("X-RateLimit-IpKey")).toBe(false);
    expect((await readSign(new Request("http://localhost"), tokenParams("missing-debug-token"))).headers.has("X-RateLimit-Count")).toBe(false);
    process.env.NIMMARI_RATE_LIMIT_DEBUG = "1";
    state.rateLimit.count = null;
    expect((await readSign(new Request("http://localhost"), tokenParams("missing-debug-token"))).headers.has("X-RateLimit-Count")).toBe(false);
  } finally {
    state.rateLimit = { response: null, count: 1 };
    if (original === undefined) delete process.env.NIMMARI_RATE_LIMIT_DEBUG;
    else process.env.NIMMARI_RATE_LIMIT_DEBUG = original;
  }
});
