# LocalStock API. Build from the repository root:
#   docker build -f apps/api/Dockerfile -t localstock-api .
# Run migrations with the same image before starting a new release:
#   docker run --rm --env-file .env localstock-api node packages/database/src/cli/migrate.js

FROM node:20.18-alpine AS deps
WORKDIR /app
# Every workspace manifest, so `npm ci` can verify the lockfile; then only this app's
# production dependencies are installed.
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
RUN npm ci --omit=dev --ignore-scripts --workspace @localstock/api && npm cache clean --force

FROM node:20.18-alpine
ENV NODE_ENV=production API_PORT=5000
WORKDIR /app
COPY --from=deps /app ./
COPY packages ./packages
COPY apps/api ./apps/api
USER node
EXPOSE 5000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.API_PORT + '/health/live').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "apps/api/src/server.js"]
