# The keeper, for Railway (or any container host). Build from the repository root:
#   docker build -f ops/keeper/Dockerfile .
# The image holds the keeper and deployments/ (the contract addresses); the key and the RPC come from the host's
# variables at run time, never from the image.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY ops/keeper/package.json ops/keeper/package-lock.json ops/keeper/
RUN cd ops/keeper && npm ci --omit=dev --no-audit --no-fund
COPY ops/keeper/src ops/keeper/src
COPY deployments deployments
USER node
CMD ["node", "ops/keeper/src/keeper.mjs"]
