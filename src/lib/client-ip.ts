import { createHash } from "node:crypto";

export function clientIp(req: Request): string {
  for (const header of ["x-vercel-forwarded-for", "x-real-ip", "x-forwarded-for"]) {
    const ip = req.headers.get(header)?.split(",")[0].trim();
    if (ip) return ip;
  }
  return "unknown";
}

/** Debug identifiers never expose the client address. */
export function rateLimitIpDebugHeaders(req: Request): Record<string, string> {
  return {
    "X-RateLimit-IpKey": createHash("sha256").update(`sign-ip:${clientIp(req)}`).digest("hex").slice(0, 8),
  };
}
