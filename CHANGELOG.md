# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

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
- Signatures are eIDAS Simple Electronic Signatures (SES). PAdES and trusted timestamps are planned for v1.1.

[1.0.0]: https://github.com/puumerkki/puumerkki/releases/tag/v1.0.0
