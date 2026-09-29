# Base image pinned to the Node 22.22 line. The keeper holds a hot key, so pin it by digest when you build it on the box:
#   docker pull node:22.22-alpine && docker inspect --format '{{index .RepoDigests 0}}' node:22.22-alpine
# then replace the line below with FROM node:22.22-alpine@sha256:<that digest> (not done in the repo: no registry
# access when this was written).
FROM node:22.22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY keeper.mjs ./
USER node
CMD ["node", "keeper.mjs"]
