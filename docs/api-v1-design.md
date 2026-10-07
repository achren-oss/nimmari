# Headless API v1 design

Design draft, 2026-10-07. This document and `openapi/v1.yaml` describe proposed behavior, not implemented endpoints. The existing Next.js routes, Drizzle/libSQL schema, Better Auth, pdf-lib and Puppeteer remain the starting point.

## Goals and non-goals

Provide a self-hosted, workspace-isolated API for preparing PDF and HTML envelopes, collecting ordered recipient actions, embedding signing, retrieving immutable evidence, and receiving reliable webhooks. Publish a machine-readable OpenAPI 3.1 contract suitable for an eventual TypeScript SDK. Email is optional; headless workflows must work without it.

V1 produces eIDAS Simple Electronic Signatures (SES) only. It does not promise advanced or qualified signatures, identity verification, legal suitability, hosted service operation, or cryptographic PDF signatures. PAdES certificate signatures and RFC 3161 timestamps belong to v1.1; they must not retroactively change v1 evidence. Templates, bulk sending, public workspace provisioning and storage-provider APIs are outside v1.

## Data model

All timestamps use UTC RFC 3339 strings on the wire. IDs are opaque strings. Foreign keys and authorization must bind every child to its envelope and workspace. Live and test data are separate namespaces within each workspace; test credentials cannot access live resources or send real email. Schema tables below are proposed additions or evolutions, not current capabilities.

| Entity | Proposed attributes and invariants |
| --- | --- |
| Workspace | `id`, `name`, `created_at`, `updated_at`; memberships connect Better Auth users to owner/admin/member roles. Provision through the administrator UI or CLI. `GET /v1/workspace` returns the credential's workspace. |
| ApiKey | `id`, `workspace_id`, `name`, `mode` (live/test), visible `prefix`, `secret_hash`, `scopes`, `created_at`, optional `expires_at`, `revoked_at`, `last_used_at`. Full credential is `pk_live_<id>.<secret>` or `pk_test_<id>.<secret>`: `pk_` plus mode and ID is public; secret is at least 256 random bits. Return full key once at creation, never in list/read. Store only SHA-256 of the random secret (or versioned Argon2id hash), never plaintext. Look up by visible ID and compare hashes in constant time. Revocation is immediate; last-used updates may be coalesced within one minute. |
| Envelope | `id`, `workspace_id`, `mode`, `title`, `metadata`, `routing` (parallel/sequential), `status`, `expires_at`, `sent_at`, `completed_at`, `void_reason`, timestamps, revision; `final_file_sha256`, `audit_certificate_sha256`, evidence version and storage references once finalized. |
| Document | `id`, `envelope_id`, `kind` (pdf/html), `name`, deterministic `position`, content storage reference, `content_sha256`, optional uploaded-byte hash, sanitizer/render versions, timestamps. PDF hash covers exact accepted bytes; HTML hash covers exact sanitized UTF-8 bytes, not raw upload. No normalization after hash calculation. PDFs max 4 MiB; HTML max 2 MiB UTF-8 bytes, checked while streaming. |
| Recipient | `id`, `envelope_id`, `email`, optional `name`, `role` (signer/approver/cc), positive `routing_order`, `status` (pending/active/signed/approved/declined/notified), action timestamps. Multiple recipients may share one sequential order. CC receives completion notice and has no action or fields. Approver explicitly approves and has no signature fields. |
| Field | `id`, `document_id`, `recipient_id`, `type` (text/textarea/checkbox/signature/date), `name`, `label`, `required`, `prefilled`, `value`. PDF location uses zero-based page, top-left coordinates in PDF points after page rotation, positive width/height within page bounds. HTML uses unique `data-pm-field` name and no PDF coordinates. Dates are ISO `YYYY-MM-DD`; checkbox values are booleans, text max 5000 characters, signature values are validated PNG data URLs limited to 512 KiB decoded. No signature prefill. |
| SigningSession | `id`, `recipient_id`, token hash, `expires_at`, `consumed_at`, allowed parent origin, `return_url`, session timestamps. Invitation capabilities and embedded bootstrap capabilities are separately purposed. Never persist clear tokens. |
| Event | `id`, `workspace_id`, `envelope_id`, strictly increasing per-envelope `sequence`, `type`, `occurred_at`, actor, data, `prev_hash`, `hash`, `evidence_version`. Append-only; no public mutation endpoint. |
| WebhookEndpoint / Delivery | Endpoint: workspace/mode, URL, subscribed event types, enabled flag, encrypted signing secret, timestamps. Delivery: endpoint/event IDs, immutable payload bytes, status, attempt count and bounded attempt records (timestamps, HTTP status, sanitized error, next attempt). Secrets are returned once at creation and are encrypted at rest because HMAC requires retrieval. |

