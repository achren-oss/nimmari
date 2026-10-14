import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { stampPdf, applyCombinedPdfAudit } from "../stamp-pdf";
import { formatAuditTimestamp } from "../audit-timezone";

const SIG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

async function pdfText(bytes: Uint8Array): Promise<string> {
  const doc = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const parts: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const c = await page.getTextContent();
    parts.push(c.items.map((i) => ("str" in i ? i.str : "")).join(" "));
  }
  return parts.join("\n");
}

describe("audit timestamps (#12)", () => {
  it("formats in Europe/Helsinki with zone label", () => {
    const s = formatAuditTimestamp(new Date("2026-10-12T14:07:00.000Z"), "Europe/Helsinki");
    expect(s).toContain("Europe/Helsinki");
    expect(s).not.toContain("UTC");
    expect(s).toMatch(/2026-10-12 17:07/);
  });
});

describe("text fields in narrow boxes", () => {
  it("renders full postal code and city without dropping the city", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([600, 800]);
    const base = await pdf.save();
    const stamped = await stampPdf({
      pdfBytes: base,
      fields: [
        {
          type: "text",
          page: 0,
          x: 50,
          y: 400,
          width: 55,
          height: 18,
          value: "00710 Helsinki",
        },
      ],
      signaturePng: null,
    });
    const t = await pdfText(stamped);
    expect(t).toContain("00710");
    expect(t).toContain("Helsinki");
  });
});

describe("audit footer placement (#9)", () => {
  it("adds a seal page when the last signature sits in the audit band", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([800, 842]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText("Form", { x: 50, y: 800, size: 12, font });
    const base = await pdf.save();

    const sigBox = { page: 0, x: 50, y: 780, width: 200, height: 50 };

    const afterA = await stampPdf({
      pdfBytes: base,
      fields: [{ type: "signature", ...sigBox, value: null }],
      signaturePng: SIG,
    });

    const buyerSig = sigBox;
    const afterB = await stampPdf({
      pdfBytes: afterA,
      fields: [{ type: "signature", ...buyerSig, value: null }],
      signaturePng: SIG,
    });

    const sealed = await applyCombinedPdfAudit(
      afterB,
      [
        { email: "a@example.com", signedAt: new Date("2026-10-12T14:07:00Z") },
        { email: "b@example.com", signedAt: new Date("2026-10-13T12:59:00Z") },
      ],
      { documentId: "doc_test", contentHashShort: "abc…def", auditTimezone: "Europe/Helsinki" },
      [
        { page: 0, x: 50, y: 720, width: 200, height: 50 },
        { page: 0, x: 50, y: 720, width: 200, height: 50 },
      ],
    );

    const doc = await getDocument({ data: new Uint8Array(sealed) }).promise;
    expect(doc.numPages).toBe(2);
    const t = await pdfText(sealed);
    expect(t).toContain("Sealed");
    expect(t).toContain("Europe/Helsinki");
  });
});
