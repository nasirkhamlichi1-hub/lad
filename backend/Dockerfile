# syntax=docker/dockerfile:1.6
# ─────────────────────────────────────────────────────────────────────────
# LAD CLPD backend — multi-stage Dockerfile
# ─────────────────────────────────────────────────────────────────────────
# Stage 1 builds native deps (better-sqlite3 needs python3/make/g++)
# Stage 2 carries only runtime artefacts, runs as a non-root user.
# Result: ~120 MB image, no build toolchain shipped, healthcheck baked in.

FROM node:20-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /build
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# ─── Runtime ────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# wget for the healthcheck (already in alpine base, but ensure present); tini for clean signal handling.
RUN apk add --no-cache wget tini && \
    addgroup -g 1001 -S app && \
    adduser  -u 1001 -S app -G app

WORKDIR /app

# Bring in compiled node_modules from the builder stage
COPY --from=builder --chown=app:app /build/node_modules ./node_modules

# App code
COPY --chown=app:app package*.json ./
COPY --chown=app:app src ./src
COPY --chown=app:app scripts ./scripts
COPY --chown=app:app migrations ./migrations

# Persistent data — mounted at runtime, never baked in
RUN mkdir -p /app/data && chown -R app:app /app/data
VOLUME ["/app/data"]

ENV NODE_ENV=production \
    PORT=4000 \
    LOG_LEVEL=info

USER app
EXPOSE 4000

# Health check used by Docker/Render/Azure container probes
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- --tries=1 --timeout=2 http://127.0.0.1:4000/api/v1/health || exit 1

# tini reaps zombies and forwards SIGTERM cleanly — required for graceful shutdown
ENTRYPOINT ["/sbin/tini", "--"]
# Zero-downtime boot: apply schema migrations (fast), then START THE SERVER
# IMMEDIATELY so the health check passes within ~2s and Render's rolling deploy
# never drops traffic. All data seeding runs in the BACKGROUND (own process, so
# it can't block the event loop); the app also self-heals feedback/accredited
# data lazily. SQLite WAL + busy_timeout lets the seed and the live server share
# the file safely.
CMD ["sh", "-c", "node scripts/migrate.js || true; { node scripts/seed-if-needed.js; node scripts/seed-feedback.js; node scripts/seed-accredited.js; node scripts/dedupe-firms.js; } & exec node src/server.js"]
