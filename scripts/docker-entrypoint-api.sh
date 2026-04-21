#!/usr/bin/env sh
# cepage API/worker entrypoint.
#
# - Syncs the Prisma schema with the DB once per container, gated by
#   RUN_PRISMA_MIGRATE=1 (default). The worker can skip with RUN_PRISMA_MIGRATE=0.
# - We use `db push` rather than `migrate deploy` because the current
#   schema.prisma includes tables (WorkerNode, etc.) that do not yet have
#   versioned migrations; same strategy as `pnpm api:dev` (see scripts/run-api-dev.mjs).
# - Forwards signals and execs CMD.
set -eu

if [ "${RUN_PRISMA_MIGRATE:-1}" = "1" ]; then
  echo "[entrypoint] prisma db push (sync schema with database)"
  cd /repo
  pnpm --filter @cepage/db exec prisma db push --skip-generate --accept-data-loss \
    --schema=/repo/packages/db/prisma/schema.prisma
  cd /repo/apps/api
fi

echo "[entrypoint] exec: $*"
exec "$@"
