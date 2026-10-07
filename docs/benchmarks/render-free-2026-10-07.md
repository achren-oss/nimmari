# Render free tier benchmark (7.10.2026)

## Setup
- Render web service, Docker runtime, region Frankfurt, free plan (0.1 CPU / 512 MB)
- Database: Turso, EU West (Ireland)
- Commit: `03686db`
- Script: [`scripts/bench.sh`](../../scripts/bench.sh), 5 runs

## Results

| Run | upload | send | sign (incl. Chromium PDF render) | PDF fetch | PDF size |
|---|---|---|---|---|---|
| 1 | 1.48 s | 1.28 s | 10.37 s | 0.48 s | 49,834 B |
| 2 | 0.31 s | 0.39 s | 9.42 s | 0.36 s | 49,441 B |
| 3 | 0.42 s | 0.40 s | 10.21 s | 0.26 s | 49,775 B |
| 4 | 0.33 s | 0.48 s | 9.84 s | 0.28 s | 49,919 B |
| 5 | 0.32 s | 0.38 s | 9.89 s | 0.27 s | 49,823 B |

Mean sign + render: **9.95 s**. All requests returned 200.

**Comparison:** the same render takes about 1.4 s locally and about 15 s in Docker limited to 0.1 CPU. The free tier is CPU-bound.

**Cold start:** after 19 minutes idle, the first `/api/health` took 27.6 s and the next took 0.4 s.

## Crashpad fix
On Render, Chromium first failed to launch with `chrome_crashpad_handler: --database is required`. Signing succeeded, but no PDF was stored, so the signed-PDF fetch returned 500. The fix (`03686db`) disables crash reporting and gives each launch its own temporary profile directory, also used as HOME and the XDG config/cache directories. `GET /api/health/pdf` (requires the service-account bearer key) renders a test page and reports the timing or the launch error.

## The bench script
`scripts/bench.sh` times a cold `/api/health` request, then runs N times (default 5): upload HTML → create signing session → sign (renders the PDF) → fetch the signed PDF and check it is a valid PDF.

```sh
BASE_URL=https://your-service.onrender.com PUUMERKKI_API_KEY=... RUNS=5 scripts/bench.sh
```

The server needs `PUUMERKKI_API_KEY` and `PUUMERKKI_API_OWNER_ID` set. Create the owner with `scripts/create-service-user.mjs`.

## Recommendation
The free plan is fine for evaluation and the tutorial videos. For regular use, choose the cheapest paid instance. Clients can pre-warm the service by calling `/api/health` when the UI opens.
