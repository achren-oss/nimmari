import { expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import config from "../../../next.config";
import { token } from "../ids";

it("sets security headers on every path with preview and worker support", async () => {
  const rules = await config.headers!();
  expect(rules[0].source).toBe("/:path*");
  const headers = Object.fromEntries(rules[0].headers.map(({ key, value }) => [key, value]));
  expect(headers).toMatchObject({
    "X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer", "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  });
  for (const directive of ["frame-ancestors 'none'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "worker-src 'self' blob:"]) {
    expect(headers["Content-Security-Policy"]).toContain(directive);
  }
});

it("generates 192-bit signing tokens and retains 30-day expiry", () => {
  expect(Buffer.from(token(), "base64url")).toHaveLength(24);
  expect(token()).not.toBe(token());
  expect(readFileSync("src/app/api/documents/[id]/send/route.ts", "utf8")).toMatch(/30 \* 24 \* 60 \* 60 \* 1000/);
});

it("requires an authentication guard on every API route", () => {
  function routes(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? routes(join(dir, entry.name)) : entry.name === "route.ts" ? [join(dir, entry.name)] : []);
  }
  const exceptions: Record<string, RegExp> = {
    "setup/claim/route.ts": /timingSafeEqual\(hash\(body.setupCode\), hash\(code\)\)/,
    "health/route.ts": /export async function GET/,
    "auth/[...all]/route.ts": /toNextJsHandler\(auth\)/,
    "webhooks/resend/route.ts": /if \(!verify\(rawBody, req.headers, secret\)\)/,
    "keys/[id]/route.ts": /revokeApiKey\(req,/,
    "keys/[id]/revoke/route.ts": /revokeApiKey\(req,/,
  };
  for (const path of routes("src/app/api")) {
    const name = relative("src/app/api", path);
    const source = readFileSync(path, "utf8");
    if (exceptions[name]) expect(source, name).toMatch(exceptions[name]);
    else if (name.startsWith("sign/")) {
      expect(source, name).toContain("eq(signingSession.token, token)");
      expect(source, name).toContain("s.expiresAt < new Date()");
      expect(source.match(/await signRateLimit(?:WithCount)?\(req, token\)/g)?.length, name).toBe(source.match(/export async function (GET|POST)/g)?.length);
    } else {
      expect(source, name).toMatch(/await (getApiIdentity|getAgentIdentity)\(req/);
      if (name.startsWith("documents/[id]/")) expect(source, name).toMatch(/doc.ownerId/);
    }
  }
});