Scopes are `envelopes:read`, `envelopes:write`, `webhooks:manage`, `api_keys:manage`. Read covers all envelope children, evidence and downloads; write covers draft mutation, send/void and signing URL creation. Webhook management covers endpoints and deliveries. API-key management requires a workspace administrator principal or a key with that scope; it may grant only scopes it holds. Bootstrap the first administrator key using the authenticated admin UI/CLI, never anonymous HTTP. Ordinary browser sessions are not bearer credentials for `/v1`.

### Lifecycle and routing

`draft → sent → completed | declined | voided | expired`; a draft may also be voided. Draft deletion is allowed; evidence-bearing envelopes cannot be deleted through v1. Drafts alone allow document, recipient, field, title, routing and expiry edits. Send freezes a revision and rejects missing documents, missing action recipients, unassigned fields, invalid locations, invalid expiry, or signers without a required signature. Prefilled values become immutable.

Parallel activates all action recipients. Sequential activates the lowest unfinished routing order, with all recipients of that order acting in parallel. CC is excluded from advancement. Every signer signs and every approver approves before completion. A decline terminates the envelope immediately. Void or expiry invalidates every outstanding capability. Terminal states never reopen; create a new envelope to restart. Serialize competing send/sign/decline/void/expiry transactions with revision checks; exactly one terminal outcome may commit. Rendering failures leave the envelope sent with actions recorded and finalization queued; mark completed only after durable evidence and final bytes exist. Downloads return 409 until ready.

### Event chain and final evidence

Use [RFC 8785 JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785.html). For each envelope, `prev_hash` is 64 zero hex characters for sequence 1, otherwise the prior event hash. `hash = SHA256(UTF8(JCS(event_without_hash)))`; the object includes `prev_hash`, IDs, sequence, type, UTC timestamp, actor, data and evidence_version, but excludes only `hash`. Store canonical bytes as well as parsed data; reject duplicate JSON keys and unsupported numeric values. State mutation, event append, per-envelope sequence allocation and transactional outbox insert commit together. Database constraints enforce unique `(envelope_id, sequence)`; application permissions/triggers prohibit updates and deletion. A hash chain detects modification against a trusted checkpoint; it does not prevent a database administrator rewriting the entire chain or prove time/identity.

At finalization: record recipient actions; freeze their chain head; render ordered documents plus an audit certificate page; hash the exact final PDF bytes; append `envelope.completed` with that SHA-256, certificate SHA-256 and evidence checkpoint; commit artifact references, terminal status and outbox atomically. The appended certificate page contains source hashes, recipient actions/consent, timestamps, evidence version and the pre-completion chain checkpoint. It cannot contain its enclosing file's hash without circularity. A separately downloadable certificate PDF additionally states the final-file SHA-256 and the same pre-completion checkpoint; hash that certificate before the completion event. No artifact contains its own hash. Final artifacts are stored once, never lazily regenerated on download. Imported legacy artifacts are explicitly identified as legacy evidence.

## REST endpoints

Base is the deployment origin, with `/v1` paths. JSON requests use snake_case. Child IDs are validated under the path envelope, not fetched globally. Create returns 201; reads/updates/actions return 200; deletion returns 204. Send/void return the envelope; rendering may finish asynchronously while status remains sent.

