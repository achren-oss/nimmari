import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { stampPdf, applyCombinedPdfAudit } from "../stamp-pdf";

async function pdfHasSealed(bytes: Uint8Array): Promise<boolean> {
  const doc = await getDocument({ data: new Uint8Array(bytes) }).promise;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const c = await page.getTextContent();
    if (c.items.map((i) => ("str" in i ? i.str : "")).join(" ").includes("Sealed")) return true;
  }
  return false;
}

const SIG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

describe("stampPdf preserves pages", () => {
  it("keeps seal page when stamping second signature", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([800, 842]);
    let bytes = await pdf.save();

    bytes = await applyCombinedPdfAudit(
      bytes,
      [{ email: "a@example.com", signedAt: new Date() }],
      { documentId: "d", contentHashShort: "ab...cd", auditTimezone: "Europe/Helsinki" },
      [{ page: 0, x: 40, y: 780, width: 200, height: 44 }],
    );
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);

    bytes = await stampPdf({
      pdfBytes: bytes,
      fields: [{ type: "signature", page: 0, x: 40, y: 730, width: 200, height: 44, value: null }],
      signaturePng: SIG,
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);

    bytes = await applyCombinedPdfAudit(
      bytes,
      [
        { email: "a@example.com", signedAt: new Date() },
        { email: "b@example.com", signedAt: new Date() },
      ],
      { documentId: "d", contentHashShort: "ab...cd", auditTimezone: "Europe/Helsinki" },
      [
        { page: 0, x: 40, y: 780, width: 200, height: 44 },
        { page: 0, x: 40, y: 730, width: 200, height: 44 },
      ],
    );
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(2);
    expect(await pdfHasSealed(bytes)).toBe(true);
  });

  it("clears stale inline seal text from the content page when moving to a seal page", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([800, 842]);
    let bytes = await pdf.save();

    bytes = await applyCombinedPdfAudit(
      bytes,
      [{ email: "first@example.com", signedAt: new Date("2026-10-12T10:00:00Z") }],
      { documentId: "d", contentHashShort: "ab...cd", auditTimezone: "Europe/Helsinki" },
      [],
      { multiSignerDocument: true },
    );

    const boxes = [{ page: 0, x: 40, y: 780, width: 200, height: 44 }];
    bytes = await applyCombinedPdfAudit(
      bytes,
      [
        { email: "first@example.com", signedAt: new Date("2026-10-12T10:00:00Z") },
        { email: "second@example.com", signedAt: new Date("2026-10-13T11:00:00Z") },
      ],
      { documentId: "d", contentHashShort: "ab...cd", auditTimezone: "Europe/Helsinki" },
      boxes,
      { multiSignerDocument: true },
    );

    const doc = await getDocument({ data: new Uint8Array(bytes) }).promise;
    expect(doc.numPages).toBe(2);
    const page1 = await doc.getPage(1);
    const t1 = (await page1.getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ");
    expect(t1).not.toContain("Sealed");
    expect(t1).not.toContain("first@example.com");

    const page2 = await doc.getPage(2);
    const t2 = (await page2.getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ");
    expect(t2).toContain("Sealed");
    expect(t2).toContain("first@example.com");
    expect(t2).toContain("second@example.com");
    const all = [
      t1,
      t2,
    ].join(" ");
    expect((all.match(/Sealed/g) ?? []).length).toBe(1);
  });
});
