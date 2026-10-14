import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { stampPdf } from "../stamp-pdf";
import { buildSignerFieldPayload, initialSignerValues } from "../signer-fields";
import { buildPdfStampFields } from "../pdf-stamp-fields";

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const doc = await getDocument({ data: bytes }).promise;
  const parts: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const item of content.items as { str?: string }[]) {
      if (item.str) parts.push(item.str);
    }
  }
  return parts.join(" ");
}

async function minimalPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage([600, 800]);
  return await pdf.save();
}

describe("PDF prefill signer payload and stamping", () => {
  it("exposes prefilled values on signer GET-shaped payload and stamps once", async () => {
    const fieldRow = {
      id: "fld_prefill",
      documentId: "doc_x",
      type: "text" as const,
      page: 0,
      x: 40,
      y: 60,
      width: 200,
      height: 28,
      name: "Company",
      label: "Company",
      required: true,
      value: "Acme Oy",
      prefilled: true,
      privateForOtherSigners: false,
      assignedToSignerEmail: null,
      assignedSignerKey: null,
    };

    const dtos = buildSignerFieldPayload([fieldRow], "signer@example.com");
    expect(dtos).toHaveLength(1);
    expect(dtos[0]).toMatchObject({
      id: "fld_prefill",
      prefilled: true,
      readOnly: true,
      value: "Acme Oy",
    });
    expect(initialSignerValues(dtos)).toEqual({ fld_prefill: "Acme Oy" });

    const stampList = buildPdfStampFields({
      fields: [fieldRow],
      signerEmail: "signer@example.com",
      priorSignedCount: 0,
      submittedValues: {},
    });
    expect(stampList[0]?.value).toBe("Acme Oy");

    const base = await minimalPdf();
    const stamped = await stampPdf({
      pdfBytes: base,
      fields: stampList,
      signaturePng: null,
    });
    const text = await extractPdfText(stamped);
    expect(text).toContain("Acme Oy");

    const secondPass = buildPdfStampFields({
      fields: [fieldRow],
      signerEmail: "other@example.com",
      priorSignedCount: 1,
      submittedValues: {},
    });
    expect(secondPass.filter((f) => f.type === "text")).toHaveLength(0);
  });
});