| Method | Path | Scope / behavior |
| --- | --- | --- |
| GET | `/v1/workspace` | Credential workspace metadata |
| GET, POST | `/v1/envelopes` | Read list / write create draft |
| GET, PATCH, DELETE | `/v1/envelopes/{envelope_id}` | Read / write draft update / write draft delete |
| GET, POST | `/v1/envelopes/{envelope_id}/documents` | Read list / write multipart upload (`file`, `kind`, `name`, `position`) |
| GET, DELETE | `/v1/envelopes/{envelope_id}/documents/{document_id}` | Read metadata / write draft removal; associated fields removed |
| GET, POST | `/v1/envelopes/{envelope_id}/recipients` | Read list / write add |
| GET, PATCH, DELETE | `/v1/envelopes/{envelope_id}/recipients/{recipient_id}` | Read / write draft edit / write removal (409 if fields remain assigned) |
| GET, POST | `/v1/envelopes/{envelope_id}/fields` | Read list / write add |
| GET, PATCH, DELETE | `/v1/envelopes/{envelope_id}/fields/{field_id}` | Read / write draft edit including prefill / write removal |
| POST | `/v1/envelopes/{envelope_id}/send` | Write; freezes draft and schedules optional notifications |
| POST | `/v1/envelopes/{envelope_id}/void` | Write; reason required; cancels outstanding actions |
| POST | `/v1/envelopes/{envelope_id}/signing-urls` | Write; active signer/approver ID, return URL, parent origin, TTL; returns short-lived embedded URL |
| GET | `/v1/envelopes/{envelope_id}/final.pdf` | Read; combined ordered final PDF and certificate page |
| GET | `/v1/envelopes/{envelope_id}/audit-certificate.pdf` | Read; standalone evidence certificate |
| GET | `/v1/envelopes/{envelope_id}/events` | Read; ordered append-only evidence events |
| GET, POST | `/v1/webhook-endpoints` | Webhooks manage; list / create (secret once) |
| GET, PATCH, DELETE | `/v1/webhook-endpoints/{endpoint_id}` | Webhooks manage; read / edit / disable and remove subscription |
| GET | `/v1/webhook-deliveries` | Webhooks manage; optional endpoint filter |
| GET | `/v1/webhook-deliveries/{delivery_id}` | Webhooks manage; attempts and status |
| POST | `/v1/webhook-deliveries/{delivery_id}/redeliver` | Webhooks manage; 202; enqueue a new delivery for the same event/payload |
| GET, POST | `/v1/api-keys` | Keys manage; list / create (credential once) |
| GET, DELETE | `/v1/api-keys/{key_id}` | Keys manage; metadata / revoke; metadata retained |

## Embedded signing

The integrator's backend holds the API key and creates a URL for an active recipient. TTL defaults to 300 seconds, maximum 900, bounded by envelope expiry. The opaque 256-bit bootstrap token is single-use and exchanges into a narrowly scoped HttpOnly Secure signing session. The hosted signing UI (outside public `/v1`) validates recipient, routing, expiry and envelope status on every read, submission and download, uses CSRF protection, and records explicit consent plus signer/approver action. API keys never enter the iframe or browser. No capability can mutate another recipient's fields or prefilled values.

`return_url` must match workspace-configured HTTPS return origins; local HTTP is permitted only in explicit development mode. Reject credentials, fragments containing secrets, and unapproved redirects. `parent_origin` must match a configured embedding origin and is bound to the capability and CSP `frame-ancestors`. Navigation returns only envelope/recipient IDs and result; the backend confirms via API/webhooks. `postMessage` uses the exact allowed origin and contains no tokens. Use no-store and no-referrer, scrub URL tokens from logs, exchange immediately and remove them from browser history. Expired/used links require backend recreation. Completion does not preserve download authorization in the consumed session; owner downloads or separately scoped short-lived download capabilities serve that purpose.

## Optional email

Provider contract: `sendInvitation(message)`, `sendCompletion(message)`, `health()` returning provider message ID or a structured retryable/permanent error. Implement `none`, `resend`, `smtp`; configuration and credentials stay in deployment/workspace settings, not in envelope JSON. `send` accepts `notification: none | email`, default none. Requesting email with provider none returns 422 before send commits. Queue mail through the transactional outbox; provider failures never roll back the envelope or duplicate recipient actions. Invitation tokens are separately scoped to recipient access and expire at the envelope deadline (default 30 days), unlike embedded bootstrap tokens. Click tracking is optional telemetry, never proof of consent. Test mode suppresses external email and exposes only test events. Resend inbound verification remains a provider adapter, distinct from outbound integration webhooks.

## Webhooks

Types: `envelope.created`, `envelope.sent`, `recipient.viewed`, `recipient.signed`, `recipient.approved`, `recipient.declined`, `envelope.completed`, `envelope.declined`, `envelope.voided`, `envelope.expired`. Subscribe explicitly; exclude field values, signatures, tokens and raw IPs from payloads. Payload contains stable event ID, type, occurred_at, workspace_id, mode, envelope_id and minimal data (recipient ID or final hashes when applicable). Fetch full evidence with authorized API calls.

