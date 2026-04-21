# syntax=docker/dockerfile:1.7

# =====================================================================
# cepage — shared multi-stage image (API, Web)
#
# Exposed targets:
#   - api : NestJS bootstrap (apps/api), CMD = node dist/main.js
#           Control plane only; does not spawn any agent CLI.
#           `agent_run` / `runtime_*` jobs are consumed by the native daemon
#           (`apps/daemon`) running on the host machine.
#   - web : Next.js (standalone), CMD = node apps/web/server.js
# =====================================================================

ARG NODE_VERSION=22.13.1

# ---------------------------------------------------------------------
# Stage 0: base — shared toolchain (node + pnpm + openssl for Prisma)
# ---------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/root/.pnpm \
    PATH=/root/.pnpm:$PATH \
    NODE_ENV=production

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        openssl \
        ca-certificates \
        tini \
        curl \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable \
 && corepack prepare pnpm@9.0.0 --activate

WORKDIR /repo

# ---------------------------------------------------------------------
# Stage 1: deps — deterministic pnpm workspace install
# ---------------------------------------------------------------------
FROM base AS deps

# Copy manifests first to maximize layer cache.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json eslint.config.mjs ./

COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

COPY packages/agent-core/package.json packages/agent-core/
COPY packages/api/package.json packages/api/
COPY packages/app-ui/package.json packages/app-ui/
COPY packages/client-api/package.json packages/client-api/
COPY packages/config/package.json packages/config/
COPY packages/db/package.json packages/db/
COPY packages/graph-core/package.json packages/graph-core/
COPY packages/i18n/package.json packages/i18n/
COPY packages/shared-core/package.json packages/shared-core/
COPY packages/state/package.json packages/state/
COPY packages/ui-kit/package.json packages/ui-kit/

# NODE_ENV=production would skip devDependencies, which we need for the build
ENV NODE_ENV=development
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------
# Stage 2: sources — code + Prisma client (shared by both targets)
# ---------------------------------------------------------------------
FROM deps AS sources

COPY packages packages
COPY apps apps
COPY scripts scripts
# Workflow skills catalog (read at runtime by WorkflowSkillsService).
# Generic: ships the full catalog regardless of skill.
# NOTE: This copies only public workflow skills.
# Personal skills in docs/workflow-prompt-library/private/ are gitignored
# and will NOT be included in the Docker image.
COPY docs/workflow-prompt-library docs/workflow-prompt-library

# Prisma client generated from packages/db/prisma/schema.prisma.
RUN pnpm --filter @cepage/db run generate

# ---------------------------------------------------------------------
# Stage 3a: api-build — backend packages + Nest bundle
#
# The API imports NO frontend packages (verify with grep).
# We only build the backend chain (strict tsc).
# ---------------------------------------------------------------------
FROM sources AS api-build
RUN pnpm --filter @cepage/shared-core build \
 && pnpm --filter @cepage/graph-core build \
 && pnpm --filter @cepage/config build \
 && pnpm --filter @cepage/agent-core build \
 && pnpm --filter @cepage/api build \
 && pnpm --filter @cepage/api-app build

# ---------------------------------------------------------------------
# Stage 4a: api — API runtime (control plane only, no agent CLI)
# ---------------------------------------------------------------------
FROM base AS api
WORKDIR /repo

# Full copy of installed + built repo; simpler than prune.
# Image ~1.2GB; acceptable for a "local prod" setup.
COPY --from=api-build /repo /repo

ENV NODE_ENV=production \
    PORT=3001

WORKDIR /repo/apps/api

# Shared entrypoint: apply Prisma migrations then exec the command
COPY scripts/docker-entrypoint-api.sh /usr/local/bin/cepage-entrypoint.sh
RUN chmod +x /usr/local/bin/cepage-entrypoint.sh

EXPOSE 3001

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/cepage-entrypoint.sh"]
CMD ["node", "dist/main.js"]

# ---------------------------------------------------------------------
# Stage 3b: web-build — Next build (standalone)
#
# next.config.mjs aliases @cepage/* to sources: Next uses SWC to transpile
# without type-check (tsconfig only includes apps/web/src).
# Only i18n needs its dist (message tables JSON resolved at runtime).
# ---------------------------------------------------------------------
FROM sources AS web-build

RUN pnpm --filter @cepage/shared-core build \
 && pnpm --filter @cepage/i18n build

# NEXT_PUBLIC_* are fixed at build time: injected via --build-arg in compose.
ARG NEXT_PUBLIC_API_URL=http://localhost:31947
ARG NEXT_PUBLIC_WS_URL=http://localhost:31947
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL \
    NODE_ENV=production

RUN pnpm --filter @cepage/web build

# ---------------------------------------------------------------------
# Stage 4b: web — Next standalone runtime
# ---------------------------------------------------------------------
FROM base AS web
WORKDIR /app

# .next/standalone bundles server.js + minimal node_modules.
# outputFileTracingRoot=rootDir => standalone tree mirrors /repo
COPY --from=web-build /repo/apps/web/.next/standalone ./
COPY --from=web-build /repo/apps/web/.next/static ./apps/web/.next/static
# public/ may be missing; create empty dir to avoid errors
RUN mkdir -p ./apps/web/public

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/web/server.js"]
