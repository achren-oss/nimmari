import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { document, signingSession, user } from "@/db/schema";
import { writeTransaction } from "./write-transaction";
import { token } from "./ids";
import { appUrl } from "./app-url";
import { sendSigningEmail } from "./email";

export async function reissueSlots(docId: string, ownerId: string, selectors: string[] | null, notify?: boolean) {
  const result = await writeTransaction(async (tx) => {
    const [doc] = await tx.update(document).set({ version: sql`${document.version} + 1`, updatedAt: new Date() }).where(and(eq(document.id, docId), eq(document.ownerId, ownerId))).returning();
    if (!doc) return { error: "Not found", status: 404 };
    if (doc.status !== "sent") return { error: "Document cannot be reissued", status: 409 };
    const slots = await tx.select().from(signingSession).where(eq(signingSession.documentId, docId));
    const active = (s: typeof slots[number]) => !s.signedAt && !s.declinedAt && (s.signerOrder === null || !slots.some((p) => p.signerOrder !== null && p.signerOrder < s.signerOrder! && !p.signedAt));
    if (selectors?.some((key) => slots.filter((s) => s.signerKey === key || s.id === key).length > 1)) return { error: "Ambiguous signer selector", status: 400 };
    const selected = selectors ? selectors.map((key) => slots.find((s) => s.signerKey === key || s.id === key)) : slots.filter(active);
    if (selected.some((s) => !s)) return { error: "Signer not found", status: 404 };
    if (new Set(selected.map((s) => s!.id)).size !== selected.length) return { error: "Duplicate signer selection", status: 400 };
    if (selected.some((s) => !active(s!))) return { error: "Signer signed, declined or waiting for their turn", status: 409 };
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const updated = [];
    for (const s of selected) {
      const t = token();
      await tx.update(signingSession).set({ token: t, expiresAt, linkClickedAt: null }).where(eq(signingSession.id, s!.id));
      updated.push({ ...s!, token: t, expiresAt });
    }
    return { doc, slots: updated };
  });
  if (result.error) return result;
  const [owner] = await db.select().from(user).where(eq(user.id, ownerId));
  const signers = [];
  for (const s of result.slots!) {
    const url = `${appUrl()}/sign/${s.token}`;
    const enabled = result.doc!.notify && (notify ?? s.inviteEmailEnabled);
    const email = enabled ? await sendSigningEmail({ to: s.recipientEmail, recipientName: s.recipientName ?? undefined, senderName: owner?.name ?? "Nimmari", documentTitle: result.doc!.title, url, signingSessionId: s.id }) : { sent: false, note: "Email notifications disabled" };
    signers.push({ key: s.signerKey, url, signingSessionId: s.id, expiresAt: s.expiresAt.toISOString(), emailSent: email.sent, emailNote: email.note });
  }
  return { signers };
}