Deliver exact persisted UTF-8 JSON bytes using HTTPS POST with `Content-Type: application/json`, `Puumerkki-Event-Id`, `Puumerkki-Delivery-Id`, and `Puumerkki-Signature: t=<unix_seconds>,v1=<lowercase_hex_hmac>`. Compute HMAC-SHA256 with the endpoint secret over `ASCII(timestamp) + '.' + raw_body`. Receivers compare in constant time, reject timestamps outside ±300 seconds, and deduplicate by event ID. Retry and manual redelivery generate fresh timestamps/signatures. Webhooks are at least once; ordering is not guaranteed. Acknowledge 2xx after durable enqueueing; signature verification occurs before JSON parsing. Secrets are at least 256 bits; rotation uses a replacement endpoint during overlap, then retires the old endpoint.

Worker timeout is 10 seconds. Initial delivery plus seven retries at approximately 30s, 2m, 10m, 30m, 2h, 8h, 24h, with ±20% jitter. Retry network errors and any non-2xx, with bounded Retry-After for 429/503; disable endpoint on 410. Exhaustion marks failed, without affecting envelope state. Logs store each attempt and redact/bound response bodies to 4 KiB, retained 30 days by default. Redelivery requires an enabled existing endpoint and creates a new delivery ID referring to the original event; it never adds an evidence event. Deleting endpoints cancels pending jobs but preserves delivery metadata under retention policy. Test endpoints receive only test events.

## Idempotency

`Idempotency-Key` is optional but strongly recommended on all POST, PATCH and DELETE operations. Accept 1–255 printable ASCII characters. Scope uniqueness to `(workspace_id, mode, key_id, idempotency_key)` for 24 hours; store a fingerprint of method, canonical path, relevant content type and canonical JSON body (multipart: ordered metadata plus exact file-byte SHA-256). Same key with different path/method/content returns 409 `/problems/idempotency-conflict`; an in-flight identical request returns 409 `/problems/idempotency-in-progress` with Retry-After. Replays return the original status, body and semantic headers with `Idempotency-Replayed: true` and no repeated action/outbox work. Validation/authentication/rate-limit failures before reservation are not retained. Transactions prevent duplicate effects on crashes; reserve, mutate and persist result atomically, using an outbox for external effects.

Always recheck authentication/scopes before replay; revoked keys cannot replay. API-key creation never caches the returned secret: its completed idempotency record stores the new key ID only. A duplicate creation request returns 409 `/problems/one-time-result-unavailable` with that ID, without creating another key; revoke and replace a key whose one-time response was lost. This is the documented exception to response replay, keeping API-key secrets stored only as hashes. Webhook-secret and signing-URL results use encrypted replay storage with 24-hour deletion (never plaintext logs); signing URLs retain their original expiry and may already be consumed. Clients must create a fresh request/key when a replayed URL has expired. After retention expires, a repeated key is a new request; use resource status and caller metadata for longer-lived reconciliation.

## Pagination and errors

Every collection uses `limit` (default 20, range 1–100), `starting_after` (last resource ID), and `{data: [...], has_more: boolean}`. Sort immutable `(created_at, id)` ascending; events by sequence; children also have creation timestamps. The cursor must belong to the same workspace, mode, parent and filter, or return 400. Deleted resource cursor lookup uses retained cursor metadata for 24 hours; older/unavailable cursor returns 400. A list is not a snapshot; insertion after the cursor may appear later. Repeat filters on each page; take the last returned ID only when has_more is true.

Use [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html), which supersedes RFC 7807, with `application/problem+json`: `type`, `title`, `status`, `detail`, `instance`, plus `code`, `request_id`, optional `errors` (JSON pointers and messages). Resolve stable type URIs against the deployment origin, e.g. `https://puumerkki.your-domain.tld/problems/invalid-request`. Publish human-readable problem pages. Codes/types: invalid-request (400), unauthorized (401), insufficient-scope (403), not-found (404), state-conflict / idempotency-conflict / idempotency-in-progress / one-time-result-unavailable (409), token-expired (410, signing UI only), payload-too-large (413), unsupported-media-type (415), validation-failed (422), rate-limited (429), internal-error (500), temporarily-unavailable (503). Hide cross-workspace existence as 404. Never disclose secrets, SQL or stack traces. Responses include X-Request-Id; 401 includes WWW-Authenticate; 429/503 include Retry-After when retryable.

