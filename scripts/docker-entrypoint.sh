#!/bin/sh
set -eu
# Preserve existing volumes; explicit DATABASE_URL always wins.
if [ -z "${DATABASE_URL:-}" ]; then
  if [ ! -e /data/nimmari.db ] && [ -e /data/puumerkki.db ]; then
    DATABASE_URL=file:/data/puumerkki.db
  else
    DATABASE_URL=file:/data/nimmari.db
  fi
  export DATABASE_URL
fi
node migrator/scripts/migrate.mjs
exec node server.js
