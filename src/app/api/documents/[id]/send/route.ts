import { sha256Hex } from "@/lib/hash";
import { appUrl } from "@/lib/app-url";
import { writeTransaction } from "@/lib/write-transaction";
import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { document, field, signingSession, user, sendIdempotency } from "@/db/schema";
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

  const json = await req.json().catch(() => null);
  const key = req.headers.get("Idempotency-Key");
  if (key !== null && (key.length < 1 || key.length > 255)) return NextResponse.json({ error: "Invalid Idempotency-Key" }, { status: 400 });
  // Canonical object ordering makes equivalent JSON bodies identical.
  const canonical = (v: unknown): string => JSON.stringify(v, (_, value) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
  const requestHash = sha256Hex(Buffer.from(canonical(json)));
  const idemId = key === null ? null : sha256Hex(Buffer.from(JSON.stringify([identity.userId, docId, key])));
  const replay = async () => {
    if (!idemId) return null;
    const [row] = await db.select().from(sendIdempotency).where(eq(sendIdempotency.id, idemId));
    if (!row || row.expiresAt <= new Date()) return null;
    return row.requestHash === requestHash ? NextResponse.json(JSON.parse(row.response), { status: row.statusCode }) : NextResponse.json({ error: "Idempotency-Key reused with a different body" }, { status: 422 });
  };
  const previous = await replay();
  if (previous) return previous;

  if (doc.status === "completed" || doc.status === "cancelled" || doc.status === "declined") {
    return NextResponse.json({ error: "Document cannot be sent" }, { status: 409 });
  }

  const fields = await db.select().from(field).where(eq(field.documentId, docId));
  if (fields.length === 0) {
    return NextResponse.json({ error: "Add at least one field first." }, { status: 400 });
  }

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

  const created = await writeTransaction(async (tx) => {
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
    if (idemId) {
      const [row] = await tx.select().from(sendIdempotency).where(eq(sendIdempotency.id, idemId));
      if (row && row.expiresAt > now) return row.requestHash === requestHash ? { response: JSON.parse(row.response) } : { error: "Idempotency-Key reused with a different body", status: 422 };
      if (row) await tx.delete(sendIdempotency).where(eq(sendIdempotency.id, idemId));
    }
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
    for (const [index, signer] of signers.entries()) {
      const sessionId = sessions[index].id;
      const t = sessions[index].token;

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
        key: sessions[index].signerKey,
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
      const response = {
        key: results[0].key,
        url: results[0].url,
        signingSessionId: results[0].signingSessionId,
        expiresAt: expiresAt.toISOString(),
        emailSent: results[0].emailSent,
        emailNote: results[0].emailNote,
      };
      if (idemId) await tx.insert(sendIdempotency).values({ id: idemId, ownerId: identity.userId, documentId: docId, requestHash, response: JSON.stringify(response), createdAt: now, expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000) });
      return { response };
    }

    // Multi-signer response
    const response = { signers: results, expiresAt: expiresAt.toISOString() };
    if (idemId) await tx.insert(sendIdempotency).values({ id: idemId, ownerId: identity.userId, documentId: docId, requestHash, response: JSON.stringify(response), createdAt: now, expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000) });
    return { response };
  });
  if (created.error) return NextResponse.json({ error: created.error }, { status: created.status });
  return NextResponse.json(created.response);
}
