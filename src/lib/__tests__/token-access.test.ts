import { describe, expect, it } from "vitest";
import { checkSigningTokenAccess } from "../token-access";

const now = new Date("2026-10-07T12:00:00Z");
const future = new Date("2026-11-01T00:00:00Z");
const past = new Date("2026-10-01T00:00:00Z");

describe("checkSigningTokenAccess", () => {
  it("rejects missing session", () => {
    expect(checkSigningTokenAccess(undefined, "d1", now)).toBe("forbidden");
  });
  it("rejects token for another document", () => {
    expect(checkSigningTokenAccess({ documentId: "d2", expiresAt: future }, "d1", now)).toBe("forbidden");
  });
  it("rejects expired token", () => {
    expect(checkSigningTokenAccess({ documentId: "d1", expiresAt: past }, "d1", now)).toBe("expired");
  });
  it("allows valid unexpired token", () => {
    expect(checkSigningTokenAccess({ documentId: "d1", expiresAt: future }, "d1", now)).toBe("ok");
  });
});
