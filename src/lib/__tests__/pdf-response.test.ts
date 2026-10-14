import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isCompletePdf, pdfResponse } from "../pdf-response";

async function realPdf() {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 40; i++) {
    pdf.addPage().drawText(`Page ${i}: signing document integrity check`);
  }
  return pdf.save({ useObjectStreams: false });
}

afterEach(() => vi.restoreAllMocks());

describe("pdfResponse", () => {
  it("serves a complete PDF with matching length and integrity headers", async () => {
    const bytes = await realPdf();
    const digest = createHash("sha256").update(bytes).digest();
    const response = pdfResponse(bytes, "agreement.pdf");
    expect(isCompletePdf(bytes)).toBe(true);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe('inline; filename="agreement.pdf"');
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Length")).toBe(String(bytes.byteLength));
    expect(response.headers.get("X-Content-SHA256")).toBe(digest.toString("hex"));
    expect(response.headers.get("Repr-Digest")).toBe(`sha-256=:${digest.toString("base64")}:`);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it("rejects the first 8185 bytes of a real PDF with a retryable JSON response", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const bytes = await realPdf();
    expect(bytes.byteLength).toBeGreaterThan(8185);
    const truncated = bytes.subarray(0, 8185);
    expect(isCompletePdf(truncated)).toBe(false);
    const response = pdfResponse(truncated, "agreement.pdf");
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("2");
    expect(await response.json()).toEqual({ error: "PDF not ready" });
    expect(log).toHaveBeenCalledOnce();
  });

  it("rejects non-PDF bytes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = pdfResponse(new TextEncoder().encode("not a PDF"), "agreement.pdf");
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("2");
    expect(await response.json()).toEqual({ error: "PDF not ready" });
  });

  it("requires startxref and an EOF marker within the last 2048 bytes", () => {
    const encode = (value: string) => new TextEncoder().encode(value);
    expect(isCompletePdf(encode("%PDF-1.7\n%%EOF"))).toBe(false);
    expect(isCompletePdf(encode("%PDF-1.7\nstartxref\n0\n%%EOF" + " ".repeat(2048)))).toBe(false);
    expect(isCompletePdf(encode("invalid\nstartxref\n0\n%%EOF"))).toBe(false);
  });
});
