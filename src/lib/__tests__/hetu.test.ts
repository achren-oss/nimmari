import { describe, it, expect } from "vitest";
import { validateHetu, formatHetu, maskHetu } from "../hetu";

describe("validateHetu", () => {
  it("accepts valid hetus", () => {
    // Valid test hetus from different centuries (with correct checksums)
    expect(validateHetu("010190-123M")).toBe(true); // 1900s
    expect(validateHetu("010100A123D")).toBe(true); // 2000s
    expect(validateHetu("311280+888Y")).toBe(true); // 1800s
    expect(validateHetu("150695-9998")).toBe(true); // 1900s
  });

  it("rejects impossible calendar dates even with valid checksum shape", () => {
    expect(validateHetu("310200A123D")).toBe(false);
  });

  it("rejects invalid checksums", () => {
    expect(validateHetu("010190-123A")).toBe(false); // Wrong checksum (should be M)
    expect(validateHetu("311299-999K")).toBe(false); // Wrong checksum
  });

  it("rejects malformed hetus", () => {
    expect(validateHetu("01019-123M")).toBe(false); // Too short
    expect(validateHetu("010190Z123M")).toBe(false); // Invalid century marker (Z not in list)
    expect(validateHetu("320190-123M")).toBe(false); // Invalid day
    expect(validateHetu("011390-123M")).toBe(false); // Invalid month
    expect(validateHetu("abc")).toBe(false);
    expect(validateHetu("")).toBe(false);
  });

  it("normalizes input", () => {
    expect(validateHetu("  010190-123M  ")).toBe(true); // Trim whitespace
    expect(validateHetu("010190-123m")).toBe(true); // Lowercase checksum
  });
});

describe("formatHetu", () => {
  it("returns hetu as-is (already in canonical form)", () => {
    expect(formatHetu("010190-123M")).toBe("010190-123M");
    expect(formatHetu("010100A123D")).toBe("010100A123D");
  });

  it("returns input unchanged if wrong length", () => {
    expect(formatHetu("abc")).toBe("abc");
  });
});

describe("maskHetu", () => {
  it("masks all but last 4 characters", () => {
    expect(maskHetu("010190-123M")).toBe("*******123M");
    expect(maskHetu("010100A123D")).toBe("*******123D");
  });

  it("handles short strings", () => {
    expect(maskHetu("abcd")).toBe("abcd");
    expect(maskHetu("abc")).toBe("abc");
    expect(maskHetu("ab")).toBe("ab");
    expect(maskHetu("a")).toBe("a");
  });
});
