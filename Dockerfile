# The multiplayer server, ready to play: the gateway (page + lobby) and three battle instances in one container, with
# the page built from the repository's asset pack (the build stage fetches the two display fonts, docs/ASSETS.md).
#
#   docker build -t duel-channel .
#   docker run --rm -p 127.0.0.1:8600:8600 duel-channel
#
# A page built elsewhere can still be mounted over it: -v "$PWD/public:/app/public:ro"
#
# For linux/amd64 and linux/arm64 alike (docker buildx build --platform linux/amd64,linux/arm64 .): the page and the
# server's dependencies are the same on every architecture (HTML / JSON, pure JavaScript), so they are made once on the
# machine that builds; the image's own stage only copies them in and runs nothing, so no emulation is needed.

# ---- the page -------------------------------------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM node:24-alpine AS page
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web ./web
COPY shared ./shared
COPY data ./data
COPY tools ./tools
COPY assets ./assets
RUN node tools/build-page.mjs

# ---- the server's dependencies (pure JavaScript: a native addon would have to be built in the last stage instead) ---
FROM --platform=$BUILDPLATFORM node:24-alpine AS deps
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && if find node_modules -name '*.node' | grep -q .; then echo 'a native addon among the server dependencies' >&2; exit 1; fi \
 && mkdir logs

# ---- the server -----------------------------------------------------------------------------------------------------
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY --from=deps /src/node_modules ./node_modules
COPY server ./server
COPY shared ./shared
COPY data ./data
COPY --from=page /src/public ./public
# browsers connect to the gateway only (8600): it relays their match connections to the instances (8611-8613, local)
EXPOSE 8600
# error logs and players' reports (logs/server-errors.log, logs/reports/)
COPY --from=deps --chown=node:node /src/logs ./logs
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8600/healthz || exit 1
CMD ["node", "server/launch.mjs", "--instances", "3", "--host", "0.0.0.0"]
