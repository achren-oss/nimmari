import { z } from "zod";
import { db } from "@/db";
import { document } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getApiIdentity, authenticationFailure } from "@/lib/api-auth";
import { reissueSlots } from "@/lib/reissue";
export async function POST(req: Request, { params }: { params: Promise<{ id: string; slot: string }> }) {
  const identity = await getApiIdentity(req);
  if (!identity) return authenticationFailure(req);
  const { id, slot } = await params;
  const [doc] = await db.select().from(document).where(eq(document.id, id));
  if (!doc || doc.ownerId !== identity.userId) return Response.json({ error: "Not found" }, { status: 404 });
  const raw = await req.text();
  const body = z.object({ notify: z.boolean().optional() }).safeParse(raw ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : {});
  if (!body.success) return Response.json({ error: "Invalid input" }, { status: 400 });
  const result = await reissueSlots(id, identity.userId, [slot], body.data.notify);
  return "error" in result ? Response.json({ error: result.error }, { status: result.status }) : Response.json(result.signers![0]);
}
