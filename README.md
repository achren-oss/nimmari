# Puumerkki

Self-hosted headless e-signatures. Your documents never leave your server.

Puumerkki is Finnish for “your John Hancock”. Upload a PDF or an HTML form, prepare its fields, and send a signing link. Run it on infrastructure you control, with a web UI and HTTP endpoints for integrations. Puumerkki is self-host only; there is no hosted offering.

Documents are stored in your configured database. Optional Resend email sends signing links and completion notifications through an external provider; a remote libSQL database stores documents on that database host.

## Features

- PDF field placement for text, multi-line text, checkboxes, and signatures.
- HTML form mode using `data-pm-field`, including multi-line `<textarea>` fields.
- Signer links with a 30-day expiry and no signer account requirement.
- Audit footer with signing metadata and a SHA-256 content hash.
- Optional Resend email and signed click-event webhooks.
- Service-account API key for supported document endpoints.

## Quick start

Use Node.js 20.19+ (or a newer supported Node version) and npm.

```sh
npm ci
cp .env.example .env.local
# Set BETTER_AUTH_SECRET to a strong random value in .env.local.
# For HTML PDF rendering, set PUPPETEER_EXECUTABLE_PATH to your browser binary.
npx drizzle-kit push
npm run dev
```

Open http://localhost:3000 and create an account. The Drizzle config defaults to `file:./local.db`; when using a remote database, export `DATABASE_URL` and `DATABASE_AUTH_TOKEN` into the shell before running Drizzle. Next.js loads `.env.local` for the application.

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
| `PUUMERKKI_API_KEY` | Optional shared service-account bearer key |
| `PUUMERKKI_API_OWNER_ID` | Existing user ID that owns service-account documents |
| `SERVICE_USER_EMAIL` | Email for the service-user creation script |
| `SERVICE_USER_NAME` | Name for that script; `Service Account` |
| `RESEND_API_KEY` | Optional email API key |
| `RESEND_FROM` | Verified sender identity for optional email |
| `RESEND_WEBHOOK_SECRET` | Signing secret for Resend webhook verification |
| `PUPPETEER_EXECUTABLE_PATH` | System Chrome/Chromium executable; macOS Chrome fallback |
| `VERCEL` | Platform-managed flag selecting serverless Chromium; unset locally |
| `AWS_LAMBDA_FUNCTION_NAME` | Platform-managed flag selecting serverless Chromium; unset locally |
| `HOST` | Smoke test origin; `http://localhost:3000` |

Create a service user after applying the schema:

```sh
node --env-file=.env.local scripts/create-service-user.mjs service@example.com "Service Account"
```

The script prints `PUUMERKKI_API_OWNER_ID=...`, including when the email already exists. Add that ID and a strong random `PUUMERKKI_API_KEY` to your configuration and restart the app. CLI email/name override the script environment defaults.

## Self-hosting

Puumerkki is self-host only. Pick one:

- **Render + Turso (recommended):** Docker image with Chromium on Render, database on Turso. Both have free tiers. See [docs/deploy-render.md](docs/deploy-render.md) and `render.yaml`.
- **Vercel + Turso:** serverless, uses `@sparticuz/chromium-min`. The free Hobby plan is for non-commercial use only. See [docs/deploy-vercel.md](docs/deploy-vercel.md).
- **Any Docker host:** `docker build -t puumerkki .` then
  `docker run -p 3000:3000 -v puumerkki-data:/data -e BETTER_AUTH_SECRET=... -e BETTER_AUTH_URL=https://your.host -e APP_URL=https://your.host puumerkki`.
  Without `DATABASE_URL` the image uses a SQLite file at `/data/puumerkki.db` (mount a volume). Migrations run on start; `/api/health` reports status.

Documents and signed outputs are stored in the database; back it up and test restores. You are the data controller for your instance.

## Current API

“Owner” below means an authenticated browser session or `Authorization: Bearer <PUUMERKKI_API_KEY>`, with document ownership enforced. Field placement and prefill currently accept browser sessions only. An invalid bearer key is rejected on routes using service-account authentication.

| Method | Endpoint | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | None | Liveness and database check; `{"status":"ok"}` or 503 |
| GET, POST | `/api/auth/[...all]` | Better Auth route-specific | Signup, login, logout, session and other Better Auth handlers |
| POST | `/api/documents` | Owner | Upload multipart `pdf` and optional `title`; returns document ID (4 MB limit) |
| POST | `/api/documents/html` | Owner | Upload multipart `html` file or string and optional `title`; extracts fields (2 MB limit) |
| GET | `/api/documents/[id]` | Owner | Read document metadata, fields, and signing sessions |
| PUT | `/api/documents/[id]/fields` | Owner browser session | Replace draft PDF fields with JSON `{fields: [...]}` |
| PUT | `/api/documents/[id]/prefill` | Owner browser session | Set or clear draft field values with JSON `{values: {...}}` |
| POST | `/api/documents/[id]/send` | Owner | Create a signing session; JSON `email`, optional `name` and `senderName`; returns `url`, `emailSent`, and optional `emailNote` |
| GET | `/api/documents/[id]/pdf` | Owner or matching `?t=` signing token | Read original PDF, or signed PDF with `signed=1` |
| GET | `/api/documents/[id]/html` | Owner or matching `?t=` signing token | Read HTML; `signed=1` for signed output, `print=1` for browser printing |
| POST | `/api/sign/[token]` | Unexpired signing token | Submit JSON `values` and optional `signaturePng` data URL; complete signing |
| GET | `/api/sign/[token]/pdf` | Unexpired signing token | Download completed signed PDF |
| POST | `/api/webhooks/resend` | Verified Svix-style signature | Record Resend signing-link click events |

The owner document HTML/PDF routes check token association but currently do not check token expiry; the signing submission and signer PDF endpoints do. Treat signing URLs as secrets. There is currently no document-list HTTP endpoint, webhook subscription API, or versioned API contract.

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

Inputs and textareas are text fields; `<textarea>` preserves line breaks in signed output. Checkbox inputs are checkbox fields. For radio groups, put `data-pm-field` on a fieldset containing radio inputs with a shared `name` and distinct `value` attributes. Native date inputs remain text values in the API.

HTML is sanitized, scripts are removed, and external resources are blocked during PDF rendering. Embed images and fonts as data URLs and include layout CSS in the form itself.

To run the end-to-end smoke script against a running app with Chromium configured:

```sh
bash scripts/smoke.sh
```

It requires Bash, curl, Python 3, and standard shell utilities. It creates a test account and document in the target database; temporary files are cleaned up, database records are retained.

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
