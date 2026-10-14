import type { PDFPage, PDFFont, RGB } from "pdf-lib";
import { layoutMultiline } from "./wrap-text";

const MIN_FONT_SIZE = 4;
const MAX_SINGLE_LINE_FONT = 11;
const LINE_HEIGHT = 1.2;

/** Padding scales down for small overlay boxes (avoids eating the whole cell). */
export function boxTextInsets(w: number, h: number): { padX: number; padY: number; innerW: number; innerH: number } {
  const pad = Math.min(4, Math.max(0.5, Math.min(w, h) * 0.1));
  return {
    padX: pad,
    padY: pad,
    innerW: Math.max(0.5, w - 2 * pad),
    innerH: Math.max(0.5, h - 2 * pad),
  };
}

function isSingleLine(text: string): boolean {
  return !/[\r\n]/.test(text);
}

function startingFontSize(innerH: number, singleLine: boolean): number {
  if (singleLine) {
    const fromHeight = innerH / LINE_HEIGHT;
    return Math.min(MAX_SINGLE_LINE_FONT, Math.max(MIN_FONT_SIZE, fromHeight));
  }
  return Math.min(14, Math.max(MIN_FONT_SIZE, innerH * 0.55));
}

function shrinkToFitWidth(
  text: string,
  font: Pick<PDFFont, "widthOfTextAtSize">,
  maxWidth: number,
  startSize: number,
): number {
  let size = startSize;
  while (size > MIN_FONT_SIZE && font.widthOfTextAtSize(text, size) > maxWidth) {
    size -= 0.5;
  }
  return Math.max(MIN_FONT_SIZE, size);
}

/** Layout for tests: never returns empty lines for non-empty text. */
export function layoutTextInBox(
  text: string,
  font: Pick<PDFFont, "widthOfTextAtSize">,
  w: number,
  h: number,
): { fontSize: number; lines: string[]; truncated: boolean } {
  if (!text) {
    return { fontSize: MIN_FONT_SIZE, lines: [], truncated: false };
  }
  const { innerW, innerH } = boxTextInsets(w, h);
  const single = isSingleLine(text);
  const start = startingFontSize(innerH, single);
  const layout = layoutMultiline(text, font, innerW, innerH, {
    fontSize: start,
    minFontSize: MIN_FONT_SIZE,
    lineHeight: LINE_HEIGHT,
  });
  const hasVisible = layout.lines.some((line) => line.length > 0);
  if (hasVisible) return layout;

  const fontSize = shrinkToFitWidth(text, font, innerW, start);
  return { fontSize, lines: [text], truncated: font.widthOfTextAtSize(text, fontSize) > innerW };
}

/** Draw text inside a box: shrink and wrap to fit; never omit non-empty values. */
export function drawTextInBox(
  page: PDFPage,
  font: PDFFont,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  color: RGB,
): void {
  if (!text) return;

  const { padX, padY } = boxTextInsets(w, h);
  const layout = layoutTextInBox(text, font, w, h);

  layout.lines.forEach((line, index) => {
    if (!line) return;
    const baselineY = y + h - padY - layout.fontSize - index * layout.fontSize * LINE_HEIGHT;
    page.drawText(line, {
      x: x + padX,
      y: baselineY,
      size: layout.fontSize,
      font,
      color,
    });
  });
}
