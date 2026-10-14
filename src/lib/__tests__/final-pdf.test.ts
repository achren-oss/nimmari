import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { signedPdfForTokenViewer } from "../signer-view-pdf";
import { stampPdf } from "../stamp-pdf";

async function text(bytes: Uint8Array) {
  const doc = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const c = await (await doc.getPage(1)).getTextContent();
  return c.items.map((i) => ("str" in i ? i.str : "")).join(" ");
}
const seller = "s@example.com";
const buyer = "b@example.com";
const sellerHetu = "131052-308T";
const buyerHetu = "010190-123M";
const geo = { page: 0, x: 50, width: 300, height: 30 };
const fields = [
  { ...geo, y: 50, type: "hetu" as const, value: sellerHetu, prefilled: false, privateForOtherSigners: true, assignedToSignerEmail: seller },
  { ...geo, y: 100, type: "hetu" as const, value: buyerHetu, prefilled: false, privateForOtherSigners: true, assignedToSignerEmail: buyer },
];

async function setup() {
  const p = await PDFDocument.create();
  p.addPage([595, 842]);
  const original = await p.save();
  const finalPdf = await stampPdf({ pdfBytes: original, fields: fields.map((f) => ({ ...f })), signaturePng: null });
  return { original, finalPdf };
}

describe("signedPdfForTokenViewer", () => {
  it("completed: every party gets both full hetus in plain text", async () => {
    const { original, finalPdf } = await setup();
    for (const viewer of [seller, buyer]) {
      const out = await signedPdfForTokenViewer({
        kind: "pdf", status: "completed", originalPdf: original, signedPdf: finalPdf,
        fields, signedEmails: new Set([seller, buyer]), viewerEmail: viewer,
      });
      const t = await text(out);
      expect(t).toContain(sellerHetu);
      expect(t).toContain(buyerHetu);
    }
  });
  it("in progress: other signer's hetu is really masked", async () => {
    const { original, finalPdf } = await setup();
    const out = await signedPdfForTokenViewer({
      kind: "pdf", status: "sent", originalPdf: original, signedPdf: finalPdf,
      fields, signedEmails: new Set([seller, buyer]), viewerEmail: buyer,
    });
    const t = await text(out);
    expect(t).not.toContain(sellerHetu);
    expect(t).toContain(buyerHetu);
  });
});
