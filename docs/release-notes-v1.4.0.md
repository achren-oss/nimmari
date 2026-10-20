# Nimmari 1.4.0 — 20 October 2026

Upgrade to `ghcr.io/achren-oss/nimmari:1.4.0`, retaining the existing database volume and secrets. Docker automatically applies journaled migration `0009_delivery_recovery.sql`. Vercel and native deployments must run `npm run db:migrate` before starting the new release. Migration is additive: existing pmk_ keys, signing tokens, documents and accounts continue working. Back up your database before upgrading.

The new tables are `send_idempotency` and `webhook_delivery`. The Drizzle snapshot includes the current schema. Send responses include secret URLs; protect database backups accordingly. Responses replay for 24 hours; expired rows are replaced lazily on key reuse. Always retain and reuse the same send key/body after a timeout.

Reissue rotates existing unsigned signer links rather than exposing stored tokens. It resets expiry to 30 days and invalidates old links. Resend rotates and optionally emails existing active slots, without creating signers. Waiting sequential slots and signed/terminal slots cannot be reissued.

Webhook events now enqueue inside the lifecycle transaction and persist across restarts. Six attempts use exponential backoff and jitter. Delivery remains at-least-once; deduplicate on `X-Nimmari-Delivery-Id`. HMAC uses the unchanged `X-Puumerkki-Signature` raw-body SHA-256 contract. History shows aggregate attempts and last failure; manual redelivery resets the budget.

`NIMMARI_WEBHOOK_WORKER=1` enables the standalone 15-second interval, on by default in Docker. Set `0` to disable. On Vercel/serverless, configure an external cron to POST `/api/webhooks/deliveries/process` every minute with a private bearer key (regular keys process their owner; admin/root process all). Authenticated requests and health checks also process bounded batches. Cron is recommended for timely retries when traffic is absent.

New production webhook URLs require HTTPS; existing public HTTP URLs continue delivering. Redirects are refused. Existing private/local checks remain; `NIMMARI_WEBHOOK_ALLOW_PRIVATE=1` explicitly bypasses them for trusted networks or local testing, including HTTP. Keep this disabled for untrusted creators.

Run `scripts/e2e-smoke-v14.mjs` with `NIMMARI_BASE_URL` and `NIMMARI_BOT_API_KEY` against an explicitly authorized test instance. It creates synthetic persistent records and signs only synthetic data. An optional `WEBHOOK_RECEIVER_URL` targets your test receiver; local runs otherwise start a fail-once receiver on port 3334 and require the private-destination flag. A fresh local instance can instead use `NIMMARI_SETUP_CODE`. Never use real signer information.

Validation: Node 22 `npm ci`, TypeScript, ESLint, 254 Vitest tests across 42 files, five Python helper tests, and the production build passed. A fresh SQLite built-app smoke passed setup claim → upload → fields → prefill → idempotent send twice (one slot) → owner list → reissue (old token rejected) → synthetic signing → fail-once webhook receiver → two attempts/delivered → integrity-checked signed PDF. Docker was unavailable in the validation environment.
