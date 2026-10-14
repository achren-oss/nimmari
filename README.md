# Puumerkki

[![CI](https://github.com/puumerkki/puumerkki/actions/workflows/ci.yml/badge.svg)](https://github.com/puumerkki/puumerkki/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Image: ghcr.io/puumerkki/puumerkki](https://img.shields.io/badge/image-ghcr.io%2Fpuumerkki%2Fpuumerkki-2496ED?logo=docker&logoColor=white)](https://github.com/puumerkki/puumerkki/pkgs/container/puumerkki)

> **Signatures:** Puumerkki produces eIDAS *Simple* Electronic Signatures (SES) only, not AdES/QES. See [Legal disclaimer](#legal-disclaimer).

Self-hosted headless e-signatures. Your documents never leave your server.

Puumerkki is Finnish for “your John Hancock”. Upload a PDF or an HTML form, prepare its fields, and send a signing link. Run it on infrastructure you control, with a web UI and HTTP endpoints for integrations. Puumerkki is self-host only; there is no hosted offering.

Documents are stored in your configured database. Optional Resend email sends signing links and completion notifications through an external provider; a remote libSQL database stores documents on that database host.

## Features

- PDF field placement for text, multi-line text, checkboxes, dates, personal identity text, and signatures; optional AcroForm import.
- HTML form mode using `data-pm-field`, including multi-line `<textarea>` fields.
- Signer links with a 30-day expiry and no signer account requirement.
- Combined audit seals with signing metadata, timezone controls, and a SHA-256 content hash.
- Parallel or sequential signer slots, including several roles with the same email.
- Private signing views, merge prefill, required-field validation, cancellation, and decline.
- Optional Resend email, notification controls, signed click-event webhooks, and outbound lifecycle webhooks.
- Scoped, hashed API keys and admin account provisioning.

## Quick start

Use Node.js 20.19+ (or a newer supported Node version) and npm.

```sh
npm ci
cp .env.example .env.local
# Set BETTER_AUTH_SECRET to a strong random value in .env.local.
# For HTML PDF rendering, set PUPPETEER_EXECUTABLE_PATH to your browser binary.
node --env-file=.env.local scripts/migrate.mjs
npm run dev
```

Provision an account through the admin API as described below, then log in at http://localhost:3000. The migration script reads `.env.local` and defaults to `file:./local.db`; set `DATABASE_URL` and `DATABASE_AUTH_TOKEN` there for a remote database. Next.js also loads `.env.local` for the application. `npm run db:push` is development-only; use migrations for deployments.

Install Chrome/Chromium for HTML-form PDF rendering and set `PUPPETEER_EXECUTABLE_PATH` to its executable. On Vercel, `@sparticuz/chromium-min` is used, with a pinned Chromium pack downloaded at runtime. PDF uploads use pdf-lib directly.

## Configuration

See [.env.example](.env.example). Empty optional values disable the corresponding integration.

| Variable | Purpose / local default |
| --- | --- |
| `DATABASE_URL` | SQLite file or libSQL URL; `file:./local.db` |
| `DATABASE_AUTH_TOKEN` | Remote database token; optional for local files |
| `BETTER_AUTH_SECRET` | Strong random authentication secret; set before startup |
| `BETTER_AUTH_URL` | Authentication origin; `http://localhost:3000` |
| `APP_URL` | Public origin for signing links; `http://localhost:3000` |
| `PUUMERKKI_API_KEY` | Optional root/admin bearer secret for bootstrap |
| `PUUMERKKI_API_OWNER_ID` | Optional existing user ID for root document requests |
| `SERVICE_USER_EMAIL` | Email for the service-user creation script |
| `SERVICE_USER_NAME` | Name for that script; `Service Account` |
| `PUUMERKKI_AUDIT_TIMEZONE` | Default IANA timezone for audit seals (`Europe/Helsinki`) |
| `PUUMERKKI_WEBHOOK_SECRET` | Optional HMAC-SHA256 secret for outbound document webhooks |
| `RESEND_API_KEY` | Optional email API key |
| `RESEND_FROM` | Verified sender identity for optional email |
| `RESEND_WEBHOOK_SECRET` | Signing secret for Resend webhook verification |
| `PUPPETEER_EXECUTABLE_PATH` | System Chrome/Chromium executable; macOS Chrome fallback |
| `VERCEL` | Platform-managed flag selecting serverless Chromium; unset locally |
| `AWS_LAMBDA_FUNCTION_NAME` | Platform-managed flag selecting serverless Chromium; unset locally |
| `HOST` | Smoke test origin; `http://localhost:3000` |

## Self-hosting

Public signup and implicit provider account creation are disabled. Existing accounts can log in with email/password; signers need no account. Administrators provision accounts through the API. Run `node --env-file=.env.local scripts/migrate.mjs` before deploying new code; Docker runs migrations at startup.

Puumerkki is self-host only. Pick one:

- **Render + Turso (recommended):** Docker image with Chromium on Render, database on Turso. Both have free tiers. See [docs/deploy-render.md](docs/deploy-render.md) and `render.yaml`.
- **Vercel + Turso:** serverless, uses `@sparticuz/chromium-min`. The free Hobby plan is for non-commercial use only. See [docs/deploy-vercel.md](docs/deploy-vercel.md).
- **Any Docker host:** use the prebuilt image `ghcr.io/puumerkki/puumerkki:1.0.0` (published from `v*` tags), or `docker build -t puumerkki .`, then
  `docker run -p 3000:3000 -v puumerkki-data:/data -e BETTER_AUTH_SECRET=... -e BETTER_AUTH_URL=https://your.host -e APP_URL=https://your.host puumerkki`.
  Without `DATABASE_URL` the image uses a SQLite file at `/data/puumerkki.db` (mount a volume). Migrations run on start; `/api/health` reports status.

Documents and signed outputs are stored in the database; back it up and test restores. You are the data controller for your instance.

## Create an API key for an AI agent

Configure a strong root secret as the server's `PUUMERKKI_API_KEY` (for example, generate one with `openssl rand -hex 32` in a private terminal). Restart the app after updating its secret configuration. Keep this key for administration.

1. Authenticate with the root bearer key and call `POST /api/accounts` with `{email,name,password?}`. The response contains `{id,email,name}`; omitting `password` generates one returned only in this response. Existing email/password login remains available.
2. Call `POST /api/keys` with `{name:"Document agent",ownerUserId:"<account id>",scope:"regular"}`. Store the returned `key` securely and give the agent this regular key through its environment or secret manager. Only its SHA-256 hash and display prefix are stored.
3. List metadata with `GET /api/keys`. Rotate by creating a replacement, updating the client secret, verifying it works, then revoking its predecessor with `DELETE /api/keys/{id}` or `POST /api/keys/{id}/revoke`.

Root/admin keys can provision accounts and manage keys for any owner. Regular keys can create only regular keys for their own owner and list/revoke that owner's keys. All database keys, including admin keys, access only their owner's documents. Account/key endpoints reject browser sessions. Root can bootstrap without `PUUMERKKI_API_OWNER_ID`; set that variable to an existing user ID only if root should also access that owner's documents. Missing, malformed, unknown or revoked bearer keys never fall back to cookies.

See the [account/key API reference](skills/puumerkki/reference/api-cheatsheet.md#accounts-and-api-keys) for request limits and responses. Generated passwords and plaintext keys are returned once; never log them.

To verify without uploading a document or printing the key, load the client key securely into the environment, set `PUUMERKKI_BASE_URL`, and run in Bash with tracing disabled:

```bash
set +x
printf 'Authorization: Bearer %s\n' "$PUUMERKKI_API_KEY" | \
  curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' \
  --request POST --header @- --form notify=false "$PUUMERKKI_BASE_URL/api/documents"
```

HTTP 400 means authentication passed and the required PDF was omitted; HTTP 401 means the key or owner configuration is missing or incorrect. Do not use curl verbose/trace options or log the key.

### Account administration

`GET /api/accounts` requires an admin or root key and returns
`{accounts:[{id,email,name,createdAt,disabled}]}` sorted by creation time (oldest
first). `?email=...` filters by exact email after trimming and lowercasing.
Timestamps are ISO strings. `disabled` means `user.disabled_at` is non-null;
disabled accounts cannot log in and their existing server sessions are ignored.

`DELETE /api/accounts/{id}` requires an admin or root key. Unknown IDs return
404. The configured `PUUMERKKI_API_OWNER_ID`, the caller's own key owner, and
accounts owning any documents return 409 with `{error}`. Documents are never
deleted. Success returns `{ok:true,id}` after one transaction revokes the owner's
keys, deletes sessions and credentials, and deletes the user. Revoked key rows
then cascade with the user. Missing/invalid keys return 401; regular keys and
session authentication return 403 for both operations.

Apply `drizzle/0006_account_disabled.sql` before deploying with
`node --env-file=.env.local scripts/migrate.mjs`. The migration is registered in
the Drizzle journal and runs once. This adds no public account-disable endpoint.

## Use with an AI agent

Copy the entire `skills/puumerkki` folder into your agent's skills directory, such as `.claude/skills`, `.cursor/skills`, or `~/.codex/skills`. Alternatively, point the agent directly at [SKILL.md](skills/puumerkki/SKILL.md). Install the Python helper dependencies from the repository:

```sh
python3 -m pip install -r skills/puumerkki/requirements.txt
```

Optional Poppler (`poppler-utils` on Debian/Ubuntu) provides the tools used by `render_check.sh`. Set `PUUMERKKI_BASE_URL` to your instance URL and provide `PUUMERKKI_API_KEY` through the agent's environment or secret manager, using a provisioned regular database key.

Example first prompt:

> Use the Puumerkki skill to prepare this PDF for signing. Ask me who signs, how many signers there are, which line belongs to each person, and which blanks they should fill. Verify field placement before sending, then return the signing links privately in chat without emailing them. Do not fill or sign for anyone.

## Current API

AI agents using this API must follow [AGENTS.md](AGENTS.md): ask who signs which line before creating fields, one signing session per signer, never sign or fill on the user's behalf.

“Owner” below means an authenticated browser session or `Authorization: Bearer <PUUMERKKI_API_KEY>`, with document ownership enforced. Field placement and prefill accept either. An invalid bearer key is rejected on routes using service-account authentication.

| Method | Endpoint | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | None | Liveness and database check; `{"status":"ok"}` or 503 |
| GET, POST | `/api/auth/[...all]` | Better Auth route-specific | Login, logout, session and other Better Auth handlers; signup disabled |
| GET | `/api/accounts` | Admin/root bearer | List accounts; optional exact normalized `email` filter |
| DELETE | `/api/accounts/{id}` | Admin/root bearer | Delete an account without documents; configured owner and self are protected |
| POST | `/api/accounts` | Admin/root bearer | Provision account with `{email,name,password?}` |
| GET, POST | `/api/keys` | Bearer key | List key metadata or create a scoped key |
| DELETE | `/api/keys/[id]` | Bearer key | Revoke a key |
| POST | `/api/keys/[id]/revoke` | Bearer key | Revoke a key (POST alias) |
| POST | `/api/documents` | Owner | Upload multipart `pdf`, optional `title`, `importAcroForm`, `notify`, `webhookUrl`, `auditTimezone`; returns document ID (4 MB limit) |
| POST | `/api/documents/html` | Owner | Upload multipart `html` file or string and optional `title`; extracts fields (2 MB limit) |
| GET | `/api/documents/[id]` | Owner | Read document metadata, fields, and signing sessions |
| PUT | `/api/documents/[id]/fields` | Owner | Replace draft PDF fields with JSON `{fields: [...]}` |
| PUT | `/api/documents/[id]/prefill` | Owner | Merge draft field values with JSON `{values: {...}}`; `clear:true` or `mode:"replace"` clears omitted keys |
| POST | `/api/documents/[id]/send` | Owner | Create one session per signer slot; JSON `email` or `signers:[{email,name,key,order}]`, optional `senderName` and `notify` (default `true`); returns `url`, `signingSessionId`, `expiresAt`, `emailSent`, and optional `emailNote`. With `notify: false` no email is sent and you deliver `url` yourself |
| GET | `/api/documents/[id]/pdf` | Owner or matching `?t=` signing token | Read original PDF, or signed PDF with `signed=1` |
| GET | `/api/documents/[id]/html` | Owner or matching `?t=` signing token | Read HTML; `signed=1` for signed output, `print=1` for browser printing |
| GET | `/api/sign/[token]` | Unexpired signing token | Read signer slot and permitted fields |
| POST | `/api/documents/[id]/cancel` | Owner | Cancel a draft or sent document; optional `{reason}` |
| POST | `/api/sign/[token]/decline` | Unexpired unsigned signing token | Decline for all signers; optional `{reason}` |
| POST | `/api/sign/[token]` | Unexpired signing token | Submit JSON `values` and `signaturePng` (PNG data URL or null); record this signer slot |
| GET | `/api/sign/[token]/pdf` | Unexpired signing token | Download signed copy for an already-signed slot |
| POST | `/api/webhooks/resend` | Verified Svix-style signature | Record Resend signing-link click events |

Link-only delivery, for example a bot that returns the signing link in a chat instead of emailing it:

```bash
curl -X POST "$APP_URL/api/documents/$DOC_ID/send" \
  -H "Authorization: Bearer $PUUMERKKI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"signer@example.com","name":"Signer Name","notify":false}'
# {"url":"https://.../sign/<token>","signingSessionId":"ss_...","expiresAt":"...","emailSent":false,...}
```

The recipient email is still recorded on the signing session and in the audit trail. The URL works for 30 days; treat it as a secret.

All signing-token routes check expiry. Cancel/decline invalidate outstanding links; previously signed slots retain read-only PDF access until expiry. There is no document-list endpoint, webhook subscription API, or implemented versioned API.

The [portable Puumerkki agent skill](skills/puumerkki/README.md) includes a full workflow, [API reference](skills/puumerkki/reference/api-cheatsheet.md), and helpers. Clients use `PUUMERKKI_BASE_URL` and a provisioned regular key in `PUUMERKKI_API_KEY`. The implemented contract is [openapi/current.yaml](openapi/current.yaml); [openapi/v1.yaml](openapi/v1.yaml) remains the future design.

PDF uploads support `importAcroForm="true"` to extract native field rectangles; inspect the returned count, warnings, and errors. Both upload routes accept `webhookUrl`, `notify="false"`, and `auditTimezone`. For fully silent operation, disable notify at upload and send. Send-time `notify:false` disables invitations and sequential follow-ups only; signed notices follow the document setting.

Assign multi-signer signature fields to `assignedSignerKey` matching each signer's unique `key`, or to `assignedToSignerEmail`. Keys take precedence. The same email may sign in multiple roles using distinct keys. Omit `order` for parallel signing; set zero-based orders for sequential groups. Signers cannot be added after signing starts. Draft fields include `date` (normalized date text) and `hetu` (unvalidated personal identity text). Required fields are marked and all missing fields are reported together.

Later PDF signers see accumulated values and signatures with other signers' private values excluded from the PDF text layer. Completed PDFs show **all values to all parties**, including private fields. Signed artifacts rebuild from the original source under a write transaction and use one combined audit seal, adding a dedicated seal page when necessary. Seal timestamps use upload `auditTimezone`, then `PUUMERKKI_AUDIT_TIMEZONE`, then `Europe/Helsinki`. Completion, cancellation, and decline emit best-effort webhooks; `PUUMERKKI_WEBHOOK_SECRET` enables HMAC-SHA256 signatures.

## HTML form authoring

Start from [the sample Consulting Agreement](scripts/fixtures/sample-form.html). Use unique field names:

```html
<input data-pm-field="client_name" data-pm-label="Client name" data-pm-required>
<textarea rows="5" data-pm-field="scope" data-pm-label="Scope of services"></textarea>
<div class="pm-signature" data-pm-field="signature"
     data-pm-label="Client signature" data-pm-type="signature"
     data-pm-required>Sign here</div>
```

`data-pm-field` identifies the key in submitted or prefilled `values`. `data-pm-label` supplies a human-readable label and falls back to the field name. The presence of `data-pm-required` marks a field required, even if its value is `"false"`; omit it for optional fields. `data-pm-type="signature"` explicitly identifies a signature slot; use the `pm-signature` class for the clickable signing placeholder. Give the slot a visible height in CSS.

Inputs and textareas are text fields; `<textarea>` preserves line breaks in signed output. Checkbox inputs are checkbox fields. For radio groups, put `data-pm-field` on a fieldset containing radio inputs with a shared `name` and distinct `value` attributes. Native date inputs extract as `date` fields. Use `data-pm-type="hetu"` for unvalidated personal identity text. `data-pm-signer-key` (alias `data-pm-role`) assigns a signer slot, `data-pm-signer` assigns by email, and `data-pm-private` hides values from other signers during signing.

HTML is sanitized, scripts are removed, and external resources are blocked during PDF rendering. Embed images and fonts as data URLs and include layout CSS in the form itself.

To run the end-to-end smoke script against a running app with Chromium configured:

```sh
bash scripts/smoke.sh
```

It requires Bash, curl, Python 3, standard shell utilities, and the root key in `PUUMERKKI_API_KEY` for disposable account provisioning. It creates a test account and document in the target database; temporary files are cleaned up, database records are retained.

## Legal disclaimer

Puumerkki produces eIDAS Simple Electronic Signatures only, not Advanced or Qualified Electronic Signatures. This project does not provide legal advice. Suitability depends on the jurisdiction and document type. It is provided without warranty under AGPL-3.0.

## Roadmap

These are planned ideas, not current capabilities:

- Headless API v1: workspaces, API keys, an envelope/signer/field model, immutable event log, webhooks, OpenAPI, and a TypeScript SDK.
- docker-compose for local use and S3-compatible storage.
- v1.1: PAdES certificate-signed PDFs and RFC 3161 timestamps.
- Optional “Sign in with AgentID” OIDC integration idea.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), including the [Developer Certificate of Origin](https://developercertificate.org/) and commit sign-off requirement. Contributions and discussion should be in English.

## Security

See [SECURITY.md](SECURITY.md) for private vulnerability reporting and deployment responsibilities.

## License

[AGPL-3.0-only](LICENSE).

## License

Copyright (C) 2026 Big Blue Games Oy.

Puumerkki is licensed under the GNU Affero General Public License v3.0 only. See [LICENSE](LICENSE).
