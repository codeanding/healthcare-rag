# syntax=docker/dockerfile:1.7
# Multi-stage build for the NestJS api service.
# Build context: repo root (handles workspace deps including @aws-rag/shared).
#
#   docker build --platform linux/amd64 \
#     -t healthcare-rag-api -f apps/api/Dockerfile .

# ---- base ----
FROM node:22-alpine AS base
WORKDIR /repo
# openssl needed at install time so @prisma/engines' postinstall detects
# openssl-3.0.x and downloads the matching engine binaries. Without it the
# postinstall falls back to linux-musl (openssl-1.1.x) and runtime errors
# out trying to download the missing openssl-3.0.x variant.
RUN apk add --no-cache openssl
RUN corepack enable

# ---- deps: install workspace deps for api + shared ----
# Shared's `prepare` script (tsc) runs during install — it needs the source +
# tsconfig present, so we copy those before pnpm install.
FROM base AS deps
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
COPY tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src packages/shared/src
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter api...

# ---- builder: compile api ----
FROM deps AS builder
COPY apps/api ./apps/api
WORKDIR /repo/apps/api
RUN pnpm prisma generate
RUN pnpm build

# ---- deploy: produce a self-contained bundle (flat node_modules, no symlinks) ----
# `pnpm deploy --prod` flattens workspace deps (copies shared's dist into
# node_modules/@aws-rag/shared) and strips devDependencies. Result: portable
# /deploy directory the runner can copy verbatim.
FROM builder AS deploy
WORKDIR /repo
# `--legacy` flag required since pnpm 10 - without it pnpm refuses to deploy
# from workspaces that don't set `inject-workspace-packages=true`. We don't
# need injected packages for our case (shared already builds to dist via
# its prepare script), so legacy mode is the right escape hatch.
RUN pnpm --filter api deploy --prod --legacy /deploy
# pnpm deploy --legacy leaves the Prisma query engine binaries inside
# node_modules/.pnpm/ but Prisma's runtime looks them up at the top-level
# node_modules/.prisma/client/. Re-generating the client inside the
# deployed flat tree materializes them at the expected path so the runtime
# doesn't try to download them from binaries.prisma.sh.
WORKDIR /deploy
RUN node_modules/.bin/prisma generate --schema=prisma/schema.prisma

# ---- runner: minimal runtime image ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache wget openssl
COPY --from=deploy /deploy/dist ./dist
COPY --from=deploy /deploy/node_modules ./node_modules
COPY --from=deploy /deploy/package.json ./package.json
COPY --from=deploy /deploy/prisma ./prisma
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "dist/main.js"]
