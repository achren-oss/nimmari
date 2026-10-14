import { describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFPage } from "pdf-lib";
import { PNG } from "pngjs";
import { cropSignaturePng, MIN_SIGNATURE_HEIGHT_PT, stampPdf } from "../stamp-pdf";

function encodePng(data: Uint8Array, width: number, height: number): Uint8Array {
  const png = new PNG({ width, height });
  png.data = Buffer.from(data);
  return PNG.sync.write(png);
}

function legacySignature(): Uint8Array {
  const data = new Uint8Array(1000 * 300 * 4);
  // Small diagonal scribble in a mostly transparent canvas.
  for (let x = 450; x < 550; x++) {
    const y = 130 + Math.floor((x - 450) / 5);
    data.set([20, 30, 40, 255], (y * 1000 + x) * 4);
  }
  return encodePng(data, 1000, 300);
}

describe("PDF signature cropping", () => {
  it.each([
    { width: 300, height: 20, expectedHeight: 40, expectedX: 40 },
    { width: 300, height: 60, expectedHeight: 60, expectedX: 74.285714 },
    { width: 100, height: 20, expectedHeight: 25.925926, expectedX: 40 },
    { width: 300, height: 20, y: 0, expectedHeight: 20, expectedX: 151.428571 },
    { width: 300, height: 20, pageWidth: 595, expectedHeight: 40, expectedX: 29.75 },
    { width: 300, height: 20, x: 760, expectedHeight: 10.370370, expectedX: 760 },
  ])(
    "crops legacy PNGs and draws bottom-anchored in a $width x $height field",
    async ({ width, height, y = 100, x = 40, pageWidth = 800, expectedHeight, expectedX }) => {
      const png = legacySignature();
      const cropped = PNG.sync.read(Buffer.from(cropSignaturePng(png)));
      expect([cropped.width, cropped.height]).toEqual([108, 28]);
      const pdf = await PDFDocument.create();
      pdf.addPage([pageWidth, 842]);
      const draw = vi.spyOn(PDFPage.prototype, "drawImage");
      try {
        const output = await stampPdf({
          pdfBytes: await pdf.save(),
          fields: [{ type: "signature", page: 0, x, y, width, height, value: null }],
          signaturePng: `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
        });
        expect((await PDFDocument.load(output)).getPageCount()).toBe(1);
        const [image, options] = draw.mock.calls[0];
        expect([image.width, image.height]).toEqual([108, 28]);
        expect(MIN_SIGNATURE_HEIGHT_PT).toBe(40);
        expect(options?.width).toBeCloseTo(expectedHeight * 108 / 28);
        expect(options?.height).toBeCloseTo(expectedHeight);
        expect(options?.x).toBeCloseTo(expectedX);
        expect(options?.y).toBeCloseTo(842 - (y + height) * pageWidth / 800);
        expect(options!.y! + options!.height!).toBeLessThanOrEqual(842);
        expect(options!.x! + options!.width!).toBeLessThanOrEqual(pageWidth);

      } finally {
        draw.mockRestore();
      }
    },
  );

  it("preserves invalid, empty, opaque and already cropped PNGs", () => {
    const invalid = new Uint8Array([1, 2, 3]);
    expect(cropSignaturePng(invalid)).toBe(invalid);
    for (const alpha of [0, 255]) {
      const pixels = new Uint8Array(10 * 10 * 4);
      for (let i = 3; i < pixels.length; i += 4) pixels[i] = alpha;
      const png = encodePng(pixels, 10, 10);
      expect(cropSignaturePng(png)).toBe(png);
    }
    const cropped = cropSignaturePng(legacySignature());
    expect(cropSignaturePng(cropped)).toBe(cropped);
  });
});
