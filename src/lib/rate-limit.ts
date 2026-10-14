import { createHash } from "node:crypto";

const WINDOW_MS = 60_000;

/** Per-process sliding windows. Only trust IP headers set by a trusted proxy. */
export class SlidingWindowLimiter {
  private requests = new Map<string, number[]>();

  check(key: string, limit: number, now = Date.now()): Response | null {
    for (const [key, times] of this.requests) {
      if (times[times.length - 1] <= now - WINDOW_MS) this.requests.delete(key);
    }
    const times = (this.requests.get(key) ?? []).filter((time) => time > now - WINDOW_MS);
    if (times.length >= limit) {
      return Response.json({ error: "Too many requests" }, {
        status: 429,
        headers: { "Retry-After": String(Math.max(1, Math.ceil((times[0] + WINDOW_MS - now) / 1000))) },
      });
    }
    times.push(now);
    this.requests.set(key, times);
    return null;
  }
}

const limiter = new SlidingWindowLimiter();
function clientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim()
    || req.headers.get("x-real-ip")?.trim() || "unknown";
}
export function signRateLimit(req: Request, token: string): Response | null {
  const ipLimit = limiter.check(`sign-ip:${clientIp(req)}`, 60);
  if (ipLimit) return ipLimit;
  // Do not retain secret signing URLs in limiter keys.
  const digest = createHash("sha256").update(token).digest("hex");
  return limiter.check(`sign-token:${req.method === "POST" ? "write" : "read"}:${digest}`, req.method === "POST" ? 20 : 60);
}
export function bearerFailureRateLimit(req: Request): Response | null {
  return limiter.check(`auth:${clientIp(req)}`, 30);
}
