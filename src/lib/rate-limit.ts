import { createHash } from "node:crypto";
import { client } from "@/db";
import { clientIp } from "@/lib/client-ip";
export { clientIp } from "@/lib/client-ip";

type RateLimitResult = { response: Response | null; count: number | null };

const WINDOW_MS = 60_000;

/** Shared fixed windows. Only trust IP headers overwritten by the deployment proxy. */
export class FixedWindowLimiter {
  constructor(private database: Pick<typeof client, "execute"> = client, private windowMs = WINDOW_MS, private failClosed = false) {}

  async check(key: string, limit: number, now = Date.now()): Promise<Response | null> {
    return (await this.checkWithCount(key, limit, now)).response;
  }

  async checkWithCount(key: string, limit: number, now = Date.now()): Promise<RateLimitResult> {
    const digest = createHash("sha256").update(key).digest("hex");
    const start = Math.floor(now / this.windowMs) * this.windowMs;
    try {
      let result;
      for (let attempt = 0; attempt < 3; attempt++) {
        result = await this.database.execute({
          sql: `UPDATE rate_limit_bucket SET count = count + 1
            WHERE key = ? AND window_start >= ? RETURNING count, window_start`,
          args: [digest, start],
        });
        if (result.rowsAffected > 0 || result.rows.length > 0) break;
        // Reset expired windows atomically, without overwriting a concurrent reset.
        result = await this.database.execute({
          sql: `UPDATE rate_limit_bucket SET count = 1, window_start = ?
            WHERE key = ? AND window_start < ? RETURNING count, window_start`,
          args: [start, digest, start],
        });
        if (result.rowsAffected > 0 || result.rows.length > 0) break;
        try {
          result = await this.database.execute({
            sql: "INSERT INTO rate_limit_bucket (key, window_start, count) VALUES (?, ?, 1) RETURNING count, window_start",
            args: [digest, start],
          });
          break;
        } catch (error) {
          const code = (error as { code?: string } | null)?.code;
          const uniqueConflict = code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT_PRIMARYKEY"
            || (code === "SQLITE_CONSTRAINT" && error instanceof Error && /UNIQUE constraint failed/i.test(error.message));
          if (!uniqueConflict || attempt === 2) throw error;
          // Another writer created/reset the bucket; retry the atomic increment.
        }
      }
      const count = Number(result?.rows[0]?.count);
      const windowStart = Number(result?.rows[0]?.window_start);
      if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(windowStart)) {
        throw new Error("Invalid rate limit bucket result");
      }
      if (Math.random() < 0.01) {
        // Cleanup failure must not discard a successful limiting decision.
        try {
          await this.database.execute({
            sql: "DELETE FROM rate_limit_bucket WHERE window_start < ?",
            // Retain longer setup windows when signing checks run cleanup.
            args: [start - Math.max(this.windowMs, 600_000)],
          });
        } catch (error) { logFailure("Rate limit bucket cleanup failed", error, key, digest); }
      }
      const response = count > limit ? Response.json({ error: "Too many requests" }, {
        status: 429,
        headers: { "Retry-After": String(Math.max(1, Math.ceil((windowStart + this.windowMs - now) / 1000))) },
      }) : null;
      return { response, count };
    } catch (error) {
      // Signing remains available during database failures. Never log keys or IPs.
      logFailure(this.failClosed ? "Database rate limit check failed; rejecting request" : "Database rate limit check failed; allowing request", error, key, digest);
      return { response: this.failClosed ? Response.json({ error: "Rate limiter unavailable" }, { status: 503 }) : null, count: null };
    }
  }
}

function logFailure(context: string, error: unknown, key: string, digest: string) {
  // Drivers may include SQL arguments in messages; redact bucket identifiers.
  const ip = key.startsWith("sign-ip:") ? key.slice(8) : key.startsWith("auth:") ? key.slice(5) : key.startsWith("setup:") ? key.slice(6) : null;
  const redact = (value: string) => [key, digest, ip].reduce<string>(
    (message, secret) => secret ? message.split(secret).join("[redacted]") : message, value,
  );
  console.error(context, {
    name: error instanceof Error ? redact(error.name) : "UnknownError",
    message: redact(error instanceof Error ? error.message : String(error)),
  });
}

const limiter = new FixedWindowLimiter();
export async function signRateLimit(req: Request, token: string): Promise<Response | null> {
  return (await signRateLimitWithCount(req, token)).response;
}

/** Count of the rejecting bucket, or the busiest successful signing bucket. Null on failure. */
export async function signRateLimitWithCount(req: Request, token: string): Promise<RateLimitResult> {
  const ipLimit = await limiter.checkWithCount(`sign-ip:${clientIp(req)}`, 60);
  if (ipLimit.response) return ipLimit;
  const tokenLimit = await limiter.checkWithCount(`sign-token:${req.method === "POST" ? "write" : "read"}:${token}`, req.method === "POST" ? 20 : 60);
  if (tokenLimit.response) return tokenLimit;
  return {
    response: null,
    count: ipLimit.count === null || tokenLimit.count === null ? null : Math.max(ipLimit.count, tokenLimit.count),
  };
}

export async function bearerFailureRateLimit(req: Request): Promise<Response | null> {
  return await limiter.check(`auth:${clientIp(req)}`, 30);
}
