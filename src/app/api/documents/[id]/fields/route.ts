import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { document, field } from "@/db/schema";
import { getApiIdentity, authenticationFailure } from "@/lib/api-auth";
import { FieldsBody } from "@/lib/field-schema";
import { id } from "@/lib/ids";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const identity = await getApiIdentity(req);
  if (!identity) return authenticationFailure(req);

  const { id: docId } = await params;
  const [doc] = await db.select().from(document).where(eq(document.id, docId));
  if (!doc || doc.ownerId !== identity.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (doc.status !== "draft") {
    return NextResponse.json({ error: "Document cannot be edited" }, { status: 409 });
  }

  const json = await req.json();
  const parsed = FieldsBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  await db.delete(field).where(eq(field.documentId, docId));
  if (parsed.data.fields.length > 0) {
    await db.insert(field).values(
      parsed.data.fields.map((f) => ({
        id: id("fld"),
        documentId: docId,
        type: f.type,
        page: f.page,
        x: f.x,
        y: f.y,
        width: f.width,
        height: f.height,
        name: f.name ?? null,
        label: f.label ?? null,
        required: f.required,
        privateForOtherSigners: f.privateForOtherSigners,
        assignedSignerKey: f.assignedSignerKey ?? null,
        assignedToSignerEmail: f.assignedToSignerEmail ?? null,
      })),
    );
  }

  return NextResponse.json({ ok: true });
}
