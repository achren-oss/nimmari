import { beforeAll, describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDF_OVERLAY_WIDTH } from "../pdf-coords";
import { boxTextInsets, layoutTextInBox } from "../draw-text-in-box";
import { stampPdf } from "../stamp-pdf";

let font: PDFFont;

beforeAll(async () => {
  const pdf = await PDFDocument.create();
  font = await pdf.embedFont(StandardFonts.Helvetica);
});

describe("boxTextInsets", () => {
  it("uses minimal padding for ~12pt-tall boxes", () => {
    const scale = 595 / PDF_OVERLAY_WIDTH;
    const h = 17 * scale;
    const { padY, innerH } = boxTextInsets(40 * scale, h);
    expect(padY).toBeLessThan(2);
    expect(innerH).toBeGreaterThan(8);
  });
});

describe("layoutTextInBox", () => {
  it("never returns empty lines for short numeric values in small boxes", () => {
    const scale = 595 / PDF_OVERLAY_WIDTH;
    const w = 30 * scale;
    const h = 17 * scale;
    for (const value of ["7,5", "37,5"]) {
      const layout = layoutTextInBox(value, font, w, h);
      expect(layout.lines.join("")).toContain(value);
      expect(layout.lines.some((l) => l.length > 0)).toBe(true);
    }
  });

  it("uses a readable font size for single-line numbers when height allows", () => {
    const scale = 595 / PDF_OVERLAY_WIDTH;
    const h = 17 * scale;
    const layout = layoutTextInBox("7,5", font, 50 * scale, h);
    expect(layout.fontSize).toBeGreaterThanOrEqual(6);
    expect(layout.fontSize).toBeLessThanOrEqual(11);
  });
});

describe("drawTextInBox via stampPdf", () => {
  async function extractText(bytes: Uint8Array): Promise<string> {
    const doc = await getDocument({ data: new Uint8Array(bytes) }).promise;
    const page = await doc.getPage(1);
    const c = await page.getTextContent();
    return c.items.map((i) => ("str" in i ? i.str : "")).join(" ");
  }

  it("renders employment-contract style small hour fields", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([595, 842]);
    const base = await pdf.save();
    const stamped = await stampPdf({
      pdfBytes: base,
      fields: [
        { type: "text", page: 0, x: 100, y: 200, width: 30, height: 17, value: "7,5" },
        { type: "text", page: 0, x: 140, y: 200, width: 30, height: 17, value: "37,5" },
      ],
      signaturePng: null,
    });
    const t = await extractText(stamped);
    expect(t).toContain("7,5");
    expect(t).toContain("37,5");
  });
});
