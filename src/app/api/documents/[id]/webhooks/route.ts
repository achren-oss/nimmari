import { db } from "@/db";
import { document } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getApiIdentity, authenticationFailure } from "@/lib/api-auth";
import { deliveryHistory } from "@/lib/webhook-outbox";
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const identity = await getApiIdentity(req);
  if (!identity) return authenticationFailure(req);
  const { id } = await params;
  const [doc] = await db.select().from(document).where(eq(document.id, id));
  if (!doc || doc.ownerId !== identity.userId) return Response.json({ error: "Not found" }, { status: 404 });
  return deliveryHistory(req, identity.userId, id);
}
