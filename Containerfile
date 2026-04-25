FROM docker.io/library/node:22-alpine AS builder
WORKDIR /app

# bundle-lambda.mjs shells out to `zip` to produce Lambda deployment zips.
# The zips aren't used at runtime (the server requires bundle/handler.js
# directly), but the bundle script runs the zip step unconditionally.
RUN apk add --no-cache zip

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/poller/package.json packages/poller/
COPY packages/api/package.json packages/api/
COPY packages/frontend/package.json packages/frontend/

RUN npm ci

COPY packages/shared packages/shared
COPY packages/poller packages/poller
COPY packages/api packages/api
COPY packages/frontend packages/frontend
COPY scripts scripts

RUN npm run build --workspace=@bridge-tracker/shared
RUN npm run bundle
RUN npm run build --workspace=@bridge-tracker/frontend


FROM docker.io/library/node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/poller/package.json packages/poller/
COPY packages/api/package.json packages/api/

# The runtime only needs AWS SDK deps for the two handlers. Install prod deps
# for poller+api; frontend + tests never run in the container.
RUN npm ci --omit=dev --workspaces --include-workspace-root \
      --workspace=@bridge-tracker/poller \
      --workspace=@bridge-tracker/api

COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/poller/bundle packages/poller/bundle
COPY --from=builder /app/packages/api/bundle packages/api/bundle
COPY --from=builder /app/packages/frontend/dist packages/frontend/dist
COPY scripts/server.mjs scripts/server.mjs

EXPOSE 8080
USER node
CMD ["node", "scripts/server.mjs"]
