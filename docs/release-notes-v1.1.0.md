# Puumerkki v1.1.0

Released 2026-10-14.

This release adds administrator-provisioned accounts, scoped API keys, account listing and safe deletion, multi-signer workflows, improved signature sizing, and PDF integrity headers. Security headers and per-instance rate limits protect signing and bearer authentication. Signatures remain SES only; PAdES and trusted timestamps are not included.

## Upgrade

1. Back up the database and secrets and stop application writes.
2. Install v1.1.0 and run `node --env-file=.env.local scripts/migrate.mjs` against the deployment database before starting new code. Apply every journaled migration, including `0005_api_keys.sql` and `0006_account_disabled.sql`. Docker runs migrations at startup. Shell exports override `.env.local`; remove stale values first.
3. Configure a strong `PUUMERKKI_API_KEY` root secret. Existing accounts and password login continue to work. To bootstrap a new instance, use root authentication to `POST /api/accounts`, save the returned ID and password, then `POST /api/keys` with that owner ID and `scope: "regular"`. Follow the README First run commands and verify with `GET /api/keys`.
4. Restart and verify health, owner login, and integration key access. Configure trusted proxy IP headers and edge rate limiting for multi-instance/serverless deployments. Clients must honor HTTP 429 and `Retry-After`.

## Breaking changes

- Public signup and implicit provider signup are removed; administrators create accounts through the API.
- The environment API key is now root/admin. Without `PUUMERKKI_API_OWNER_ID`, it can administer accounts/keys but cannot access documents. Database keys always access only their owner's documents, including admin keys.
- Account/key endpoints require bearer authentication and reject browser sessions. Invalid bearer credentials never fall back to cookies.
- Security headers deny framing and suppress referrers. Integrations embedding the app must use direct links instead. Inline styles, signature images, and local PDF.js workers remain supported.
- Signer and bearer-failure requests can return 429. Limits are process-local, not shared across deployments.

See CHANGELOG.md for the complete changes and SECURITY.md for the security model.
