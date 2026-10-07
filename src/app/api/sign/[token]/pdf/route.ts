import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { document, signingSession } from "@/db/schema";
import { renderHtmlToPdf } from "@/lib/render-pdf";

import { signRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const limited = signRateLimit(req);
  if (limited) return limited;
  const { token } = await params;
  const [s] = await db.select().from(signingSession).where(eq(signingSession.token, token));
  if (!s) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

  if (s.expiresAt < new Date()) {
    return NextResponse.json({ error: "Link expired" }, { status: 410 });
  }

  const [doc] = await db.select().from(document).where(eq(document.id, s.documentId));
  if (!doc) return NextResponse.json({ error: "Document missing" }, { status: 404 });

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
        .where(eq(document.id, doc.id));
    } catch (e) {
      console.error("PDF on-demand render failed", e);
      return NextResponse.json({ error: "PDF not available" }, { status: 500 });
    }
  }

  if (!pdfBlob) {
    return NextResponse.json({ error: "PDF not available yet" }, { status: 404 });
  }

  const bytes = pdfBlob instanceof Uint8Array ? pdfBlob : Buffer.from(pdfBlob as ArrayBuffer);
  const safeTitle = doc.title.replace(/[^\w\-. ]+/g, "_");
  return new NextResponse(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safeTitle}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
