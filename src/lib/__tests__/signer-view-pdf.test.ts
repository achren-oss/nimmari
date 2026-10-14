import { describe, expect, it } from "vitest";
import { overlayFieldsForViewer, shouldViewStampedPdf } from "../signer-view-pdf";
import type { SignerFieldDto } from "../signer-fields";

const f = (id: string, prefilled: boolean): SignerFieldDto => ({
  id, type: "text", page: 0, x: 0, y: 0, width: 10, height: 10,
  required: false, prefilled, value: prefilled ? "v" : null, readOnly: prefilled,
});

describe("shouldViewStampedPdf", () => {
  it("uses original PDF for the first signer", () => {
    expect(shouldViewStampedPdf({ kind: "pdf", hasSignedPdf: false, priorSignedCount: 0 })).toBe(false);
  });
  it("uses stamped PDF once a prior signer sealed", () => {
    expect(shouldViewStampedPdf({ kind: "pdf", hasSignedPdf: true, priorSignedCount: 1 })).toBe(true);
  });
  it("never for html docs", () => {
    expect(shouldViewStampedPdf({ kind: "html", hasSignedPdf: true, priorSignedCount: 1 })).toBe(false);
  });
});

describe("overlayFieldsForViewer", () => {
  it("drops prefilled overlays only when viewing stamped PDF", () => {
    const all = [f("a", true), f("b", false)];
    expect(overlayFieldsForViewer(all, false).map((x) => x.id)).toEqual(["a", "b"]);
    expect(overlayFieldsForViewer(all, true).map((x) => x.id)).toEqual(["b"]);
  });
});
