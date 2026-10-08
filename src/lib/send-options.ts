import { z } from "zod";

/**
 * Request body for POST /api/documents/[id]/send.
 *
 * `notify` defaults to true (email the signing link). With `notify: false`
 * no email is sent and the caller is expected to deliver the returned `url`
 * itself, e.g. a bot returning the link in a chat.
 */
export const SendBody = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  // Overrides the email's displayed sender name. Falls back to the
  // document owner's account name when omitted.
  senderName: z.string().trim().min(1).max(80).optional(),
  notify: z.boolean().default(true),
});

export type SendBodyInput = z.infer<typeof SendBody>;

export const LINK_ONLY_NOTE = "Email not sent (notify: false); deliver the URL yourself.";
