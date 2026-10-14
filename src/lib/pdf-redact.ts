import { fieldMatchesSigner } from "@/lib/signer-assignment";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { maskHetu } from "./hetu";

const RENDER_WIDTH = 800;

type RedactField = {
  type: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  value: string | null;
  privateForOtherSigners: boolean;
  assignedSignerKey?: string | null;
  assignedToSignerEmail: string | null;
};

/**
 * Masks private field values in a stamped PDF for viewers who are not the
 * assigned signer (and not the document owner — owner should use unredacted blob).
 */
export async function redactPdfForViewer(
  pdfBytes: Uint8Array,
  fields: RedactField[],
  viewerEmail: string,
  viewerKey?: string | null,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(pdfBytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();

  for (const f of fields) {
    if (!f.privateForOtherSigners || !f.value) continue;
    if (fieldMatchesSigner(f, { recipientEmail: viewerEmail, signerKey: viewerKey })) continue;

    const page = pages[f.page];
    if (!page) continue;
    const { width: pw, height: ph } = page.getSize();
    const scale = pw / RENDER_WIDTH;
    const x = f.x * scale;
    const yTop = f.y * scale;
    const w = f.width * scale;
    const h = f.height * scale;
    const y = ph - yTop - h;

    page.drawRectangle({
      x,
      y,
      width: w,
      height: h,
      color: rgb(1, 1, 1),
      borderWidth: 0,
    });

    const display =
      f.type === "hetu" ? maskHetu(f.value) : "*".repeat(Math.min(f.value.length, 12));
    const fontSize = Math.min(h * 0.55, 12);
    page.drawText(display, {
      x: x + 4,
      y: y + (h - fontSize) / 2,
      size: fontSize,
      font,
      color: rgb(0.35, 0.29, 0.19),
    });
  }

  return await pdf.save();
}
