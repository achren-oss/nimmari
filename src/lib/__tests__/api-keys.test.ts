import { afterEach, describe, expect, it, vi } from "vitest";
import { generateApiKey, hashApiKey, matchesRootKey } from "../api-keys";

afterEach(() => vi.unstubAllEnvs());

describe("API key secrets", () => {
  it("hashes keys deterministically and generates unique strong keys", () => {
    expect(hashApiKey("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const a = generateApiKey();
    expect(a.key).toMatch(/^pmk_[A-Za-z0-9_-]{43}$/);
    expect(a.keyHash).toBe(hashApiKey(a.key));
    expect(a.keyPrefix).toBe(a.key.slice(0, 8));
    expect(generateApiKey().key).not.toBe(a.key);
  });
  it("reads the OSS root environment key and rejects other secrets", () => {
    vi.stubEnv("NIMMARI_API_KEY", "synthetic-root-secret");
    expect(matchesRootKey("synthetic-root-secret")).toBe(true);
    expect(matchesRootKey("wrong")).toBe(false);
    vi.stubEnv("NIMMARI_API_KEY", "");
    expect(matchesRootKey("synthetic-root-secret")).toBe(false);
    expect(matchesRootKey("")).toBe(false);
  });
});
