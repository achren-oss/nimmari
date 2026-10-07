# Puumerkki v1.0.0

Puumerkki is a self-hosted, headless e-signature service. Upload a PDF or an HTML form, place or define fields, and send a signing link. Your documents stay on infrastructure you control. There is no hosted service.

## Highlights
- **PDF and HTML form modes.** HTML forms use `data-pm-field` attributes and are rendered to PDF with Chromium.
- **Signer links** without signer accounts, with a 30-day expiry.
- **Audit footer** with signing metadata and a SHA-256 content hash.
- **Service-account API** using a bearer key.
- **Self-hosting:** Docker image `ghcr.io/puumerkki/puumerkki:1.0.0`, a Render blueprint (Render + Turso, both with free tiers) and a Vercel + Turso guide.

## Signature level
v1.0.0 produces eIDAS **Simple Electronic Signatures (SES)** only. PAdES and trusted timestamps are planned for v1.1. This is not legal advice; check suitability for your jurisdiction and document type.

## Performance note
On Render's free plan (0.1 CPU), signing including the PDF render takes about 10 s, and the first request after the service sleeps can take about 30 s. That is fine for evaluation; use the cheapest paid instance for regular use. See [docs/benchmarks/render-free-2026-10-07.md](benchmarks/render-free-2026-10-07.md).

## Upgrading
This is the first release. Migrations run automatically when the container starts.

## Reporting vulnerabilities
Use GitHub private vulnerability reporting. See [SECURITY.md](../SECURITY.md).

Full list of changes: [CHANGELOG.md](../CHANGELOG.md). License: AGPL-3.0-only, © 2026 Big Blue Games Oy.
