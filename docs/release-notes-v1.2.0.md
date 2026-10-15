# Nimmari v1.2.0

Nimmari (formerly Puumerkki) is the new project name. The repository is now [achren-oss/nimmari](https://github.com/achren-oss/nimmari) and the image is `ghcr.io/achren-oss/nimmari:1.3.0`.

## Upgrade existing installations

1. Back up your database and retain the existing Docker volume. Replace the image reference with `ghcr.io/achren-oss/nimmari:1.3.0`. Container and volume names are arbitrary; keep the existing volume mounted at `/data`.
2. Keep existing `PUUMERKKI_*` settings or rename them to matching `NIMMARI_*` settings. The new name wins even when empty. Aliases cover API key, API owner ID, audit timezone, webhook secret, rate-limit debug, and skill base URL/API key (including the deprecated bot key). Other settings such as `DATABASE_URL` are unchanged.
3. Without an explicit `DATABASE_URL`, startup uses `/data/nimmari.db` if present, otherwise reuses `/data/puumerkki.db` if present. New installations create `/data/nimmari.db`. Do not rename an active SQLite database or discard its WAL files. Explicit database URLs always take precedence. Migrations run before server startup.
4. Replace the installed `skills/puumerkki` folder with `skills/nimmari`; its frontmatter name is `nimmari`. Update commands to `scripts/nimmari_flow.py` and references to the new folder. Client scripts accept the old environment names.
5. Update your Git remote to `https://github.com/achren-oss/nimmari` and verify `/api/health` and account login after restarting.

Existing documents, signer slots, field IDs, tokens, DB schema, and `pmk_` API keys remain valid. Persisted browser draft keys, PDF seal markers, and webhook signature headers keep their legacy identifiers so existing integrations and in-progress documents continue working. UI, email sender defaults, metadata, and new deployment examples use Nimmari.
