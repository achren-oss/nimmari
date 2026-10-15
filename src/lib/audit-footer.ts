export type SealedSigner = {
  email: string;
  signedAt: Date;
};

import { formatAuditTimestamp as formatAuditTimestampInZone } from "./audit-timezone";

export type AuditDocumentMeta = {
  documentId: string;
  contentHashShort: string;
  /** IANA timezone for seal timestamps; falls back to deployment default. */
  auditTimezone?: string | null;
};

export function formatAuditTimestamp(d: Date, timeZone?: string | null): string {
  return formatAuditTimestampInZone(d, timeZone ?? "");
}

/** Remove any existing Nimmari audit section from signed HTML. */
export function stripHtmlAuditFooter(html: string): string {
  return html.replace(
    /<style>[\s\S]*?\.pm-audit[\s\S]*?<\/style>\s*<section class="pm-audit"[\s\S]*?<\/section>/i,
    "",
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/** One combined audit block listing every signer (no per-signer append overlap). */
export function buildHtmlAuditFooter(
  signers: SealedSigner[],
  meta: AuditDocumentMeta,
): string {
  const signerLines = signers
    .map(
      (s) =>
        `<div class="pm-audit-signer"><span class="seal-mark">&#10003;</span> ${escapeHtml(s.email)} &middot; ${formatAuditTimestamp(s.signedAt, meta.auditTimezone)}</div>`,
    )
    .join("\n");

  return `
<style>
  .pm-audit{margin-top:32px;padding-top:14px;border-top:1px solid #97876a;font-family:'Helvetica Neue',Arial,sans-serif;font-size:10px;line-height:1.65;color:#5a4a31;}
  .pm-audit .seal-mark{font-style:italic;color:#4a6b3f;font-weight:600;}
  .pm-audit-signer{margin:2px 0;}
  .pm-audit-meta{margin-top:8px;font-size:9px;color:#5a4a31;}
  .pm-audit code{font-family:'SF Mono','Menlo',monospace;font-size:9px;color:#1d2839;}
  input:disabled, textarea:disabled, select:disabled{
    -webkit-text-fill-color: currentColor !important;
    opacity: 1 !important;
    color: inherit !important;
  }
</style>
<section class="pm-audit" data-pm-audit>
<div class="pm-audit-title" style="font-weight:600;margin-bottom:6px;">Sealed</div>
${signerLines}
<div class="pm-audit-meta">Document <code>${escapeHtml(meta.documentId)}</code> &middot; SHA-256 <code>${escapeHtml(meta.contentHashShort)}</code></div>
</section>`;
}

export function applyHtmlAuditFooter(
  html: string,
  signers: SealedSigner[],
  meta: AuditDocumentMeta,
): string {
  const base = stripHtmlAuditFooter(html);
  const footer = buildHtmlAuditFooter(signers, meta);
  if (base.includes("</body>")) return base.replace("</body>", footer + "\n</body>");
  return base + footer;
}
