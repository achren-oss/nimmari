# Nimmari HTTP API cheatsheet

Use `NIMMARI_BASE_URL` as the client instance URL and
`Authorization: Bearer $NIMMARI_API_KEY` for owner routes.
Use a provisioned regular database key on the client. The server root
`NIMMARI_API_KEY` needs `NIMMARI_API_OWNER_ID` only for document requests.
`NIMMARI_BASE_URL` is not a server environment variable; server signing links
use `APP_URL` (fallback `http://localhost:3000`). Never log the key.

## Routes and bodies

All JSON routes use `Content-Type: application/json`. Signer routes authenticate
by the token in the path, without an owner bearer token.

| Method/path | Authentication | Request / result |
| --- | --- | --- |
| `POST /api/documents` | Owner | Multipart `pdf`, optional `title`, `importAcroForm`, `notify`, `webhookUrl`, `auditTimezone`; returns `id`, `importedFields` |
| `POST /api/documents/html` | Owner | Multipart `html` (file or string), optional `title`, `notify`, `webhookUrl`, `auditTimezone`; returns `id`, `fieldCount` |
| `GET /api/documents/{id}` | Owner | Metadata, status, stop reasons/times, `fields`, `signingSessions` |
| `PUT /api/documents/{id}/fields` | Owner | `{"fields":[...]}`; draft only; replaces all fields; returns `{"ok":true}` |
| `PUT /api/documents/{id}/prefill` | Owner | `{"values":{"field-key":"value"},"mode":"merge"}`; draft only; returns `ok`, `filled` |
| `POST /api/documents/{id}/send` | Owner | `{"signers":[...],"notify":false}`; returns signer links and `expiresAt` |
| `POST /api/documents/{id}/cancel` | Owner | Optional `{"reason":"Withdrawn"}` or empty body; returns `{"ok":true,"status":"cancelled"}` |
| `GET /api/sign/{token}` | Token | Document/signing identity, `signedAt`, visible fields, prefilled values, `readOnly` |
| `POST /api/sign/{token}` | Token | `{"values":{...},"signaturePng":"data:image/png;base64,..."}`; returns `{"ok":true}` |
| `POST /api/sign/{token}/decline` | Token | `{"reason":"I disagree"}` or `{}`; returns `{"ok":true,"status":"declined"}` |
| `GET /api/documents/{id}/pdf` | Owner or `?t={token}` | Original PDF; token viewers may get prior stamped fields with private values masked |
| `GET /api/documents/{id}/pdf?signed=1` | Owner or additional `&t={token}` | Signed artifact; wait for `completed` for the final copy |
| `GET /api/sign/{token}/pdf` | Token | Signed-copy PDF, 404 if not yet available; privacy masking until completed |

For native HTML, `GET /api/documents/{id}/html` exists with owner or `?t={token}`
authentication and optional `signed=1`. The original PDF route rejects HTML-source
documents without `signed=1`; signed PDF download supports both kinds.

PDF upload requires `application/pdf` and accepts at most 4 × 1024 × 1024 bytes.
HTML files accept at most 2 × 1024 × 1024 bytes; raw strings are checked by JS
string length against that number. Multipart flags are strings (`"false"`, `"true"`).
PDF AcroForm import returns a field count (or false), plus errors/warnings;
an import failure can still leave a successfully created draft. Inspect the response.
Radio groups and dropdowns become text, checkboxes become checkbox fields.
Import does not flatten widgets. Read widget rectangles first, then flatten desired
appearances or remove controls that would obscure overlays before uploading.

## Skill helpers: draft -> verify -> send

- `scripts/acroform_to_fields.py form.pdf --output-dir /tmp/new-form` writes
  `flattened.pdf` without widgets/AcroForm and `fields.json` in 800px coordinates.
  Requires `pypdf`; repeat `--skip-prefix PREFIX` or `--private NAME=signerKey`.
  Native widget values/appearances are removed, not baked in. Assign imported signature boxes to signers and add missing boxes
  manually; review layout and required flags before upload.
- `scripts/nimmari_flow.py PDF --title TITLE --fields fields.json --prefill prefill.json
  --signers signers.json --no-send` prepares a draft and prints `documentId` and
  `prefilledCheck`. Verify the fetched fields, assignments and layout before send.
