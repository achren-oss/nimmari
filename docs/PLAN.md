# Puumerkki open-source plan

## Decisions (7.10.2026)
- License: AGPL-3.0-only. Copyright: Big Blue Games Oy.
- Repo: puumerkki/puumerkki, clean history. Self-host only, no hosted service.
- Contributions: DCO (`git commit -s`). Contact: GitHub private vulnerability reporting, no email.
- Signatures: v1 is an eIDAS Simple Electronic Signature (disclaimer). PAdES + RFC 3161 timestamp in v1.1.
- HTML form mode included in v1.
- Project site: puumerkki.joakimachren.com.

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

## Render free tier benchmark (7.10.2026)
Frankfurt, free plan (0.1 CPU / 512 MB), Turso EU West (Ireland), commit `03686db`, 5 runs:
- upload 0.3–1.5 s
- send 0.4–1.3 s
- sign including the Chromium PDF render 9.4–10.4 s (about 9.95 s on average)
- PDF fetch about 0.3 s, PDF size about 49 KB

For comparison, the same render takes 1.4 s locally and about 15 s at a 0.1-CPU limit. Cold start after 19 minutes idle: the first `/api/health` took 27.6 s, the next 0.4 s.

Chromium needed crash reporting disabled and a per-launch temp profile to launch on Render (crashpad fix).

**Decision:** free is fine for evaluation and the tutorial videos. For regular use, recommend the cheapest paid instance. Clients can pre-warm by calling `/api/health` when the UI opens. Full results: [benchmarks/render-free-2026-10-07.md](benchmarks/render-free-2026-10-07.md).
