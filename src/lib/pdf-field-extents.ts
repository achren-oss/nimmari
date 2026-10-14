import { fieldMatchesSigner } from "@/lib/signer-assignment";
import type { field } from "@/db/schema";
import { PDF_OVERLAY_WIDTH } from "./pdf-coords";

type DbField = typeof field.$inferSelect;

export type PdfFieldBox = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Bottom edge of a field box in PDF coordinates (origin bottom-left). */
export function fieldBottomPdfPt(
  f: PdfFieldBox,
  pageWidth: number,
  pageHeight: number,
): number {
  const scale = pageWidth / PDF_OVERLAY_WIDTH;
  const yTop = f.y * scale;
  const h = f.height * scale;
  return pageHeight - yTop - h;
}

/**
 * Fields that appear on the signed PDF (stamped values and completed signatures).
 */
export function stampedFieldBoxes(
  fields: DbField[],
  valueByFieldId: Record<string, string | null>,
): PdfFieldBox[] {
  const boxes: PdfFieldBox[] = [];
  for (const f of fields) {
    if (f.page === null || f.x === null || f.y === null || f.width === null || f.height === null) {
      continue;
    }
    const v = valueByFieldId[f.id] ?? f.value;
    if (f.type === "signature") {
      if (v) {
        boxes.push({
          page: f.page,
          x: f.x,
          y: f.y,
          width: f.width,
          height: f.height,
        });
      }
      continue;
    }
    if (v && String(v).trim()) {
      boxes.push({
        page: f.page,
        x: f.x,
        y: f.y,
        width: f.width,
        height: f.height,
      });
    }
  }
  return boxes;
}

/** Field values as they will exist on the PDF after this signing request completes. */
export function projectedPdfFieldValues(
  fields: DbField[],
  signerEmail: string,
  submittedValues: Record<string, string>,
  signaturePng: string | null,
  signerKey?: string | null,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const f of fields) {
    if (f.type === "signature") {
      if (fieldMatchesSigner(f, { recipientEmail: signerEmail, signerKey }) && signaturePng) {
        out[f.id] = signaturePng;
      } else {
        out[f.id] = f.value;
      }
      continue;
    }
    if (f.prefilled) {
      out[f.id] = f.value;
      continue;
    }
    if (!fieldMatchesSigner(f, { recipientEmail: signerEmail, signerKey })) {
      out[f.id] = f.value;
      continue;
    }
    out[f.id] = submittedValues[f.id] ?? f.value;
  }
  return out;
}

export function lowestContentBottomOnPage(
  boxes: PdfFieldBox[],
  pageIndex: number,
  pageWidth: number,
  pageHeight: number,
): number | null {
  let minBottom: number | null = null;
  for (const b of boxes) {
    if (b.page !== pageIndex) continue;
    const bottom = fieldBottomPdfPt(b, pageWidth, pageHeight);
    if (minBottom === null || bottom < minBottom) minBottom = bottom;
  }
  return minBottom;
}
