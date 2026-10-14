import { describe, expect, it } from "vitest";
import fs from "fs";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { stampPdf, applyCombinedPdfAudit } from "../stamp-pdf";
import { buildPdfStampFields } from "../pdf-stamp-fields";
import { projectedPdfFieldValues, stampedFieldBoxes } from "../pdf-field-extents";
import type { field } from "@/db/schema";

const SIG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

type DbField = typeof field.$inferSelect;

async function pdfHasSealed(bytes: Uint8Array): Promise<boolean> {
  const doc = await getDocument({ data: new Uint8Array(bytes) }).promise;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const c = await page.getTextContent();
    if (c.items.map((i) => ("str" in i ? i.str : "")).join(" ").includes("Sealed")) {
      return true;
    }
  }
  return false;
}

function makeFields(): DbField[] {
  const base = {
    documentId: "doc_test",
    name: null,
    label: null,
    required: true,
    prefilled: false,
    privateForOtherSigners: false,
    page: 0,
    x: 40,
    y: 780,
    width: 280,
    height: 44,
  };
  return [
    {
      ...base,
      id: "fld_seller_sig",
      type: "signature",
      assignedToSignerEmail: "seller@example.com",
      value: null,
      y: 780,
    },
    {
      ...base,
      id: "fld_buyer_sig",
      type: "signature",
      assignedToSignerEmail: "buyer@example.com",
      value: null,
      y: 730,
    },
    {
      ...base,
      id: "fld_seller_postal",
      type: "text",
      assignedToSignerEmail: "seller@example.com",
      value: "00710 Helsinki",
      y: 380,
      width: 55,
      height: 18,
      prefilled: true,
    },
  ] as DbField[];
}

/** Mirrors POST /api/sign/[token] PDF stamping for each signer. */
async function signPdfPass(args: {
  basePdf: Uint8Array;
  fields: DbField[];
  signerEmail: string;
  priorSignedCount: number;
  values: Record<string, string>;
  signaturePng: string;
  sealedSigners: { email: string; signedAt: Date }[];
}) {
  const fieldsToStamp = buildPdfStampFields({
    fields: args.fields,
    signerEmail: args.signerEmail,
    priorSignedCount: args.priorSignedCount,
    submittedValues: args.values,
  });
  let stamped = await stampPdf({
    pdfBytes: args.basePdf,
    fields: fieldsToStamp,
    signaturePng: args.signaturePng,
  });
  const projected = projectedPdfFieldValues(
    args.fields,
    args.signerEmail,
    args.values,
    args.signaturePng,
  );
  stamped = await applyCombinedPdfAudit(
    stamped,
    args.sealedSigners,
    {
      documentId: "doc_pipeline",
      contentHashShort: "abcd1234…9ef0",
      auditTimezone: "Europe/Helsinki",
    },
    stampedFieldBoxes(args.fields, projected),
    { multiSignerDocument: true },
  );
  return stamped;
}

describe("two-signer PDF pipeline (bot API path)", () => {
  it("sequential signs always produce a visible seal block", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([800, 842]);
    let base = await pdf.save();

    const fields = makeFields();
    const t1 = new Date("2026-10-12T14:07:00Z");
    const t2 = new Date("2026-10-13T12:59:00Z");

    base = await signPdfPass({
      basePdf: base,
      fields,
      signerEmail: "seller@example.com",
      priorSignedCount: 0,
      values: {},
      signaturePng: SIG,
      sealedSigners: [{ email: "seller@example.com", signedAt: t1 }],
    });
    expect(await pdfHasSealed(base)).toBe(true);
    const afterSeller = await PDFDocument.load(base);
    expect(afterSeller.getPageCount()).toBe(2);

    const fieldsAfterSeller = fields.map((f) =>
      f.id === "fld_seller_sig" ? { ...f, value: SIG } : f,
    );

    const final = await signPdfPass({
      basePdf: base,
      fields: fieldsAfterSeller,
      signerEmail: "buyer@example.com",
      priorSignedCount: 1,
      values: {},
      signaturePng: SIG,
      sealedSigners: [
        { email: "seller@example.com", signedAt: t1 },
        { email: "buyer@example.com", signedAt: t2 },
      ],
    });

    const loaded = await PDFDocument.load(final);
    expect(loaded.getPageCount()).toBe(2);
    expect(await pdfHasSealed(final)).toBe(true);
    const doc = await getDocument({ data: new Uint8Array(final) }).promise;
    const lastPage = await doc.getPage(doc.numPages);
    const lastText = (await lastPage.getTextContent()).items
      .map((i) => ("str" in i ? i.str : ""))
      .join(" ");
    expect(lastText).toContain("Europe/Helsinki");
    expect(lastText).toContain("seller@example.com");
    expect(lastText).toContain("buyer@example.com");

    let sealedCount = 0;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const t = (await page.getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ");
      sealedCount += (t.match(/Sealed/g) ?? []).length;
    }
    expect(sealedCount).toBe(1);
  });

  it("re-seals prod-like PDF missing audit (regression doc)", async () => {
    const prodPath = "/home/ubuntu/.cursor/projects/workspace/uploads/signed_4a15.pdf";
    if (!fs.existsSync(prodPath)) return;
    const bytes = fs.readFileSync(prodPath);
    const boxes = [
      { page: 0, x: 50, y: 780, width: 280, height: 44 },
      { page: 0, x: 50, y: 730, width: 280, height: 44 },
    ];
    const repaired = await applyCombinedPdfAudit(
      bytes,
      [
        { email: "seller@example.com", signedAt: new Date("2026-10-12T14:07:00Z") },
        { email: "buyer@example.com", signedAt: new Date("2026-10-13T12:59:00Z") },
      ],
      { documentId: "doc_repair", contentHashShort: "demo…hash", auditTimezone: "Europe/Helsinki" },
      boxes,
    );
    expect(await pdfHasSealed(repaired)).toBe(true);
  });

  it("legacy Subject puumerkki:sealPage=0 must not skip the audit footer", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([800, 842]);
    pdf.setSubject("puumerkki:sealPage=0");
    let base = await pdf.save();

    const fields = makeFields();
    base = await signPdfPass({
      basePdf: base,
      fields,
      signerEmail: "seller@example.com",
      priorSignedCount: 0,
      values: {},
      signaturePng: SIG,
      sealedSigners: [{ email: "seller@example.com", signedAt: new Date() }],
    });
    expect(await pdfHasSealed(base)).toBe(true);
    const loaded = await PDFDocument.load(base);
    expect(loaded.getSubject()).toBe("");
  });
});
