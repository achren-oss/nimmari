import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { buildViewerPdf } from "../signer-view-pdf";

async function blankPdf() {
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  return await pdf.save();
}
async function text(bytes: Uint8Array) {
  const doc = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const page = await doc.getPage(1);
  const c = await page.getTextContent();
  return c.items.map((i) => ("str" in i ? i.str : "")).join(" ");
}
const base = { page: 0, x: 50, width: 300, height: 30 };
const seller = "seller@example.com";
const buyer = "buyer@example.com";
const hetu = "131052-308T";

describe("buildViewerPdf", () => {
  it("shows prefilled + prior signer values, masks other signer's hetu fully", async () => {
    const out = await buildViewerPdf({
      originalPdf: await blankPdf(),
      signedEmails: new Set([seller]),
      viewerEmail: buyer,
      fields: [
        { ...base, y: 50, type: "text", value: "TST-123", prefilled: true, privateForOtherSigners: false, assignedToSignerEmail: seller },
        { ...base, y: 100, type: "text", value: "Kotikatu 1", prefilled: false, privateForOtherSigners: false, assignedToSignerEmail: seller },
        { ...base, y: 150, type: "hetu", value: hetu, prefilled: false, privateForOtherSigners: true, assignedToSignerEmail: seller },
        { ...base, y: 200, type: "text", value: "Ostaja", prefilled: true, privateForOtherSigners: false, assignedToSignerEmail: buyer },
      ],
    });
    const t = await text(out);
    expect(t).toContain("TST-123");
    expect(t).toContain("Kotikatu 1");
    expect(t).toContain("Ostaja");
    expect(t).not.toContain(hetu);
    expect(t).toContain("*******308T"); // existing maskHetu policy: last 4 only
    expect(t).not.toContain("131052");
  });
});
