import { nimmariEnv } from "@/lib/env";
import { appUrl } from "@/lib/app-url";
import { clientIp, rateLimitIpDebugHeaders } from "@/lib/client-ip";
import { fieldMatchesSigner } from "@/lib/signer-assignment";
import { writeTransaction } from "@/lib/write-transaction";
import { rebuildSignedArtifact } from "@/lib/rebuild-signed-artifact";
import { stoppedDocumentResponse } from "@/lib/document-stop";
import { NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { document, field, signingSession, user, webhookDelivery } from "@/db/schema";
import { fieldsVisibleToSigner } from "@/lib/field-visibility";
import { isValidSignaturePng, validateAndNormalizeDate } from "@/lib/validators";
import { signRateLimit, signRateLimitWithCount } from "@/lib/rate-limit";
import { deliveryValues, processDeliveries } from "@/lib/webhook-outbox";
import { buildSignerFieldPayload } from "@/lib/signer-fields";
import { sendSigningEmail } from "@/lib/email";
import {
  nextUnsignedSequentialSigner,
} from "@/lib/sequential-invites";
import { Resend } from "resend";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  values: z.record(z.string(), z.string()),
  signaturePng: z.string().nullable(),
});

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const { response: limited, count } = await signRateLimitWithCount(req, token);
  const withRateLimitCount = (response: Response) => {
    if (nimmariEnv("RATE_LIMIT_DEBUG") === "1") {
      for (const [name, value] of Object.entries(rateLimitIpDebugHeaders(req))) response.headers.set(name, value);
      if (count !== null) response.headers.set("X-RateLimit-Count", String(count));
    }
    return response;
  };
  if (limited) return withRateLimitCount(limited);
  const [s] = await db.select().from(signingSession).where(eq(signingSession.token, token));
  if (!s) return withRateLimitCount(NextResponse.json({ error: "Invalid link" }, { status: 404 }));
  if (s.expiresAt < new Date()) {
    return withRateLimitCount(NextResponse.json({ error: "Link expired" }, { status: 410 }));
  }

  const [doc] = await db.select().from(document).where(eq(document.id, s.documentId));
  if (!doc) return withRateLimitCount(NextResponse.json({ error: "Document missing" }, { status: 404 }));

  const stopped = stoppedDocumentResponse(doc.status);
  if (stopped) return withRateLimitCount(stopped);

  const fields = await db.select().from(field).where(eq(field.documentId, s.documentId));
  const payload =
    doc.kind === "pdf"
      ? buildSignerFieldPayload(fields, s.recipientEmail, s.signerKey)
      : fieldsVisibleToSigner(fields, s.recipientEmail, s.signerKey).map((f) => ({
          id: f.id, name: f.name, type: f.type, required: f.required,
          assignedSignerKey: f.assignedSignerKey, assignedToSignerEmail: f.assignedToSignerEmail,
          value: f.prefilled ? f.value : null, prefilled: f.prefilled, readOnly: f.prefilled,
        }));

  return withRateLimitCount(NextResponse.json({
    documentId: doc.id,
    kind: doc.kind,
    title: doc.title,
    recipientEmail: s.recipientEmail,
    recipientName: s.recipientName,
    signerKey: s.signerKey,
    signedAt: s.signedAt?.toISOString() ?? null,
    fields: payload,
  }));
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const limited = await signRateLimit(req, token);
  if (limited) return limited;
  const [s] = await db.select().from(signingSession).where(eq(signingSession.token, token));
  if (!s) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  if (s.expiresAt < new Date()) {
    return NextResponse.json({ error: "Link expired" }, { status: 410 });
  }

  const [doc] = await db.select().from(document).where(eq(document.id, s.documentId));
  if (!doc) return NextResponse.json({ error: "Document missing" }, { status: 404 });

  const stopped = stoppedDocumentResponse(doc.status);
  if (stopped) return stopped;

  if (s.signedAt) return NextResponse.json({ error: "Already signed" }, { status: 409 });
  if (doc.status !== "sent") return NextResponse.json({ error: "Document cannot be signed" }, { status: 409 });

  // Check signing order: if this signer has a defined order, all prior signers must have signed.
  if (s.signerOrder !== null) {
    const priorSigners = await db
      .select()
      .from(signingSession)
      .where(
        and(
          eq(signingSession.documentId, s.documentId),
          sql`${signingSession.signerOrder} < ${s.signerOrder}`,
        ),
      );
    const unsignedPrior = priorSigners.filter((ps) => !ps.signedAt);
    if (unsignedPrior.length > 0) {
      return NextResponse.json(
        {
          error: `This document requires sequential signing. Please wait for the previous signer (${unsignedPrior[0].recipientEmail}) to sign first.`,
        },
        { status: 409 },
      );
    }
  }

  const maxBodyBytes = 1024 * 1024;
  if (Number(req.headers.get("content-length")) > maxBodyBytes) {
    return NextResponse.json({ error: "Body too large" }, { status: 413 });
  }
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > maxBodyBytes) {
    return NextResponse.json({ error: "Body too large" }, { status: 413 });
  }
  let json: unknown;
  try { json = JSON.parse(text); } catch {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  if (parsed.data.signaturePng !== null && !isValidSignaturePng(parsed.data.signaturePng)) {
    return NextResponse.json({ error: "Invalid signature PNG" }, { status: 400 });
  }

  const fields = await db.select().from(field).where(eq(field.documentId, s.documentId));
  const visibleFields = fieldsVisibleToSigner(fields, s.recipientEmail, s.signerKey);

  for (const f of visibleFields) {
    if (f.type !== "text" && f.type !== "textarea" && f.type !== "date" && f.type !== "hetu") continue;
    const key = doc.kind === "html" ? f.name : f.id;
    if (key && (parsed.data.values[key]?.length ?? 0) > 5000) {
      return NextResponse.json({ error: "Text values must not exceed 5000 characters" }, { status: 400 });
    }
    // Validate date fields
    if (f.type === "date" && key && parsed.data.values[key]) {
      const normalized = validateAndNormalizeDate(parsed.data.values[key]);
      if (!normalized) {
        return NextResponse.json({ error: `Invalid date format for ${f.label}` }, { status: 400 });
      }
      parsed.data.values[key] = normalized;
    }
    // hetu: no format/checksum validation by design; any non-empty value is accepted.
  }
  const now = new Date();
  const ip = clientIp(req);
  const ua = req.headers.get("user-agent");
  if (doc.kind === "html") {
    if (!doc.htmlSource) {
      return NextResponse.json({ error: "Document body missing" }, { status: 500 });
    }

    const merged: Record<string, string> = {};
    for (const f of fields) {
      if (!f.name) continue;
      if (f.type === "signature") {
        if (fieldMatchesSigner(f, s) && parsed.data.signaturePng) {
          merged[f.name] = parsed.data.signaturePng;
        } else if (f.value) {
          merged[f.name] = f.value;
        }
        continue;
      }
      if (f.prefilled && f.value !== null) {
        merged[f.name] = f.value;
        continue;
      }
      if (fieldMatchesSigner(f, s)) {
        const submitted = parsed.data.values[f.name];
        if (submitted !== undefined) merged[f.name] = submitted;
        else if (f.value) merged[f.name] = f.value;
      } else if (f.value) {
        merged[f.name] = f.value;
      }
    }

    for (const f of visibleFields) {
      if (f.type === "signature") {
        if (!parsed.data.signaturePng) {
          return NextResponse.json({ error: `Signature required` }, { status: 400 });
        }
        continue;
      }
      if (!f.name) {
        return NextResponse.json(
          { error: "Document is corrupt (field has no name). Please re-upload." },
          { status: 500 },
        );
      }
      if (!f.required) continue;
      // Pre-filled fields satisfy the requirement automatically.
      if (f.prefilled) continue;
      const v = merged[f.name];
      if (f.type === "checkbox" && v !== "true") {
        return NextResponse.json(
          { error: `Required checkbox not checked: ${f.label}` },
          { status: 400 },
        );
      }
      if ((f.type === "text" || f.type === "textarea" || f.type === "date" || f.type === "hetu") && (!v || !v.trim())) {
        return NextResponse.json(
          { error: `Missing value for: ${f.label}` },
          { status: 400 },
        );
      }
    }

  } else {
    for (const f of visibleFields) {
      if (f.type === "signature" && !parsed.data.signaturePng) {
        return NextResponse.json({ error: "Signature required" }, { status: 400 });
      }
      if (!f.required) continue;
      if (f.prefilled) continue;
      const v = parsed.data.values[f.id];
      if ((f.type === "text" || f.type === "textarea" || f.type === "date" || f.type === "hetu") && (!v || !v.trim())) {
        return NextResponse.json({ error: `Missing value for ${f.label ?? "text field"}` }, { status: 400 });
      }
      if (f.type === "checkbox" && v !== "true") {
        return NextResponse.json({ error: `Required checkbox not checked` }, { status: 400 });
      }
      if (f.type === "signature" && !parsed.data.signaturePng) {
        return NextResponse.json({ error: "Signature required" }, { status: 400 });
      }
    }

    if (!doc.pdf) {
      return NextResponse.json({ error: "Document body missing" }, { status: 500 });
    }

  }

  // Persist field values as a single batched UPDATE using CASE WHEN id THEN value.
  // Avoids N round-trips to Turso (one per field).
  // Skip pre-filled fields — their values were set by the owner before sending
  // and shouldn't be overwritten by anything the recipient submitted.
  // Only update fields visible to this signer.
  const valuesById: Record<string, string | null> = {};
  for (const f of visibleFields) {
    if (f.prefilled) continue;
    const v =
      f.type === "signature"
        ? parsed.data.signaturePng
        : doc.kind === "html"
          ? (f.name ? parsed.data.values[f.name] ?? null : null)
          : parsed.data.values[f.id] ?? null;
    valuesById[f.id] = v ?? null;
  }
  const ids = Object.keys(valuesById);

  const signed = await writeTransaction(async (tx) => {
    // Acquire the document write lock before reading sessions or artifact inputs.
    // Cancel, decline and send use the same lock, so their transitions serialize.
    const locked = await tx.update(document)
      .set({ version: sql`${document.version} + 1`, updatedAt: now })
      .where(and(eq(document.id, doc.id), eq(document.status, "sent")))
      .returning();
    if (!locked.length) return null;
    // Other signatures may advance the version without changing the fields.
    // Reject only a concurrent field edit; never sign a different layout than validated.
    const currentFields = await tx.select().from(field).where(eq(field.documentId, doc.id));
    const definition = (rows: typeof fields) => JSON.stringify(rows.map((f) => ({ ...f, value: f.prefilled ? f.value : null })).sort((a, b) => a.id.localeCompare(b.id)));
    if (definition(currentFields) !== definition(fields)) return "fields-changed" as const;
    const claimed = await tx.update(signingSession)
      .set({ signedAt: now, signedIp: ip, signedUserAgent: ua })
      .where(and(eq(signingSession.id, s.id), eq(signingSession.token, token), isNull(signingSession.signedAt)))
      .returning({ id: signingSession.id });
    if (claimed.length === 0) return false;

    if (ids.length > 0) {
      const cases = ids.map(
        (id) => sql`when ${field.id} = ${id} then ${valuesById[id]}`,
      );
      await tx.update(field)
        .set({ value: sql.join([sql`case`, ...cases, sql`end`], sql` `) })
        .where(sql`${field.id} in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
    }
    const latestFields = await tx.select().from(field).where(eq(field.documentId, doc.id));
    const sessions = await tx.select().from(signingSession).where(eq(signingSession.documentId, doc.id));
    const allSigned = sessions.every((session) => session.signedAt !== null);
    const artifact = await rebuildSignedArtifact(locked[0], latestFields, sessions);
    await tx.update(document).set({ ...artifact, status: allSigned ? "completed" : "sent" })
      .where(eq(document.id, doc.id));
    const delivery = allSigned && doc.webhookUrl ? deliveryValues(doc, "document.completed", {
      event: "document.completed", completedAt: now.toISOString(),
      document: { id: doc.id, title: doc.title, kind: doc.kind, status: "completed" },
      signers: sessions.map((session) => ({ email: session.recipientEmail, name: session.recipientName, signedAt: session.signedAt?.toISOString() ?? null })),
    }) : null;
    if (delivery) await tx.insert(webhookDelivery).values(delivery);
    return { allSigned, sessions, deliveryId: delivery?.id };
  });
  if (signed === "fields-changed") {
    return NextResponse.json({ error: "Document fields changed. Reload the page before signing." }, { status: 409 });
  }
  if (!signed) {
    const [latest] = await db.select().from(document).where(eq(document.id, doc.id));
    return stoppedDocumentResponse(latest.status) ?? NextResponse.json({ error: "Already signed or document unavailable" }, { status: 409 });
  }
  const { allSigned } = signed;
  const latestSigners = signed.sessions;

  const nextSigner = nextUnsignedSequentialSigner(
    latestSigners.map((sess) => ({
      id: sess.id,
      token: sess.token,
      recipientEmail: sess.recipientEmail,
      recipientName: sess.recipientName,
      signerOrder: sess.signerOrder,
      signedAt: sess.id === s.id ? now : sess.signedAt,
      inviteEmailEnabled: sess.inviteEmailEnabled,
    })),
  );
  if (nextSigner && (nextSigner.inviteEmailEnabled ?? true)) {
    const publicUrl = appUrl();
    await sendSigningEmail({
      to: nextSigner.recipientEmail,
      recipientName: nextSigner.recipientName ?? undefined,
      senderName: "Nimmari",
      documentTitle: doc.title,
      url: `${publicUrl}/sign/${nextSigner.token}`,
      signingSessionId: nextSigner.id,
    });
  }

  // Send notifications only if document.notify is true
  let notices = { copyEmailSent: false, senderEmailSent: false };
  if (doc.notify) {
    notices = await sendSignedNotices({
      documentId: doc.id,
      documentTitle: doc.title,
      ownerId: doc.ownerId,
      recipientEmail: s.recipientEmail,
      recipientName: s.recipientName,
      signingToken: s.token,
      copyEmailEnabled: s.inviteEmailEnabled,
    });
  }

  if (allSigned && doc.webhookUrl) await processDeliveries(doc.ownerId, signed.deliveryId).catch(() => undefined);

  return NextResponse.json({ ok: true, ...notices });
}

async function sendSignedNotices(args: {
  documentId: string;
  documentTitle: string;
  ownerId: string;
  recipientEmail: string;
  recipientName: string | null;
  signingToken: string;
  copyEmailEnabled: boolean;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  const unsent = { copyEmailSent: false, senderEmailSent: false };
  if (!apiKey || !from) return unsent;
  const [owner] = await db.select().from(user).where(eq(user.id, args.ownerId));
  if (!owner) return unsent;

  const publicUrl = appUrl();
  const recipientPdfUrl = `${publicUrl}/api/sign/${args.signingToken}/pdf`;
  const ownerPdfUrl = `${publicUrl}/api/documents/${args.documentId}/pdf?signed=1`;
  const resend = new Resend(apiKey);
  const who = args.recipientName
    ? `${args.recipientName} (${args.recipientEmail})`
    : args.recipientEmail;
  const title = escapeHtml(args.documentTitle);

  const button = (href: string, label: string) =>
    `<p style="margin:24px 0;"><a href="${href}" style="background:#1d2839;color:#fbf6e6;padding:11px 18px;border-radius:6px;text-decoration:none;display:inline-block;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">${label}</a></p>`;

  const [copy, sender] = await Promise.allSettled([
    args.copyEmailEnabled ? resend.emails.send({
      from,
      to: args.recipientEmail,
      subject: `Your signed copy of "${args.documentTitle}"`,
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1d2839;">
  <p>Hi${args.recipientName ? ` ${escapeHtml(args.recipientName)}` : ""},</p>
  <p>Thank you for signing <strong>${title}</strong>. Your signed copy is ready.</p>
  ${button(recipientPdfUrl, "View signed PDF →")}
  <p style="color:#5a4a31;font-size:13px;">Or paste this link: <a href="${recipientPdfUrl}" style="color:#5a4a31;">${recipientPdfUrl}</a></p>
</div>`,
    }) : Promise.resolve(null),
    resend.emails.send({
      from,
      to: owner.email,
      subject: `${who} signed "${args.documentTitle}"`,
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1d2839;">
  <p>${who} just signed <strong>${title}</strong>.</p>
  ${button(ownerPdfUrl, "View signed PDF →")}
  <p style="color:#5a4a31;font-size:13px;">Or open the document in Nimmari: <a href="${publicUrl}/documents/${args.documentId}" style="color:#5a4a31;">${publicUrl}/documents/${args.documentId}</a></p>
</div>`,
    }),
  ]);
  return {
    copyEmailSent: copy.status === "fulfilled" && copy.value !== null && !copy.value.error,
    senderEmailSent: sender.status === "fulfilled" && !sender.value.error,
  };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
