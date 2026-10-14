import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { mkdtemp, rm } from "node:fs/promises";
import * as schema from "@/db/schema";

const local = vi.hoisted(() => ({ db: undefined as unknown, client: undefined as unknown }));
vi.mock("@/db", () => ({ get db() { return local.db; }, get client() { return local.client; } }));
const directory = await mkdtemp("/tmp/puumerkki-rate-limit-");
const url = `file:${directory}/test.db`;
const client = createClient({ url });
const secondClient = createClient({ url });
const database = drizzle(client, { schema });
local.db = database;
local.client = client;
const { FixedWindowLimiter, clientIp, signRateLimit, bearerFailureRateLimit, signRateLimitWithCount } = await import("../rate-limit");
const { auth } = await import("../auth");

beforeAll(async () => { await migrate(database, { migrationsFolder: "drizzle" }); });
beforeEach(async () => {
  vi.restoreAllMocks();
  await database.delete(schema.rateLimitBucket);
  await database.delete(schema.rateLimit);
});
afterAll(async () => { client.close(); secondClient.close(); await rm(directory, { recursive: true, force: true }); });

it("shares sequential and concurrent budgets across independent SQLite connections", async () => {
  const instances = [new FixedWindowLimiter(client), new FixedWindowLimiter(secondClient)];
  for (let i = 0; i < 70; i++) {
    expect((await instances[i % 2].check("shared-ip", 60, 1000))?.status).toBe(i < 60 ? undefined : 429);
  }
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => instances[i % 2].check("concurrent", 8, 1000)));
  expect(results.filter((response) => response === null)).toHaveLength(8);
});

it("resets at the fixed window boundary and reports retry seconds", async () => {
  const limiter = new FixedWindowLimiter(client);
  expect(await limiter.check("a", 1, 1000)).toBeNull();
  expect((await limiter.check("a", 1, 2000))?.headers.get("Retry-After")).toBe("58");
  expect((await limiter.check("a", 1, 59999))?.headers.get("Retry-After")).toBe("1");
  expect(await limiter.check("a", 1, 60000)).toBeNull();
});

it("hashes all bucket keys and cleans up old windows opportunistically", async () => {
  const limiter = new FixedWindowLimiter(client);
  vi.spyOn(Math, "random").mockReturnValue(0);
  await limiter.check("secret-token:192.0.2.1", 1, 0);
  const rows = await database.select().from(schema.rateLimitBucket);
  expect(rows[0].key).toMatch(/^[a-f0-9]{64}$/);
  expect(rows[0].key).not.toContain("192.0.2.1");
  await limiter.check("current", 1, 180000);
  expect(await database.select().from(schema.rateLimitBucket)).toHaveLength(1);
});

it("fails open and logs without leaking keys when SQLite fails", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(client, "execute").mockRejectedValue(new Error("secret-token"));
  expect(await new FixedWindowLimiter(client).check("secret-token", 1)).toBeNull();
  expect(log).toHaveBeenCalledWith("Database rate limit check failed; allowing request", { name: "Error", message: "[redacted]" });
});

it("prefers Vercel, then real IP, then first forwarded IP", () => {
  const req = (headers: Record<string, string>) => new Request("http://localhost", { headers });
  expect(clientIp(req({ "x-vercel-forwarded-for": "192.0.2.1", "x-real-ip": "192.0.2.2", "x-forwarded-for": "192.0.2.3, 192.0.2.4" }))).toBe("192.0.2.1");
  expect(clientIp(req({ "x-real-ip": "192.0.2.2", "x-forwarded-for": "192.0.2.3" }))).toBe("192.0.2.2");
  expect(clientIp(req({ "x-forwarded-for": "192.0.2.3, 192.0.2.4" }))).toBe("192.0.2.3");
});

it("limits token writes across IPs, IP reads across tokens, and bearer failures separately", async () => {
  for (let i = 0; i < 21; i++) {
    const response = await signRateLimit(new Request("http://localhost", { method: "POST", headers: { "x-real-ip": `write-${i}` } }), "write-token");
    expect(response?.status).toBe(i < 20 ? undefined : 429);
  }
  for (let i = 0; i < 61; i++) {
    const response = await signRateLimit(new Request("http://localhost", { headers: { "x-vercel-forwarded-for": "read-ip", "x-forwarded-for": `spoof-${i}` } }), `token-${i}`);
    expect(response?.status).toBe(i < 60 ? undefined : 429);
  }
  const req = new Request("http://localhost", { headers: { "x-real-ip": "read-ip" } });
  for (let i = 0; i < 31; i++) expect((await bearerFailureRateLimit(req))?.status).toBe(i < 30 ? undefined : 429);
});

