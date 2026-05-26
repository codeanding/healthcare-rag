# syntax=docker/dockerfile:1.7
# Multi-stage build for the React/Vite frontend, served by nginx.
# Build context: repo root.
#
#   docker build --platform linux/amd64 \
#     --build-arg VITE_API_URL=https://your-alb.us-west-2.elb.amazonaws.com \
#     -t healthcare-rag-web -f apps/web/Dockerfile .
#
# If VITE_API_URL is empty, the bundle uses relative /api paths — useful when
# nginx proxies /api to the backend (or when bundling web behind the same ALB).

# ---- base ----
FROM node:22-alpine AS base
WORKDIR /repo
RUN corepack enable

# ---- deps ----
FROM base AS deps
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
COPY tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src packages/shared/src
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter web...

# ---- builder: produce static dist ----
FROM deps AS builder
COPY apps/web ./apps/web
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
WORKDIR /repo/apps/web
RUN pnpm build

# ---- runner: nginx serving static files ----
FROM nginx:1.27-alpine AS runner
RUN apk add --no-cache wget
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://localhost/health || exit 1
