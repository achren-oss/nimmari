import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { document, field, signingSession } from "@/db/schema";
import { getApiIdentity } from "@/lib/api-auth";
import { fillHtml } from "@/lib/html-form";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: docId } = await params;
  const url = new URL(req.url);
  const signingToken = url.searchParams.get("t");
  const signed = url.searchParams.get("signed") === "1";
  const print = url.searchParams.get("print") === "1";

  const [doc] = await db.select().from(document).where(eq(document.id, docId));
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (doc.kind !== "html") {
    return NextResponse.json({ error: "Not an HTML document" }, { status: 400 });
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

  let html: string | null;
  if (signed && doc.signedHtml) {
    html = doc.signedHtml;
  } else {
    html = doc.htmlSource;
    // Owner preview should reflect the current pre-filled values, not the
    // raw template. Bake them in (read-only style) so what they see matches
    // what the recipient will see when opening the signing link.
    if (html) {
      const fields = await db.select().from(field).where(eq(field.documentId, docId));
      const prefilled: Record<string, string> = {};
      for (const f of fields) {
        if (f.prefilled && f.name && f.value !== null) prefilled[f.name] = f.value;
      }
      if (Object.keys(prefilled).length > 0) {
        html = fillHtml(html, prefilled, null, { disableMode: "filled-only" });
      }
    }
  }
  if (!html) return NextResponse.json({ error: "No body" }, { status: 404 });

  if (print) {
    // Inject auto-print + auto-close + tightened print layout.
    // - @page narrows the printer's default margins so more form content fits.
    // - body padding is zeroed in print mode (form's own 32px padding compounds
    //   with @page margin, often pushing the audit footer to a blank 2nd page).
    // - .pm-audit is glued to the preceding content with page-break-before: avoid
    //   so the browser keeps it on the same page when there's any room.
    // Trusted source (we author this string), so injecting <script> is safe.
    const printSnippet = `
<style>
@page { size: A4; margin: 10mm 14mm; }
@media print {
  /* Force browsers to print background colors and images. Without this,
     custom checkboxes (appearance:none + :checked dark fill) and SVG fills
     render as white boxes in the printed PDF. */
  html, body, * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }
  html, body { background: white !important; }
  body { padding-top: 0 !important; padding-bottom: 0 !important; }
  .pm-audit {
    margin-top: 6px !important;
    padding-top: 4px !important;
    page-break-before: avoid !important;
    page-break-inside: avoid !important;
    break-before: avoid !important;
    break-inside: avoid !important;
  }
}
</style>
<script>
window.addEventListener('load', function () {
  setTimeout(function () { window.print(); }, 200);
  window.addEventListener('afterprint', function () {
    setTimeout(function () { window.close(); }, 100);
  });
});
</script>`;
    html = html.includes("</body>") ? html.replace("</body>", printSnippet + "</body>") : html + printSnippet;
  }

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}
