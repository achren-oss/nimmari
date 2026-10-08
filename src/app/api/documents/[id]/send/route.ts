import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { document, field, signingSession, user } from "@/db/schema";
import { getApiIdentity } from "@/lib/api-auth";
import { id, token } from "@/lib/ids";
import { sendSigningEmail } from "@/lib/email";
import { LINK_ONLY_NOTE, SendBody } from "@/lib/send-options";

export async function POST(
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

  if (doc.status === "completed") {
    return NextResponse.json({ error: "Document cannot be sent" }, { status: 409 });
  }

  const fields = await db.select().from(field).where(eq(field.documentId, docId));
  if (fields.length === 0) {
    return NextResponse.json({ error: "Add at least one field first." }, { status: 400 });
  }

  const json = await req.json();
  const parsed = SendBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const sessionId = id("ss");
  const t = token();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  await db.insert(signingSession).values({
    id: sessionId,
    documentId: docId,
    recipientEmail: parsed.data.email,
    recipientName: parsed.data.name ?? null,
    token: t,
    expiresAt,
    createdAt: now,
  });

  if (doc.status === "draft") {
    await db.update(document).set({ status: "sent", updatedAt: now }).where(eq(document.id, docId));
  }

  const url = `${process.env.APP_URL ?? "http://localhost:3000"}/sign/${t}`;

  if (!parsed.data.notify) {
    return NextResponse.json({
      url,
      signingSessionId: sessionId,
      expiresAt: expiresAt.toISOString(),
      emailSent: false,
      emailNote: LINK_ONLY_NOTE,
    });
  }

  const [owner] = await db.select().from(user).where(eq(user.id, identity.userId));

  const emailResult = await sendSigningEmail({
    to: parsed.data.email,
    recipientName: parsed.data.name,
    senderName: parsed.data.senderName ?? owner?.name ?? "Puumerkki",
    documentTitle: doc.title,
    url,
    signingSessionId: sessionId,
  });

  return NextResponse.json({
    url,
    signingSessionId: sessionId,
    expiresAt: expiresAt.toISOString(),
    emailSent: emailResult.sent,
    emailNote: emailResult.note,
  });
}
