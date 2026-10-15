import { appUrl } from "@/lib/app-url";
import { writeTransaction } from "@/lib/write-transaction";
import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { document, field, signingSession, user } from "@/db/schema";
import { getApiIdentity, authenticationFailure } from "@/lib/api-auth";
import { id, token } from "@/lib/ids";
import { sendSigningEmail } from "@/lib/email";
import { SendBody } from "@/lib/send-options";
import { resolveEffectiveNotify } from "@/lib/notify";
import {
  resolveSignerEmailNote,
  shouldInviteOnSend,
} from "@/lib/sequential-invites";

export async function POST(
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

  if (doc.status === "completed" || doc.status === "cancelled" || doc.status === "declined") {
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

  // Determine signers list: either single signer or multiple signers
  const signers = parsed.data.signers?.length
    ? parsed.data.signers
    : [{ email: parsed.data.email!, name: parsed.data.name, order: null, key: undefined }];

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const [owner] = await db.select().from(user).where(eq(user.id, identity.userId));
  const effectiveNotify = resolveEffectiveNotify(doc.notify, parsed.data.notify);

  const results: Array<{
    key: string;
    email: string;
    name: string | null;
    url: string;
    signingSessionId: string;
    order: number | null;
    emailSent: boolean;
    emailNote?: string;
  }> = [];

  const created = await writeTransaction(async (tx) => {
    const locked = await tx.update(document).set({ version: sql`${document.version} + 1`, updatedAt: now })
      .where(and(eq(document.id, docId), sql`${document.status} in ('draft', 'sent')`)).returning();
    if (!locked.length) return { error: "Document cannot be sent", status: 409 };
    const existing = await tx.select().from(signingSession).where(eq(signingSession.documentId, docId));
    if (existing.some((s) => s.signedAt)) return { error: "Signing has already started; signers cannot be added.", status: 409 };
    if (existing.length + signers.length > 1 && fields.some((f) => f.type === "signature" && !f.assignedToSignerEmail && !f.assignedSignerKey)) {
      return { error: "Assign each signature field to a signer key or email for multi-signer documents.", status: 400 };
    }
    const emails = [...existing.map((s) => s.recipientEmail), ...signers.map((s) => s.email)].map((email) => email.toLowerCase());
    const duplicates = new Set(emails.filter((email, index) => emails.indexOf(email) !== index));
    if (fields.some((f) => !f.assignedSignerKey && f.assignedToSignerEmail && duplicates.has(f.assignedToSignerEmail.toLowerCase()))) {
      return { error: "Duplicate signer emails require keys/roles: assign fields with assignedSignerKey and give each signer a unique key.", status: 400 };
    }
    const keys = signers.map((signer, index) => signer.key ?? `signer-${existing.length + index}`);
    const allKeys = [...existing.map((s) => s.signerKey).filter(Boolean), ...keys];
    if (new Set(allKeys).size !== allKeys.length) return { error: "Signer keys must be unique within the document.", status: 400 };
    const sessions = signers.map((signer, index) => ({
      signerKey: keys[index],
      id: id("ss"), documentId: docId, recipientEmail: signer.email, recipientName: signer.name ?? null,
      token: token(), expiresAt, createdAt: now, signerOrder: signer.order ?? null, inviteEmailEnabled: effectiveNotify,
    }));
    await tx.insert(signingSession).values(sessions);
    await tx.update(document).set({ status: "sent" }).where(eq(document.id, docId));
    return { sessions };
  });
  if (created.error) return NextResponse.json({ error: created.error }, { status: created.status });
  for (const [index, signer] of signers.entries()) {
    const sessionId = created.sessions![index].id;
    const t = created.sessions![index].token;

    const url = `${appUrl()}/sign/${t}`;
    const invitedNow = shouldInviteOnSend(
      { email: signer.email, name: signer.name, order: signer.order ?? null },
      signers.map((s) => ({ email: s.email, name: s.name, order: s.order ?? null })),
    );

    let emailSent = false;
    let emailNoteFromProvider: string | undefined;
    if (effectiveNotify && invitedNow) {
      const emailResult = await sendSigningEmail({
        to: signer.email,
        recipientName: signer.name,
        senderName: parsed.data.senderName ?? owner?.name ?? "Nimmari",
        documentTitle: doc.title,
        url,
        signingSessionId: sessionId,
      });
      emailSent = emailResult.sent;
      emailNoteFromProvider = emailResult.note;
    }

    results.push({
      key: created.sessions![index].signerKey,
      email: signer.email,
      name: signer.name ?? null,
      url,
      signingSessionId: sessionId,
      order: signer.order ?? null,
      emailSent,
      emailNote: resolveSignerEmailNote({
        effectiveNotify,
        invitedNow,
        emailSent,
        emailNoteFromProvider,
      }),
    });
  }

  // Backwards compatible response for single signer
  if (signers.length === 1) {
    return NextResponse.json({
      key: results[0].key,
      url: results[0].url,
      signingSessionId: results[0].signingSessionId,
      expiresAt: expiresAt.toISOString(),
      emailSent: results[0].emailSent,
      emailNote: results[0].emailNote,
    });
  }

  // Multi-signer response
  return NextResponse.json({
    signers: results,
    expiresAt: expiresAt.toISOString(),
  });
}
