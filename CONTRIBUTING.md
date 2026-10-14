# Contributing

Use English for code comments, UI strings, documentation, issues, and pull requests. Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Report security vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Development setup

Use Node.js 20.19+ or a newer supported version and npm:

```sh
npm ci
cp .env.example .env.local
# Set BETTER_AUTH_SECRET and configure Chromium for HTML PDF rendering.
node --env-file=.env.local scripts/migrate.mjs
npm run dev
```

The migration script loads `.env.local`, defaults to local SQLite, and applies the numbered Drizzle journal migrations. `npm run db:push` is development-only; use migrations for deployments. See [README.md](README.md) for configuration and the service user script.

## Checks

Before submitting a pull request, run:

```sh
npm test
npm run lint
npx tsc --noEmit
```

For signing-flow changes, also run `bash scripts/smoke.sh` against a running development server with Chrome/Chromium configured. It creates persistent test records. Use a development database.

## Pull requests

Keep changes focused. Describe the problem, resulting behavior, and validation performed. Add meaningful tests for behavior changes and update documentation for configuration or API changes. Preserve existing behavior unless the change explicitly addresses it. Do not include secrets, personal documents, generated build outputs, or local databases. Discuss large changes in an issue first. Sign off every commit under the DCO below.

## Developer Certificate of Origin

Contributions use the [Developer Certificate of Origin 1.1](https://developercertificate.org/). Certify your contribution by adding a sign-off to each commit:

```sh
git commit -s -m "Describe your change"
```

This adds a `Signed-off-by: Your Name <your-email@example.com>` trailer. Use your own identity. Signing off certifies the following:

```text
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.
1 Letterman Drive
Suite D4700
San Francisco, CA, 94129

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.

Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```
