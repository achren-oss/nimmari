# Puumerkki v1.1.1

Released 2026-10-14.

The post-signing done page now confirms that the signature was recorded and only claims a copy email or sender notification when the corresponding Resend send succeeds. Missing email configuration, disabled notifications, and provider failures no longer produce misleading inbox promises.

Signed-copy emails now respect both the document notification setting and the signing session email preference. Sender notices continue to follow the document setting. The redirect carries display-only send results; these flags do not authorize PDF access or prove delivery.

Signer and bearer-failure limits now use atomic database-backed fixed windows with hashed bucket keys, shared across serverless and multi-instance deployments. Database check failures are logged and allow signing to continue. Better Auth login/sign-up limits also use database storage. Client IP resolution prefers `X-Vercel-Forwarded-For`, then `X-Real-IP`, then the first `X-Forwarded-For` address; configure trusted proxies to overwrite these headers.

Remote libSQL counters use the client directly, convert returned numeric values, and retry competing inserts at most three times. Failed checks allow requests with redacted diagnostics.

For troubleshooting, set `PUUMERKKI_RATE_LIMIT_DEBUG=1` to add `X-RateLimit-Count` and an eight-character hexadecimal `X-RateLimit-IpKey` to signing GET responses, including HTTP 429 responses. The count is the rejecting bucket or the busiest successful bucket, and is omitted when a check fails. The IP key is a truncated SHA-256 fingerprint of the selected IP bucket; raw IP addresses are never included. Diagnostics are disabled by default; unset the variable or set it to `0` after troubleshooting.

## Upgrade

Install v1.1.1 or use `ghcr.io/achren-oss/puumerkki:1.1.1`. Before starting the updated application, run `node --env-file=.env.local scripts/migrate.mjs` to apply the journaled migrations, including idempotent `0007_rate_limits.sql` for both rate-limit tables. The Docker image runs migrations automatically before startup.
