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
    PUPPETEER_NO_SANDBOX=1
RUN groupadd --system --gid 1001 nimmari \
 && useradd --system --uid 1001 --gid nimmari --home /app nimmari \
 && mkdir -p /data && chown nimmari:nimmari /data
COPY --from=build --chown=nimmari:nimmari /app/.next/standalone ./
COPY --from=build --chown=nimmari:nimmari /app/.next/static ./.next/static
COPY --from=build --chown=nimmari:nimmari /app/public ./public
COPY --from=migrator --chown=nimmari:nimmari /migrator/node_modules ./migrator/node_modules
COPY --chown=nimmari:nimmari drizzle ./migrator/drizzle
COPY --chown=nimmari:nimmari scripts/migrate.mjs ./migrator/scripts/migrate.mjs
COPY --chown=nimmari:nimmari scripts/docker-entrypoint.sh ./docker-entrypoint.sh
USER nimmari
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/api/health || exit 1
# Apply migrations (idempotent), then start the server.
CMD ["sh", "./docker-entrypoint.sh"]
