/**
 * Email delivery for signing invites and post-sign notices.
 *
 * - `document.notify` (set at upload) is the document-level default.
 * - `requestNotify` on POST …/send is a per-send override when present.
 *
 * Precedence: if the document disables notify, no emails are sent. Otherwise
 * the send request's `notify` flag applies (defaults to true).
 */
export function resolveEffectiveNotify(
  documentNotify: boolean,
  requestNotify: boolean,
): boolean {
  if (!documentNotify) return false;
  return requestNotify;
}
