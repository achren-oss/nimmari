const WINDOW_MS = 60_000;
const LIMIT = 20;
const requests = new Map<string, { count: number; resetAt: number }>();

export function signRateLimit(req: Request): Response | null {
  const now = Date.now();
  for (const [key, entry] of requests) {
    if (entry.resetAt <= now) requests.delete(key);
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim()
    || req.headers.get("x-real-ip")?.trim() || "unknown";
  const entry = requests.get(ip) ?? { count: 0, resetAt: now + WINDOW_MS };
  requests.set(ip, entry);
  if (++entry.count > LIMIT) {
    return Response.json({ error: "Too many requests" }, {
      status: 429,
      headers: { "Retry-After": String(Math.ceil((entry.resetAt - now) / 1000)) },
    });
  }
  return null;
}
