---
name: nimmari
description: Nimmari (formerly Puumerkki) self-hosted e-signature; use when asked to install Nimmari, prepare/send documents for signature.
---

# Use Nimmari through HTTP

Nimmari is agent-first: the human hands over the material and signs. The agent handles installation, configuration, accounts/keys, source preparation (including photos), field placement, authorized known-value prefill, confirmed signer selection, link delivery, tracking, signed PDF retrieval, webhooks, and updates. Signers fill only what the agent cannot know. Only signature fields are mandatory by default; require other fields only when requested. The owner UI and manual setup are secondary alternatives.

Use this skill with any agent capable of HTTP requests and document inspection.
Read [reference/api-cheatsheet.md](reference/api-cheatsheet.md) for request schemas,
examples, validation details, lifecycle responses, and implementation sources.
Use the deployed instance's matching source when its version differs from this repo.

For installation, follow [INSTALL-FOR-AGENTS.md](https://github.com/achren-oss/nimmari/blob/main/INSTALL-FOR-AGENTS.md): agent deployment with Render + Turso API keys and one-time setup claim is the default (no server root key). The Deploy to Render button is the alternative for users who don't want to give an agent provider keys; local/self-managed installation requires an explicit user request.

## End-to-end workflow

Run helpers from this skill folder. For a photo, crop/straighten and convert to PDF locally (for example, `img2pdf photo.jpg -o form.pdf` after image cleanup); the server does not accept images or perform OCR. Inspect the source and confirm signers, count, line ownership, and wanted fields before placing anything.

1. Upload PDF via `POST /api/documents` or HTML via `POST /api/documents/html`, with multipart `notify="false"` and optional `webhookUrl`. Save the document ID privately.
2. Place PDF fields via `PUT /api/documents/{id}/fields`; HTML fields come from `data-pm-field` attributes. Use stable signer keys, keep non-signature fields optional unless requested, then fetch owner `GET /api/documents/{id}`.
3. Prefill authorized known values via `PUT /api/documents/{id}/prefill` with `{"values":{...},"mode":"merge"}` (PDF IDs, HTML names). Never prefill signatures. Fetch again and verify values and assignments.
4. Render every PDF page at 800px width, draw the configured boxes, and look at them before send. Preview self-contained HTML locally and inspect its extracted fields and signer attributes; never submit a real signing form as a preview.
5. Send `POST /api/documents/{id}/send` with a persisted `Idempotency-Key` header, confirmed `signers` and `notify:false`; verify each returned `emailSent:false`. Use `--print-urls` with the helper to capture URLs privately, then deliver each secret link in chat only to its intended signer. The API still requires the signer's email for audit metadata, even without email delivery.
6. Poll owner GET or reconcile HMAC-verified lifecycle webhooks; on `completed`, download `GET /api/documents/{id}/pdf?signed=1` with `scripts/fetch_signed_pdf.py`. Stop on cancellation/decline. Webhooks are best effort; keep polling as a fallback.

The detailed steps below include the supported helper commands and recovery limits. Agent preparation uses owner endpoints; the human alone fills remaining signing fields and submits their signature.

## Establish the request

- Ask explicitly: **“Who needs to sign this document?”**
- Confirm how many signers there are and collect each signer's name, email, role, and intended signature line before placing fields.
- Ask whether signing must be sequential or parallel.
- Ask which line belongs to whom when labels or roles are ambiguous.
- Ask for missing facts before creating links; never guess contract values.
- Prefill authorized values supplied by the requester or otherwise known; never invent values.
- Leave signatures and unknowable/sensitive values for the appropriate signer.
- Use `hetu` for Finnish national ID; use text for a bank account.
- Do not claim that `hetu` verifies identity, format, or checksum.
- Explain that private fields are hidden/masked during signing but appear in full
  in the completed PDF to **all parties**, including full national IDs.
- Confirm that this simple electronic signature fits the requested workflow.
- Describe its actual mechanism: a drawn signature image and possession of a signer-specific link, with email recorded as audit metadata. Chat delivery does not verify email ownership.
- Treat link possession as the ability to sign; no bank ID or strong authentication
  is implemented by this API.
- Do not use this workflow for documents that require advanced or qualified signatures.

## Configure access

- Read `NIMMARI_BASE_URL` and `NIMMARI_API_KEY` from the environment.
- Set the base URL to the intended instance, without a trailing slash.
- Send `Authorization: Bearer <key>` to owner API routes.
- Never print, embed in examples, or expose the key in logs or request dumps.
- Use HTTPS for a remote instance; use HTTP only for an intended local/test setup.
- Keep signer URLs out of public logs; deliver each only to its intended signer.
- Recognize that `NIMMARI_BASE_URL` is a client convention in this skill.
- Use a provisioned regular database key; document requests act as its owner.
- Public signup is disabled. Fresh hosted installs use `/api/setup/claim` to obtain
  separate admin and regular keys; see the install runbook. Existing/local installations
  can bootstrap with the server root key
  (`NIMMARI_API_KEY`): `POST /api/accounts {email,name,password?}`, then
  `POST /api/keys {name,ownerUserId,scope:"regular"}`. Store returned secrets privately.
- Root account/key administration works without `NIMMARI_API_OWNER_ID`; root
  document requests require it. Admin database keys still access only their owner's documents.
- Account/key endpoints require bearer keys and reject session cookies. Regular
  keys can create regular keys and list/revoke keys for their own owner only.
- Rotate by creating a replacement, switching the client secret, then revoking
  the old key with `DELETE /api/keys/{id}` or `POST /api/keys/{id}/revoke`.
- Check returned URLs: the server constructs them from APP_URL → BETTER_AUTH_URL → RENDER_EXTERNAL_URL → localhost:3000.

## Prepare the source

- Upload a PDF with `POST /api/documents`, multipart part `pdf`.
- Keep it at or below **4,194,304 bytes (4 MiB)**; use MIME `application/pdf`.
- Set `title`, `auditTimezone`, and optional `webhookUrl` deliberately.
- Set upload `notify` to the multipart string `"false"` for a fully silent workflow.
- For a photo, straighten and crop it into a clean PDF first, or rebuild the form
  as HTML and render to PDF; do not upload an image to the PDF endpoint.
- Inspect page orientation, dimensions, printed labels, ruling lines, and whitespace.
- Prefer a clean, readable source over trying to patch an illegible scan with overlays.
- For native HTML forms, use `POST /api/documents/html` with multipart `html`.
- Give every HTML field a unique `data-pm-field` name.
- Read the reference before selecting HTML tags and `data-pm-*` attributes;
  extraction depends on element type, not just the explicit attribute.
- Use self-contained HTML/CSS; remote resources and scripts are restricted.
- Keep an HTML file at or below 2 MiB; raw HTML strings use a character-count limit.

## Handle fillable PDFs

Use `scripts/acroform_to_fields.py` (requires `pypdf`) for explicit overlays:

```sh
python3 scripts/acroform_to_fields.py form.pdf --output-dir /tmp/new-form \
  --skip-prefix witness --private national_id=party
```

It writes `flattened.pdf` and `fields.json`, using each page's dimensions.
This removes widgets and AcroForm rather than baking native values/appearances
into page content; printed page content and non-widget annotations remain.
`Btn` becomes checkbox; `Tx` taller than 25pt becomes textarea. Text boxes grow
upward to at least 20px. Repeat `--skip-prefix` and `--private NAME=signerKey`
as needed; private fields become required hetu fields assigned to that key. Change `required` to false if the user has not requested that requirement; the helper also preserves native required flags.
Normalize rotated/cropped pages first. Review required flags, radio/dropdown
conversions and layout. **Assign imported signature boxes to signers and add missing signature lines explicitly**.


- Use multipart `importAcroForm="true"` only when its conversions fit the form.
- Inspect `importedFields`, `errors`, and `warnings`, then fetch the document.
- Expect radio groups and dropdowns to import as text fields, not choice controls.
- Prefer reading widget rectangles and building explicit Nimmari fields yourself
  when role assignment, radios, or precise layout matters.
- Record rectangles before stripping the source PDF's widgets/buttons.
- Flatten retained appearances or remove unwanted widgets/buttons before upload,
  so native controls do not render over the Nimmari values or signatures.
- Preserve printed labels; verify flattening did not bake unwanted values into the source.
- Do not assume `importAcroForm` itself removes or flattens native widgets.

## Place PDF fields

- Use zero-based `page` indexes and an **800px-wide** coordinate space per page.
- Use the top-left origin, with x increasing rightward and y downward.
- Convert a bottom-left PDF-point rectangle `(x1, y1, x2, y2)` using:

  ```text
  k = 800 / pageWidthPt
  x = x1 * k
  y = (pageHeightPt - y2) * k
  width = (x2 - x1) * k
  height = (y2 - y1) * k
  ```

- Round to integers for the fields API; width and height must each be at least 10.
- Verify rotation/crop transformations visually instead of trusting raw rects blindly.
- Put fields with `PUT /api/documents/{id}/fields` and `{"fields": [...]}`.
- Without IDs this replaces **all** fields and generates fresh IDs; include existing IDs to preserve metadata.
- Fetch `GET /api/documents/{id}` after configuring fields.
- Use `text`, `textarea`, `checkbox`, `date`, `hetu`, or `signature` for PDF fields.
- Keep single-line boxes about **22–30 overlay pixels high** for readable text.
- Give long values sufficient width; the renderer shrinks and wraps to fit.
- Use `textarea` and enough height for multiline notes.
- Avoid very short boxes: font size depends on height and can become tiny.
- Remember that the renderer now retains nonempty text even when line capacity
  would previously have dropped it; this does not guarantee an unclipped result.
- Place note text between printed rules, or use one field per ruled line.
- Signature fields should be about 40–45 PDF points tall, with their bottom on the signature line. Convert points to the 800px overlay coordinate space using `800 / pageWidthPt`. Stamping enforces a 40 pt minimum rendered height, growing upward without clipping and preserving the cropped image aspect ratio; field width and page bounds can limit this height. Native AcroForm signature boxes are extended upward to at least 40 pt while keeping their bottom.

- Put signature boxes inside the blank signature area, clear of printed labels.
- Assign signature fields only to that signer's own line: the submitted image
  is stamped into **every** signature field assigned to that signer.
- Use stable `assignedSignerKey` values and matching signer `key` values.
- Use distinct keys whenever the same email signs two roles.
- Prefer keys over email assignments; keys take precedence when both are present.
- Assign every signature field in a multi-signer document; shared signature slots
  are rejected at send time.
- Combine `privateForOtherSigners:true` with a specific key/email assignment.

## Prefill the draft

Follow **draft -> verify -> send**. Create without sending:

```sh
python3 scripts/nimmari_flow.py flattened.pdf --title Agreement \
  --fields fields.json --prefill prefill.json --signers signers.json --no-send > draft.json
```

The output contains `documentId` and `prefilledCheck` (per-field flags and overall
`ok`, without values). The helper fetches the draft after prefilling to check actual
values/flags, including the unlocked false-checkbox caveat. Inspect the owner GET,
source and overlays before sending; an automatic prefill check does not verify layout.
After verification, send that existing draft:

```sh
python3 scripts/nimmari_flow.py --send-only DOC_ID --signers signers.json
```

Use `--print-urls` only to capture links privately for delivery or a disposable test;
URLs are omitted by default. Sending locks prefill; fields remain editable until any signer signs. The legacy create-and-send
mode remains available but does not provide a pause for visual draft verification.
Both modes use upload/send `notify:false`; send-only preserves the existing upload's
notification setting. No helper retries mutations automatically.


- Send `PUT /api/documents/{id}/prefill` with string values and `mode:"merge"`.
- For PDFs, key values by the server field **id**, never its human-readable name.
- For HTML, key values by the `data-pm-field` name.
- Never prefill signatures; the endpoint skips them.
- Use canonical checkbox strings `"true"` / `"false"` and valid date values.
- Check the reference for the false-checkbox prefill caveat.
- Use `mode:"replace"` or `clear:true` only to intentionally clear omitted values.
- Fetch the draft again and verify values, prefilled flags, assignments, and required fields.
- Expect prefilled PDF fields to be read-only on the signer page and stamped
  into the signed PDF on the first signing event.

## Verify before delivering real links

- Only with deliberate synthetic-test authorization, perform a dry run on a test/preview instance or disposable test document. Otherwise inspect the real draft visually without sending or signing a test.
- Use synthetic values and `example.com` signers, with upload and send `notify:false`.
- Exercise the actual roles, privacy assignments, order, checkboxes, and long values.
- Capture test flow output privately with `--print-urls > test-flow.json`, then run
  `python3 scripts/test_sign.py test-flow.json --values test-values.json --signature synthetic.png`.
  Values are `{"signerKey":{"fieldName":"synthetic value"}}`. The helper resolves
  names via the flow's `fieldNames` map (PDF signer payloads may omit names), signs
  in ascending order, respects read-only/role assignments, and prints statuses only.
  It refuses any non-`@example.com` signer unless `--i-know-this-is-a-test` is explicit.
  Never use it to sign for a real person; it creates actual signatures on test documents.
- Fetch each test signer's field payload with `GET /api/sign/{token}`.
- Sign the **test document** via `POST /api/sign/{token}` using the reference schema.
- Check the intermediate PDF as another signer before completing the document.
- Expect signer GET to omit other signers' private fields entirely: a test returned
  42 of 44 configured fields. Do not treat the smaller count as lost configuration.
- Verify private IDs are omitted from other signers' field payloads and masked
  in their PDF views, including its extracted text layer.
- Complete all test sessions, then **always use**
  `python3 scripts/fetch_signed_pdf.py DOC_ID final.pdf --timeout 300` before rendering.
  It polls owner `GET /api/documents/{id}` until `completed`, then downloads
  `GET /api/documents/{id}/pdf?signed=1` using the environment Bearer key.
  The server sends `Content-Length`, `X-Content-SHA256` (hex SHA-256), and
  `Repr-Digest` (base64 SHA-256). The helper requires matching length and SHA-256,
  a `%PDF-` header, `startxref`, `%%EOF` in the last 2048 bytes, and a successful
  `pdfinfo` parse when available. It retries transport failures or validation
  mismatches up to three attempts with backoff; HTTP 503 honors `Retry-After`.
  `--timeout` controls completion polling; `--poll-interval` defaults to 2 seconds.
- Validate every downloaded PDF: transport truncation can remove the trailer,
  even when the server generated a complete artifact.
  The server rejects incomplete PDF bytes with 503 `{"error":"PDF not ready"}`
  and `Retry-After: 2`. A `signed=1` request while status is `sent` still returns
  the existing intermediate PDF; poll for `completed` to retrieve the final artifact.
  Any equivalent retrieval must poll completion and validate the downloaded PDF.
- Run `scripts/render_check.sh final.pdf new-render-directory`.
- Open and **look at every generated PNG**, including every seal page.
- Verify values are visible and unclipped, fonts are consistent, and checkboxes are correct.
- Verify signatures occupy the correct boxes, are uncovered, and cover no labels.
- Verify no source text, ruling lines, or important footer content is painted over.
- Expect PDF multi-signer documents to add an extra final page for the combined seal
  (a three-page source becomes four pages); inspect that page too.
- Verify one combined seal, correct signer emails/times/timezone, and document/hash marker.
- Verify full synthetic IDs appear in the completed final PDF for all parties.
- Use text extraction as an additional check, never as a substitute for looking.
- Correct the source/fields and repeat the dry run if any check fails.
- After an authorized synthetic test, create the real document **fresh** from the verified source and configuration.
- Do not reuse a signed test document or test links for humans.

## Send and monitor

- Send `POST /api/documents/{id}/send` with a persisted `Idempotency-Key`, `signers` and `notify:false` for link-only delivery.
- Set `order:0,1,2,...` for sequential signing; omit `order` for parallel signing.
- Expect a later sequential signer to get 409 until all lower orders have signed.
- Allow parallel signing; artifact writes are serialized by the implementation.
- Handle both response shapes: one signer returns top-level `url`; multiple return `signers`.
- Check `emailSent:false` for every slot, then deliver each secret URL only to its intended signer, with its role and `expiresAt`; do not expose other signers' links in shared chat.
- With silent sequential signing, monitor session `signedAt` and deliver each later link when lower orders finish; the server sends no follow-up email for these slots.
- Tell signers that links expire **30 days after send**.
- For invitations, use `notify:true` with document notifications enabled; check
  `emailSent` and `emailNote`, rather than assuming an email was delivered.
- Expect sequential follow-up invitations when the previous signer signs.
- Remember send `notify:false` suppresses invitations only; upload `notify:false`
  also suppresses signed-copy notices. Set both false for silent delivery.
- Poll `GET /api/documents/{id}` as well as receiving webhooks.
- Treat `draft`, `sent`, `completed`, `cancelled`, and `declined` as document statuses;
  expiry is a session condition, not a document status.
- Stop polling at terminal status and use `scripts/fetch_signed_pdf.py` to retrieve
  and validate the final PDF only when completed.
- Prefill locks after send. PDF fields remain editable until the first signature; include existing IDs to preserve metadata/values and keep the complete intended field list. Re-upload for changes after signing starts.
- Do not add signers after any signature exists; send returns 409.
- Always use an `Idempotency-Key` on send; after timeout retry the same key and body. Use list to discover documents, reissue to recover lost or expired unsigned links, and resend to redeliver existing slots.
- Read the reference for cancel, decline, expired links, and retained PDF access.

## Receive webhooks

- Set a public HTTP(S) `webhookUrl` at upload when asynchronous updates are needed.
- Configure `NIMMARI_WEBHOOK_SECRET` on the server and receiving service.
- Verify `X-Puumerkki-Signature` as HMAC-SHA256 hex over the **raw body bytes**.
- Use `scripts/verify_webhook.py` as a constant-time verification example.
- Verify before parsing JSON; reject missing or malformed signatures when a secret is required.
- Handle `document.completed`, `document.declined`, and `document.cancelled`.
- Read exact event schemas in the reference; the payload has no signer URLs.
- Inspect webhook delivery history; six attempts use persisted backoff. Schedule the process endpoint for serverless; keep polling as a fallback.
- Reconcile events against owner GET responses; an HMAC alone supplies no replay protection.

### Account administration

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

Configuration: `NIMMARI_*` variables take precedence over deprecated `PUUMERKKI_*` aliases, including explicitly empty values. Existing API keys retain the `pmk_` prefix.

For fresh hosted setup, follow [INSTALL-FOR-AGENTS.md](https://github.com/achren-oss/nimmari/blob/main/INSTALL-FOR-AGENTS.md): agent deployment with a Render API key and Turso Platform API token, followed by the one-time setup claim, is the default (no server root key). The Deploy to Render button is the alternative for users who don't want to give an agent provider keys. Existing root/API-key provisioning remains supported.


### Field requirements and editing

Only signature fields are required by default. Other field types (text, textarea, date, hetu, checkbox) are optional unless `required:true` is supplied. A visible signature field always requires a signature, even with `required:false`. HTML non-signature fields remain opt-in via `data-pm-required`. Existing stored flags are unchanged.

Field PUT accepts optional existing field `id` values to update in place, preserving omitted metadata and stored flags. Fields omitted from the list are deleted; fields without IDs are inserted with generated names when needed. A request without IDs retains replace-all behavior. Drafts and sent documents with no signatures may be edited; signed, completed, cancelled or declined documents return 409. Pending signers see saved fields on their next load; no emails are sent.

## Release 1.4 reliability

Use `GET /api/documents?status=draft,sent&limit=20` to discover your documents instead of relying only on saved IDs. Follow the opaque `nextCursor`; ordering is creation time descending with ID as the tiebreaker. Invalid status/cursor/limit returns 400. Summaries include signer roles and state, never tokens.

Always send with an `Idempotency-Key` (1–255 characters, for example a UUID), saved privately with the exact request. On timeout, retry the same body with the same key. The owner/document/key tuple stores the original response and URLs for 24 hours in the database; concurrent duplicates serialize. A different body with that key returns 422. After expiry a request can create new slots; inspect state first. Stored responses contain secret URLs and deserve the same database protection as signing tokens. Expired records are replaced lazily when the key is reused.

`send` creates signer slots. `POST /api/documents/{id}/resend` creates no slots: it rotates links and re-delivers invitations for active unsigned slots. Optional `{signers:["slot-key"],notify:false}` selects roles and returns fresh URLs without email. `POST /api/documents/{id}/signers/{slotKeyOrSessionId}/reissue` rotates one unsigned slot's token, invalidates its old link, and resets expiry to 30 days, including for expired slots. Both default to the slot's original invitation preference gated by document notify; explicit `notify:false` is silent. Signed, stopped, completed, or sequentially waiting slots return 409. Resend without a selection skips signed/waiting slots. Although existing tokens remain stored for sequential invitation compatibility, rotation prevents reuse of a misplaced link. Deliver every returned secret URL only to its intended signer.

Webhooks use a persistent outbox, enqueued atomically on completion/cancel/decline. Delivery is attempted immediately with a 10-second timeout, then retried after approximately 1 minute, 5 minutes, 30 minutes, 2 hours, and 12 hours (up to 20% jitter, six total attempts). Any non-2xx or transport failure retries; redirects are refused. DB leases prevent simultaneous workers from delivering the same item. Inspect `GET /api/documents/{id}/webhooks` or owner-only `GET /api/webhooks/deliveries?status=failed&limit=20&cursor=...`. History reports aggregate attempt count, last HTTP status/error, retry time and timestamps. `POST /api/webhooks/deliveries/{id}/redeliver` resets the retry budget and attempts again; an active lease returns 409. Receivers must deduplicate on `X-Nimmari-Delivery-Id`: network failures and expired leases can cause repeat delivery. `X-Nimmari-Attempt` is one-based. The existing `X-Puumerkki-Signature` remains HMAC-SHA256 hex over the exact JSON body.

Authenticated API traffic and health checks opportunistically process at most three due deliveries. Docker defaults `NIMMARI_WEBHOOK_WORKER=1` for a 15-second interval; other standalone deployments can opt in. On serverless, schedule `POST /api/webhooks/deliveries/process` every minute with a bearer key. Regular keys process only their owner's deliveries; admin/root keys may process all. Keep the cron credential private. Poll `GET /api/documents/{id}` as the fallback.

New webhook destinations require HTTPS in production. Existing public HTTP URLs continue delivering. Private/local destinations remain blocked unless `NIMMARI_WEBHOOK_ALLOW_PRIVATE=1` is explicitly configured for a trusted network or synthetic tests; this also allows local HTTP. Never enable it for untrusted document creators.
