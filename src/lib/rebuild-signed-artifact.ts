import { fieldMatchesSigner } from "@/lib/signer-assignment";
import type { document, field, signingSession } from "@/db/schema";
import { stampPdf, applyCombinedPdfAudit } from "./stamp-pdf";
import { stampedFieldBoxes } from "./pdf-field-extents";
import { resolveAuditTimezone } from "./audit-timezone";
import { shortHash } from "./hash";
import { fillHtml } from "./html-form";
import { applyHtmlAuditFooter } from "./audit-footer";
import { renderHtmlToPdf } from "./render-pdf";

/** Rebuild only from original content and committed session/field state. Caller holds the document write lock. */
export async function rebuildSignedArtifact(
  doc: typeof document.$inferSelect,
  fields: (typeof field.$inferSelect)[],
  sessions: (typeof signingSession.$inferSelect)[],
): Promise<{ signedPdf: Buffer | null; signedHtml: string | null }> {
  const signers = sessions.filter((s) => s.signedAt).map((s) => ({ email: s.recipientEmail, signedAt: s.signedAt! }))
    .sort((a, b) => a.signedAt.getTime() - b.signedAt.getTime() || a.email.localeCompare(b.email));
  const signedSessions = sessions.filter((s) => s.signedAt);
  const populated = fields.filter((f) => f.prefilled || signedSessions.some((s) => fieldMatchesSigner(f, s)))
    .sort((a, b) => a.id.localeCompare(b.id));
  const meta = { documentId: doc.id, contentHashShort: doc.contentHash ? shortHash(doc.contentHash) : "(no hash)", auditTimezone: resolveAuditTimezone(doc.auditTimezone) };
  if (doc.kind === "html") {
    const values = Object.fromEntries(populated.filter((f) => f.name && f.value !== null).map((f) => [f.name!, f.value!]));
    const signedHtml = applyHtmlAuditFooter(fillHtml(doc.htmlSource!, values, null), signers, meta);
    let signedPdf: Buffer | null = null;
    try { signedPdf = Buffer.from(await renderHtmlToPdf(signedHtml)); }
    catch (error) { console.error("PDF render failed at sign time", error); }
    return { signedHtml, signedPdf };
  }
  let bytes = doc.pdf instanceof Uint8Array ? doc.pdf : Buffer.from(doc.pdf as ArrayBuffer);
  const placed = populated.filter((f) => f.page !== null && f.x !== null && f.y !== null && f.width !== null && f.height !== null);
  for (const f of placed) {
    bytes = Buffer.from(await stampPdf({ pdfBytes: bytes, fields: [{ type: f.type, page: f.page!, x: f.x!, y: f.y!, width: f.width!, height: f.height!, value: f.value }], signaturePng: f.type === "signature" ? f.value : null }));
  }
  bytes = Buffer.from(await applyCombinedPdfAudit(bytes, signers, meta, stampedFieldBoxes(populated, Object.fromEntries(populated.map((f) => [f.id, f.value]))), { multiSignerDocument: sessions.length > 1 }));
  return { signedPdf: Buffer.from(bytes), signedHtml: null };
}
