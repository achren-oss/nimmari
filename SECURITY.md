# Security policy

## Reporting a vulnerability

Use GitHub private vulnerability reporting: open this repository's **Security** tab and select **Report a vulnerability**. Do not report vulnerabilities through public issues or disclose sensitive details publicly.

Include affected versions, reproduction steps, expected and actual behavior, potential impact, and a minimal proof of concept where possible. Remove credentials, signing tokens, personal data, and real documents from reports.

We aim to acknowledge reports within 7 days, on a best-effort basis. Investigation, updates, and remediation depend on severity and maintainer availability; there is no guaranteed resolution timeline.

## Supported versions

The latest release and the current `main` branch are supported. Older releases should be upgraded before requesting a fix.

## Scope

Reports about authentication, authorization, signing-token handling, document confidentiality or integrity, HTML sanitization, PDF rendering, and exploitable dependency issues are welcome. Provide evidence of how a dependency issue affects Puumerkki. Operational misconfiguration and third-party services may require action by their operators. Test only deployments you own or are authorized to test.

Puumerkki is self-hosted. Self-hosters are responsible for their deployments, including updates, HTTPS, secrets, access controls, database backups, and data retention.
