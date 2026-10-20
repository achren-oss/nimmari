import { and, eq, lt, or, desc, inArray, sql } from "drizzle-orm";
import { pageQuery, encodeCursor } from "@/lib/pagination";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { document, field, signingSession } from "@/db/schema";
import { getApiIdentity, authenticationFailure } from "@/lib/api-auth";
import { id } from "@/lib/ids";
import { sha256Hex } from "@/lib/hash";
import { extractAcroFormFields } from "@/lib/acroform";
import { isSafeWebhookUrl } from "@/lib/webhook";

const MAX_PDF_BYTES = 4 * 1024 * 1024; // 4 MB — under Vercel's 4.5 MB body limit

export async function POST(req: Request) {
  const identity = await getApiIdentity(req);
  if (!identity) return authenticationFailure(req);

  const form = await req.formData();
  const file = form.get("pdf");
  const title = (form.get("title") as string) || "Untitled";
  const importAcroForm = form.get("importAcroForm") === "true";
  const webhookUrl = form.get("webhookUrl") as string | null;
  const notify = form.get("notify") === "false" ? false : true;
  const auditTimezone = (form.get("auditTimezone") as string | null)?.trim() || null;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing PDF" }, { status: 400 });
  }
  if (file.type !== "application/pdf") {
    return NextResponse.json({ error: "Must be a PDF" }, { status: 400 });
  }
  if (webhookUrl && !isSafeWebhookUrl(webhookUrl)) {
    return NextResponse.json({ error: "Webhook URL is not allowed" }, { status: 400 });
  }

  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json(
      { error: `PDF is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 4 MB.` },
      { status: 413 },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const contentHash = sha256Hex(buf);
  const docId = id("doc");
  const now = new Date();
  await db.insert(document).values({
    id: docId,
    ownerId: identity.userId,
    title,
    pdf: buf,
    contentHash,
    status: "draft",
    webhookUrl: webhookUrl || null,
    notify,
    auditTimezone,
    createdAt: now,
    updatedAt: now,
  });

  // If importAcroForm is true, extract fields from the PDF
  if (importAcroForm) {
    try {
      const importResult = await extractAcroFormFields(new Uint8Array(buf));
      if (importResult.fields.length > 0) {
        await db.insert(field).values(
          importResult.fields.map((f) => ({
            id: id("fld"),
            documentId: docId,
            type: f.type,
            page: f.page,
            x: f.x,
            y: f.y,
            width: f.width,
            height: f.height,
            name: f.name,
            label: f.label,
            required: f.required,
            value: null,
            prefilled: false,
            privateForOtherSigners: false,
            assignedToSignerEmail: null,
          })),
        );
      }

      // Log errors and warnings
      if (importResult.errors.length > 0) {
        console.warn("AcroForm import errors:", importResult.errors);
      }
      if (importResult.warnings.length > 0) {
        console.info("AcroForm import warnings:", importResult.warnings);
      }

      return NextResponse.json({
        id: docId,
        importedFields: importResult.fields.length,
        errors: importResult.errors,
        warnings: importResult.warnings,
      });
    } catch (err) {
      console.error("AcroForm import failed:", err);
      return NextResponse.json({
        id: docId,
        importedFields: false,
        error: err instanceof Error ? err.message : "AcroForm import failed",
      });
    }
  }

  return NextResponse.json({ id: docId, importedFields: false });
}

export async function GET(req: Request) {
  const identity = await getApiIdentity(req);
  if (!identity) return authenticationFailure(req);
  try {
    const { q, limit, cursor } = pageQuery(req.url);
    const statuses = q.has("status") ? q.get("status")!.split(",") : [];
    if (statuses.some((s) => !["draft", "sent", "completed", "cancelled", "declined"].includes(s))) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    const rows = await db.select({ id: document.id, title: document.title, status: document.status, kind: document.kind, createdAt: document.createdAt, updatedAt: document.updatedAt }).from(document).where(and(eq(document.ownerId, identity.userId),
      statuses.length ? sql`${document.status} in (${sql.join(statuses.map((s) => sql`${s}`), sql`,`)})` : undefined,
      cursor ? or(lt(document.createdAt, new Date(cursor.time)), and(eq(document.createdAt, new Date(cursor.time)), lt(document.id, cursor.id))) : undefined,
    )).orderBy(desc(document.createdAt), desc(document.id)).limit(limit + 1);
    const page = rows.slice(0, limit);
    const slots = page.length ? await db.select({ documentId: signingSession.documentId, key: signingSession.signerKey, name: signingSession.recipientName, email: signingSession.recipientEmail, signedAt: signingSession.signedAt, declinedAt: signingSession.declinedAt, expiresAt: signingSession.expiresAt }).from(signingSession).where(inArray(signingSession.documentId, page.map((r) => r.id))) : [];
    return NextResponse.json({ documents: page.map((row) => ({ ...row, signers: slots.filter((s) => s.documentId === row.id).map((s) => ({ key: s.key, name: s.name, email: s.email, status: s.signedAt ? "signed" : s.declinedAt ? "declined" : s.expiresAt < new Date() ? "expired" : "pending", signedAt: s.signedAt })) })), nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null });
  } catch (error) {
    if (error instanceof Error && /^Invalid (cursor|limit)$/.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
