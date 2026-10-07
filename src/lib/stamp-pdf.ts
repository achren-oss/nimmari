import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

import { layoutMultiline } from "./wrap-text";

type StampField = {
  type: "text" | "textarea" | "checkbox" | "signature";
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  value: string | null;
};

type AuditLine = {
  documentId: string;
  contentHashShort: string;
  signedAt: Date;
  recipientEmail: string;
};

const RENDER_WIDTH = 800;

export async function stampPdf({
  pdfBytes,
  fields,
  signaturePng,
  audit,
}: {
  pdfBytes: Uint8Array;
  fields: StampField[];
  signaturePng: string | null;
  audit?: AuditLine;
}) {
  const pdf = await PDFDocument.load(pdfBytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  let sigImage = null as Awaited<ReturnType<PDFDocument["embedPng"]>> | null;
  if (signaturePng) {
    const base64 = signaturePng.replace(/^data:image\/\w+;base64,/, "");
    const buf = Buffer.from(base64, "base64");
    sigImage = await pdf.embedPng(buf);
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
      const fontSize = Math.min(h * 0.6, 14);
      page.drawText(f.value, {
        x: x + 4,
        y: y + (h - fontSize) / 2,
        size: fontSize,
        font,
        color: rgb(0.05, 0.1, 0.2),
      });
    } else if (f.type === "textarea" && f.value) {
      const lineHeight = 1.2;
      const layout = layoutMultiline(f.value, font, w - 8, h - 8, {
        fontSize: 12, minFontSize: 6, lineHeight,
      });
      layout.lines.forEach((line, index) => {
        if (!line) return;
        page.drawText(line, {
          x: x + 4,
          y: y + h - 4 - layout.fontSize - index * layout.fontSize * lineHeight,
          size: layout.fontSize,
          font,
          color: rgb(0.05, 0.1, 0.2),
        });
      });
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

  if (audit) {
    const lastPage = pages[pages.length - 1];
    if (lastPage) {
      const { width: pw } = lastPage.getSize();
      const dt = audit.signedAt.toISOString().replace("T", " ").slice(0, 16) + " UTC";
      const line = `Sealed by ${audit.recipientEmail} on ${dt}  ·  Doc ${audit.documentId}  ·  SHA-256 ${audit.contentHashShort}`;
      const fontSize = 7;
      const margin = 24;
      lastPage.drawLine({
        start: { x: margin, y: margin + 14 },
        end: { x: pw - margin, y: margin + 14 },
        thickness: 0.5,
        color: rgb(0.59, 0.53, 0.42),
      });
      lastPage.drawText(line, {
        x: margin,
        y: margin + 4,
        size: fontSize,
        font,
        color: rgb(0.35, 0.29, 0.19),
      });
    }
  }

  return await pdf.save();
}
