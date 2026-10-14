/** Minimum signature ink height in PDF points, unless width/page bounds limit it. */
export const MIN_SIGNATURE_HEIGHT_PT = 40;

/** Bottom-anchored placement; all arguments use the same coordinate units. */
export function signaturePlacement(
  ratio: number, x: number, bottom: number, width: number, height: number,
  pageWidth: number, pageHeight: number, minimumHeight = MIN_SIGNATURE_HEIGHT_PT,
) {
  const y = Math.max(0, Math.min(bottom, pageHeight));
  const left = Math.max(0, Math.min(x, pageWidth));
  const availableWidth = Math.max(0, Math.min(width, pageWidth - left));
  const fittedHeight = Math.min(height, width / ratio);
  const drawHeight = Math.max(0, Math.min(
    Math.max(fittedHeight, minimumHeight), availableWidth / ratio, pageHeight - y,
  ));
  const drawWidth = drawHeight * ratio;
  return {
    x: left + (drawHeight > height ? 0 : (availableWidth - drawWidth) / 2),
    y, width: drawWidth, height: drawHeight,
  };
}
