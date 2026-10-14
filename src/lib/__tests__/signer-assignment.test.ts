import { describe, expect, it } from "vitest";
import { fieldMatchesSigner } from "../signer-assignment";
import { extractFields, htmlVisibleToSigner, sanitizeFormHtml } from "../html-form";
import { buildSignerFieldPayload } from "../signer-fields";
import { buildPdfStampFields } from "../pdf-stamp-fields";
import { projectedPdfFieldValues } from "../pdf-field-extents";
import type { field } from "@/db/schema";

describe("signer assignment", () => {
  it("gives keys precedence, preserves legacy email matching, and shares unassigned fields", () => {
    const signer = { recipientEmail: "same@example.com", signerKey: "seller" };
    expect(fieldMatchesSigner({ assignedSignerKey: "guarantor", assignedToSignerEmail: signer.recipientEmail }, signer)).toBe(false);
    expect(fieldMatchesSigner({ assignedSignerKey: "seller", assignedToSignerEmail: "other@example.com" }, signer)).toBe(true);
    expect(fieldMatchesSigner({ assignedToSignerEmail: signer.recipientEmail }, signer)).toBe(true);
    expect(fieldMatchesSigner({ assignedToSignerEmail: "other@example.com" }, signer)).toBe(false);
    expect(fieldMatchesSigner({}, signer)).toBe(true);
    expect(fieldMatchesSigner({ assignedSignerKey: "seller" }, { recipientEmail: signer.recipientEmail })).toBe(false);
  });

  it("preserves HTML key/role attributes and removes other slots' source values and controls", () => {
    const html = sanitizeFormHtml('<input data-pm-field="seller" data-pm-signer="same@example.com" data-pm-signer-key="seller"><input data-pm-field="guarantor" data-pm-signer="same@example.com" data-pm-role="guarantor" data-pm-private value="SECRET"><input data-pm-field="shared">');
    const fields = extractFields(html);
    expect(fields.map((f) => f.assignedSignerKey)).toEqual(["seller", "guarantor", null]);
    const visible = htmlVisibleToSigner(html, fields, { recipientEmail: "same@example.com", signerKey: "seller" });
    expect(visible).toContain('data-pm-field="seller"');
    expect(visible).toContain('data-pm-field="shared"');
    expect(visible).not.toContain('data-pm-field="guarantor"');
    expect(visible).not.toContain("SECRET");
  });

  it("keeps prefilled fields read-only per key and scopes stamping and projected extents", () => {
    const base = { documentId: "doc", name: null, label: null, required: true, privateForOtherSigners: false, assignedToSignerEmail: "same@example.com", page: 0, x: 40, y: 100, width: 150, height: 30, assignedSignerKey: "seller", prefilled: true, value: "Known" };
    const fields = [
      { ...base, id: "known", type: "text" },
      { ...base, id: "seller", type: "signature", prefilled: false, value: null },
      { ...base, id: "guarantor", type: "signature", assignedSignerKey: "guarantor", prefilled: false, value: null },
    ] as (typeof field.$inferSelect)[];
    const payload = buildSignerFieldPayload(fields, "same@example.com", "seller");
    expect(payload.map((f) => f.id)).toEqual(["known", "seller"]);
    expect(payload[0]).toMatchObject({ readOnly: true, value: "Known" });
    const stamped = buildPdfStampFields({ fields, signerEmail: "same@example.com", signerKey: "seller", priorSignedCount: 0, submittedValues: { known: "tampered" } });
    expect(stamped.map((f) => [f.type, f.value])).toEqual([["text", "Known"], ["signature", null]]);
    expect(projectedPdfFieldValues(fields, "same@example.com", { known: "tampered" }, "signature", "seller")).toEqual({ known: "Known", seller: "signature", guarantor: null });
  });
});
