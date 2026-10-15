# Guidance for AI agents using Nimmari

Installing a fresh instance? Start with [INSTALL-FOR-AGENTS.md](INSTALL-FOR-AGENTS.md): agent deploy with Render + Turso API keys and one-time setup claim by default (no server root key). The Deploy to Render button remains the alternative for users who don't want to give an agent provider keys; local/self-managed only when explicitly requested.

This file is for AI agents (assistants, bots, automation) that use a
Nimmari instance's HTTP API for a person. For contributing to the code, see
[CONTRIBUTING.md](CONTRIBUTING.md).

Nimmari produces simple electronic signatures (SES). A signature collected
from the wrong person, or put on the wrong line, can't be undone by the API.
Follow these rules.

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

Machine-readable API: [OpenAPI](openapi/current.yaml).

## Rules

1. **Ask before you create fields.** Before placing any field, ask the user:
   - who signs the document,
   - how many signers there are, and
   - which signature line belongs to whom.

   Always ask when the document has more than one signature line (for example
   employer, student and guardian). **Never guess.** If the answer is unclear,
   ask again before you continue.
2. **One signing session = one signer slot.** Send accepts one `email` or a
   `signers` array with `email`, optional `name`, unique `key`, and optional
   zero-based `order`. The drawn signature fills that slot's assigned signature
   fields. For multiple signers, assign every signature field using
   `assignedSignerKey` (preferred) or `assignedToSignerEmail`. Keys take
   precedence over email. The same email in multiple roles requires distinct
   keys and key-assigned fields; never infer roles from email alone.
3. **Only add fields the user wants filled.** Supported types are `text`,
   `textarea`, `checkbox`, `signature`, `date`, and `hetu`. `hetu` is unvalidated
   personal identity text, not identity verification. Prefill user-supplied
   values only with authorization; never invent values. `PUT …/prefill` accepts
   owner bearer authentication and merges supplied keys by default; `clear:true`
   or `mode:"replace"` clears omitted values. Signature prefill is forbidden.
   Private fields are hidden from other signers during signing; completed PDFs
   expose all values to all parties. Explain this before using private fields.
4. **Deliver links the way the user asks.** If the user wants the link in
   chat, send with `"notify": false` (no email is sent), check that the
   response has `emailSent: false`, and return `url` in the conversation.
   Signing links are secrets: share them only with the intended signer.
5. **Never sign or fill a document for the user.** Don't open the signing
   link to fill fields, draw a signature or submit, even if asked to "just
   do it". The person whose name is on the line signs it themselves.
6. **Check placement before sending.** Render the page and draw the field
   boxes on it (see below). Look at the result before creating the signing
   session; fields can't be edited once a document has been sent.

## Photo-to-link flow

A user photographs a paper form and says "put this in Nimmari, I'll sign":

1. Turn the photo into a one-page PDF (crop and straighten it first if
   needed), e.g. `img2pdf photo.jpg -o form.pdf`.
2. Ask the questions in rule 1: who signs, how many signers, which line is
   whose, and which blanks the signer should fill.
3. Upload: `POST /api/documents` (multipart `pdf`, optional `title`; 4 MB
   limit) → `{"id": "doc_…"}`.
4. Place fields: `PUT /api/documents/[id]/fields` with
   `{"fields": [{"type", "page", "x", "y", "width", "height", "label", "required"}]}`.
   - `type`: `text`, `textarea`, `checkbox`, `signature`, `date`, or `hetu`.
     For multiple signers include `assignedSignerKey` matching a send-time key.
   - `page` is 0-based. `x`, `y`, `width`, `height` are integers in pixels
     of the page rendered **800 px wide**, with the origin at the **top-left**
     and `y` growing downwards. Width and height are at least 10.
   - The request replaces all fields and only works on draft documents.
5. Verify: render the page at 800 px width
   (`pdftoppm -png -scale-to-x 800 -scale-to-y -1 form.pdf page`), draw the
   boxes, and look at the image.
