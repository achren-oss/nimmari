export type SignatureBounds = { x: number; y: number; width: number; height: number };

/** Find visible ink and add 4% breathing room, clamped to the source image. */
export function signatureInkBounds(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): SignatureBounds | null {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] > 10) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }
  if (right < left) return null;
  const padding = Math.max(4, Math.ceil(Math.max(right - left + 1, bottom - top + 1) * 0.04));
  const x = Math.max(0, left - padding);
  const y = Math.max(0, top - padding);
  return {
    x,
    y,
    width: Math.min(width, right + padding + 1) - x,
    height: Math.min(height, bottom + padding + 1) - y,
  };
}

/** Null means empty or already tightly cropped (including fully opaque images). */
export function cropSignatureRgba(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): { data: Uint8Array<ArrayBuffer>; width: number; height: number } | null {
  const bounds = signatureInkBounds(rgba, width, height);
  if (!bounds || (bounds.width === width && bounds.height === height)) return null;
  const data = new Uint8Array(bounds.width * bounds.height * 4);
  for (let row = 0; row < bounds.height; row++) {
    const start = ((bounds.y + row) * width + bounds.x) * 4;
    data.set(rgba.subarray(start, start + bounds.width * 4), row * bounds.width * 4);
  }
  return { data, width: bounds.width, height: bounds.height };
}
