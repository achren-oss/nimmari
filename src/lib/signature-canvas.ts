import { signatureInkBounds } from "./signature-crop";

/** Export only the ink, preserving the original canvas for further drawing. */
export function signatureCanvasDataUrl(canvas: HTMLCanvasElement, originalDataUrl?: string): string | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return originalDataUrl ?? canvas.toDataURL("image/png");
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const cropped = signatureInkBounds(pixels.data, canvas.width, canvas.height);
  if (!cropped) return null;
  if (cropped.width === canvas.width && cropped.height === canvas.height) {
    return originalDataUrl ?? canvas.toDataURL("image/png");
  }
  const output = document.createElement("canvas");
  output.width = cropped.width;
  output.height = cropped.height;
  const outputCtx = output.getContext("2d");
  if (!outputCtx) return originalDataUrl ?? canvas.toDataURL("image/png");
  outputCtx.drawImage(canvas, cropped.x, cropped.y, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
  return output.toDataURL("image/png");
}
