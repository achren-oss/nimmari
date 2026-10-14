import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { stampPdf, applyCombinedPdfAudit } from "../stamp-pdf";

const SIG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

async function pageText(bytes: Uint8Array, pageNumber: number): Promise<string> {
  const doc = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const page = await doc.getPage(pageNumber);
  const c = await page.getTextContent();
  return c.items.map((i) => ("str" in i ? i.str : "")).join(" ");
}

async function fullText(bytes: Uint8Array): Promise<string> {
  const doc = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const parts: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    parts.push(await pageText(bytes, p));
  }
  return parts.join("\n");
}

function countSealed(text: string): number {
  return (text.match(/Sealed/g) ?? []).length;
}

describe("seal page must not alter content pages", () => {
  it("leaves bottom signature, name, and footer text on the content page", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([800, 842]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText("Testi Ostaja", { x: 40, y: 48, size: 10, font });
    page.drawText("TRAFICOM footer line 308-redirect preserved", { x: 40, y: 28, size: 8, font });
    let bytes = await pdf.save();

    bytes = await stampPdf({
      pdfBytes: bytes,
      fields: [
        { type: "signature", page: 0, x: 40, y: 780, width: 280, height: 44, value: null },
        { type: "signature", page: 0, x: 40, y: 730, width: 280, height: 44, value: null },
      ],
      signaturePng: SIG,
    });

    const beforeSeal = await pageText(bytes, 1);
    expect(beforeSeal).toContain("Testi Ostaja");
    expect(beforeSeal).toContain("TRAFICOM footer");

    bytes = await applyCombinedPdfAudit(
      bytes,
      [
        { email: "seller@example.com", signedAt: new Date("2026-10-12T14:07:00Z") },
        { email: "buyer@example.com", signedAt: new Date("2026-10-13T12:59:00Z") },
      ],
      { documentId: "doc_luov", contentHashShort: "ab...cd", auditTimezone: "Europe/Helsinki" },
      [
        { page: 0, x: 40, y: 780, width: 280, height: 44 },
        { page: 0, x: 40, y: 730, width: 280, height: 44 },
      ],
      { multiSignerDocument: true },
    );

    const afterSeal = await pageText(bytes, 1);
    expect(afterSeal).toContain("Testi Ostaja");
    expect(afterSeal).toContain("TRAFICOM footer");
    expect(afterSeal).not.toContain("Sealed");

    const all = await fullText(bytes);
    expect(countSealed(all)).toBe(1);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
  });

  it("re-seal after two signers still shows Sealed exactly once", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([800, 842]);
    let bytes = await pdf.save();

    const boxes = [
      { page: 0, x: 40, y: 780, width: 200, height: 44 },
      { page: 0, x: 40, y: 730, width: 200, height: 44 },
    ];
    const meta = { documentId: "d", contentHashShort: "ab...cd", auditTimezone: "Europe/Helsinki" };
    const signers = [
      { email: "a@example.com", signedAt: new Date("2026-10-12T10:00:00Z") },
      { email: "b@example.com", signedAt: new Date("2026-10-13T11:00:00Z") },
    ];

    bytes = await applyCombinedPdfAudit(bytes, [signers[0]], meta, boxes, { multiSignerDocument: true });
    bytes = await stampPdf({
      pdfBytes: bytes,
      fields: [{ type: "signature", page: 0, x: 40, y: 730, width: 200, height: 44, value: null }],
      signaturePng: SIG,
    });
    bytes = await applyCombinedPdfAudit(bytes, signers, meta, boxes, { multiSignerDocument: true });

    expect(countSealed(await fullText(bytes))).toBe(1);
  });
});