## Versioning and rate limits

Path version `/v1` is the compatibility boundary. Add optional fields and new endpoints; never remove/rename fields, change types, make optional inputs required or alter lifecycle meanings within v1. Clients ignore unknown response fields and handle unknown event types/status values defensively. Announce breaking changes through a new major path. Deprecation uses documented migration notes, Deprecation/Sunset/Link headers and at least 180 days plus one supported release before removal; self-host operators control upgrades. V1.1 evidence extensions are opt-in and versioned.

Defaults configurable by operator: 120 API requests/minute per key (burst 30), 600/minute per workspace/mode; uploads and rendering-triggering actions additionally 10/minute per workspace, maximum two concurrent render jobs per workspace. Signing UI uses 30 requests/minute per recipient session plus 60/minute per trusted client IP. Apply a shared persistent limiter across workers; do not reuse only an in-process limiter. Responses expose RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset (seconds until reset) and Retry-After on 429. Quotas apply before expensive parsing/rendering; retries and valid replays count requests, not duplicated actions.

## Security considerations

TLS is required outside development. Scope all SQL queries and storage access to workspace/mode; validate parent-child references and use transaction constraints. Store keys hashed, capabilities hashed, retrievable provider/webhook secrets encrypted; separate encryption keys from backups and support rotation. Audit administrator changes separately from per-envelope evidence. Test mode is an enforced data boundary, not a cosmetic prefix.

Validate PDF structure and reject encrypted/unsupported or active-content PDFs; sanitize HTML, disallow scripts and external resources, isolate Puppeteer with OS sandboxing, resource/time budgets and blocked network access. Pin renderer/font versions to the evidence manifest. Never trust client MIME alone. Serve private artifacts with no-store and safe attachment filenames. Verify all required fields, recipient assignment, role, locked prefills, actual streamed body size, signature image structure and date format server-side.

Webhook destinations are an SSRF boundary: prohibit localhost, private/link-local/metadata ranges and credentials; validate DNS on every connection, pin validated resolution and disable redirects. Trusted private destinations require explicit operator allowlists, never unrestricted API override. Trust forwarded client IP headers only from configured proxies. Restrict CORS, embedding and return origins. Redact secrets/PII from logs, define retention/export/deletion policies, encrypt backups and test restore plus hash-chain verification. Retention purge is privileged and auditable, outside public v1; append-only means no selective rewriting during retained lifetime. Certificates and hashes are evidence of recorded actions, not identity assurance or independent trusted timestamps.

## Migration from current endpoints

Current routes were read directly; README's metadata description mentions fields, but the actual GET document handler returns metadata and signing sessions, not fields. There is no current HTTP list endpoint.

| Current method/path | Migration |
| --- | --- |
| GET/POST `/api/auth/[...all]` | Keep Better Auth for UI/admin sessions; do not reinterpret it as scoped bearer v1 auth. |
| POST `/api/documents` | Create draft envelope, then upload PDF at `/v1/envelopes/{id}/documents`. |
| POST `/api/documents/html` | Same two steps with HTML; extracted fields need explicit recipient assignment before send. |
| GET `/api/documents/[id]` | GET envelope and its document/recipient/field collections. |
| PUT `/api/documents/[id]/fields` | Individual field create/update/delete in drafts; replacement UI uses a transactional internal service. |
| PUT `/api/documents/[id]/prefill` | PATCH draft fields with typed value and prefilled flag. |
| POST `/api/documents/[id]/send` | Create recipient then send; obtain embedded URL separately. Legacy permits repeated sent-document sessions; v1 send is draft-only. |
| GET `/api/documents/[id]/pdf` | Final output → final.pdf; source preview moves to protected signing/UI service (not a public v1 source download). |
| GET `/api/documents/[id]/html` | Protected HTML preview stays in UI service; signed evidence download becomes final.pdf. `print=1` is a UI feature. |
| POST `/api/sign/[token]` | Compatibility signer UI delegates to recipient-scoped action service; not bearer API. |
| GET `/api/sign/[token]/pdf` | Legacy capability handler during transition; new owner downloads use final.pdf. |
| POST `/api/webhooks/resend` | Retain verified inbound provider adapter; outbound `/v1/webhook-endpoints` is a separate facility. |

