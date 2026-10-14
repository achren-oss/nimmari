import { describe, expect, it } from "vitest";
import { resolveEffectiveNotify } from "../notify";

describe("notify precedence", () => {
  it("document notify false blocks all email", () => {
    expect(resolveEffectiveNotify(false, true)).toBe(false);
    expect(resolveEffectiveNotify(false, false)).toBe(false);
  });

  it("document notify true follows send request", () => {
    expect(resolveEffectiveNotify(true, true)).toBe(true);
    expect(resolveEffectiveNotify(true, false)).toBe(false);
  });
});