it("persists Better Auth login and signup budgets across fresh auth instances", async () => {
  const { betterAuth } = await import("better-auth");
  for (const [path, max] of [["sign-in/email", 8], ["sign-up/email", 5]] as const) {
    for (let i = 0; i <= max; i++) {
      const instance = betterAuth({ ...auth.options, baseURL: "http://localhost", secret: "disposable-rate-limit-test-secret-123456" });
      const response = await instance.handler(new Request(`http://localhost/api/auth/${path}`, {
        method: "POST", headers: { "content-type": "application/json", "x-vercel-forwarded-for": "192.0.2.10", "x-forwarded-for": `192.0.2.${20 + i}` },
        body: JSON.stringify({ email: "missing@example.com", password: "disposable-password", name: "Test" }),
      }));
      if (i < max) expect(response.status).not.toBe(429);
      else { expect(response.status).toBe(429); expect(response.headers.get("X-Retry-After")).toBeTruthy(); }
    }
  }
  const rows = await database.select().from(schema.rateLimit);
  expect(rows).toHaveLength(2);
  expect(rows.every((row) => row.lastRequest > 0)).toBe(true);
  expect(rows.every((row) => /^[a-f0-9]{64}$/.test(row.key))).toBe(true);
});

it("reads remote-style string counts and rejects missing RETURNING rows", async () => {
  const execute = vi.fn().mockResolvedValue({ rowsAffected: 1, rows: [{ count: "61", window_start: "0" }] });
  const limiter = new FixedWindowLimiter({ execute } as unknown as Pick<typeof client, "execute">);
  const result = await limiter.checkWithCount("remote-ip", 60, 2000);
  expect(result.count).toBe(61);
  expect(result.response?.status).toBe(429);
  expect(result.response?.headers.get("Retry-After")).toBe("58");
  execute.mockResolvedValue({ rowsAffected: 1, rows: [] });
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await limiter.checkWithCount("remote-ip", 60, 2000)).toEqual({ response: null, count: null });
  expect(log).toHaveBeenCalledWith(expect.any(String), { name: "Error", message: "Invalid rate limit bucket result" });
  log.mockRestore();
});

it("returns the busiest successful bucket and the rejecting bucket count", async () => {
  const req = new Request("http://localhost", { headers: { "x-real-ip": "debug-ip" } });
  for (let i = 1; i <= 60; i++) {
    expect(await signRateLimitWithCount(req, `debug-token-${i}`)).toEqual({ response: null, count: i });
  }
  const result = await signRateLimitWithCount(req, "debug-token");
  expect(result.count).toBe(61);
  expect(result.response?.status).toBe(429);
});

it("redacts bucket keys and IPs from database error diagnostics", async () => {
  const key = "sign-ip:192.0.2.9";
  const execute = vi.fn().mockRejectedValue(new Error(`Failed for ${key} at 192.0.2.9`));
  const limiter = new FixedWindowLimiter({ execute } as unknown as Pick<typeof client, "execute">);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await limiter.check(key, 60)).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.any(String), { name: "Error", message: "Failed for [redacted] at [redacted]" });
  } finally { log.mockRestore(); }
});

it("retries a competing insert and returns the atomic update count", async () => {
  const execute = vi.fn()
    .mockResolvedValueOnce({ rowsAffected: 0, rows: [] })
    .mockResolvedValueOnce({ rowsAffected: 0, rows: [] })
    .mockRejectedValueOnce(Object.assign(new Error("UNIQUE constraint failed: rate_limit_bucket.key"), { code: "SQLITE_CONSTRAINT" }))
    .mockResolvedValue({ rowsAffected: 1, rows: [{ count: 2, window_start: 0 }] });
  const random = vi.spyOn(Math, "random").mockReturnValue(1);
  try {
    expect(await new FixedWindowLimiter({ execute } as unknown as Pick<typeof client, "execute">).checkWithCount("race", 60, 2000)).toEqual({ response: null, count: 2 });
    expect(execute).toHaveBeenCalledTimes(4);
    expect(execute.mock.calls[3][0].sql).toContain("count = count + 1");
  } finally { random.mockRestore(); }
});

it("bounds insert conflict retries and fails open", async () => {
  const execute = vi.fn().mockImplementation(async ({ sql }: { sql: string }) => {
    if (sql.startsWith("INSERT")) throw Object.assign(new Error("UNIQUE constraint failed"), { code: "SQLITE_CONSTRAINT" });
    return { rowsAffected: 0, rows: [] };
  });
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await new FixedWindowLimiter({ execute } as unknown as Pick<typeof client, "execute">).checkWithCount("race", 60)).toEqual({ response: null, count: null });
    expect(execute).toHaveBeenCalledTimes(9);
  } finally { log.mockRestore(); }
});

it("does not reset a newer window for a delayed request", async () => {
  const limiter = new FixedWindowLimiter(client);
  expect((await limiter.checkWithCount("delayed", 60, 60000)).count).toBe(1);
  expect((await limiter.checkWithCount("delayed", 60, 59999)).count).toBe(2);
  expect((await database.select().from(schema.rateLimitBucket))[0].windowStart).toBe(60000);
});