Create one default workspace per existing owner, with administrator membership; map service owner to that workspace. Preserve original IDs in explicit legacy mapping records. Existing `document` becomes one Envelope plus one Document: owner_id → workspace membership, status/title/timestamps → envelope, pdf/html_source/content_hash → document; signed_pdf/signed_html are preserved legacy artifacts, with actual final-byte hash computed if present. Verify old hash against stored bytes; report mismatch without replacing evidence. Missing hashes are backfilled with provenance, not presented as historical hashes.

Existing `field.document_id` points to the mapped Document. Preserve type/name/label/coordinates, values and prefilled flag; existing types exclude date. Assign historical fields to the actual completing recipient for completed envelopes. For uncompleted envelopes, draft the migration assignment for owner review; do not arbitrarily assume every historical invitation was an additional required signer.

Existing `signing_session` becomes legacy session evidence and candidate Recipient records (email/name, signed_at/IP/user-agent, link_clicked_at, expiry, creation). Multiple legacy sessions may be repeated invitations or different people; v1 must not infer routing or required actions from row count. For sent documents, keep legacy processing until resolved or explicitly void and recreate in v1. For completed documents preserve terminal status; mark extra outstanding sessions inactive and revoke all capabilities. Hash preserved active tokens during a controlled compatibility cutover; do not disclose or mint new tokens from them. Backfill one `envelope.imported` event containing a manifest of historical facts and known hashes, with migration time and `legacy` evidence version. It is a chain genesis, not fabricated historical signing events; exclude imported events from outbound subscriptions.

Roll out new tables/indexes first, verified backfill second, and shared business services third. Keep legacy routes as adapters under a feature flag; do not dual-write business logic independently. Before adapter use fix expiry checks on legacy owner HTML/PDF token paths (they currently check association only), and enforce terminal-state/routing restrictions consistently. Replace the shared environment API key with newly issued scoped workspace credentials; rotate/revoke it after client migration. Announce deprecation, provide examples and ≥180-day transition, then remove legacy document APIs after one supported release; auth and provider inbound routes remain. This design changes no runtime code.

## Phased implementation and acceptance criteria

1. **Contract and persistence:** review this draft, schema/migration constraints, mode/workspace indexes and membership bootstrap. Acceptance: OpenAPI lint has zero errors; migration dry run preserves every document/blob and reports ambiguous sessions and hash mismatches; rollback restores the original database.
2. **Authorization and draft API:** hashed scoped keys, workspace isolation, envelope/document/recipient/field CRUD, typed prefill, pagination, problem responses and persistent quotas. Acceptance: cross-workspace/mode and wrong-parent accesses fail; revoked/expired keys fail immediately; upload byte limits and cursor boundaries are tested; secrets appear only in creation responses.
3. **Workflow and embedded signing:** transactional lifecycle/routing, idempotency, capability exchange, isolated rendering and optional mail outbox. Acceptance: parallel and tied sequential orders work; concurrent sign/void/expiry yields one terminal result; tampered prefills/recipient fields fail; replay does not duplicate mail/actions; expired links cannot read or submit.
4. **Evidence:** canonical events, atomic sequence allocation, frozen final artifact and audit certificate. Acceptance: independent verifier recomputes every event/source/final hash; tampering is detected against retained checkpoint; renderer failure never marks completed; repeated downloads return identical bytes; no circular hash assertion.
5. **Webhooks:** transactional outbox, signed payloads, worker retries, SSRF defenses, delivery log/redelivery. Acceptance: receiver verifies raw-byte signature and timestamp; crash/retry preserves event identity; malicious DNS/redirect targets fail; exhausted delivery and manual redelivery are visible without changing envelope state.
6. **Migration and release:** compatibility adapters, documented bootstrap/rotation, SDK examples and deprecation telemetry. Acceptance: historical evidence remains identified as legacy; all listed legacy routes have a tested disposition; contract tests validate runtime against this specification; live/test boundaries and no-email embedding pass end-to-end. V1.1 then introduces opt-in PAdES/RFC 3161 with separate evidence verification criteria.

## Contract references

The draft uses the [OpenAPI 3.1 specification](https://spec.openapis.org/oas/v3.1.0.html), including its top-level webhooks object. Operational values above are proposed Puumerkki defaults, not requirements of those standards.
