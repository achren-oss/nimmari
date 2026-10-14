// These query flags describe email send outcomes for display only. They must
// never authorize access or serve as evidence of signing or email delivery.
export function signDoneUrl(token: string, notices: {
  copyEmailSent?: boolean;
  senderEmailSent?: boolean;
}) {
  const query = new URLSearchParams();
  if (notices.copyEmailSent === true) query.set("copyEmailSent", "1");
  if (notices.senderEmailSent === true) query.set("senderEmailSent", "1");
  return `/sign/${token}/done${query.size ? `?${query}` : ""}`;
}

export function signDoneMessage(query: Record<string, string | string[] | undefined>) {
  return [
    "Your signature has been recorded.",
    query.senderEmailSent === "1" ? "The sender has been notified." : "",
    query.copyEmailSent === "1" ? "A copy is on its way to your inbox." : "",
  ].filter(Boolean).join(" ");
}
