# syntax=docker/dockerfile:1

# ---- deps: install all dependencies (dev deps needed for the build) ----
FROM node:25-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: compile the Next.js standalone server ----
FROM node:25-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- migrator: tiny standalone install used to apply SQL migrations at boot ----
FROM node:25-bookworm-slim AS migrator
WORKDIR /migrator
RUN npm init -y >/dev/null && npm install --omit=dev --no-audit --no-fund drizzle-orm@0.45.2 @libsql/client@0.17.3

# ---- runtime: Node + Chromium, non-root ----
FROM node:25-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-dejavu-core fonts-liberation ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_NO_SANDBOX=1 \
    DATABASE_URL=file:/data/puumerkki.db
RUN groupadd --system --gid 1001 puumerkki \
 && useradd --system --uid 1001 --gid puumerkki --home /app puumerkki \
 && mkdir -p /data && chown puumerkki:puumerkki /data
COPY --from=build --chown=puumerkki:puumerkki /app/.next/standalone ./
COPY --from=build --chown=puumerkki:puumerkki /app/.next/static ./.next/static
COPY --from=build --chown=puumerkki:puumerkki /app/public ./public
COPY --from=migrator --chown=puumerkki:puumerkki /migrator/node_modules ./migrator/node_modules
COPY --chown=puumerkki:puumerkki drizzle ./migrator/drizzle
COPY --chown=puumerkki:puumerkki scripts/migrate.mjs ./migrator/scripts/migrate.mjs
USER puumerkki
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/api/health || exit 1
# Apply migrations (idempotent), then start the server.
CMD ["sh", "-c", "node migrator/scripts/migrate.mjs && exec node server.js"]
