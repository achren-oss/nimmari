# Security policy

## Reporting a vulnerability

Use GitHub private vulnerability reporting: [submit a private security advisory](https://github.com/puumerkki/puumerkki/security/advisories/new). Do not report vulnerabilities through public issues or disclose sensitive details publicly.

Include affected versions, reproduction steps, expected and actual behavior, potential impact, and a minimal proof of concept where possible. Remove credentials, signing tokens, personal data, and real documents from reports.

We aim to acknowledge reports within 7 days, on a best-effort basis. Investigation, updates, and remediation depend on severity and maintainer availability; there is no guaranteed resolution timeline.

## Supported versions

The latest release and the current `main` branch are supported. Older releases should be upgraded before requesting a fix.

## Scope

Reports about authentication, authorization, signing-token handling, document confidentiality or integrity, HTML sanitization, PDF rendering, and exploitable dependency issues are welcome. Provide evidence of how a dependency issue affects Puumerkki. Operational misconfiguration and third-party services may require action by their operators. Test only deployments you own or are authorized to test.

Puumerkki is self-hosted. Self-hosters are responsible for their deployments, including updates, HTTPS, secrets, access controls, database backups, and data retention.

## Security model

- Public signup is disabled. Administrators provision accounts; browser sessions identify document owners. Document operations enforce ownership. Admin scope manages accounts and keys but does not grant access to other owners' documents.
- Database API keys contain 256 random bits and are stored as SHA-256 hashes with a display prefix. The environment root key is an operator-managed secret. Invalid bearer credentials never fall back to session cookies.
- Signing links are bearer secrets generated with `crypto.randomBytes(24)` (192 bits), encoded as base64url, and expire after 30 days. Token routes check expiry and document lifecycle. Anyone holding a link can act as that signer; deliver it privately.
- Database-backed fixed-window rate limits allow 60 signer requests per minute per IP, 60 reads per minute per token, and 20 writes per minute per token (submission and decline share a budget). Bearer authentication permits 30 failures per minute per IP, then returns HTTP 429 with `Retry-After`. Successful authentication does not consume this failure budget.
- Signer and bearer-failure limits are shared across instances via the database, use SHA-256 bucket keys, and fail open with a server log if the database check fails. Better Auth login/sign-up limits also use database storage. Run migrations before deploying (including `0007_rate_limits.sql`). Limits are not a distributed denial-of-service defense; edge rate limiting remains useful. Client IP resolution prefers `X-Vercel-Forwarded-For`, then `X-Real-IP`, then the first `X-Forwarded-For` address. Per-IP limits depend on the proxy supplying the correct client-IP header; a shared proxy address collapses clients into one budget, and a missing address uses a shared `unknown` bucket. Configure the reverse proxy to overwrite trusted IP headers; direct clients must not be able to spoof them.
- Responses set CSP, deny framing, disable MIME sniffing, suppress referrers (including signing tokens), disable camera/microphone/geolocation, and advertise two-year HSTS including subdomains. HSTS takes effect over HTTPS. CSP permits inline styles and scripts needed by the app, same-origin PDF.js workers, and data/blob image previews; it is defense in depth alongside HTML sanitization. Production does not enable script evaluation; development permits it and WebSockets for Next.js.
- Signatures are Simple Electronic Signatures (SES) only. There is no identity verification, certificate-backed PAdES signature, or trusted timestamp service. Audit hashes support integrity checking; they do not establish signer identity.
