# Deploy Nimmari on Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/achren-oss/nimmari)

Follow [the agent runbook](../INSTALL-FOR-AGENTS.md) for the default button flow:
generate a one-time setup code, create a free Turso database in its dashboard, enter its
URL/token and the code in the Render form, then give the agent only the service URL and
first account email/name. The agent claims the account and stores separate admin and
regular keys. No fork, build, registry login, or provider API keys are needed.

The Blueprint uses ghcr.io/achren-oss/nimmari:1.3.0, Frankfurt, free plan, one instance,
and /api/health. BETTER_AUTH_SECRET is generated. RENDER_EXTERNAL_URL supplies public
and auth URL defaults. Existing APP_URL, BETTER_AUTH_URL, root keys and NIMMARI_*/PUUMERKKI_*
aliases remain supported; explicit URLs take precedence.

Blueprints [auto-sync linked-branch changes](https://render.com/docs/infrastructure-as-code)
by default, so image tag updates redeploy instances; sync:false secrets are prompted only
at initial creation. Change existing values in dashboard Environment.
Render provides [RENDER_EXTERNAL_URL automatically](https://render.com/docs/environment-variables).
Use external libSQL: free web-service storage is ephemeral. See the runbook for setup
claim status/error handling, cold starts, threat handling and alternative API provisioning.
