/**
 * Decide whether a signing-session token grants access to a document's
 * HTML/PDF download routes. Expired links are rejected (410), matching the
 * /api/sign/[token] routes.
 */
export type TokenAccess = "ok" | "forbidden" | "expired";

export function checkSigningTokenAccess(
  session: { documentId: string; expiresAt: Date } | undefined | null,
  docId: string,
  now: Date = new Date(),
): TokenAccess {
  if (!session || session.documentId !== docId) return "forbidden";
  if (session.expiresAt < now) return "expired";
  return "ok";
}
