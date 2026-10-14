import { LINK_ONLY_NOTE } from "./send-options";

export const SEQUENTIAL_WAIT_NOTE =
  "Invitation queued; this signer is notified after the previous signer completes.";

export type SignerSlot = {
  email: string;
  name?: string | null;
  order: number | null;
};

export function usesSequentialOrder(signers: SignerSlot[]): boolean {
  return (
    signers.length > 0 &&
    signers.every((s) => s.order !== null && s.order !== undefined)
  );
}

/** Lowest order value among signers (sequential workflows). */
export function firstOrder(signers: SignerSlot[]): number {
  return Math.min(...signers.map((s) => s.order as number));
}

export function shouldInviteOnSend(signer: SignerSlot, signers: SignerSlot[]): boolean {
  if (!usesSequentialOrder(signers)) return true;
  return signer.order === firstOrder(signers);
}

export type InviteEmailNoteInput = {
  invitedNow: boolean;
  effectiveNotify: boolean;
  emailSent: boolean;
  emailNoteFromProvider?: string;
};

export function resolveSignerEmailNote(input: InviteEmailNoteInput): string | undefined {
  if (!input.effectiveNotify) return LINK_ONLY_NOTE;
  if (!input.invitedNow) return SEQUENTIAL_WAIT_NOTE;
  return input.emailNoteFromProvider;
}

export type SigningSessionRow = {
  recipientEmail: string;
  recipientName: string | null;
  signerOrder: number | null;
  signedAt: Date | null;
  token: string;
  id: string;
  inviteEmailEnabled?: boolean;
};

/** Next sequential signer who has not signed yet (lowest order). */
export function nextUnsignedSequentialSigner(
  sessions: SigningSessionRow[],
): SigningSessionRow | null {
  const ordered = sessions.filter(
    (s) => s.signerOrder !== null && s.signerOrder !== undefined && !s.signedAt,
  );
  if (ordered.length === 0) return null;
  if (!usesSequentialOrder(sessions.map((s) => ({
    email: s.recipientEmail,
    order: s.signerOrder,
  })))) {
    return null;
  }
  ordered.sort((a, b) => (a.signerOrder as number) - (b.signerOrder as number));
  return ordered[0] ?? null;
}
