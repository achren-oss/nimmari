import { NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { document, field, signingSession, user } from "@/db/schema";
import { stampPdf } from "@/lib/stamp-pdf";
import { fillHtml, appendAuditFooter } from "@/lib/html-form";
import { shortHash } from "@/lib/hash";
import { renderHtmlToPdf } from "@/lib/render-pdf";
import { isValidSignaturePng } from "@/lib/validators";
import { signRateLimit } from "@/lib/rate-limit";
import { Resend } from "resend";

export const runtime = "nodejs";
export const maxDuration = 60;

function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return null;
}

const Body = z.object({
  values: z.record(z.string(), z.string()),
  signaturePng: z.string().nullable(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const limited = signRateLimit(req);
  if (limited) return limited;
  const { token } = await params;
  const [s] = await db.select().from(signingSession).where(eq(signingSession.token, token));
  if (!s) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  if (s.signedAt) return NextResponse.json({ error: "Already signed" }, { status: 409 });
  if (s.expiresAt < new Date()) {
    return NextResponse.json({ error: "Link expired" }, { status: 410 });
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

  const [doc] = await db.select().from(document).where(eq(document.id, s.documentId));
  if (!doc) return NextResponse.json({ error: "Document missing" }, { status: 404 });

  const fields = await db.select().from(field).where(eq(field.documentId, s.documentId));
  for (const f of fields) {
    if (f.type !== "text" && f.type !== "textarea") continue;
    const key = doc.kind === "html" ? f.name : f.id;
    if (key && (parsed.data.values[key]?.length ?? 0) > 5000) {
      return NextResponse.json({ error: "Text values must not exceed 5000 characters" }, { status: 400 });
    }
  }
  const now = new Date();
  const ip = clientIp(req);
  const ua = req.headers.get("user-agent");
  const contentHashShort = doc.contentHash ? shortHash(doc.contentHash) : "(no hash)";
  const auditMeta = {
    documentId: doc.id,
    contentHashShort,
    signedAt: now,
    recipientEmail: s.recipientEmail,
  };

  let signedHtml: string | null = null;
  let signedPdf: Buffer | null = null;
  if (doc.kind === "html") {
    if (!doc.htmlSource) {
      return NextResponse.json({ error: "Document body missing" }, { status: 500 });
    }

    // Build the merged values map: pre-filled values from the owner take
    // precedence over anything the recipient submits (defence against tampering).
    const merged: Record<string, string> = { ...parsed.data.values };
    for (const f of fields) {
      if (f.prefilled && f.name && f.value !== null) {
        merged[f.name] = f.value;
      }
    }

    for (const f of fields) {
      if (f.type === "signature") {
        if (f.required && !parsed.data.signaturePng) {
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
      if ((f.type === "text" || f.type === "textarea") && (!v || !v.trim())) {
        return NextResponse.json(
          { error: `Missing value for: ${f.label}` },
          { status: 400 },
        );
      }
    }

    const filled = fillHtml(doc.htmlSource, merged, parsed.data.signaturePng);
    const sealed = appendAuditFooter(filled, auditMeta);

    let signedPdfBytes: Uint8Array | null = null;
    try {
      signedPdfBytes = await renderHtmlToPdf(sealed);
    } catch (e) {
      // Don't block the sign — PDF can be re-rendered on demand from signedHtml.
      console.error("PDF render failed at sign time", e);
    }

    signedHtml = sealed;
    signedPdf = signedPdfBytes ? Buffer.from(signedPdfBytes) : null;
  } else {
    for (const f of fields) {
      if (!f.required) continue;
      const v = parsed.data.values[f.id];
      if ((f.type === "text" || f.type === "textarea") && (!v || !v.trim())) {
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
    const pdfBytes = doc.pdf instanceof Uint8Array ? doc.pdf : Buffer.from(doc.pdf as ArrayBuffer);
    const stamped = await stampPdf({
      pdfBytes,
      fields: fields
        .filter((f) => f.page !== null && f.x !== null && f.y !== null && f.width !== null && f.height !== null)
        .map((f) => ({
          type: f.type,
          page: f.page!,
          x: f.x!,
          y: f.y!,
          width: f.width!,
          height: f.height!,
          value: f.type === "signature" ? null : (parsed.data.values[f.id] ?? null),
        })),
      signaturePng: parsed.data.signaturePng,
      audit: auditMeta,
    });

    signedPdf = Buffer.from(stamped);
  }

  // Persist field values as a single batched UPDATE using CASE WHEN id THEN value.
  // Avoids N round-trips to Turso (one per field).
  // Skip pre-filled fields — their values were set by the owner before sending
  // and shouldn't be overwritten by anything the recipient submitted.
  const valuesById: Record<string, string | null> = {};
  for (const f of fields) {
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
  const signed = await db.transaction(async (tx) => {
    const claimed = await tx.update(signingSession)
      .set({ signedAt: now, signedIp: ip, signedUserAgent: ua })
      .where(and(eq(signingSession.id, s.id), eq(signingSession.token, token), isNull(signingSession.signedAt)))
      .returning({ id: signingSession.id });
    if (claimed.length === 0) return false;

    await tx.update(document)
      .set({ signedHtml, signedPdf, status: "completed", updatedAt: now })
      .where(eq(document.id, doc.id));
    if (ids.length > 0) {
      const cases = ids.map(
        (id) => sql`when ${field.id} = ${id} then ${valuesById[id]}`,
      );
      await tx.update(field)
        .set({ value: sql.join([sql`case`, ...cases, sql`end`], sql` `) })
        .where(sql`${field.id} in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
    }
    return true;
  });
  if (!signed) return NextResponse.json({ error: "Already signed" }, { status: 409 });

  await sendSignedNotices({
    documentId: doc.id,
    documentTitle: doc.title,
    ownerId: doc.ownerId,
    recipientEmail: s.recipientEmail,
    recipientName: s.recipientName,
    signingToken: s.token,
  });

  return NextResponse.json({ ok: true });
}

async function sendSignedNotices(args: {
  documentId: string;
  documentTitle: string;
  ownerId: string;
  recipientEmail: string;
  recipientName: string | null;
  signingToken: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) return;
  const [owner] = await db.select().from(user).where(eq(user.id, args.ownerId));
  if (!owner) return;

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const recipientPdfUrl = `${appUrl}/api/sign/${args.signingToken}/pdf`;
  const ownerPdfUrl = `${appUrl}/api/documents/${args.documentId}/pdf?signed=1`;
  const resend = new Resend(apiKey);
  const who = args.recipientName
    ? `${args.recipientName} (${args.recipientEmail})`
    : args.recipientEmail;
  const title = escapeHtml(args.documentTitle);

  const button = (href: string, label: string) =>
    `<p style="margin:24px 0;"><a href="${href}" style="background:#1d2839;color:#fbf6e6;padding:11px 18px;border-radius:6px;text-decoration:none;display:inline-block;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">${label}</a></p>`;

  await Promise.allSettled([
    resend.emails.send({
      from,
      to: args.recipientEmail,
      subject: `Your signed copy of "${args.documentTitle}"`,
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1d2839;">
  <p>Hi${args.recipientName ? ` ${escapeHtml(args.recipientName)}` : ""},</p>
  <p>Thank you for signing <strong>${title}</strong>. Your signed copy is ready.</p>
  ${button(recipientPdfUrl, "View signed PDF →")}
  <p style="color:#5a4a31;font-size:13px;">Or paste this link: <a href="${recipientPdfUrl}" style="color:#5a4a31;">${recipientPdfUrl}</a></p>
</div>`,
    }),
    resend.emails.send({
      from,
      to: owner.email,
      subject: `${who} signed "${args.documentTitle}"`,
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1d2839;">
  <p>${who} just signed <strong>${title}</strong>.</p>
  ${button(ownerPdfUrl, "View signed PDF →")}
  <p style="color:#5a4a31;font-size:13px;">Or open the document in Puumerkki: <a href="${appUrl}/documents/${args.documentId}" style="color:#5a4a31;">${appUrl}/documents/${args.documentId}</a></p>
</div>`,
    }),
  ]);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
