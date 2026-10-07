# Puumerkki open-source plan

## Decisions (7.10.2026)
- License: AGPL-3.0-only. Copyright: Big Blue Games Oy.
- Repo: puumerkki/puumerkki, clean history. Self-host only, no hosted service.
- Contributions: DCO (`git commit -s`). Contact: GitHub private vulnerability reporting, no email.
- Signatures: v1 is an eIDAS Simple Electronic Signature (disclaimer). PAdES + RFC 3161 timestamp in v1.1.
- HTML form mode included in v1.
- Project site: puumerkki.joakimachren.com. Maintainer's private instance moves to esign.joakimachren.com.

## Hosting
- **Primary (recommended for users, used in tutorial videos): Render + Turso.** Both have free tiers. Render runs the Docker image (Chromium included); Turso is the database. Free Render instances sleep when idle (first request is slow).
- **Alternative: Vercel + Turso.** Free Hobby plan (non-commercial use). Uses serverless Chromium.
- Users may deploy anywhere that runs Docker.

## Phases
1. Security fixes (done).
2. Repo hygiene and clean public repo (done, private until launch).
3. Headless API v1: workspaces, scoped API keys, envelopes/recipients/fields, append-only event log, webhooks, OpenAPI 3.1, TypeScript SDK, tests.
4. Self-hosting: Dockerfile, render.yaml (Render + Turso), Vercel guide, docker-compose for local use.
5. v1.1: PAdES + timestamp.
6. Docs + landing page, tutorial videos (Render + Turso).
7. CI + releases.
8. Launch.
