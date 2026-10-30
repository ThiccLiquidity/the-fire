# The indexer (docs/indexer.md), for Railway. Build from the repository root: docker build -f ops/indexer/Dockerfile .
# The image holds the indexer and deployments/ (the addresses); the RPC and the database come from the host's
# variables at run time. Each deploy indexes into its own schema (RAILWAY_DEPLOYMENT_ID), so a new version backfills
# beside the old one and takes over once ready (Railway's healthcheck on /ready).
FROM node:22.23.4-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY ops/indexer/package.json ops/indexer/package-lock.json ops/indexer/
RUN cd ops/indexer && npm ci --no-audit --no-fund
COPY ops/indexer ops/indexer
COPY deployments deployments
WORKDIR /app/ops/indexer
USER node
CMD ["sh", "-c", "S=${DATABASE_SCHEMA:-omni_$(echo ${RAILWAY_DEPLOYMENT_ID:-local} | tr -c 'a-zA-Z0-9\n' _ | cut -c1-40)}; exec npx ponder start --schema \"$S\" --port ${PORT:-42069}"]
