import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { document, field } from "@/db/schema";
import { getApiIdentity, authenticationFailure } from "@/lib/api-auth";

const Body = z.object({
  values: z.record(z.string(), z.string()),
  /** When true, omitted keys are cleared. Default is merge-only (touch only keys in `values`). */
  clear: z.boolean().optional(),
  /** Alias for clear: "replace" clears omitted keys; "merge" is the default. */
  mode: z.enum(["merge", "replace"]).optional(),
});

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
    return NextResponse.json({ error: "Only draft documents can be edited." }, { status: 409 });
  }

  const json = await req.json();
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const fields = await db.select().from(field).where(eq(field.documentId, docId));
  for (const f of fields) {
    if (f.type !== "text" && f.type !== "textarea" && f.type !== "date" && f.type !== "hetu" && f.type !== "checkbox") continue;
    const key = doc.kind === "html" ? f.name : f.id;
    if (key && (parsed.data.values[key]?.length ?? 0) > 5000) {
      return NextResponse.json({ error: "Text values must not exceed 5000 characters" }, { status: 400 });
    }
  }

  const replaceAll =
    parsed.data.clear === true || parsed.data.mode === "replace";

  const updates: { id: string; value: string | null; prefilled: boolean }[] = [];
  for (const f of fields) {
    const key = doc.kind === "html" ? f.name : f.id;
    if (!key) continue;
    if (f.type === "signature") continue;

    const v = parsed.data.values[key];
    if (!replaceAll && v === undefined) continue;

    const isFilled =
      f.type === "checkbox"
        ? v === "true" || v === "on" || v === "1"
        : v !== undefined && v !== null && String(v).trim() !== "";
    updates.push({
      id: f.id,
      value: isFilled ? (f.type === "checkbox" ? "true" : v!) : null,
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
