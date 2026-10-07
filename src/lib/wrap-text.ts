import type { PDFFont } from "pdf-lib";

/** lineHeight is a multiplier of fontSize (default 1.2). Sizes are PDF points. */
export function layoutMultiline(
  text: string,
  font: Pick<PDFFont, "widthOfTextAtSize">,
  maxWidth: number,
  maxHeight: number,
  { fontSize = 12, minFontSize = 6, lineHeight = 1.2 } = {},
): { fontSize: number; lines: string[]; truncated: boolean } {
  if (![maxWidth, maxHeight, fontSize, minFontSize, lineHeight].every(Number.isFinite)
    || fontSize <= 0 || minFontSize <= 0 || minFontSize > fontSize || lineHeight < 1) {
    throw new RangeError("Invalid multiline layout dimensions or font options");
  }
  if (maxWidth <= 0 || maxHeight <= 0) {
    return { fontSize: minFontSize, lines: [], truncated: text.length > 0 };
  }

  function wrap(size: number) {
    const lines: string[] = [];
    let tooWide = false;
    for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
      let line = "";
      for (const word of paragraph.split(/[^\S\n]+/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
          line = candidate;
          continue;
        }
        if (line) lines.push(line);
        line = "";
        for (const char of word) {
          if (font.widthOfTextAtSize(line + char, size) > maxWidth) {
            if (line) lines.push(line);
            line = "";
            if (font.widthOfTextAtSize(char, size) > maxWidth) tooWide = true;
          }
          line += char;
        }
      }
      lines.push(line);
    }
    return { lines, tooWide };
  }

  let size = fontSize;
  while (true) {
    const { lines, tooWide } = wrap(size);
    const capacity = Math.max(0, Math.floor(maxHeight / (size * lineHeight)));
    if (!tooWide && lines.length <= capacity) {
      return { fontSize: size, lines, truncated: false };
    }
    if (size === minFontSize) {
      // A glyph wider than the box cannot be drawn without overflowing.
      const visible = lines.slice(0, capacity).map((line) => {
        let clipped = "";
        for (const char of line) {
          if (font.widthOfTextAtSize(clipped + char, size) > maxWidth) break;
          clipped += char;
        }
        return clipped;
      });
      return { fontSize: size, lines: visible, truncated: tooWide || lines.length > capacity };
    }
    size = Math.max(minFontSize, size - 1);
  }
}