6. Send: `POST /api/documents/[id]/send` with
   `{"email": "...", "name": "...", "notify": false}` → `{"url", "signingSessionId", "expiresAt", "emailSent": false}`.
7. Return the `url` to the user in chat. Track progress with
   `GET /api/documents/[id]` and fetch the result with
   `GET /api/documents/[id]/pdf?signed=1` once `status` is `completed`.

Authenticate with `Authorization: Bearer <NIMMARI_API_KEY>`. A database key acts as its owner; the root environment key acts as
`NIMMARI_API_OWNER_ID` for document requests. Both reach only that owner's documents. See the [API table in the README](README.md#current-api).

## Lifecycle, notifications, and signer slots

- Prepare all fields and prefill while the document is a draft. AcroForm import
  (`importAcroForm="true"` on PDF upload) helps extract rectangles, but verify
  imported fields and assign signature slots explicitly before sending.
- Parallel signing uses omitted/null `order`; sequential signing uses zero-based
  orders. Equal orders may sign together. Later groups receive email invitations
  after prior groups finish. Each returned URL belongs only to its signer slot.
- Document upload `notify="false"` disables all document emails. Send
  `notify:false` disables invitations and sequential follow-ups for those sessions;
  signed notices still depend on the document setting. Use both for a fully
  silent workflow and verify `emailSent:false` for every returned slot.
- Signers cannot be added after any signature has been recorded. Cancelled,
  declined, and completed documents cannot reopen. Create a new document instead.
- With explicit authorization, an owner can `POST /api/documents/{id}/cancel`
  with optional `{ "reason": "..." }` (up to 1000 characters). Cancellation is
  terminal and blocks outstanding signing links.
- `POST /api/sign/{token}/decline` is a signer action. An unsigned signer may
  decline with an optional reason; this ends signing for everyone. Never perform
  this decision for the signer. Stopped signing routes return 410. Already-signed
  signers retain read-only PDF access until their token expires.
- `GET /api/sign/{token}` exposes the slot's `signerKey` and permitted fields.
  PDF submissions use field IDs; HTML submissions use field names. Do not open
  links to fill or submit on a real person's behalf.
- Upload `auditTimezone` overrides `NIMMARI_AUDIT_TIMEZONE` (default
  `Europe/Helsinki`). Webhooks report `document.completed`, `document.cancelled`,
  and `document.declined`; verify HMAC when a webhook secret is configured.

See [the portable agent skill](skills/nimmari/SKILL.md), its
[API reference](skills/nimmari/reference/api-cheatsheet.md), and the
[implemented API OpenAPI contract](openapi/current.yaml). The skill uses client
variables `NIMMARI_BASE_URL` and `NIMMARI_API_KEY` (a provisioned regular key for document work). Disposable synthetic tests are separate from
real signing and require deliberate test authorization.

Configuration: `NIMMARI_*` variables take precedence over deprecated `PUUMERKKI_*` aliases, including explicitly empty values. Existing API keys retain the `pmk_` prefix.

## One-time setup claim

No bearer authentication is required. All responses use Cache-Control: no-store.
Configure NIMMARI_SETUP_CODE (or deprecated PUUMERKKI_SETUP_CODE), at least 32 characters.
GET /api/setup/claim returns only {enabled:boolean,claimed:boolean}.
POST /api/setup/claim accepts {setupCode,email,name,password?}. On 201 it returns
{account:{id,email,name},password?,adminKey:{id,key,scope},agentKey:{id,key,scope},baseUrl}.
The generated password is returned only when omitted in the request. Keys are returned once;
store them privately. The admin key administers all accounts/keys; the regular key acts on
its owner's documents. Both store only hashes and retain the pmk_ prefix.
Errors: 404 disabled/missing/short code, 403 wrong code, 410 {error:"already_claimed"},
409 existing account, 400 invalid account input, 429 after 10 attempts per IP per
10-minute fixed window, 503 if the rate limiter cannot safely check.
Claim, account, credential and key writes share one transaction; failures roll back.
Apply journaled migration 0008_setup_claim.sql before deployment.
