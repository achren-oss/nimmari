import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";

const WINDOW_MS = 60_000;

/** Shared fixed windows. Only trust IP headers overwritten by a trusted proxy. */
export class FixedWindowLimiter {
  constructor(private database = db) {}

  async check(key: string, limit: number, now = Date.now()): Promise<Response | null> {
    const digest = createHash("sha256").update(key).digest("hex");
    const start = Math.floor(now / WINDOW_MS) * WINDOW_MS;
    try {
      const bucket = await this.database.get<{ count: number; window_start: number }>(sql`
        INSERT INTO rate_limit_bucket (key, window_start, count) VALUES (${digest}, ${start}, 1)
        ON CONFLICT(key) DO UPDATE SET
          count = CASE WHEN window_start < ${start} THEN 1 ELSE count + 1 END,
          window_start = CASE WHEN window_start < ${start} THEN ${start} ELSE window_start END
        RETURNING count, window_start
      `);
      if (Math.random() < 0.01) {
        try {
          await this.database.run(sql`DELETE FROM rate_limit_bucket WHERE window_start < ${start - WINDOW_MS}`);
        } catch { console.error("Rate limit bucket cleanup failed"); }
      }
      if (bucket && bucket.count > limit) {
        return Response.json({ error: "Too many requests" }, {
          status: 429,
          headers: { "Retry-After": String(Math.max(1, Math.ceil((bucket.window_start + WINDOW_MS - now) / 1000))) },
        });
      }
    } catch {
      // Do not log database errors: they may contain request parameters.
      console.error("Database rate limit check failed; allowing request");
    }
    return null;
  }
}

const limiter = new FixedWindowLimiter();
export function clientIp(req: Request) {
  for (const header of ["x-vercel-forwarded-for", "x-real-ip", "x-forwarded-for"]) {
    const ip = req.headers.get(header)?.split(",")[0].trim();
    if (ip) return ip;
  }
  return "unknown";
}
export async function signRateLimit(req: Request, token: string): Promise<Response | null> {
  const ipLimit = await limiter.check(`sign-ip:${clientIp(req)}`, 60);
  if (ipLimit) return ipLimit;
  return await limiter.check(`sign-token:${req.method === "POST" ? "write" : "read"}:${token}`, req.method === "POST" ? 20 : 60);
}
export async function bearerFailureRateLimit(req: Request): Promise<Response | null> {
  return await limiter.check(`auth:${clientIp(req)}`, 30);
}
