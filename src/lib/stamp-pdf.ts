import { PNG } from "pngjs";
import { PDFDocument, PDFName, PDFNumber, rgb, StandardFonts } from "pdf-lib";

import { cropSignatureRgba } from "./signature-crop";
import { PDF_OVERLAY_WIDTH } from "./pdf-coords";
import { maskHetu } from "./hetu";
import { formatDateFinnish } from "./validators";
import type { AuditDocumentMeta, SealedSigner } from "./audit-footer";
import { formatAuditTimestamp } from "./audit-timezone";
import { drawTextInBox } from "./draw-text-in-box";
import type { PdfFieldBox } from "./pdf-field-extents";
import { lowestContentBottomOnPage } from "./pdf-field-extents";
import { pdfAuditText } from "./pdf-audit-text";

type StampField = {
  type: "text" | "textarea" | "checkbox" | "signature" | "date" | "hetu";
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  value: string | null;
  maskValue?: boolean;
};

const RENDER_WIDTH = PDF_OVERLAY_WIDTH;
const PDF_AUDIT_BAND_PT = 72;
const AUDIT_SIDE_MARGIN = 24;
const AUDIT_CONTENT_GAP = 8;
const LEGACY_SEAL_SUBJECT_PREFIX = "puumerkki:sealPage=";
const CATALOG_SEAL_PAGE = PDFName.of("PuumerkkiSealPage");

const ink = rgb(0.05, 0.1, 0.2);

/** Legacy/API signatures may still contain the full transparent canvas. */
export function cropSignaturePng(bytes: Uint8Array): Uint8Array {
  try {
    const png = PNG.sync.read(Buffer.from(bytes));
    const cropped = cropSignatureRgba(png.data, png.width, png.height);
    if (!cropped) return bytes;
    const output = new PNG({
      width: cropped.width,
      height: cropped.height,
    });
    output.data = Buffer.from(cropped.data);
    return PNG.sync.write(output);
  } catch {
    return bytes;
  }
}

