---
name: puumerkki
description: Prepare, prefill, send, monitor, and verify Puumerkki e-signature documents through its HTTP API, using PDF overlays or annotated HTML forms.
---

# Use Puumerkki through HTTP

Use this skill with any agent capable of HTTP requests and document inspection.
Read [reference/api-cheatsheet.md](reference/api-cheatsheet.md) for request schemas,
examples, validation details, lifecycle responses, and implementation sources.
Use the deployed instance's matching source when its version differs from this repo.

## Establish the request

- Ask explicitly: **“Who needs to sign this document?”**
- Collect each signer's name, email, role, and intended signature line.
- Ask whether signing must be sequential or parallel.
- Ask which line belongs to whom when labels or roles are ambiguous.
- Ask for missing facts before creating links; never guess contract values.
- Prefill everything the requester has supplied or that is otherwise known.
- Leave signatures and unknowable/sensitive values for the appropriate signer.
- Use `hetu` for Finnish national ID; use text for a bank account.
- Do not claim that `hetu` verifies identity, format, or checksum.
- Explain that private fields are hidden/masked during signing but appear in full
  in the completed PDF to **all parties**, including full national IDs.
- Confirm that this simple electronic signature fits the requested workflow.
- Describe its actual mechanism: a drawn signature image and email-link identity.
- Treat link possession as the ability to sign; no bank ID or strong authentication
  is implemented by this API.
- Do not use this workflow for documents that require advanced or qualified signatures.

## Configure access

- Read `PUUMERKKI_BASE_URL` and `PUUMERKKI_BOT_API_KEY` from the environment.
- Set the base URL to the intended instance, without a trailing slash.
- Send `Authorization: Bearer <key>` to owner API routes.
- Never print, embed in examples, or expose the key in logs or request dumps.
- Use HTTPS for a remote instance; use HTTP only for an intended local/test setup.
- Keep signer URLs out of public logs; deliver each only to its intended signer.
- Recognize that `PUUMERKKI_BASE_URL` is a client convention in this skill.
- Ensure the OSS server has `PUUMERKKI_API_KEY` and `PUUMERKKI_API_OWNER_ID` set (the client uses `PUUMERKKI_BOT_API_KEY` for that API key);
  the bearer identity owns documents as that configured service-account user.
- Check returned URLs: the server constructs them from its `APP_URL`.

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
as needed; private fields become required hetu fields assigned to that key.
Normalize rotated/cropped pages first. Review required flags, radio/dropdown
conversions and layout. **Add signature boxes manually**; the helper never invents them.


- Use multipart `importAcroForm="true"` only when its conversions fit the form.
- Inspect `importedFields`, `errors`, and `warnings`, then fetch the document.
- Expect radio groups and dropdowns to import as text fields, not choice controls.
- Prefer reading widget rectangles and building explicit Puumerkki fields yourself
  when role assignment, radios, or precise layout matters.
- Record rectangles before stripping the source PDF's widgets/buttons.
- Flatten retained appearances or remove unwanted widgets/buttons before upload,
  so native controls do not render over the Puumerkki values or signatures.
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
- Remember that this replaces **all** fields and generates fresh IDs.
- Fetch `GET /api/documents/{id}` after configuring fields.
- Use `text`, `textarea`, `checkbox`, `date`, `hetu`, or `signature` for PDF fields.
- Keep single-line boxes about **22–30 overlay pixels high** for readable text.
- Give long values sufficient width; the renderer shrinks and wraps to fit.
- Use `textarea` and enough height for multiline notes.
- Avoid very short boxes: font size depends on height and can become tiny.
- Remember that the renderer now retains nonempty text even when line capacity
  would previously have dropped it; this does not guarantee an unclipped result.
- Place note text between printed rules, or use one field per ruled line.
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
python3 scripts/puumerkki_flow.py flattened.pdf --title Agreement \
  --fields fields.json --prefill prefill.json --signers signers.json --no-send > draft.json
```

The output contains `documentId` and `prefilledCheck` (per-field flags and overall
`ok`, without values). The helper fetches the draft after prefilling to check actual
values/flags, including the unlocked false-checkbox caveat. Inspect the owner GET,
source and overlays before sending; an automatic prefill check does not verify layout.
After verification, send that existing draft:

```sh
python3 scripts/puumerkki_flow.py --send-only DOC_ID --signers signers.json
```

Use `--print-urls` only to capture links privately for delivery or a disposable test;
URLs are omitted by default. Sending locks fields/prefill. The legacy create-and-send
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

- Perform a dry run on a test/preview instance or disposable test document.
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
  It requires a `%PDF-` header and `%%EOF`, and a successful `pdfinfo` parse when
  available, retrying failed downloads/validation up to three attempts with backoff.
  `--timeout` controls completion polling; `--poll-interval` defaults to 2 seconds.
- Never trust the first PDF byte stream: an immediate fetch after the last signer
  POST once returned an 8 KB truncated PDF with no trailer; a later refetch was valid.
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
- Create the real document **fresh** from the verified source and configuration.
- Do not reuse a signed test document or test links for humans.

## Send and monitor

- Send `POST /api/documents/{id}/send` with `signers` and `notify:false` for link-only delivery.
- Set `order:0,1,2,...` for sequential signing; omit `order` for parallel signing.
- Expect a later sequential signer to get 409 until all lower orders have signed.
- Allow parallel signing; artifact writes are serialized by the implementation.
- Handle both response shapes: one signer returns top-level `url`; multiple return `signers`.
- Return the URLs, their signer/role mapping, and `expiresAt` to the requester.
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
- Remember fields and prefill lock after send; re-upload to change either.
- Do not add signers after any signature exists; send returns 409.
- Do not blindly retry mutations after a timeout; inspect state first.
- Read the reference for cancel, decline, expired links, and retained PDF access.

## Receive webhooks

- Set a public HTTP(S) `webhookUrl` at upload when asynchronous updates are needed.
- Configure `PUUMERKKI_WEBHOOK_SECRET` on the server and receiving service.
- Verify `X-Puumerkki-Signature` as HMAC-SHA256 hex over the **raw body bytes**.
- Use `scripts/verify_webhook.py` as a constant-time verification example.
- Verify before parsing JSON; reject missing or malformed signatures when a secret is required.
- Handle `document.completed`, `document.declined`, and `document.cancelled`.
- Read exact event schemas in the reference; the payload has no signer URLs.
- Do not assume retry delivery: the server makes one attempt with a 10-second timeout.
- Reconcile events against owner GET responses; an HMAC alone supplies no replay protection.
