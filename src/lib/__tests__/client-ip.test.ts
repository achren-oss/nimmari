import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { clientIp, rateLimitIpDebugHeaders } from "../client-ip";

it("fingerprints the preferred address used for limiting", () => {
  const req = new Request("http://localhost", { headers: {
    "x-vercel-forwarded-for": "8.8.8.8, 10.0.0.1", "x-real-ip": "10.0.0.2", "x-forwarded-for": "10.0.0.3",
  } });
  expect(clientIp(req)).toBe("8.8.8.8");
  expect(rateLimitIpDebugHeaders(req)).toEqual({
    "X-RateLimit-IpKey": createHash("sha256").update("sign-ip:8.8.8.8").digest("hex").slice(0, 8),
  });
});

it.each(["8.8.8.8", "10.1.2.3", "2001:4860:4860::8888", "::1", "unknown", "invalid"])("never exposes the raw address %s", (ip) => {
  const headers = rateLimitIpDebugHeaders(new Request("http://localhost", { headers: { "x-real-ip": ip } }));
  expect(Object.keys(headers)).toEqual(["X-RateLimit-IpKey"]);
  expect(headers["X-RateLimit-IpKey"]).toMatch(/^[0-9a-f]{8}$/);
});
