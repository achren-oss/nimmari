import { pdfResponse } from "@/lib/pdf-response";
import { stoppedDocumentResponse } from "@/lib/document-stop";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { document, field, signingSession } from "@/db/schema";
import { signedPdfForTokenViewer } from "@/lib/signer-view-pdf";
import { renderHtmlToPdf } from "@/lib/render-pdf";

import { signRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const limited = signRateLimit(req, token);
  if (limited) return limited;
  const [s] = await db.select().from(signingSession).where(eq(signingSession.token, token));
  if (!s) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

  if (s.expiresAt < new Date()) {
    return NextResponse.json({ error: "Link expired" }, { status: 410 });
  }

  const [doc] = await db.select().from(document).where(eq(document.id, s.documentId));
  if (!doc) return NextResponse.json({ error: "Document missing" }, { status: 404 });

  if (!s.signedAt) {
    const stopped = stoppedDocumentResponse(doc.status);
    if (stopped) return stopped;
  }

  let pdfBlob = doc.signedPdf;

  // Fallback: if PDF wasn't cached at sign time (HTML render failed, or doc
  // was signed before this feature shipped), render now from signedHtml.
  if (!pdfBlob && doc.kind === "html" && doc.signedHtml) {
    try {
      const bytes = await renderHtmlToPdf(doc.signedHtml);
      pdfBlob = Buffer.from(bytes);
      await db
        .update(document)
        .set({ signedPdf: pdfBlob, updatedAt: new Date() })
        .where(and(eq(document.id, doc.id), eq(document.version, doc.version)));
    } catch (e) {
      console.error("PDF on-demand render failed", e);
      return NextResponse.json({ error: "PDF not available" }, { status: 500 });
    }
  }

  if (!pdfBlob) {
    return NextResponse.json({ error: "PDF not available yet" }, { status: 404 });
  }

  let bytes: Uint8Array = pdfBlob instanceof Uint8Array ? pdfBlob : Buffer.from(pdfBlob as ArrayBuffer);

  const fields = await db.select().from(field).where(eq(field.documentId, doc.id));
  const sessions = await db
    .select()
    .from(signingSession)
    .where(eq(signingSession.documentId, doc.id));
  bytes = await signedPdfForTokenViewer({
    kind: doc.kind,
    status: doc.status,
    originalPdf: doc.pdf ? (doc.pdf instanceof Uint8Array ? doc.pdf : Buffer.from(doc.pdf as ArrayBuffer)) : null,
    signedPdf: bytes,
    fields,
    signedSessions: sessions.filter((x) => x.signedAt),
    viewerKey: s.signerKey,
    viewerEmail: s.recipientEmail,
  });

  const safeTitle = doc.title.replace(/[^\w\-. ]+/g, "_");
  return pdfResponse(bytes, `${safeTitle}.pdf`);
}
