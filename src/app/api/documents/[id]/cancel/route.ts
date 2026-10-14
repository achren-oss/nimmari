import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { document } from "@/db/schema";
import { getApiIdentity } from "@/lib/api-auth";
import { stopDocument } from "@/lib/document-stop";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const identity = await getApiIdentity(req);
  if (!identity) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const [doc] = await db.select().from(document).where(eq(document.id, id));
  if (!doc || doc.ownerId !== identity.userId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const text = await req.text();
  let json: unknown;
  try { json = text.trim() ? JSON.parse(text) : {}; } catch { return NextResponse.json({ error: "Invalid input" }, { status: 400 }); }
  const parsed = z.object({ reason: z.string().max(1000).optional() }).safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const stopped = await stopDocument(id, "cancelled", parsed.data.reason ?? null);
  return stopped ? NextResponse.json({ ok: true, status: "cancelled" }) : NextResponse.json({ error: "Document cannot be cancelled" }, { status: 409 });
}
