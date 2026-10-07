import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { document, signingSession } from "@/db/schema";
import { getApiIdentity } from "@/lib/api-auth";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const identity = await getApiIdentity(req);
  if (!identity) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: docId } = await params;
  const [doc] = await db.select().from(document).where(eq(document.id, docId));
  if (!doc || doc.ownerId !== identity.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const sessions = await db
    .select({
      recipientEmail: signingSession.recipientEmail,
      recipientName: signingSession.recipientName,
      signedAt: signingSession.signedAt,
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
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    signingSessions: sessions,
  });
}
