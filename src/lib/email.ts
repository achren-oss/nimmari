import { Resend } from "resend";

type SendArgs = {
  to: string;
  recipientName?: string;
  senderName: string;
  documentTitle: string;
  url: string;
  // Tag carried back via Resend webhooks (email.clicked) so we can map the
  // event onto the right signing_session row. Resend tag values must match
  // /^[A-Za-z0-9_-]+$/ — our IDs already do.
  signingSessionId?: string;
};

export async function sendSigningEmail(args: SendArgs) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) {
    return { sent: false, note: "RESEND_API_KEY/RESEND_FROM not set — copy the link manually." };
  }

  const resend = new Resend(apiKey);
  const greeting = args.recipientName ? `Hi ${args.recipientName},` : "Hi,";

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <p>${greeting}</p>
      <p>${escapeHtml(args.senderName)} has sent you <strong>${escapeHtml(
        args.documentTitle,
      )}</strong> to sign.</p>
      <p style="margin: 24px 0;">
        <a href="${args.url}" style="background:#0f172a;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block;">Review &amp; sign</a>
      </p>
      <p style="color:#64748b;font-size:13px;">Or paste this link: <a href="${args.url}">${args.url}</a></p>
    </div>
  `;

  try {
    const { error } = await resend.emails.send({
      from,
      to: args.to,
      subject: `${args.senderName} sent you "${args.documentTitle}" to sign`,
      html,
      tags: args.signingSessionId
        ? [{ name: "signing_session_id", value: args.signingSessionId }]
        : undefined,
    });
    // The Resend SDK reports API failures (bad key, unverified sender) in
    // `error` instead of throwing.
    if (error) return { sent: false, note: error.message || "Email failed" };
    return { sent: true };
  } catch (e) {
    return { sent: false, note: e instanceof Error ? e.message : "Email failed" };
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
