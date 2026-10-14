import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { mkdtemp, rm } from "node:fs/promises";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";

const local = vi.hoisted(() => ({ session: vi.fn(), db: undefined as unknown }));
vi.mock("@/db", () => ({ get db() { return local.db; } }));
vi.mock("@/lib/session", () => ({ getServerSession: local.session }));
const directory = await mkdtemp("/tmp/puumerkki-auth-test-");
const client = createClient({ url: `file:${directory}/test.db` });
const database = drizzle(client, { schema });
local.db = database;
const { hashApiKey } = await import("../api-keys");
const { getApiIdentity } = await import("../api-auth");
const accounts = await import("@/app/api/accounts/route");
const documents = await import("@/app/api/documents/[id]/route");
const keys = await import("@/app/api/keys/route");
const revoke = await import("@/app/api/keys/[id]/route");
const revokePost = await import("@/app/api/keys/[id]/revoke/route");
const { auth } = await import("../auth");
const request = (key?: string, body?: unknown, path = "/api/keys") => new Request(`http://localhost${path}`, { method: body === undefined ? "GET" : "POST", headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

beforeAll(async () => {
  await migrate(database, { migrationsFolder: "drizzle" });
  await migrate(database, { migrationsFolder: "drizzle" });
});
afterAll(async () => { client.close(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
beforeEach(() => { local.session.mockReset().mockResolvedValue(null); vi.stubEnv("PUUMERKKI_API_KEY", "test-root-key"); vi.stubEnv("PUUMERKKI_API_OWNER_ID", ""); });

describe("API key authentication and provisioning", () => {
  it("allows the existing root environment key to bootstrap, but requires an owner for document identity", async () => {
    expect(await getApiIdentity(request("test-root-key"))).toBeNull();
    expect(await getApiIdentity(request("test-root-key"), { allowOwnerlessRoot: true })).toMatchObject({ via: "root", scope: "admin", userId: "" });
    vi.stubEnv("PUUMERKKI_API_OWNER_ID", "owner");
    expect(await getApiIdentity(request("test-root-key"))).toMatchObject({ userId: "owner" });
  });
  it("rejects missing, invalid, and session credentials for agent endpoints", async () => {
    expect((await accounts.POST(request())).status).toBe(401);
    local.session.mockResolvedValue({ user: { id: "owner" } });
    expect((await accounts.POST(request())).status).toBe(403);
    expect((await accounts.POST(request("invalid"))).status).toBe(401);
    expect((await keys.GET(request())).status).toBe(403);
    expect(local.session).toHaveBeenCalledTimes(3);
  });
  it("rejects malformed authorization without falling back to session cookies", async () => {
    local.session.mockResolvedValue({ user: { id: "owner" } });
    for (const authorization of ["Basic credentials", "Bearer", "Bearer a b", "", "Bearer invalid"]) {
      const req = new Request("http://localhost/api/keys", { headers: { authorization } });
      expect(await getApiIdentity(req)).toBeNull();
    }
    expect(local.session).not.toHaveBeenCalled();
    expect(await getApiIdentity(request())).toMatchObject({ via: "session", userId: "owner" });
  });
  it("provisions login-compatible credentials, forbids signup, and handles duplicates", async () => {
    const response = await accounts.POST(request("test-root-key", { email: " Owner@Example.com ", name: "Owner" }));
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result.email).toBe("owner@example.com");
    const credential = await database.query.account.findFirst({ where: eq(schema.account.userId, result.id) });
    const context = await auth.$context;
    expect(await context.password.verify({ hash: credential!.password!, password: result.password })).toBe(true);
    const login = await auth.api.signInEmail({ body: { email: result.email, password: result.password } });
    expect(login.user.id).toBe(result.id);
    await expect(auth.api.signUpEmail({ body: { email: "public@example.com", name: "Public", password: "password1234" } })).rejects.toThrow();
    expect(await context.internalAdapter.createUser({ email: "provider@example.com", name: "Provider" }, { method: "oauth", oauth: { providerId: "test" } })).toBeFalsy();
    expect((await accounts.POST(request("test-root-key", { email: result.email, name: "Duplicate" }))).status).toBe(409);
    expect((await accounts.POST(request("test-root-key", { email: "bad", name: "" }))).status).toBe(400);
    expect((await accounts.POST(request("test-root-key", { email: "short@example.com", name: "Short", password: "x" }))).status).toBe(400);
    const supplied = await accounts.POST(request("test-root-key", { email: "other@example.com", name: "Other", password: "password1234" }));
    expect(await supplied.json()).not.toHaveProperty("password");
  });
  it("enforces key scope, ownership, listing redaction, revocation, and last-used tracking", async () => {
    await accounts.POST(request("test-root-key", { email: "owner@example.com", name: "Owner", password: "password1234" }));
    await accounts.POST(request("test-root-key", { email: "other@example.com", name: "Other", password: "password1234" }));
    const users = await database.select().from(schema.user);
    const owner = users.find((u) => u.email === "owner@example.com")!;
    const other = users.find((u) => u.email === "other@example.com")!;
    expect((await keys.POST(request("test-root-key", { name: "missing owner" }))).status).toBe(400);
    expect((await keys.POST(request("test-root-key", { name: "bad owner", ownerUserId: "missing" }))).status).toBe(404);
    const created = await keys.POST(request("test-root-key", { name: "Agent", ownerUserId: owner.id }));
    const regular = await created.json();
    expect(created.status).toBe(201);
    expect(await getApiIdentity(request(regular.key))).toMatchObject({ userId: owner.id, scope: "regular", keyId: regular.id, via: "key" });
    const stored = await database.query.apiKey.findFirst({ where: eq(schema.apiKey.id, regular.id) });
    expect(stored!.lastUsedAt).toBeInstanceOf(Date);
    expect(stored!.keyHash).toBe(hashApiKey(regular.key));
    const tracking = vi.spyOn(database, "update").mockImplementationOnce(() => { throw new Error("tracking unavailable"); });
    expect(await getApiIdentity(request(regular.key))).toMatchObject({ userId: owner.id });
    tracking.mockRestore();
    expect((await accounts.POST(request(regular.key, {}))).status).toBe(403);
    expect((await keys.POST(request(regular.key, { name: "escalate", scope: "admin" }))).status).toBe(403);
    expect((await keys.POST(request(regular.key, { name: "other", ownerUserId: other.id }))).status).toBe(403);
    const childResponse = await keys.POST(request(regular.key, { name: "child" }));
    expect(childResponse.status).toBe(201);
    const child = await childResponse.json();
    expect((await revoke.DELETE(request(regular.key), { params: Promise.resolve({ id: child.id }) })).status).toBe(200);
    expect(await getApiIdentity(request(child.key))).toBeNull();
    const admin = await (await keys.POST(request("test-root-key", { name: "Admin", scope: "admin", ownerUserId: other.id }))).json();
    expect((await accounts.POST(request(admin.key, { name: "Third", email: "third@example.com" }))).status).toBe(201);
    const now = new Date();
    await database.insert(schema.document).values({ id: "owned-document", ownerId: owner.id, title: "Owner document", createdAt: now, updatedAt: now });
    const documentParams = { params: Promise.resolve({ id: "owned-document" }) };
    expect((await documents.GET(request(regular.key), documentParams)).status).toBe(200);
    expect((await documents.GET(request(admin.key), documentParams)).status).toBe(404);
    const ownList = await (await keys.GET(request(regular.key, undefined, `/api/keys?ownerUserId=${other.id}`))).json();
    expect(ownList.keys.every((k: { ownerUserId: string }) => k.ownerUserId === owner.id)).toBe(true);
    expect(JSON.stringify(ownList)).not.toContain("keyHash");
    expect(JSON.stringify(ownList)).not.toContain(regular.key);
    const all = await (await keys.GET(request(admin.key))).json();
    expect(all.keys.length).toBeGreaterThan(ownList.keys.length);
    const filtered = await (await keys.GET(request(admin.key, undefined, `/api/keys?ownerUserId=${other.id}`))).json();
    expect(filtered.keys).toHaveLength(1);
    expect((await revoke.DELETE(request(regular.key), { params: Promise.resolve({ id: admin.id }) })).status).toBe(404);
    expect((await revokePost.POST(request(admin.key), { params: Promise.resolve({ id: regular.id }) })).status).toBe(200);
    expect(await getApiIdentity(request(regular.key))).toBeNull();
    expect((await revoke.DELETE(request("test-root-key"), { params: Promise.resolve({ id: regular.id }) })).status).toBe(200);
  });
});

describe("account management", () => {
  const remove = async (key: string | undefined, id: string) => {
    const route = await import("@/app/api/accounts/[id]/route");
    return route.DELETE(request(key), { params: Promise.resolve({ id }) });
  };
  const provision = async (email: string) => (await accounts.POST(request("test-root-key", { email, name: email, password: "password1234" }))).json();

  it("enforces list and delete permissions without falling back from invalid bearer keys", async () => {
    const owner = await provision("permissions@example.com");
    const regular = await (await keys.POST(request("test-root-key", { name: "Regular", ownerUserId: owner.id }))).json();
    for (const [key, status] of [[undefined, 401], ["invalid", 401], [regular.key, 403]] as const) {
      expect((await accounts.GET(request(key))).status).toBe(status);
      expect((await remove(key, owner.id)).status).toBe(status);
    }
    local.session.mockResolvedValue({ user: { id: owner.id } });
    expect((await accounts.GET(request())).status).toBe(403);
    expect((await remove(undefined, owner.id)).status).toBe(403);
    expect((await accounts.GET(request("invalid"))).status).toBe(401);
    expect((await remove("invalid", owner.id)).status).toBe(401);
    expect((await remove("test-root-key", "unknown" )).status).toBe(404);
  });

  it("lists only public account metadata, sorts dates, and normalizes the exact email filter", async () => {
    const owner = await provision("listing@example.com");
    await database.update(schema.user).set({ disabledAt: new Date(), createdAt: new Date(1000) }).where(eq(schema.user.id, owner.id));
    const admin = await (await keys.POST(request("test-root-key", { name: "Admin", scope: "admin", ownerUserId: owner.id }))).json();
    const response = await accounts.GET(request(admin.key));
    const { accounts: rows } = await response.json();
    expect(rows[0]).toEqual({ id: owner.id, email: owner.email, name: owner.name, createdAt: new Date(1000).toISOString(), disabled: true });
    expect(rows.map((row: { createdAt: string }) => row.createdAt)).toEqual(rows.map((row: { createdAt: string }) => row.createdAt).sort());
    const filtered = await (await accounts.GET(request("test-root-key", undefined, "/api/accounts?email=LISTING%40example.com"))).json();
    expect(filtered.accounts).toEqual([rows[0]]);
    expect(await (await accounts.GET(request("test-root-key", undefined, "/api/accounts?email=absent@example.com"))).json()).toEqual({ accounts: [] });
  });

  it("protects configured owners, the caller, and accounts with documents", async () => {
    const owner = await provision("protected@example.com");
    vi.stubEnv("PUUMERKKI_API_OWNER_ID", owner.id);
    expect((await remove("test-root-key", owner.id)).status).toBe(409);
    vi.stubEnv("PUUMERKKI_API_OWNER_ID", "");
    const admin = await (await keys.POST(request("test-root-key", { name: "Admin", scope: "admin", ownerUserId: owner.id }))).json();
    expect((await remove(admin.key, owner.id)).status).toBe(409);
    await database.insert(schema.document).values({ id: "protected-document", ownerId: owner.id, title: "Keep", createdAt: new Date(), updatedAt: new Date() });
    const response = await remove("test-root-key", owner.id);
    expect(response.status).toBe(409);
    expect(await response.json()).toHaveProperty("error");
    expect(await database.query.document.findFirst({ where: eq(schema.document.id, "protected-document") })).toBeTruthy();
    expect(await getApiIdentity(request(admin.key))).toBeTruthy();
  });

  it("deletes credentials, sessions and keys with foreign keys enabled; old credentials stop working", async () => {
    await client.execute("PRAGMA foreign_keys = ON");
    const caller = await provision("delete-admin@example.com");
    const admin = await (await keys.POST(request("test-root-key", { name: "Admin", scope: "admin", ownerUserId: caller.id }))).json();
    for (const key of [admin.key, "test-root-key"]) {
      const owner = await provision(`delete-${key === admin.key ? "admin" : "root"}-target@example.com`);
      const targetKey = await (await keys.POST(request("test-root-key", { name: "Target", ownerUserId: owner.id }))).json();
      await auth.api.signInEmail({ body: { email: owner.email, password: "password1234" } });
      const response = await remove(key, owner.id);
      expect(await response.json()).toEqual({ ok: true, id: owner.id });
      expect(response.status).toBe(200);
      expect(await database.query.user.findFirst({ where: eq(schema.user.id, owner.id) })).toBeUndefined();
      expect(await database.select().from(schema.account).where(eq(schema.account.userId, owner.id))).toEqual([]);
      expect(await database.select().from(schema.session).where(eq(schema.session.userId, owner.id))).toEqual([]);
      expect(await database.select().from(schema.apiKey).where(eq(schema.apiKey.ownerUserId, owner.id))).toEqual([]);
      expect(await getApiIdentity(request(targetKey.key))).toBeNull();
      await expect(auth.api.signInEmail({ body: { email: owner.email, password: "password1234" } })).rejects.toThrow();
    }
  });

  it("rolls back revocation and credential cleanup if user deletion fails", async () => {
    const owner = await provision("rollback@example.com");
    const key = await (await keys.POST(request("test-root-key", { name: "Rollback", ownerUserId: owner.id }))).json();
    await auth.api.signInEmail({ body: { email: owner.email, password: "password1234" } });
    await client.execute("CREATE TRIGGER prevent_account_delete BEFORE DELETE ON user BEGIN SELECT RAISE(ABORT, 'test deletion failure'); END");
    try {
      await expect(remove("test-root-key", owner.id)).rejects.toThrow();
      expect(await database.query.user.findFirst({ where: eq(schema.user.id, owner.id) })).toBeTruthy();
      expect(await database.query.account.findFirst({ where: eq(schema.account.userId, owner.id) })).toBeTruthy();
      expect(await database.query.session.findFirst({ where: eq(schema.session.userId, owner.id) })).toBeTruthy();
      expect(await getApiIdentity(request(key.key))).toBeTruthy();
    } finally {
      await client.execute("DROP TRIGGER prevent_account_delete");
    }
  });

  it("blocks disabled login and session creation", async () => {
    const owner = await provision("disabled@example.com");
    await database.update(schema.user).set({ disabledAt: new Date() }).where(eq(schema.user.id, owner.id));
    await expect(auth.api.signInEmail({ body: { email: owner.email, password: "password1234" } })).rejects.toThrow("Account disabled");
    expect(await database.select().from(schema.session).where(eq(schema.session.userId, owner.id))).toEqual([]);
  });
});

it("returns 429 for repeated bearer failures without blocking valid credentials", async () => {
  const req = (key: string) => new Request("http://localhost/api/keys", {
    headers: { authorization: `Bearer ${key}`, "x-real-ip": "auth-throttle-test" },
  });
  for (let i = 0; i < 30; i++) expect((await keys.GET(req("invalid"))).status).toBe(401);
  const limited = await keys.GET(req("invalid"));
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
  expect((await keys.GET(req("test-root-key"))).status).toBe(200);
});
