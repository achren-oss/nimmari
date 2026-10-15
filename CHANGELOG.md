# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Docs

- Record the 15 October 2026 real Render + Turso end-to-end run, signing and cold-start timings, successful verification and teardown; clarify deployment and wake-up expectations.
- Restore agent deployment with Render + Turso API keys as the default, with one-message credential instructions and one-time setup claim instead of a hosted root key. Keep the Deploy button as the no-provider-keys alternative and preserve explicit local setup.

## [1.3.1] - 2026-10-15

### Fixed

- Non-signature fields are optional by default; signatures are always enforced server-side.
- Editing unsigned sent documents persists field changes while preserving metadata.
- The field editor shows save errors and warns before discarding unsaved changes.

## [1.3.0] - 2026-10-15

### Added

- One-time, rate-limited setup claim creates the first account and admin/regular API keys atomically.
- Deploy to Render button and prebuilt-image Blueprint with agent setup runbook.

### Changed

- Public and authentication URLs fall back to Render's automatic service URL.
- Make the Deploy to Render button the default agent installation with the pinned 1.3.0 image; retain alternative provider API provisioning, explicit local Docker setup, and silent synthetic verification.

### Fixed

- Retry Chromium profile directory cleanup after disconnect and catch cleanup errors to prevent unhandled rejections while Chromium exits.

## [1.2.0] - 2026-10-14

- Rename the app, repository, and Docker image to Nimmari (formerly Puumerkki).
- Introduce `NIMMARI_*` configuration with deprecated `PUUMERKKI_*` fallback aliases.
- Move the portable skill to `skills/nimmari` and rename its flow script to `nimmari_flow.py`.
- Preserve existing keys, stored identifiers, and databases. Docker reuses the legacy database on existing volumes; new installs use `/data/nimmari.db`.
- Upgrade: change the image to `ghcr.io/achren-oss/nimmari:1.3.0`, retain the existing volume, and update installed skill paths. Existing environment variables continue to work. See [upgrade guide](docs/release-notes-v1.2.0.md).


### Added
- Self-contained AI-agent installation runbook covering Docker setup, private secret handling, account and regular-key provisioning, skill installation, and a silent synthetic signing-link smoke test.

## [1.1.1] - 2026-10-14

- Fix remote libSQL rate-limit counters with direct client execution, numeric row conversion, and atomic UPDATE-then-INSERT with at most three attempts. Fail open with redacted diagnostics; optional `PUUMERKKI_RATE_LIMIT_DEBUG=1` adds signing GET count and eight-hex IP bucket fingerprint headers without raw IPs.

### Fixed
- Share signer, bearer-failure, and Better Auth login/sign-up rate limits across instances via the database. Use atomic fixed-window signer/bearer counters with hashed keys, fail-open database checks, and Vercel-aware client IP resolution. Run migrations before upgrading (`0007_rate_limits.sql`).
- Show signed-copy and sender notification messages on the post-signing done page only when their email sends succeed. Missing email configuration, disabled notifications, and provider errors show neutral confirmation.
- Respect the signing session email preference for signed-copy emails while preserving document-controlled sender notices.

## [1.1.0] - 2026-10-14

### Added
- Security response headers and sliding-window signer and bearer-failure rate limits, with route authentication coverage tests.
- Admin/root account listing and safe deletion with owner/document protection and transactional credential cleanup. Apply journaled `0006_account_disabled.sql` before deployment.
- Admin account provisioning and scoped, hashed API keys with metadata listing, revocation, and best-effort usage tracking.
- Idempotent `0005_api_keys.sql` registered in the migration journal, authentication tests, and bootstrap documentation.
- AcroForm field import, date fields, unvalidated personal identity (`hetu`) fields, and signer-slot keys supporting multiple roles with the same email.
- Multi-signer parallel/sequential routing, deferred invitations, private viewer PDFs, document notification controls, and completion/cancel/decline webhooks.
- Per-document audit timezone and combined seals with a dedicated seal page when needed.
- Owner cancellation, signer decline, and the portable `skills/puumerkki` agent workflow and helper scripts.
- Four journaled additive migrations after `0000_init`, plus fresh-install and v1.0.0-upgrade tests.
- Production regression tests and a separate OpenAPI contract for the implemented API.

