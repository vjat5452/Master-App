# LocalStock worker (outbox publisher, consumers, background collection, retention).
# Build from the repository root:
#   docker build -f apps/worker/Dockerfile -t localstock-worker .

FROM node:20.18-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/allocation-engine/package.json packages/allocation-engine/
COPY packages/connectors/package.json packages/connectors/
COPY packages/database/package.json packages/database/
COPY packages/external-data/package.json packages/external-data/
COPY packages/logger/package.json packages/logger/
COPY packages/metrics/package.json packages/metrics/
RUN npm ci --omit=dev --ignore-scripts --workspace @localstock/worker && npm cache clean --force

FROM node:20.18-alpine
# The metrics port also serves /health/live for the container health check.
ENV NODE_ENV=production WORKER_METRICS_PORT=9100
WORKDIR /app
COPY --from=deps /app ./
COPY packages ./packages
COPY apps/worker ./apps/worker
USER node
EXPOSE 9100
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.WORKER_METRICS_PORT + '/health/live').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "apps/worker/src/worker.js"]
