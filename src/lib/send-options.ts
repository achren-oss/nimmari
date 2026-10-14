import { z } from "zod";

/**
 * Request body for POST /api/documents/[id]/send.
 *
 * `notify` defaults to true (email the signing link). With `notify: false`
 * no email is sent and the caller is expected to deliver the returned `url`
 * itself, e.g. a bot returning the link in a chat.
 *
 * For multiple signers, use `signers` array. If both `email` and `signers`
 * are provided, `signers` takes precedence. `signerOrder` determines if
 * signers must sign sequentially (0, 1, 2, ...) or can sign in any order (all null).
 */

const SignerInput = z.object({
  key: z.string().trim().min(1).max(200).optional(),
  email: z.string().email(),
  name: z.string().optional(),
  // If specified, this signer must sign at this position (0-based).
  // Null = no enforced order (all signers can sign in parallel).
  order: z.number().int().min(0).nullable().optional(),
});

export const SendBody = z.object({
  // Single-signer mode (backwards compatible)
  email: z.string().email().optional(),
  name: z.string().optional(),
  // Overrides the email's displayed sender name. Falls back to the
  // document owner's account name when omitted.
  senderName: z.string().trim().min(1).max(80).optional(),
  notify: z.boolean().default(true),
  // Multi-signer mode (new)
  signers: z.array(SignerInput).optional(),
}).refine(
  (data) => data.email || (data.signers && data.signers.length > 0),
  { message: "Either 'email' or 'signers' array must be provided" }
);

export type SendBodyInput = z.infer<typeof SendBody>;

export const LINK_ONLY_NOTE = "Email not sent (notify: false); deliver the URL yourself.";