- `scripts/nimmari_flow.py --send-only DOC_ID --signers signers.json` sends an
  existing draft. URLs are omitted unless `--print-urls`; capture that output privately.
  Send output includes `fieldNames` (server ID -> local name), signer identities and expiry.
- `scripts/test_sign.py test-flow.json --values values.json --signature synthetic.png`
  consumes URL-bearing test flow output. Values are signer key -> field name -> string.
  Signs in order, skips read-only and other roles' fields, and prints only statuses.
  Refuses unless every email ends with `@example.com`, or `--i-know-this-is-a-test`.
  This performs real signing on disposable test documents; no automatic retries.

## PDF fields and coordinates

Example fields file for `nimmari_flow.py`:

```json
{
  "fields": [
    {"name":"party_name","type":"text","page":0,"x":70,"y":100,"width":300,"height":26,"required":true,"assignedSignerKey":"party"},
    {"name":"national_id","type":"hetu","page":0,"x":70,"y":140,"width":220,"height":26,"required":true,"privateForOtherSigners":true,"assignedSignerKey":"party"},
    {"name":"party_signature","type":"signature","page":0,"x":70,"y":250,"width":260,"height":65,"required":true,"assignedSignerKey":"party"},
    {"name":"reviewer_signature","type":"signature","page":0,"x":420,"y":250,"width":260,"height":65,"required":true,"assignedSignerKey":"reviewer"}
  ]
}
```

Adapt coordinates to the real printed form; these are illustrative, not a template.

Signature fields should be about 40–45 PDF points tall, with their bottom on the signature line. Convert points to the 800px overlay coordinate space using `800 / pageWidthPt`. Stamping enforces a 40 pt minimum rendered height, growing upward without clipping and preserving the cropped image aspect ratio; field width and page bounds can limit this height. Native AcroForm signature boxes are extended upward to at least 40 pt while keeping their bottom.

Types: `text`, `textarea`, `checkbox`, `date`, `hetu`, `signature`.
`page` is an integer ≥ 0; `x`, `y`, `width`, `height` are integers;
width/height ≥ 10. `name` and `assignedSignerKey` are trimmed, nonempty,
maximum 200 characters. `label` is optional. `required` defaults true,
`privateForOtherSigners` defaults false. Assignments may be null/omitted.
The fields endpoint does not check that a box fits a page; verify this yourself.
Replacing fields generates new IDs and loses existing field values.

Each page has width 800 in overlay units and a top-left origin.
For unrotated PDF-point rect `(x1,y1,x2,y2)`, set `k=800/pageWidthPt`;
`x=x1*k`, `y=(pageHeightPt-y2)*k`, `width=(x2-x1)*k`, `height=(y2-y1)*k`.
Stamping reverses this with scale `pageWidthPt/800` and
`pdfY=pageHeightPt-y*scale-height*scale`.
Normalize or account for rotated/cropped pages and visually verify the mapping.

Text layout operates in **PDF points after scaling**, not overlay pixels:

- Padding: `min(4, max(0.5, min(w,h)*0.1))` points on each side.
- Inner dimensions: `max(0.5, dimension-2*padding)`.
- Single-line initial font: `min(11, max(4, innerHeight/1.2))` points.
- Text containing newlines: `min(14, max(4, innerHeight*0.55))` points.
- Wrap/shrink in 1-point steps down to 4pt; line height is `fontSize*1.2`.
- Capacity is `floor(innerHeight/(fontSize*1.2))`; at minimum size text can truncate.
- The current fallback prevents nonempty text disappearing when no visible lines
  fit; fallback width fitting uses 0.5-point steps. Tiny boxes can still overflow.

Use 22–30 overlay-pixel single-line heights and sufficient widths, then inspect.
Use textarea for multiline PDF content. A tall note box does not align text to
preprinted rules automatically; put each line between rules or use separate boxes.
Signature images preserve aspect ratio and center within the box.
A submitted image fills every signature field assigned to that session.

## Native HTML forms

Example (upload as multipart `html`):

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>Agreement</title></head><body>
<label>Name <input data-pm-field="party_name" data-pm-label="Name"
  data-pm-required data-pm-signer-key="party"></label>
<label>ID <input data-pm-field="national_id" data-pm-type="hetu"
  data-pm-required data-pm-private data-pm-signer-key="party"></label>
<label><input type="checkbox" data-pm-field="consent"
  data-pm-required data-pm-signer-key="party"> I agree</label>
