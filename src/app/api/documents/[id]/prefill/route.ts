import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { document, field } from "@/db/schema";
import { getServerSession } from "@/lib/session";

const Body = z.object({
  values: z.record(z.string(), z.string()),
});

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
    return NextResponse.json({ error: "Only draft documents can be edited." }, { status: 409 });
  }

  const json = await req.json();
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const fields = await db.select().from(field).where(eq(field.documentId, docId));
  for (const f of fields) {
    if (f.type !== "text" && f.type !== "textarea") continue;
    const key = f.name;
    if (key && (parsed.data.values[key]?.length ?? 0) > 5000) {
      return NextResponse.json({ error: "Text values must not exceed 5000 characters" }, { status: 400 });
    }
  }

  // Decide each field's new state. A non-empty string or a checkbox truthy
  // string ("true") counts as "pre-filled". Everything else is cleared.
  const updates: { id: string; value: string | null; prefilled: boolean }[] = [];
  for (const f of fields) {
    if (!f.name) continue;
    if (f.type === "signature") continue; // never pre-fill signatures
    const v = parsed.data.values[f.name];
    const isFilled =
      f.type === "checkbox"
        ? v === "true" || v === "on" || v === "1"
        : v !== undefined && v !== null && String(v).trim() !== "";
    updates.push({
      id: f.id,
      value: isFilled ? (f.type === "checkbox" ? "true" : v) : null,
      prefilled: isFilled,
    });
  }

  if (updates.length > 0) {
    const ids = updates.map((u) => u.id);
    const valueCases = updates.map(
      (u) => sql`when ${field.id} = ${u.id} then ${u.value}`,
    );
    const prefillCases = updates.map(
      (u) => sql`when ${field.id} = ${u.id} then ${u.prefilled ? 1 : 0}`,
    );
    await db
      .update(field)
      .set({
        value: sql.join([sql`case`, ...valueCases, sql`end`], sql` `),
        prefilled: sql.join([sql`case`, ...prefillCases, sql`end`], sql` `),
      })
      .where(sql`${field.id} in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
  }

  await db.update(document).set({ updatedAt: new Date() }).where(eq(document.id, docId));

  const filledCount = updates.filter((u) => u.prefilled).length;
  return NextResponse.json({ ok: true, filled: filledCount });
}
