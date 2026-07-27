# Multi-stage build → Next.js standalone runtime.
# Portable: no cloud provider assumptions. Works on any container host.

# ── deps ──────────────────────────────────────────────────────────────────────
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts || npm install --omit=dev --ignore-scripts

# ── build ─────────────────────────────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts || npm install --ignore-scripts
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── runtime ───────────────────────────────────────────────────────────────────
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Storage lives outside the build output so it survives image rebuilds and can be
# bind-mounted. Override with STORAGE_LOCAL_DIR, or use STORAGE_DRIVER=s3|gcs.
ENV STORAGE_LOCAL_DIR=/app/.data

RUN groupadd --system --gid 1001 nodejs \
 && useradd  --system --uid 1001 --gid nodejs nextjs

# standalone bundle + static assets + the env preload
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# (no public/ dir in this project; add a COPY here if you introduce one)
COPY --from=builder --chown=nextjs:nodejs /app/scripts/preload-env.cjs ./scripts/preload-env.cjs

RUN mkdir -p /app/.data && chown -R nextjs:nodejs /app/.data
VOLUME ["/app/.data"]

USER nextjs
EXPOSE 3000

# The preload reads env.yaml (if mounted) into process.env before any app module.
# Real environment variables always win, so orchestrator/secret-manager values
# override the file without editing it.
CMD ["node", "-r", "./scripts/preload-env.cjs", "server.js"]
