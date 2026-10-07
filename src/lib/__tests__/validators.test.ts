import { describe, expect, it } from "vitest";
import { isValidSignaturePng } from "../validators";

const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const dataUrl = (bytes: Buffer) => `data:image/png;base64,${bytes.toString("base64")}`;

describe("signature PNG validation", () => {
  it("accepts PNG bytes and the exact size limit", () => {
    expect(isValidSignaturePng(dataUrl(magic))).toBe(true);
    const bytes = Buffer.alloc(500 * 1024);
    magic.copy(bytes);
    expect(isValidSignaturePng(dataUrl(bytes))).toBe(true);
  });
  it("rejects oversized decoded data", () => {
    const bytes = Buffer.alloc(500 * 1024 + 1);
    magic.copy(bytes);
    expect(isValidSignaturePng(dataUrl(bytes))).toBe(false);
  });
  it.each([
    null, "", "data:image/jpeg;base64,iVBORw0KGgo=",
    "data:image/png;base64,SGVsbG8=", "data:image/png;base64,iVBORw==",
    "data:image/png;base64,iVBORw0KGgo=\n", "data:image/png;base64,iVBORw0KGgo=\" onerror=\"alert(1)",
    "data:image/png;base64,====", "data:image/png;base64,iVBORw0KGgo===",
  ])("rejects invalid input %s", (value: unknown) => {
    expect(isValidSignaturePng(value)).toBe(false);
  });
});
