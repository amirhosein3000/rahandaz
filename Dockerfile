# Rahandaz console: deploys to Liara as a Docker app (dogfooding).
# Build: docker build -t rahandaz .   (UNVERIFIED locally: Docker is not installed on the dev box)
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/liara/package.json packages/liara/
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
COPY apps/cli/package.json apps/cli/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @rahandaz/web build

FROM node:22-alpine
# git: the agent clones the repositories it deploys.
RUN apk add --no-cache git
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    RAHANDAZ_ROOT=/app \
    RAHANDAZ_DATA_DIR=/app/var \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/fixtures ./fixtures
COPY --from=build /app/data/liara-docs ./data/liara-docs
# Runs as root: a Liara disk is mounted at /app/var and its ownership is UNVERIFIED.
RUN mkdir -p /app/var
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/web/server.js"]
