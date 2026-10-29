# LocalStock website: static build served by nginx, with /api and /health forwarded to the
# API. Build from the repository root:
#   docker build -f apps/web/Dockerfile -t localstock-web .
#   docker run -p 8080:8080 -e API_UPSTREAM=http://api:5000 localstock-web
# Set VITE_DEMO_NOTICE=off at build time for a deployment with real sellers.

FROM node:20.18-alpine AS build
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
RUN npm ci --ignore-scripts --workspace @localstock/web
COPY apps/web ./apps/web
ARG VITE_DEMO_NOTICE
ENV VITE_DEMO_NOTICE=${VITE_DEMO_NOTICE}
RUN npm run build -w @localstock/web

FROM nginx:1.27-alpine
ENV API_UPSTREAM=http://api:5000
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
