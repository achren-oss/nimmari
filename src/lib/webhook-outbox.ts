import { and, eq, lte, or, isNull, desc, lt } from "drizzle-orm";
import { db } from "@/db";
import { webhookDelivery } from "@/db/schema";
import { id } from "./ids";
import { nimmariEnv } from "./env";
import { sendWebhook } from "./webhook";
import { pageQuery, encodeCursor } from "./pagination";

export function deliveryValues(doc: { id: string; ownerId: string; webhookUrl: string | null }, eventType: string, payload: object) {
  const now = new Date();
  return { id: id("wh"), documentId: doc.id, ownerId: doc.ownerId, eventType, payload: JSON.stringify(payload), url: doc.webhookUrl!, nextAttemptAt: now, createdAt: now, updatedAt: now };
}
const backoff = [60, 300, 1800, 7200, 43200];
/** DB compare-and-swap lease protects workers across instances. Bounded to three deliveries. */
export async function processDeliveries(ownerId?: string, deliveryId?: string) {
  const now = new Date();
  const due = await db.select({ id: webhookDelivery.id }).from(webhookDelivery).where(and(
    eq(webhookDelivery.status, "pending"), lte(webhookDelivery.nextAttemptAt, now),
    or(isNull(webhookDelivery.leaseUntil), lte(webhookDelivery.leaseUntil, now)),
    ownerId ? eq(webhookDelivery.ownerId, ownerId) : undefined, deliveryId ? eq(webhookDelivery.id, deliveryId) : undefined,
  )).limit(3);
  let processed = 0;
  for (const row of due) {
    const leaseToken = id("lease");
    const [claimed] = await db.update(webhookDelivery).set({ leaseToken, leaseUntil: new Date(Date.now() + 60000), updatedAt: new Date() }).where(and(eq(webhookDelivery.id, row.id), eq(webhookDelivery.status, "pending"), lte(webhookDelivery.nextAttemptAt, now), or(isNull(webhookDelivery.leaseUntil), lte(webhookDelivery.leaseUntil, now)))).returning();
    if (!claimed) continue;
    const attempt = claimed.attemptCount + 1;
    let result;
    try { result = await sendWebhook(claimed.url, JSON.parse(claimed.payload), nimmariEnv("WEBHOOK_SECRET"), { deliveryId: claimed.id, attempt }); }
    catch { result = { success: false, error: "Webhook transport failed" }; }
    const finished = new Date();
    await db.update(webhookDelivery).set({
      attemptCount: attempt, status: result.success ? "delivered" : attempt >= 6 ? "failed" : "pending",
      nextAttemptAt: new Date(finished.getTime() + (backoff[Math.min(attempt - 1, 4)] * (1 + Math.random() * 0.2)) * 1000),
      lastStatusCode: result.statusCode ?? null, lastError: result.success ? null : (result.error ?? "Delivery failed").slice(0, 500),
      updatedAt: finished, leaseToken: null, leaseUntil: null,
    }).where(and(eq(webhookDelivery.id, row.id), eq(webhookDelivery.leaseToken, leaseToken)));
    processed++;
  }
  return { processed };
}

export async function deliveryHistory(req: Request, ownerId: string, documentId?: string) {
  try {
    const { q, limit, cursor } = pageQuery(req.url);
    const status = q.get("status");
    if (status !== null && !["pending", "delivered", "failed"].includes(status)) return Response.json({ error: "Invalid status" }, { status: 400 });
    const rows = await db.select({ id: webhookDelivery.id, documentId: webhookDelivery.documentId, eventType: webhookDelivery.eventType, url: webhookDelivery.url, attemptCount: webhookDelivery.attemptCount, status: webhookDelivery.status, nextAttemptAt: webhookDelivery.nextAttemptAt, lastStatusCode: webhookDelivery.lastStatusCode, lastError: webhookDelivery.lastError, createdAt: webhookDelivery.createdAt, updatedAt: webhookDelivery.updatedAt }).from(webhookDelivery).where(and(
      eq(webhookDelivery.ownerId, ownerId), documentId ? eq(webhookDelivery.documentId, documentId) : undefined,
      status ? eq(webhookDelivery.status, status as "pending" | "delivered" | "failed") : undefined,
      cursor ? or(lt(webhookDelivery.createdAt, new Date(cursor.time)), and(eq(webhookDelivery.createdAt, new Date(cursor.time)), lt(webhookDelivery.id, cursor.id))) : undefined,
    )).orderBy(desc(webhookDelivery.createdAt), desc(webhookDelivery.id)).limit(limit + 1);
    return Response.json({ deliveries: rows.slice(0, limit), nextCursor: rows.length > limit ? encodeCursor(rows[limit - 1]) : null });
  } catch (error) {
    if (error instanceof Error && /^Invalid (cursor|limit)$/.test(error.message)) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
