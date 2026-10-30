# API and worker in one container, for Render's free web service (no background workers,
# no pre-deploy command on the free plan). Build from the repository root:
#   docker build -f deploy/render/Dockerfile -t localstock-all-in-one .
# It runs migrations (and demo seeding when SEED_DEMO_DATA=true) at start, then serves the
# API on $PORT and runs the worker in the same process.

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
RUN npm ci --omit=dev --ignore-scripts --workspace @localstock/api --workspace @localstock/worker && npm cache clean --force

FROM node:20.18-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/worker ./apps/worker
COPY deploy/all-in-one.mjs ./deploy/all-in-one.mjs
USER node
CMD ["node", "deploy/all-in-one.mjs"]
