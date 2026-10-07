import { beforeAll, describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";
import { layoutMultiline } from "../wrap-text";

let font: PDFFont;
beforeAll(async () => {
  const pdf = await PDFDocument.create();
  font = await pdf.embedFont(StandardFonts.Helvetica);
});

describe("layoutMultiline", () => {
  it("wraps at word boundaries", () => {
    const width = font.widthOfTextAtSize("one two", 12);
    const result = layoutMultiline("one two three", font, width, 100);
    expect(result).toEqual({ fontSize: 12, lines: ["one two", "three"], truncated: false });
  });
  it("breaks overlong words without losing characters", () => {
    const text = "supercalifragilistic";
    const result = layoutMultiline(text, font, 30, 200);
    expect(result.lines.length).toBeGreaterThan(1);
    expect(result.lines.join("")).toBe(text);
    expect(result.lines.every(line => font.widthOfTextAtSize(line, result.fontSize) <= 30)).toBe(true);
  });
  it("preserves CRLF, explicit newlines, blank and trailing lines", () => {
    expect(layoutMultiline("first\r\n\r\nthird\n", font, 100, 100).lines)
      .toEqual(["first", "", "third", ""]);
  });
  it("shrinks to the largest tested size that fits", () => {
    const result = layoutMultiline("one\ntwo\nthree", font, 100, 30);
    expect(result.fontSize).toBe(8);
    expect(result.lines).toEqual(["one", "two", "three"]);
    expect(result.truncated).toBe(false);
  });
  it("clips excess lines at the minimum size", () => {
    expect(layoutMultiline("one\ntwo\nthree\nfour", font, 100, 15))
      .toEqual({ fontSize: 6, lines: ["one", "two"], truncated: true });
  });
  it("clips when even a single line or glyph cannot fit", () => {
    expect(layoutMultiline("hello", font, 100, 5).lines).toEqual([]);
    const result = layoutMultiline("W", font, 1, 100);
    expect(result.truncated).toBe(true);
    expect(result.lines).toEqual([""]);
  });
});
