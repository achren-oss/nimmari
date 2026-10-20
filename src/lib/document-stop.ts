import { deliveryValues, processDeliveries } from "./webhook-outbox";
import { writeTransaction } from "@/lib/write-transaction";
import { NextResponse } from "next/server";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { document, signingSession, user, webhookDelivery } from "@/db/schema";
import { sendDeclinedEmail } from "./email";

export function stoppedDocumentResponse(status: string) {
  if (status !== "cancelled" && status !== "declined") return null;
  return NextResponse.json({ error: `Document ${status}`, status }, { status: 410 });
}

// Default decline policy: any decline ends the whole document.
export async function stopDocument(docId: string, mode: "cancelled" | "declined", reason: string | null, sessionId?: string) {
  const now = new Date();
  const result = await writeTransaction(async (tx) => {
    const [doc] = await tx.update(document).set({
      status: mode, updatedAt: now, version: sql`${document.version} + 1`,
      ...(mode === "cancelled" ? { cancelledAt: now, cancelReason: reason } : { declinedAt: now, declineReason: reason }),
    }).where(and(eq(document.id, docId), inArray(document.status, mode === "cancelled" ? ["draft", "sent"] : ["sent"]),
      ...(sessionId ? [sql`exists (select 1 from signing_session where id = ${sessionId} and document_id = ${docId} and signed_at is null and declined_at is null and expires_at > ${Math.floor(now.getTime() / 1000)})`] : [])))
      .returning();
    if (!doc) return null;
    if (sessionId) await tx.update(signingSession).set({ declinedAt: now, declineReason: reason })
      .where(and(eq(signingSession.id, sessionId), isNull(signingSession.signedAt)));
    const delivery = doc.webhookUrl ? deliveryValues(doc, `document.${mode}`, {
      event: `document.${mode}`, [mode === "cancelled" ? "cancelledAt" : "declinedAt"]: now.toISOString(),
      reason, document: { id: doc.id, title: doc.title, kind: doc.kind, status: mode },
      ...(sessionId ? { signingSessionId: sessionId } : {}),
    }) : null;
    if (delivery) await tx.insert(webhookDelivery).values(delivery);
    return { ...doc, deliveryId: delivery?.id };
  });
  if (!result) return null;
  if (result.webhookUrl) await processDeliveries(result.ownerId, result.deliveryId).catch(() => undefined);
  if (mode === "declined" && result.notify) {
    const [owner] = await db.select().from(user).where(eq(user.id, result.ownerId));
    if (owner) await sendDeclinedEmail({ to: owner.email, documentTitle: result.title, reason });
  }
  return result;
}
