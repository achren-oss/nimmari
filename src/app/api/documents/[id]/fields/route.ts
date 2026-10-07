import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { document, field } from "@/db/schema";
import { getServerSession } from "@/lib/session";
import { id } from "@/lib/ids";

const FieldSchema = z.object({
  type: z.enum(["text", "textarea", "checkbox", "signature"]),
  page: z.number().int().min(0),
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().min(10),
  height: z.number().int().min(10),
  label: z.string().optional(),
  required: z.boolean().default(true),
});

const Body = z.object({ fields: z.array(FieldSchema) });

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: docId } = await params;
  const [doc] = await db.select().from(document).where(eq(document.id, docId));
  if (!doc || doc.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (doc.status !== "draft") {
    return NextResponse.json({ error: "Document cannot be edited" }, { status: 409 });
  }

  const json = await req.json();
  const parsed = Body.safeParse(json);
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
        label: f.label ?? null,
        required: f.required,
      })),
    );
  }

  return NextResponse.json({ ok: true });
}
