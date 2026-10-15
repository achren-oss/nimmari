import { beforeAll, afterAll, beforeEach, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { mkdtemp, rm } from "node:fs/promises";
import * as schema from "@/db/schema";

const local = vi.hoisted(() => ({ db: undefined as unknown, client: undefined as unknown }));
vi.mock("@/db", () => ({ get db() { return local.db; }, get client() { return local.client; } }));
vi.mock("@/lib/session", () => ({ getServerSession: async () => null }));
const directory = await mkdtemp("/tmp/nimmari-setup-");
const client = createClient({ url: `file:${directory}/test.db` });
const database = drizzle(client, { schema });
local.db = database;
local.client = client;
const route = await import("@/app/api/setup/claim/route");
const accounts = await import("@/app/api/accounts/route");
const keys = await import("@/app/api/keys/route");
const { getApiIdentity } = await import("../api-auth");
const { auth } = await import("../auth");
const code = "a".repeat(48);
const request = (body: unknown = { setupCode: code, email: "owner@example.com", name: "Owner" }) =>
  new Request("https://instance.example/api/setup/claim", { method: "POST", headers: { "Content-Type": "application/json", "x-real-ip": "setup-test" }, body: JSON.stringify(body) });
beforeAll(async () => { await migrate(database, { migrationsFolder: "drizzle" }); });
beforeEach(async () => {
  for (const table of [schema.apiKey, schema.account, schema.session, schema.user, schema.setupClaim, schema.rateLimitBucket]) await database.delete(table);
  vi.stubEnv("NIMMARI_SETUP_CODE", code);
  vi.stubEnv("APP_URL", "https://instance.example/");
});
afterAll(async () => { client.close(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
it("disables missing/short codes and supports the legacy alias", async () => {
  vi.stubEnv("NIMMARI_SETUP_CODE", undefined);
  vi.stubEnv("PUUMERKKI_SETUP_CODE", undefined);
  expect((await route.POST(request())).status).toBe(404);
  vi.stubEnv("NIMMARI_SETUP_CODE", "");
  vi.stubEnv("PUUMERKKI_SETUP_CODE", code);
  expect((await route.POST(request())).status).toBe(404);
  expect(await (await route.GET()).json()).toEqual({ enabled: false, claimed: false });
  vi.stubEnv("NIMMARI_SETUP_CODE", "short");
  expect((await route.POST(request())).status).toBe(404);
  delete process.env.NIMMARI_SETUP_CODE;
  expect((await route.POST(request())).status).toBe(201);
});
it("limits failed codes and marks every response no-store", async () => {
  for (let i = 0; i < 10; i++) {
    const response = await route.POST(request({ setupCode: "wrong" }));
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  }
  expect((await route.POST(request())).status).toBe(429);
});
it("creates login-compatible credentials and working admin and regular keys once", async () => {
  const response = await route.POST(request());
  expect(response.status).toBe(201);
  const result = await response.json();
  expect(result.baseUrl).toBe("https://instance.example");
  const login = await auth.api.signInEmail({ body: { email: result.account.email, password: result.password } });
  expect(login.user.id).toBe(result.account.id);
  const bearer = (key: string) => new Request("https://instance.example/api/accounts", { headers: { authorization: `Bearer ${key}` } });
  expect((await accounts.GET(bearer(result.adminKey.key))).status).toBe(200);
  expect((await keys.GET(bearer(result.adminKey.key))).status).toBe(200);
  expect(await getApiIdentity(bearer(result.agentKey.key))).toMatchObject({ userId: result.account.id, scope: "regular" });
  expect((await accounts.GET(bearer(result.agentKey.key))).status).toBe(403);
  expect((await route.POST(request())).status).toBe(410);
  expect(await (await route.GET()).json()).toEqual({ enabled: true, claimed: true });
});
it("serializes concurrent claims with exactly one winner", async () => {
  const responses = await Promise.all([route.POST(request()), route.POST(request())]);
  expect(responses.map(r => r.status).sort()).toEqual([201, 410]);
  expect(await database.select().from(schema.user)).toHaveLength(1);
  expect(await database.select().from(schema.apiKey)).toHaveLength(2);
});
it("refuses an existing account without consuming the claim", async () => {
  await database.insert(schema.user).values({ id: "existing", email: "existing@example.com", name: "Existing", emailVerified: false, createdAt: new Date(), updatedAt: new Date() });
  expect((await route.POST(request())).status).toBe(409);
  expect(await database.select().from(schema.setupClaim)).toHaveLength(0);
});
it("rolls back all writes on key failure and permits retry", async () => {
  await client.execute("CREATE TRIGGER fail_key BEFORE INSERT ON api_key BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  try {
    expect((await route.POST(request())).status).toBe(500);
    expect(await database.select().from(schema.setupClaim)).toHaveLength(0);
    expect(await database.select().from(schema.user)).toHaveLength(0);
    expect(await database.select().from(schema.account)).toHaveLength(0);
  } finally { await client.execute("DROP TRIGGER fail_key"); }
  const result = await route.POST(request({ setupCode: code, email: "owner@example.com", name: "Owner", password: "password1234" }));
  expect(result.status).toBe(201);
  expect(await result.json()).not.toHaveProperty("password");
});
