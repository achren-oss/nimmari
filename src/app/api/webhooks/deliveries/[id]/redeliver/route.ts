import { db } from "@/db";
import { webhookDelivery } from "@/db/schema";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { getAgentIdentity } from "@/lib/api-auth";
import { processDeliveries } from "@/lib/webhook-outbox";
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAgentIdentity(req);
  if (auth.error) return auth.error;
  const { id } = await params;
  const now = new Date();
  const [row] = await db.select().from(webhookDelivery).where(and(eq(webhookDelivery.id, id), eq(webhookDelivery.ownerId, auth.identity.userId)));
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  const [updated] = await db.update(webhookDelivery).set({ status: "pending", attemptCount: 0, nextAttemptAt: now, updatedAt: now, leaseToken: null, leaseUntil: null }).where(and(eq(webhookDelivery.id, id), or(isNull(webhookDelivery.leaseUntil), lte(webhookDelivery.leaseUntil, now)))).returning();
  if (!updated) return Response.json({ error: "Delivery in progress" }, { status: 409 });
  return Response.json(await processDeliveries(auth.identity.userId, id));
}
