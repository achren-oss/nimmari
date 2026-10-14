import { pdfResponse } from "@/lib/pdf-response";
import { stoppedDocumentResponse } from "@/lib/document-stop";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { document, field, signingSession } from "@/db/schema";
import { buildViewerPdf, shouldViewStampedPdf, signedPdfForTokenViewer } from "@/lib/signer-view-pdf";
import { getApiIdentity, authenticationFailure } from "@/lib/api-auth";
import { checkSigningTokenAccess } from "@/lib/token-access";
import { renderHtmlToPdf } from "@/lib/render-pdf";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: docId } = await params;
  const url = new URL(req.url);
  const signingToken = url.searchParams.get("t");
  const signed = url.searchParams.get("signed") === "1";

  const [doc] = await db.select().from(document).where(eq(document.id, docId));
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // The "original PDF" view only exists for PDF-source docs. The "signed PDF"
  // view is supported for both kinds (HTML-source signed docs are rendered to
  // PDF at sign time, with on-demand fallback below).
  if (doc.kind !== "pdf" && !signed) {
    return NextResponse.json({ error: "Not a PDF document" }, { status: 400 });
  }

  let allowed = false;
  let viewerEmail: string | null = null;
  let viewerKey: string | null = null;
  if (signingToken) {
    const [s] = await db
      .select()
      .from(signingSession)
      .where(eq(signingSession.token, signingToken));
    const access = checkSigningTokenAccess(s, docId);
    if (access === "expired") {
      return NextResponse.json({ error: "Link expired" }, { status: 410 });
    }
    if (access === "ok" && (!signed || !s?.signedAt)) {
      const stopped = stoppedDocumentResponse(doc.status);
      if (stopped) return stopped;
    }
    allowed = access === "ok";
    if (allowed && s) { viewerEmail = s.recipientEmail; viewerKey = s.signerKey; }
  } else {
    const identity = await getApiIdentity(req);
    if (!identity) return authenticationFailure(req);
    allowed = !!identity && identity.userId === doc.ownerId;
  }
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let blob = signed ? doc.signedPdf : doc.pdf;

  // A later signer in a multi-signer PDF must see prefilled values and prior
  // signers' values/signatures. Rebuilt from the original upload so other
  // signers' private values never appear in clear in the PDF.
  if (!signed && viewerEmail && doc.signedPdf && doc.pdf) {
    const sessions = await db
      .select()
      .from(signingSession)
      .where(eq(signingSession.documentId, doc.id));
    const signedSessions = sessions.filter((x) => x.signedAt);
    if (shouldViewStampedPdf({ kind: doc.kind, hasSignedPdf: true, priorSignedCount: signedSessions.length })) {
      const fields = await db.select().from(field).where(eq(field.documentId, doc.id));
      const original = doc.pdf instanceof Uint8Array ? doc.pdf : Buffer.from(doc.pdf as ArrayBuffer);
      const viewerBytes = await buildViewerPdf({ originalPdf: original, fields, signedSessions, viewerEmail, viewerKey });
      const safeTitle = doc.title.replace(/[^\w\-. ]+/g, "_");
      return pdfResponse(viewerBytes, `${safeTitle}.pdf`);
    }
  }

  // HTML signed docs: render on demand if not cached (older docs or render
  // failures at sign time).
  if (signed && !blob && doc.kind === "html" && doc.signedHtml) {
    try {
      const bytes = await renderHtmlToPdf(doc.signedHtml);
      blob = Buffer.from(bytes);
      await db
        .update(document)
        .set({ signedPdf: blob, updatedAt: new Date() })
        .where(and(eq(document.id, doc.id), eq(document.version, doc.version)));
    } catch (e) {
      console.error("PDF on-demand render failed", e);
      return NextResponse.json({ error: "PDF not available" }, { status: 500 });
    }
  }

  if (!blob) return NextResponse.json({ error: "PDF not available" }, { status: 404 });

  let bytes: Uint8Array = blob instanceof Uint8Array ? blob : Buffer.from(blob as ArrayBuffer);
  if (signed && viewerEmail) {
    const sessions = await db
      .select()
      .from(signingSession)
      .where(eq(signingSession.documentId, doc.id));
    const fields = await db.select().from(field).where(eq(field.documentId, doc.id));
    bytes = await signedPdfForTokenViewer({
      kind: doc.kind,
      status: doc.status,
      originalPdf: doc.pdf ? (doc.pdf instanceof Uint8Array ? doc.pdf : Buffer.from(doc.pdf as ArrayBuffer)) : null,
      signedPdf: bytes,
      fields,
      signedSessions: sessions.filter((x) => x.signedAt),
      viewerKey,
      viewerEmail,
    });
  }
  const safeTitle = doc.title.replace(/[^\w\-. ]+/g, "_");
  return pdfResponse(bytes, `${safeTitle}.pdf`);
}
