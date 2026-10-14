import { describe, expect, it } from "vitest";
import { cropSignatureRgba, signatureInkBounds } from "../signature-crop";

function pixels(width: number, height: number) {
  const data = new Uint8Array(width * height * 4);
  const ink = (x: number, y: number, alpha = 255) => {
    data.set([20, 30, 40, alpha], (y * width + x) * 4);
  };
  return { data, ink };
}

describe("signature crop", () => {
  it("finds ink above alpha 10, pads by at least 4px and copies RGBA rows", () => {
    const { data, ink } = pixels(100, 80);
    ink(20, 30, 11);
    ink(29, 35);
    ink(0, 0, 10);
    expect(signatureInkBounds(data, 100, 80)).toEqual({ x: 16, y: 26, width: 18, height: 14 });
    const cropped = cropSignatureRgba(data, 100, 80)!;
    expect(cropped.width).toBe(18);
    expect(cropped.height).toBe(14);
    expect([...cropped.data.slice((4 * 18 + 4) * 4, (4 * 18 + 4) * 4 + 4)]).toEqual([20, 30, 40, 11]);
    expect(data.length).toBe(100 * 80 * 4);
  });

  it("uses 4% of the larger ink dimension and clamps padding at image edges", () => {
    const { data, ink } = pixels(300, 100);
    ink(0, 0);
    ink(199, 99);
    expect(signatureInkBounds(data, 300, 100)).toEqual({ x: 0, y: 0, width: 208, height: 100 });
    const edge = pixels(100, 100);
    edge.ink(99, 99);
    expect(signatureInkBounds(edge.data, 100, 100)).toEqual({ x: 95, y: 95, width: 5, height: 5 });
  });

  it("returns null for empty images and leaves opaque or already cropped images unchanged", () => {
    const { data } = pixels(20, 10);
    expect(signatureInkBounds(data, 20, 10)).toBeNull();
    expect(cropSignatureRgba(data, 20, 10)).toBeNull();
    data.fill(255);
    expect(cropSignatureRgba(data, 20, 10)).toBeNull();
    const tight = pixels(10, 10);
    tight.ink(4, 4);
    tight.ink(5, 5);
    expect(cropSignatureRgba(tight.data, 10, 10)).toBeNull();
  });
});
