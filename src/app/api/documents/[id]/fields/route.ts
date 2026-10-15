import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { document, field, signingSession } from "@/db/schema";
import { getApiIdentity, authenticationFailure } from "@/lib/api-auth";
import { FieldsBody } from "@/lib/field-schema";
import { fieldEditingError } from "@/lib/field-editing";
import { writeTransaction } from "@/lib/write-transaction";
import { id } from "@/lib/ids";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const identity = await getApiIdentity(req);
  if (!identity) return authenticationFailure(req);
  const { id: docId } = await params;
  const parsed = FieldsBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  return writeTransaction(async (tx) => {
    // Take the same write lock used by signing before checking eligibility.
    const [doc] = await tx.update(document).set({ version: sql`${document.version}` })
      .where(eq(document.id, docId)).returning();
    if (!doc || doc.ownerId !== identity.userId) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const sessions = await tx.select().from(signingSession).where(eq(signingSession.documentId, docId));
    const error = fieldEditingError(doc.status, sessions.some((s) => s.signedAt !== null));
    if (error) return NextResponse.json({ error }, { status: 409 });
    const existing = await tx.select().from(field).where(eq(field.documentId, docId));
    const ids = parsed.data.fields.flatMap((f) => f.id ? [f.id] : []);
    if (new Set(ids).size !== ids.length || ids.some((id) => !existing.some((f) => f.id === id))) {
      return NextResponse.json({ error: "Unknown or duplicate field id" }, { status: 400 });
    }
    for (const old of existing) {
      if (!ids.includes(old.id)) await tx.delete(field).where(eq(field.id, old.id));
    }
    for (const input of parsed.data.fields) {
      const { id: fieldId, ...values } = input;
      if (fieldId) {
        // Omitted properties stay untouched, including required and privacy.
        await tx.update(field).set(values).where(eq(field.id, fieldId));
      } else {
        const newId = id("fld");
        await tx.insert(field).values({ ...values, id: newId, documentId: docId,
          name: values.name ?? `${values.type}_${newId}`,
          required: values.required ?? values.type === "signature",
          privateForOtherSigners: values.privateForOtherSigners ?? false });
      }
    }
    await tx.update(document).set({ version: sql`${document.version} + 1`, updatedAt: new Date() }).where(eq(document.id, docId));
    const fields = await tx.select().from(field).where(eq(field.documentId, docId));
    return NextResponse.json({ ok: true, fields });
  });
}
