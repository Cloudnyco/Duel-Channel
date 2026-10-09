# The multiplayer server: the gateway (page + lobby) and three battle instances in one container.
# The page is NOT in the image (it inlines the game's assets, which this project does not distribute): build it on
# your machine (`npm run build`, docs/ASSETS.md) and mount it — see docs/DEPLOY.md.
#
#   docker build -t duel-channel .
#   docker run --rm -p 127.0.0.1:8600:8600 -p 127.0.0.1:8611-8613:8611-8613 \
#     -v "$PWD/public:/app/public:ro" duel-channel
FROM node:25-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server ./server
COPY shared ./shared
COPY data ./data
RUN mkdir -p public
# browsers connect to the gateway (8600) and, during a match, straight to its instance (8611-8613)
EXPOSE 8600 8611 8612 8613
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8600/healthz || exit 1
CMD ["node", "server/launch.mjs", "--instances", "3", "--host", "0.0.0.0"]
