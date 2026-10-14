import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { document, field, signingSession } from "@/db/schema";
import { getApiIdentity, authenticationFailure } from "@/lib/api-auth";

export async function GET(
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

  const fields = await db
    .select({
      id: field.id,
      name: field.name,
      type: field.type,
      label: field.label,
      required: field.required,
      privateForOtherSigners: field.privateForOtherSigners,
      assignedSignerKey: field.assignedSignerKey,
      assignedToSignerEmail: field.assignedToSignerEmail,
      page: field.page,
      x: field.x,
      y: field.y,
      width: field.width,
      height: field.height,
      prefilled: field.prefilled,
      value: field.value,
    })
    .from(field)
    .where(eq(field.documentId, docId));

  const sessions = await db
    .select({
      signerKey: signingSession.signerKey,
      recipientEmail: signingSession.recipientEmail,
      recipientName: signingSession.recipientName,
      signedAt: signingSession.signedAt,
      declinedAt: signingSession.declinedAt,
      declineReason: signingSession.declineReason,
      linkClickedAt: signingSession.linkClickedAt,
      expiresAt: signingSession.expiresAt,
      createdAt: signingSession.createdAt,
    })
    .from(signingSession)
    .where(eq(signingSession.documentId, docId));

  return NextResponse.json({
    id: doc.id,
    title: doc.title,
    kind: doc.kind,
    status: doc.status,
    cancelledAt: doc.cancelledAt,
    cancelReason: doc.cancelReason,
    declinedAt: doc.declinedAt,
    declineReason: doc.declineReason,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    signingSessions: sessions,
    fields,
  });
}
