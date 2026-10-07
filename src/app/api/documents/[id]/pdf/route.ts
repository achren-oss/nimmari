import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { document, signingSession } from "@/db/schema";
import { getApiIdentity } from "@/lib/api-auth";
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
  if (signingToken) {
    const [s] = await db
      .select()
      .from(signingSession)
      .where(eq(signingSession.token, signingToken));
    allowed = !!s && s.documentId === docId;
  } else {
    const identity = await getApiIdentity(req);
    allowed = !!identity && identity.userId === doc.ownerId;
  }
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let blob = signed ? doc.signedPdf : doc.pdf;

  // HTML signed docs: render on demand if not cached (older docs or render
  // failures at sign time).
  if (signed && !blob && doc.kind === "html" && doc.signedHtml) {
    try {
      const bytes = await renderHtmlToPdf(doc.signedHtml);
      blob = Buffer.from(bytes);
      await db
        .update(document)
        .set({ signedPdf: blob, updatedAt: new Date() })
        .where(eq(document.id, doc.id));
    } catch (e) {
      console.error("PDF on-demand render failed", e);
      return NextResponse.json({ error: "PDF not available" }, { status: 500 });
    }
  }

  if (!blob) return NextResponse.json({ error: "PDF not available" }, { status: 404 });

  const bytes = blob instanceof Uint8Array ? blob : Buffer.from(blob as ArrayBuffer);
  const safeTitle = doc.title.replace(/[^\w\-. ]+/g, "_");
  return new NextResponse(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safeTitle}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