export async function stampPdf({
  pdfBytes,
  fields,
  signaturePng,
}: {
  pdfBytes: Uint8Array;
  fields: StampField[];
  signaturePng: string | null;
}) {
  const pdf = await PDFDocument.load(pdfBytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  let sigImage = null as Awaited<ReturnType<PDFDocument["embedPng"]>> | null;
  if (signaturePng) {
    const base64 = signaturePng.replace(/^data:image\/\w+;base64,/, "");
    const buf = Buffer.from(base64, "base64");
    sigImage = await pdf.embedPng(cropSignaturePng(buf));
  }

  const pages = pdf.getPages();

  for (const f of fields) {
    const page = pages[f.page];
    if (!page) continue;
    const { width: pw, height: ph } = page.getSize();
    const scale = pw / RENDER_WIDTH;

    const x = f.x * scale;
    const yTop = f.y * scale;
    const w = f.width * scale;
    const h = f.height * scale;
    const y = ph - yTop - h;

    if (f.type === "text" && f.value) {
      drawTextInBox(page, font, f.value, x, y, w, h, ink);
    } else if (f.type === "date" && f.value) {
      drawTextInBox(page, font, formatDateFinnish(f.value), x, y, w, h, ink);
    } else if (f.type === "hetu" && f.value) {
      const displayValue = f.maskValue ? maskHetu(f.value) : f.value;
      drawTextInBox(page, font, displayValue, x, y, w, h, ink);
    } else if (f.type === "textarea" && f.value) {
      drawTextInBox(page, font, f.value, x, y, w, h, ink);
    } else if (f.type === "checkbox") {
      page.drawRectangle({
        x,
        y,
        width: w,
        height: h,
        borderColor: rgb(0.2, 0.2, 0.2),
        borderWidth: 1,
      });
      if (f.value === "true") {
        page.drawLine({
          start: { x: x + 3, y: y + h / 2 },
          end: { x: x + w / 3, y: y + 3 },
          thickness: 1.5,
          color: rgb(0.05, 0.4, 0.2),
        });
        page.drawLine({
          start: { x: x + w / 3, y: y + 3 },
          end: { x: x + w - 3, y: y + h - 3 },
          thickness: 1.5,
          color: rgb(0.05, 0.4, 0.2),
        });
      }
    } else if (f.type === "signature" && sigImage) {
      const imgRatio = sigImage.width / sigImage.height;
      const boxRatio = w / h;
      let drawW = w;
      let drawH = h;
      if (imgRatio > boxRatio) {
        drawH = w / imgRatio;
      } else {
        drawW = h * imgRatio;
      }
      page.drawImage(sigImage, {
        x: x + (w - drawW) / 2,
        y: y + (h - drawH) / 2,
        width: drawW,
        height: drawH,
      });
    }
  }

  return await pdf.save();
}

function readCatalogSealPageIndex(pdf: PDFDocument): number | null {
  const raw = pdf.catalog.get(CATALOG_SEAL_PAGE);
  if (!raw || typeof raw !== "object" || !("asNumber" in raw)) return null;
  const n = (raw as PDFNumber).asNumber();
  return Number.isFinite(n) ? n : null;
}

function writeCatalogSealPageIndex(pdf: PDFDocument, pageIndex: number | null): void {
  if (pageIndex === null) {
    pdf.catalog.delete(CATALOG_SEAL_PAGE);
    return;
  }
  pdf.catalog.set(CATALOG_SEAL_PAGE, PDFNumber.of(pageIndex));
}

function readLegacySubjectSealPageIndex(subject: string | undefined): number | null {
  if (!subject?.startsWith(LEGACY_SEAL_SUBJECT_PREFIX)) return null;
  const n = Number.parseInt(subject.slice(LEGACY_SEAL_SUBJECT_PREFIX.length), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function clearLegacySealSubject(pdf: PDFDocument): void {
  const subject = pdf.getSubject();
  if (subject?.startsWith(LEGACY_SEAL_SUBJECT_PREFIX)) {
    pdf.setSubject("");
  }
}

/** Marked dedicated seal page index, if the last page is the seal. */
function markedSealPageIndex(pdf: PDFDocument): number | null {
  const pageCount = pdf.getPageCount();
  if (pageCount < 2) return null;
  const last = pageCount - 1;
  const catalogIdx = readCatalogSealPageIndex(pdf);
  const legacyIdx = readLegacySubjectSealPageIndex(pdf.getSubject());
  const marked = catalogIdx ?? legacyIdx;
  if (marked === null || marked <= 0 || marked !== last) return null;
  return last;
}

/** Remove the old seal page entirely so audit text is not left in the content stream. */
function removeMarkedSealPage(pdf: PDFDocument): void {
  const idx = markedSealPageIndex(pdf);
  if (idx === null || idx <= 0) {
    clearLegacySealSubject(pdf);
    return;
  }
  pdf.removePage(idx);
  writeCatalogSealPageIndex(pdf, null);
  clearLegacySealSubject(pdf);
}

export function pdfAuditBandHeightPt(signerCount: number): number {
  const lineHeight = 9;
  return PDF_AUDIT_BAND_PT + signerCount * lineHeight;
}

export type PdfAuditOptions = {
  /** When true, always use a dedicated seal page (multi-signer documents). */
  multiSignerDocument?: boolean;
};

/** Replace the bottom audit band with one combined block for all signers. */
export async function applyCombinedPdfAudit(
  pdfBytes: Uint8Array,
  signers: SealedSigner[],
  meta: AuditDocumentMeta,
  stampedBoxes: PdfFieldBox[] = [],
  options: PdfAuditOptions = {},
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(pdfBytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const timeZone = meta.auditTimezone;

  clearLegacySealSubject(pdf);
  removeMarkedSealPage(pdf);

  let pages = pdf.getPages();
  if (pages.length === 0) {
    pdf.addPage([595, 842]);
    pages = pdf.getPages();
  }

  const contentPageIndex = pdf.getPageCount() - 1;
  const contentPage = pdf.getPages()[contentPageIndex]!;
  const { width: pw, height: ph } = contentPage.getSize();
  const lineHeight = 9;
  const bandHeight = pdfAuditBandHeightPt(signers.length);
  const auditTop = bandHeight + AUDIT_SIDE_MARGIN;

  const contentBottom = lowestContentBottomOnPage(
    stampedBoxes,
    contentPageIndex,
    pw,
    ph,
  );
  const useDedicatedSealPage =
    options.multiSignerDocument === true ||
    (contentBottom !== null && contentBottom < auditTop + AUDIT_CONTENT_GAP);

  let auditPage = contentPage;

  if (useDedicatedSealPage) {
    auditPage = pdf.addPage([pw, ph]);
    writeCatalogSealPageIndex(pdf, pdf.getPageCount() - 1);
  } else {
    writeCatalogSealPageIndex(pdf, null);
    // Inline audit only: clear the bottom band on the content page, then draw there.
    contentPage.drawRectangle({
      x: 0,
      y: 0,
      width: pw,
      height: auditTop,
      color: rgb(1, 1, 1),
    });
  }

  const margin = AUDIT_SIDE_MARGIN;
  let y = bandHeight;
  auditPage.drawLine({
    start: { x: margin, y },
    end: { x: pw - margin, y },
    thickness: 0.5,
    color: rgb(0.59, 0.53, 0.42),
  });
  y -= 10;
  auditPage.drawText(pdfAuditText("Sealed"), {
    x: margin,
    y: y - 2,
    size: 8,
    font,
    color: rgb(0.29, 0.42, 0.24),
  });
  y -= lineHeight;
  for (const s of signers) {
    const line = pdfAuditText(
      `${s.email}  -  ${formatAuditTimestamp(s.signedAt, timeZone ?? "")}`,
    );
    auditPage.drawText(line, {
      x: margin,
      y: y - 2,
      size: 7,
      font,
      color: rgb(0.35, 0.29, 0.19),
    });
    y -= lineHeight;
  }
  const metaLine = pdfAuditText(
    `Doc ${meta.documentId}  -  SHA-256 ${meta.contentHashShort}`,
  );
  auditPage.drawText(metaLine, {
    x: margin,
    y: margin + 2,
    size: 7,
    font,
    color: rgb(0.35, 0.29, 0.19),
  });

  return await pdf.save();
}
