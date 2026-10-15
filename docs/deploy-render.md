# Deploy Nimmari on Render

Follow [the agent runbook](../INSTALL-FOR-AGENTS.md) for the default **Agent deploy
with Render + Turso API keys**. Supply both provider keys plus your login email/name
in one exchange; the agent creates a Turso database and free Render image service,
waits for health, then uses the 1.3.0 one-time setup claim to create the first account
and separate admin/regular keys. No root `NIMMARI_API_KEY` is stored on the server.
The create request uses the pinned image, Frankfurt, free plan, `/api/health`, and
only DATABASE_URL, DATABASE_AUTH_TOKEN, BETTER_AUTH_SECRET and NIMMARI_SETUP_CODE.
The returned serviceDetails.url is the public URL; no URL env update or redeploy is needed.
Revoke provider keys after installation unless future agent administration is wanted.

## No keys for the agent: Deploy to Render button

For users who don't want to give an agent provider keys:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/achren-oss/nimmari)

Generate a one-time setup code, create a free Turso database in its dashboard, enter its
URL/token and the code in the Render form, then give the agent only the service URL and
first account email/name. The agent claims the account and stores separate admin and
regular keys. No fork, build, registry login, or provider API keys are needed.
See alternative B in the runbook for commands and shared verification.

The Blueprint uses ghcr.io/achren-oss/nimmari:1.3.0, Frankfurt, free plan, one instance,
and /api/health. BETTER_AUTH_SECRET is generated. RENDER_EXTERNAL_URL supplies public
and auth URL defaults. Existing APP_URL, BETTER_AUTH_URL, root keys and NIMMARI_*/PUUMERKKI_*
aliases remain supported; explicit URLs take precedence.

Blueprints [auto-sync linked-branch changes](https://render.com/docs/infrastructure-as-code)
by default, so image tag updates redeploy instances; sync:false secrets are prompted only
at initial creation. Change existing values in dashboard Environment.
Render provides [RENDER_EXTERNAL_URL automatically](https://render.com/docs/environment-variables).
Use external libSQL: free web-service storage is ephemeral. See the runbook for setup
claim status/error handling, cold starts, threat handling and both installation paths. The setup code may stay after claim: it is single-use.
