# Single image: Fastify API + static web build, served from one origin on port 3000.
#
#   docker build -t casinoonline .
#   docker run --rm -p 3000:3000 -e DATABASE_URL=postgres://... -e APP_ORIGIN=https://... casinoonline
#
# Migrations are applied automatically at startup (advisory lock: safe with several replicas).
# NODE_IMAGE can point to a registry mirror, e.g. --build-arg NODE_IMAGE=mirror.gcr.io/library/node:22-bookworm-slim

ARG NODE_IMAGE=node:22-bookworm-slim

# ---------------------------------------------------------------------------
# base: Node 22 + pnpm (version pinned by corepack, same as package.json "packageManager")
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    npm_config_store_dir=/pnpm/store \
    CI=true
ENV PATH=${PNPM_HOME}:${PATH}
RUN corepack enable pnpm && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo

# ---------------------------------------------------------------------------
# build: install every workspace dependency, build web + server bundle
# ---------------------------------------------------------------------------
FROM base AS build
# Manifests first: the install layer is reused until a manifest or the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/engine/package.json packages/engine/
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
# apps/web/dist (static SPA) and apps/server/dist (esbuild bundle + dist/migrations).
RUN pnpm --filter @casino/web build && pnpm --filter @casino/server build
# Production-only node_modules of the server (fastify, pg, zod, ...), without dev tooling.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @casino/server deploy --prod --legacy /prod/server

# ---------------------------------------------------------------------------
# runtime: only the bundle, its runtime dependencies, migrations and the web build
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    SERVE_WEB_DIST=/app/web \
    MIGRATIONS_DIR=/app/server/migrations
WORKDIR /app/server

# Files stay owned by root (read-only for the app user).
COPY --from=build /prod/server/package.json ./package.json
COPY --from=build /prod/server/node_modules ./node_modules
COPY --from=build /repo/apps/server/dist ./dist
COPY --from=build /repo/apps/server/migrations ./migrations
COPY --from=build /repo/apps/web/dist /app/web

# Unprivileged user shipped with the official Node image (uid 1000).
USER node
EXPOSE 3000

# Healthy = HTTP 200 from /api/health and the database answers.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => r.json().then((b) => process.exit(r.ok && b.db === true ? 0 : 1))).catch(() => process.exit(1))"]

CMD ["node", "--enable-source-maps", "dist/index.js"]
