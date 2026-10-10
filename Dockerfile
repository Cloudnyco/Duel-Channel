# The multiplayer server, ready to play: the gateway (page + lobby) and three battle instances in one container, with
# the page built from the repository's asset pack (the build stage fetches the two display fonts, docs/ASSETS.md).
#
#   docker build -t duel-channel .
#   docker run --rm -p 127.0.0.1:8600:8600 duel-channel
#
# A page built elsewhere can still be mounted over it: -v "$PWD/public:/app/public:ro"

# ---- the page -------------------------------------------------------------------------------------------------------
FROM node:24-alpine AS page
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web ./web
COPY shared ./shared
COPY data ./data
COPY tools ./tools
COPY assets ./assets
RUN node tools/build-page.mjs

# ---- the server -----------------------------------------------------------------------------------------------------
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server ./server
COPY shared ./shared
COPY data ./data
COPY --from=page /src/public ./public
# browsers connect to the gateway only (8600): it relays their match connections to the instances (8611-8613, local)
EXPOSE 8600
# error logs and players' reports (logs/server-errors.log, logs/reports/)
RUN mkdir -p logs && chown node:node logs
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8600/healthz || exit 1
CMD ["node", "server/launch.mjs", "--instances", "3", "--host", "0.0.0.0"]
