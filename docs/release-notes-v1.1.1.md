# Puumerkki v1.1.1

Released 2026-10-14.

The post-signing done page now confirms that the signature was recorded and only claims a copy email or sender notification when the corresponding Resend send succeeds. Missing email configuration, disabled notifications, and provider failures no longer produce misleading inbox promises.

Signed-copy emails now respect both the document notification setting and the signing session email preference. Sender notices continue to follow the document setting. The redirect carries display-only send results; these flags do not authorize PDF access or prove delivery.

## Upgrade

Install v1.1.1 or use `ghcr.io/puumerkki/puumerkki:1.1.1` and restart the application. No new database migration or configuration is required for upgrades from v1.1.0.
