import { NextResponse } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import crypto from "node:crypto";
import { db } from "@/db";
import { signingSession } from "@/db/schema";

export const runtime = "nodejs";

// Resend webhooks are signed with Svix-style headers:
//   svix-id          — unique message id
//   svix-timestamp   — unix seconds
//   svix-signature   — space-separated list of "v1,<base64-hmac>" pairs
// HMAC = base64-decoded(secret minus "whsec_" prefix) over `${id}.${ts}.${body}`.
function verify(rawBody: string, headers: Headers, secret: string): boolean {
  const id = headers.get("svix-id");
  const ts = headers.get("svix-timestamp");
  const sigHeader = headers.get("svix-signature");
  if (!id || !ts || !sigHeader) return false;
  // Reject replays older than 5 minutes.
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > 5 * 60) return false;
  const trimmed = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const key = Buffer.from(trimmed, "base64");
  const expected = crypto
    .createHmac("sha256", key)
    .update(`${id}.${ts}.${rawBody}`)
    .digest("base64");
  // sigHeader contains one or more "v1,sig" pairs separated by spaces.
  return sigHeader.split(" ").some((pair) => {
    const [, sig] = pair.split(",");
    if (!sig || sig.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  });
}

type ResendEvent = {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    tags?: Record<string, string>;
    click?: { link?: string; timestamp?: string };
  };
};

export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }
  const rawBody = await req.text();
  if (!verify(rawBody, req.headers, secret)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  // We only act on first-click events for invitation emails. Resend re-fires
  // a click event for every link in the email, so we only set the timestamp
  // once (the WHERE clause checks isNull(linkClickedAt)).
  if (event.type === "email.clicked") {
    const sessionId = event.data?.tags?.signing_session_id;
    if (sessionId) {
      const ts = event.data?.click?.timestamp
        ? new Date(event.data.click.timestamp)
        : new Date();
      await db
        .update(signingSession)
        .set({ linkClickedAt: ts })
        .where(and(eq(signingSession.id, sessionId), isNull(signingSession.linkClickedAt)));
    }
  }

  // Always 200 to acknowledge — Resend retries on non-2xx.
  return NextResponse.json({ ok: true });
}