<div data-pm-field="party_signature" data-pm-type="signature"
  data-pm-required data-pm-signer-key="party"></div>
</body></html>
```

`data-pm-field` defines the unique name; duplicate names are skipped.
`data-pm-label` defaults to the name. Presence of `data-pm-required` or
`data-pm-private` means true, even if the attribute string says `"false"`.
Use `data-pm-signer-key` (alias `data-pm-role`) for slots, or
`data-pm-signer` for email assignment; slot key wins.
Explicit `data-pm-type` recognizes signature/date/hetu; checkboxes require
`<input type="checkbox">`. Input/textarea otherwise extract as text;
`<textarea>` does not become the PDF API's textarea type.
A div/span extracts as signature. A fieldset with radio inputs extracts as a
radio choice stored as text; a fieldset without radios is not a field.
Use supported tags and inspect GET results; do not assume arbitrary types work.
Sanitization removes scripts/unsafe content, restricts image/CSS resources,
and PDF rendering blocks external network requests. Use self-contained assets.

## Prefill and validation

PDF prefill and signer submission use field IDs returned by owner GET;
HTML uses field names. Values must be strings. Signature fields cannot be prefilled.
Merge is default; replace/clear wipes omitted values. Unknown keys are ignored,
so fetch again to ensure the intended fields were filled.

The flow helper deliberately accepts local names in its prefill file and resolves
those names to the fresh PDF IDs before calling the API:

```json
{"party_name":"Example Party"}
```

Text/textarea/date/hetu values have a 5000-character limit.
Signer dates validate and normalize `YYYY-MM-DD`, `DD.MM.YYYY`, or `DD/MM/YYYY`;
PDF output formats dates as `d.m.yyyy`. Prefill does not run that date validator;
provide a valid ISO date yourself. `hetu` has **no format/checksum validation**,
only required nonempty checks. Do not repeat API.md's conflicting older statement.
Required checkboxes must be submitted as `"true"`.

**False-checkbox prefill caveat:** prefill marks only `"true"`, `"on"`, or `"1"`
as filled. `"false"` clears the value and prefilled flag; it does not lock an
unchecked checkbox read-only. Use `required:false` for an optional checkbox,
and inspect actual payloads. Do not promise a false prefill is locked.

For disposable tests only, fetch a signer payload, then submit:

```json
{"values":{"fld_actual_id":"synthetic value"},"signaturePng":"data:image/png;base64,<actual PNG bytes encoded as base64>"}
```

Supply `signaturePng:null` when no signature is needed; the property is required.
Use an actual PNG data URL, ≤ 500 KiB decoded; POST body ≤ 1 MiB.
Complete all required fields belonging to the session unless prefilled.
Use a clearly synthetic drawn signature for tests, never sign for a real human.

## Signer slots, order, delivery

Example signers file:

```json
[
  {"email":"party@example.com","name":"Example Party","key":"party","order":0},
  {"email":"reviewer@example.com","name":"Example Reviewer","key":"reviewer","order":1}
]
```

Omit all orders for parallel signing; transactions serialize final artifact writes.
An ordered signer must wait for every lower-order session. Use consecutive orders
for a simple sequential workflow. Keys must be unique and ≤ 200 characters;
omitted keys default to `signer-<index>` including existing sessions.
Key assignment takes precedence over email. Unassigned non-signature fields are
shared. All multi-signer signature fields need an assignment.
Duplicate emails with any email-only assigned field return 400; assign by keys
and give distinct roles, including when one person signs two signature lines.

Send accepts `signers`, optional `senderName` (1–80 chars), `notify` (default true).
Legacy single-signer `email`/`name` is also accepted; nonempty `signers` wins.
One signer returns `{key,url,signingSessionId,expiresAt,emailSent,emailNote}`
even when supplied as an array. Multiple return `{signers:[{key,email,name,url,
signingSessionId,order,emailSent,emailNote}],expiresAt}`.
Links expire 30 days after the send call; expose that timestamp to recipients.

Upload `notify:false` disables invitations, sequential follow-ups, signed notices,
and decline owner email. Send `notify:false` disables invitation/follow-up emails
for those sessions, but signed notices still depend on document `notify`.
With notifications enabled and a configured email provider, sequential invitation
emails go to the lowest-order signer first, then the next after signing.
Signed-copy/owner notices are attempted on each signature, not exclusively completion.
Check `emailSent`/`emailNote`; provider configuration/delivery can fail.

## Lifecycle and errors

Statuses: `draft` → `sent` → `completed`; cancellation from draft/sent produces
`cancelled`; one decline on a sent document produces `declined` for everyone.
Owner GET includes `cancelledAt`, `cancelReason`, `declinedAt`, `declineReason`,
session `signedAt`, `signerKey`, `declinedAt`, `declineReason`, and field values.
Decline requires an unexpired unsigned session; reasons are optional ≤ 1000 chars.
No alternate decline mode is implemented. Terminal documents cannot be sent/cancelled.
Fields/prefill are draft-only. Additional send calls can add signers before any
signature exists, but return 409 once signing has started. Re-upload to change fields.

| Code | Meaning / action |
| --- | --- |
| 400 | Invalid payload, missing required values, bad date/PNG, ambiguous roles; inspect error |
| 401 | Missing/incorrect owner authentication or server key/owner configuration |
| 403 | PDF access forbidden |
| 404 | Missing document/token/artifact; signed PDF may not exist yet |
| 409 | Wrong order, already signed, locked editing, started signing, or terminal state; inspect state |
| 410 | Expired link or cancelled/declined document; inspect error and status, stop signing |
| 413 | Upload/sign body exceeds limit |
| 429 | Signer route IP rate limit; honor Retry-After |
| 503 | Incomplete PDF withheld: `{"error":"PDF not ready"}`; retry after `Retry-After: 2` |

Cancelled/declined token GET/POST signing routes return 410 with
`{"error":"Document cancelled","status":"cancelled"}` (or declined).
Unsigned sessions also lose PDF access. Already-signed sessions retain read-only
signed-copy PDF access until expiry; incomplete stopped PDFs keep other signers'
private values masked. Expiry remains 410 even after completion.
There is no token-renewal endpoint. Inspect state before replacing expired links;
creating a fresh document is the safe workflow after signing has begun.

## Privacy and final artifacts

Assign private fields to a key/email. Other sessions do not receive those fields
in their editable field payload (the reference test returned 42 of 44 fields). During signing, PDF views rebuild from the
original source and mask other signers' private values (`hetu`: asterisks for all
but the last four characters; other values: `****`), including the text layer.
For an 11-character hetu this is `*******123M`; values of four characters or fewer
are unchanged by the hetu masker, so use realistic-length synthetic IDs in checks.
After completion all final values, including full national IDs, are shown to all
parties in the signed PDF. Tell the requester before collecting sensitive values.

Always poll owner GET until `completed` and validate the signed PDF download:

```sh
python3 scripts/fetch_signed_pdf.py DOC_ID final.pdf --timeout 300
```

The helper uses `NIMMARI_BASE_URL` and `NIMMARI_API_KEY` from the
environment for owner Bearer authentication, without printing the key. It polls
`GET /api/documents/{id}` (`--poll-interval` defaults to 2 seconds), then downloads
`/api/documents/{id}/pdf?signed=1`. PDF responses send `Content-Length`,
`X-Content-SHA256` (hex SHA-256 of the served bytes), and `Repr-Digest: sha-256=:<base64>:`. The helper requires matching
length and SHA-256, `%PDF-`, `startxref`, `%%EOF` in the last 2048 bytes, and successful
`pdfinfo` parsing when available. It retries transport failures and mismatches, with
up to three download attempts and 1-/2-second backoff; 503 honors `Retry-After`.
Only validated bytes replace the output. `--timeout` limits completion
polling, defaulting to 300 seconds; cancelled/declined documents fail immediately.
Validate every downloaded PDF: transport truncation can remove the trailer,
even when the server generated a complete artifact.
The server withholds incomplete PDF bytes with 503 and `Retry-After: 2`.
`signed=1` while status is `sent` continues to return the intermediate signed PDF;
poll for `completed` before treating it as the final artifact.
Equivalent retrieval must also poll and validate before rendering or delivery.

PDF-source multi-signer documents always use a dedicated combined seal page;
a single-signer PDF may use an inline bottom audit band or dedicated page if
stamped boxes approach the footer. The inline band paints white over that region,
so check printed footer content as well as overlay fields.
HTML-source documents use an HTML audit footer rendered into PDF, not the same
PDF-source dedicated-page rule. Inspect the final pagination.
Seals list signer emails and signed times, document ID, and a **shortened** SHA-256
marker (`first 8 hex…last 4 hex`). The PDF hash covers the original upload bytes;
HTML hashes sanitized HTML. Preserve/hash the original yourself if you need the
full 64-hex digest. This audit marker is not a cryptographic PDF digital signature.
Timestamps use per-upload `auditTimezone`, then `NIMMARI_AUDIT_TIMEZONE`, then
`Europe/Helsinki`; invalid IANA zones fall back to Europe/Helsinki.

## Webhooks

Public HTTP(S) only; private/local/metadata destinations are blocked by URL checks.
Delivery is one best-effort POST, timeout 10 seconds, no retry. Status changes do
not roll back on failure. Also poll authenticated owner GET, stopping at terminal status.
When `NIMMARI_WEBHOOK_SECRET` is configured, `X-Puumerkki-Signature` is lowercase
64-character HMAC-SHA256 hex over the exact JSON body, with no `sha256=` prefix.
Use raw bytes and constant-time comparison **before** JSON parsing.
Without a configured secret no signature header is sent. Configure a secret for
authenticated delivery; HMAC provides no built-in timestamp/replay protection.

```json
{
  "event":"document.completed",
  "completedAt":"2026-10-14T12:00:00.000Z",
  "document":{"id":"doc_example","title":"Agreement","kind":"pdf","status":"completed"},
  "signers":[{"email":"party@example.com","name":"Example Party","signedAt":"2026-10-14T12:00:00.000Z"}]
}
```

```json
{
  "event":"document.declined",
  "declinedAt":"2026-10-14T12:00:00.000Z",
  "reason":"I disagree",
  "signingSessionId":"ss_example",
  "document":{"id":"doc_example","title":"Agreement","kind":"pdf","status":"declined"}
}
```

```json
{
  "event":"document.cancelled",
  "cancelledAt":"2026-10-14T12:00:00.000Z",
  "reason":null,
  "document":{"id":"doc_example","title":"Agreement","kind":"pdf","status":"cancelled"}
}
```

Reasons and signer names may be null. Payloads do not include tokens, slot keys,
or download URLs. Reconcile using the document ID and owner API.

## Implementation sources

Treat these files as authoritative over conflicting prose in API.md:

- [API overview](../../../API.md), [owner authentication](../../../src/lib/api-auth.ts).
- [PDF upload](../../../src/app/api/documents/route.ts), [HTML upload](../../../src/app/api/documents/html/route.ts).
- [Fields](../../../src/app/api/documents/[id]/fields/route.ts), [schema](../../../src/lib/field-schema.ts), [prefill](../../../src/app/api/documents/[id]/prefill/route.ts).
- [Send](../../../src/app/api/documents/[id]/send/route.ts), [options](../../../src/lib/send-options.ts), [notify](../../../src/lib/notify.ts).
- [Signer GET/POST](../../../src/app/api/sign/[token]/route.ts), [validators](../../../src/lib/validators.ts), [assignment](../../../src/lib/signer-assignment.ts).
- [Owner GET](../../../src/app/api/documents/[id]/route.ts), [owner PDF](../../../src/app/api/documents/[id]/pdf/route.ts), [signer PDF](../../../src/app/api/sign/[token]/pdf/route.ts).
- [Coordinates](../../../src/lib/pdf-coords.ts), [AcroForm](../../../src/lib/acroform.ts), [text boxes](../../../src/lib/draw-text-in-box.ts), [wrapping](../../../src/lib/wrap-text.ts).
- [HTML extraction/fill](../../../src/lib/html-form.ts), [rendering](../../../src/lib/render-pdf.ts).
- [Artifact rebuild](../../../src/lib/rebuild-signed-artifact.ts), [stamping/seals](../../../src/lib/stamp-pdf.ts), [HTML audit](../../../src/lib/audit-footer.ts), [timezone](../../../src/lib/audit-timezone.ts), [hash](../../../src/lib/hash.ts).
- [Private PDF views](../../../src/lib/signer-view-pdf.ts), [masking](../../../src/lib/hetu.ts), [field payloads](../../../src/lib/signer-fields.ts).
- [Cancel](../../../src/app/api/documents/[id]/cancel/route.ts), [decline](../../../src/app/api/sign/[token]/decline/route.ts), [stop/events](../../../src/lib/document-stop.ts), [token access](../../../src/lib/token-access.ts).
- [Webhook delivery](../../../src/lib/webhook.ts), [rate limits](../../../src/lib/rate-limit.ts), [sequential invitations](../../../src/lib/sequential-invites.ts).

## Accounts and API keys

Public signup is disabled, including `POST /api/auth/sign-up/email` and implicit
provider signup. Existing accounts still log in with email/password. Signing links
(`/sign/{token}` and `/api/sign/...`) require no account.

Use `Authorization: Bearer <key>`. The server's `NIMMARI_API_KEY` root
key has admin scope. Root document requests
act as `NIMMARI_API_OWNER_ID`; without that owner, only account/key administration
is available. Database keys act on their owner's documents regardless of scope;
admin scope grants account/key administration, not access to other owners' documents.
All account/key endpoints require API keys: session cookies return 403. Missing,
unknown, malformed or revoked keys return 401 and never fall back to a session.

`GET /api/accounts` requires an admin or root key and returns
`{accounts:[{id,email,name,createdAt,disabled}]}` sorted by creation time (oldest
first). `?email=...` filters by exact email after trimming and lowercasing.
Timestamps are ISO strings. `disabled` means `user.disabled_at` is non-null;
disabled accounts cannot log in and their existing server sessions are ignored.

`DELETE /api/accounts/{id}` requires an admin or root key. Unknown IDs return
404. The configured `NIMMARI_API_OWNER_ID`, the caller's own key owner, and
accounts owning any documents return 409 with `{error}`. Documents are never
deleted. Success returns `{ok:true,id}` after one transaction revokes the owner's
keys, deletes sessions and credentials, and deletes the user. Revoked key rows
then cascade with the user. Missing/invalid keys return 401; regular keys and
session authentication return 403 for both operations.

Apply `drizzle/0006_account_disabled.sql` before deploying with
`node --env-file=.env.local scripts/migrate.mjs`. The migration is registered in
the Drizzle journal and runs once. This adds no public account-disable endpoint.

### Bootstrap and provision

1. Configure a strong root key on the server through your deployment's secret store.
2. Call `POST /api/accounts` with the root key and JSON
   `{"email":"owner@example.com","name":"Example Owner","password":"chosen-password"}`.
   Only root/admin keys are allowed; regular keys return 403. Success is 201 with
   `{id,email,name}`. Omit `password` to generate one and receive it once in the
   response's `password` property. Password limits follow Better Auth (8–128 chars).
   Duplicate normalized email returns 409; invalid input returns 400.
3. Call `POST /api/keys` with root/admin authentication and JSON
   `{"name":"Document agent","scope":"regular","ownerUserId":"<account id>"}`.
   Success is 201 with `{id,name,scope,ownerUserId,prefix,createdAt,key}`.
   Store `key` securely: its plaintext is returned only on creation.
4. Give the agent that regular key for document operations. Keep the root key
   for administration. Optionally set `NIMMARI_API_OWNER_ID` to the new account
   ID if the root key should also act on that account's documents.

`scope` defaults to `regular`; `ownerUserId` defaults to the caller's owner.
An ownerless root must supply `ownerUserId` (otherwise 400). Unknown owners return
404. Regular keys can create only regular keys for themselves (otherwise 403).
Admin/root keys can create either scope for any existing owner.

`GET /api/keys` returns `{keys:[{id,name,scope,ownerUserId,prefix,createdAt,
lastUsedAt,revokedAt}]}` with no hashes or plaintext. Admin/root sees all keys and
may filter with `?ownerUserId=...`; regular keys see only their own, ignoring that
filter. Timestamps are ISO strings; unused/revocation timestamps may be null.

`DELETE /api/keys/{id}` and `POST /api/keys/{id}/revoke` both revoke a key and return
`{ok:true}`. Regular callers can revoke only their own keys; missing or inaccessible
keys return 404. Repeated revocation is safe. Revoked keys immediately stop authenticating.
Rotation: create a new key, update the agent's secret, verify it works, then revoke
its predecessor. Keys use `pmk_` plus 32 random bytes encoded as base64url; the DB
stores only SHA-256 hashes and an 8-character display prefix. `lastUsedAt` tracking
is best effort. Apply `drizzle/0005_api_keys.sql` before deploying this code; it is
registered in the Drizzle journal. Run
`node --env-file=.env.local scripts/migrate.mjs` before deployment.

Machine-readable API: [OpenAPI](../../../openapi/current.yaml).
