import { afterEach, expect, it, vi } from "vitest";
import { nimmariEnv } from "../env";

afterEach(() => vi.unstubAllEnvs());
for (const name of ["API_KEY", "API_OWNER_ID", "AUDIT_TIMEZONE", "WEBHOOK_SECRET", "RATE_LIMIT_DEBUG", "BASE_URL", "BOT_API_KEY"]) {
  it(`supports deprecated ${name} and prefers the new setting, including empty values`, () => {
    vi.stubEnv(`NIMMARI_${name}`, undefined);
    vi.stubEnv(`PUUMERKKI_${name}`, undefined);
    expect(nimmariEnv(name)).toBeUndefined();
    vi.stubEnv(`PUUMERKKI_${name}`, "legacy");
    expect(nimmariEnv(name)).toBe("legacy");
    vi.stubEnv(`NIMMARI_${name}`, "new");
    expect(nimmariEnv(name)).toBe("new");
    vi.stubEnv(`NIMMARI_${name}`, "");
    expect(nimmariEnv(name)).toBe("");
  });
}
