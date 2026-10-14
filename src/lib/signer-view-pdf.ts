import { fieldMatchesSigner, hasSignerAssignment, type SignerIdentity } from "@/lib/signer-assignment";
import type { SignerFieldDto } from "@/lib/signer-fields";

/**
 * For multi-signer PDF documents, once any signer has sealed, `document.signedPdf`
 * holds the cumulative stamped PDF (all prefilled values + prior signers' values
 * and signatures). Later signers must view that version (redacted for them),
 * not the original upload — otherwise they see none of the agreed data.
 */
export function shouldViewStampedPdf(args: {
  kind: string;
  hasSignedPdf: boolean;
  priorSignedCount: number;
}): boolean {
  return args.kind === "pdf" && args.hasSignedPdf && args.priorSignedCount > 0;
}

/**
 * When the viewer sees the stamped PDF, prefilled values are already printed on
 * it (stamped on the first signing pass), so drop their overlays to avoid
 * double-drawn text. Fields the signer still has to fill stay.
 */
export function overlayFieldsForViewer(
  dtos: SignerFieldDto[],
  viewingStamped: boolean,
): SignerFieldDto[] {
  return viewingStamped ? dtos.filter((f) => !f.prefilled) : dtos;
}

type ViewerField = {
  type: "text" | "textarea" | "checkbox" | "signature" | "date" | "hetu";
  page: number | null;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  value: string | null;
  prefilled: boolean;
  privateForOtherSigners: boolean;
  assignedSignerKey?: string | null;
  assignedToSignerEmail: string | null;
};

/**
 * Builds what a later signer should see by stamping the ORIGINAL upload with
 * prefilled values plus prior signers' values and signatures. Other signers'
 * private values are never written in clear (hetu masked, others starred), so
 * nothing private ends up in the PDF text layer. (Covering the cumulative signed
 * PDF with a white box would still leave the text extractable.)
 */
export async function buildViewerPdf(args: {
  originalPdf: Uint8Array;
  fields: ViewerField[];
  signedEmails?: Set<string>;
  signedSessions?: SignerIdentity[];
  viewerKey?: string | null;
  viewerEmail: string;
}): Promise<Uint8Array> {
  const { stampPdf } = await import("@/lib/stamp-pdf");
  const placed = args.fields.filter(
    (f) => f.page !== null && f.x !== null && f.y !== null && f.width !== null && f.height !== null,
  );
  const geom = (f: ViewerField) => ({
    page: f.page!, x: f.x!, y: f.y!, width: f.width!, height: f.height!,
  });
  const byOther = (f: ViewerField) =>
    !fieldMatchesSigner(f, { recipientEmail: args.viewerEmail, signerKey: args.viewerKey });
  const signedSessions = args.signedSessions ??
    [...(args.signedEmails ?? [])].map((recipientEmail) => ({ recipientEmail }));
  const isSigned = (f: ViewerField) => hasSignerAssignment(f) &&
    signedSessions.some((s) => fieldMatchesSigner(f, s));

  const valueFields = placed
    .filter((f) => f.type !== "signature" && f.value !== null && f.value !== "")
    .filter((f) => f.prefilled || isSigned(f))
    .map((f) => {
      const hide = f.privateForOtherSigners && byOther(f);
      if (hide && f.type !== "hetu") {
        return { type: "text" as const, ...geom(f), value: "*".repeat(Math.min(f.value!.length, 12)) };
      }
      return { type: f.type, ...geom(f), value: f.value, maskValue: hide && f.type === "hetu" };
    });

  let bytes = await stampPdf({ pdfBytes: args.originalPdf, fields: valueFields, signaturePng: null });

  for (const f of placed) {
    if (f.type !== "signature" || !f.value) continue;
    if (!isSigned(f)) continue;
    bytes = await stampPdf({
      pdfBytes: bytes,
      fields: [{ type: "signature", ...geom(f), value: null }],
      signaturePng: f.value,
    });
  }
  return bytes;
}

/**
 * Which PDF a signing-token holder gets when downloading the signed document.
 * - Completed: the final signed PDF as-is. All signers' values, including full
 *   hetu, are shown in plain text to every party (no overlay masking).
 * - Still in progress (a signer downloads after sealing while others remain):
 *   rebuilt from the original with other signers' private values masked, so
 *   nothing private is in the text layer.
 */
export async function signedPdfForTokenViewer(args: {
  kind: string;
  status: string;
  originalPdf: Uint8Array | null;
  signedPdf: Uint8Array;
  fields: ViewerField[];
  signedEmails?: Set<string>;
  signedSessions?: SignerIdentity[];
  viewerKey?: string | null;
  viewerEmail: string;
}): Promise<Uint8Array> {
  if (args.status === "completed" || args.kind !== "pdf" || !args.originalPdf) {
    return args.signedPdf;
  }
  return buildViewerPdf({
    originalPdf: args.originalPdf,
    fields: args.fields,
    signedEmails: args.signedEmails,
    signedSessions: args.signedSessions,
    viewerKey: args.viewerKey,
    viewerEmail: args.viewerEmail,
  });
}
