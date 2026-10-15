# Deploy Nimmari on Vercel + Turso (alternative)

Vercel runs Nimmari as serverless functions. HTML forms are rendered with
`@sparticuz/chromium-min`, which downloads a pinned Chromium build at cold start.

> Free-tier facts below were checked on **7 October 2026** against the providers'
> official pages. Re-check the linked pages before relying on them.

## What the free tiers mean for Nimmari

**Vercel Hobby** ([vercel.com/docs/plans/hobby](https://vercel.com/docs/plans/hobby))
- Free, but **restricted to non-commercial, personal use** (Vercel fair use guidelines).
  Use the Pro plan, or Render/any Docker host, for business use.
- Included monthly usage includes 4 active CPU-hours, 360 GB-hours of provisioned memory,
  1,000,000 function invocations and 100 GB fast data transfer. If you exceed a limit
  you generally have to wait 30 days before the feature works again.
- Function maximum duration 300 s; runtime logs kept for 1 hour.
- Functions do not "sleep" like a Render free instance, but cold starts that need to
  download Chromium make the first HTML-form PDF render slow.
- The request body limit for functions is 4.5 MB; Nimmari caps PDF uploads at 4 MB.

**Turso free plan** ([turso.tech/pricing](https://turso.tech/pricing)): 100 databases,
5 GB storage, 500 million rows read / 10 million rows written per month.

## Steps

1. **Create the Turso database** (see [deploy-render.md](deploy-render.md#steps), step 1).
2. **Apply the schema** from your machine, once (and after upgrades):
   ```bash
   DATABASE_URL=libsql://... DATABASE_AUTH_TOKEN=... node scripts/migrate.mjs
   ```
3. **Import the repository** in Vercel (*Add New → Project*). Framework: Next.js
   (detected). No build settings need changing; `vercel.json` sets function memory/duration.
4. **Environment variables** (Production): `DATABASE_URL`, `DATABASE_AUTH_TOKEN`,
   `BETTER_AUTH_SECRET` (`openssl rand -hex 32`), `BETTER_AUTH_URL` and `APP_URL`
   (your production URL), optional `RESEND_*` and `NIMMARI_API_*`.
   If the URL is not known yet, leave `BETTER_AUTH_URL` and `APP_URL` unset for the first deploy.
   Do not set `PUPPETEER_EXECUTABLE_PATH` on Vercel.
5. **Deploy to obtain the URL.** The first deploy gives you a `https://<project>.vercel.app` URL. Set both `BETTER_AUTH_URL` and `APP_URL` to that public origin in the Production environment, then **redeploy** so the app uses them. Signing links are built from `APP_URL`; configure it before sending any documents. After redeploying, open `/api/health` (expects `{"status":"ok"}`) and provision an account through the admin API before opening `/login`.
6. **Custom domain:** add it under *Settings → Domains* and update `BETTER_AUTH_URL`/`APP_URL`, then redeploy.

Public signup is disabled. Configure the root `NIMMARI_API_KEY` and follow [API key setup](../README.md#create-an-api-key-for-an-ai-agent) to provision accounts and regular agent keys. Apply journaled migrations with `scripts/migrate.mjs` before each deployment.