### Changed
- Disabled accounts cannot log in; existing server sessions are ignored.
- Disable public signup and implicit provider account creation; preserve password login and signer links.
- Treat `PUUMERKKI_API_KEY` as root/admin, allowing account/key bootstrap without a document owner. Database keys remain scoped to their owner's documents.
- Prefill accepts owner bearer authentication and merges by default, with explicit replace/clear modes.
- Required-field indicators and all-missing validation, responsive signer pages, and PDF text wrapping/shrinking preserve entered values.
- Signed artifacts rebuild from original source with all signer slots and a single audit seal; completed PDFs expose all values to all parties.
- Pin PDF.js to the react-pdf worker version and update Next.js to 16.3.8.

### Fixed
- Signature sizing and placement preserve signature aspect ratio within assigned field bounds.
- Serve PDF downloads with Content-Length and SHA-256 integrity headers; withhold incomplete PDFs with HTTP 503 and Retry-After. The signed PDF helper verifies length, checksum, and trailer markers before saving and honors Retry-After.
- Serialize concurrent signing and stop transitions; reject adding signers after signing begins and unassigned multi-signer signature fields.
- Exclude private values from later signers' PDF text layers and enforce token expiry on document HTML/PDF downloads.

## [1.0.0] - Unreleased

First open-source release under AGPL-3.0-only.

### Added
- PDF mode: field placement for text, multi-line text, checkboxes and signatures.
- HTML form mode (`data-pm-field`), including multi-line `<textarea>` fields, rendered to PDF with Chromium.
- Signing links with a 30-day expiry; no signer account required.
- Audit footer with signing metadata and a SHA-256 content hash.
- Service-account API access with a bearer key (`PUUMERKKI_API_KEY`, `PUUMERKKI_API_OWNER_ID`).
- Optional Resend email delivery and a signed click-event webhook.
- `/api/health` liveness check and `/api/health/pdf` authenticated render self-check.
- Dockerfile, Render blueprint (`render.yaml`), and Render + Turso and Vercel + Turso guides.
- CI (typecheck, lint, tests, build, Docker build) and GHCR image publishing on `v*` tags.
- Headless API v1 design and OpenAPI 3.1 draft (design only; not implemented).
- Link-only signing sessions: `POST /api/documents/[id]/send` accepts `notify: false` to skip the email and return the signing URL (plus `signingSessionId` and `expiresAt`) for the caller to deliver.
- `PUT /api/documents/[id]/fields` accepts the service-account bearer key as well as a browser session.
- `AGENTS.md`: guidance for AI agents using the API (confirm signers and signature-line ownership before placing fields; one session per signer, whose signature fills every signature field; link-only delivery; never sign or fill for the user) and the photo-to-link flow.

### Security
- Hardened authorization and input validation on document and signing routes.
- Owner PDF/HTML download links reject expired signing tokens (HTTP 410).
- HTML is sanitized; scripts and external resources are blocked during PDF rendering.

### Fixed
- Chromium launch on hosts without a usable HOME (crash reporting disabled, per-launch temp profile).
- `emailSent` is now `false` (with the provider's message in `emailNote`) when Resend rejects a send; the SDK returns errors instead of throwing.

### Notes
- Signatures are eIDAS Simple Electronic Signatures (SES). PAdES and trusted timestamps remain future work.

[1.0.0]: https://github.com/achren-oss/nimmari/releases/tag/v1.0.0

[1.1.0]: https://github.com/achren-oss/nimmari/releases/tag/v1.1.0

[1.1.1]: https://github.com/achren-oss/nimmari/releases/tag/v1.1.1

[1.2.0]: https://github.com/achren-oss/nimmari/releases/tag/v1.2.0
