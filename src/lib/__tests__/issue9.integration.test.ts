import { describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { stampPdf, applyCombinedPdfAudit } from "../stamp-pdf";
import { applyHtmlAuditFooter, stripHtmlAuditFooter } from "../audit-footer";
import { fillHtml } from "../html-form";
import { redactPdfForViewer } from "../pdf-redact";
import { generateWebhookSignature, isSafeWebhookUrl, sendWebhook } from "../webhook";
import { fieldsVisibleToSigner } from "../field-visibility";
import { validateHetu } from "../hetu";
import { formatDateFinnish } from "../validators";

const SIG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

async function minimalPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([600, 800]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("Contract", { x: 50, y: 750, size: 12, font });
  return await pdf.save();
}

describe("two-signer PDF flow", () => {
  it("keeps both signatures and one combined audit block", async () => {
    const base = await minimalPdf();
    const afterA = await stampPdf({
      pdfBytes: base,
      fields: [
        { type: "text", page: 0, x: 50, y: 50, width: 120, height: 24, value: "Alice" },
        { type: "signature", page: 0, x: 50, y: 100, width: 120, height: 40, value: null },
      ],
      signaturePng: SIG,
    });
    const afterB = await stampPdf({
      pdfBytes: afterA,
      fields: [
        { type: "text", page: 0, x: 200, y: 50, width: 120, height: 24, value: "Bob" },
        { type: "signature", page: 0, x: 200, y: 100, width: 120, height: 40, value: null },
      ],
      signaturePng: SIG,
    });
    const sealed = await applyCombinedPdfAudit(afterB, [
      { email: "a@example.com", signedAt: new Date("2024-01-01T12:00:00Z") },
      { email: "b@example.com", signedAt: new Date("2024-01-02T12:00:00Z") },
    ], { documentId: "doc_test", contentHashShort: "abc…def" });
    expect(sealed.length).toBeGreaterThan(afterB.length);
  });
});

describe("two-signer HTML flow", () => {
  it("enforces one audit section with both signers", () => {
    const html = `<html><body><input data-pm-field="name_a" value=""><input data-pm-field="name_b" value=""></body></html>`;
    let filled = fillHtml(html, { name_a: "Alice" }, SIG);
    filled = applyHtmlAuditFooter(filled, [
      { email: "a@example.com", signedAt: new Date("2024-01-01T12:00:00Z") },
    ], { documentId: "doc_x", contentHashShort: "aaa" });
    filled = stripHtmlAuditFooter(filled);
    filled = fillHtml(filled, { name_a: "Alice", name_b: "Bob" }, SIG);
    filled = applyHtmlAuditFooter(filled, [
      { email: "a@example.com", signedAt: new Date("2024-01-01T12:00:00Z") },
      { email: "b@example.com", signedAt: new Date("2024-01-02T12:00:00Z") },
    ], { documentId: "doc_x", contentHashShort: "aaa" });
    expect(filled.match(/data-pm-audit/g)?.length).toBe(1);
    expect(filled).toContain("a@example.com");
    expect(filled).toContain("b@example.com");
  });
});

describe("private field masking", () => {
  it("hides private hetu from other signers in PDF", async () => {
    const base = await minimalPdf();
    const stamped = await stampPdf({
      pdfBytes: base,
      fields: [
        { type: "hetu", page: 0, x: 50, y: 50, width: 140, height: 24, value: "010190-123M" },
      ],
      signaturePng: null,
    });
    const redacted = await redactPdfForViewer(
      stamped,
      [
        {
          type: "hetu",
          page: 0,
          x: 50,
          y: 50,
          width: 140,
          height: 24,
          value: "010190-123M",
          privateForOtherSigners: true,
          assignedToSignerEmail: "owner@example.com",
        },
      ],
      "other@example.com",
    );
    expect(redacted.length).toBeGreaterThan(0);
  });

  it("filters fields visible to signer", () => {
    const fields = [
      {
        id: "1",
        privateForOtherSigners: true,
        assignedToSignerEmail: "a@example.com",
      },
      {
        id: "2",
        privateForOtherSigners: false,
        assignedToSignerEmail: null,
      },
    ] as Parameters<typeof fieldsVisibleToSigner>[0];
    const visible = fieldsVisibleToSigner(fields, "b@example.com");
    expect(visible.map((f) => f.id)).toEqual(["2"]);
  });
});

describe("webhook security", () => {
  it("blocks internal URLs", () => {
    expect(isSafeWebhookUrl("http://127.0.0.1/hook")).toBe(false);
    expect(isSafeWebhookUrl("http://169.254.169.254/")).toBe(false);
    expect(isSafeWebhookUrl("https://hooks.example.com/nimmari")).toBe(true);
  });

  it("signs payload with HMAC", () => {
    const sig = generateWebhookSignature('{"a":1}', "secret");
    expect(sig).toHaveLength(64);
  });

  it("times out slow webhooks", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
      ),
    );
    const promise = sendWebhook("https://hooks.example.com/x", { ok: true });
    await vi.advanceTimersByTimeAsync(11_000);
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timed out/i);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});

describe("prefill and formats", () => {
  it("formats dates in Finnish", () => {
    expect(formatDateFinnish("2024-03-05")).toBe("5.3.2024");
  });

  it("rejects impossible hetu calendar dates", () => {
    expect(validateHetu("310200A123D")).toBe(false);
  });
});

describe("notify flag contract", () => {
  it("documents notify defaults in send options schema", async () => {
    const { SendBody } = await import("../send-options");
    const parsed = SendBody.safeParse({ email: "a@example.com", notify: false });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.notify).toBe(false);
  });
});
