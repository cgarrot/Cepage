# Contributing to Cepage

Thanks for your interest in improving Cepage.

This repository is still in an early public phase. Small, focused pull requests
are the easiest to review and merge.

## Before you open a pull request

- Open an issue first for large features, product changes, or architectural shifts.
- Keep pull requests scoped to one problem.
- Update docs when behavior, setup, or public contracts change.
- Do not commit secrets, local `.env` files, or generated build artifacts.

## Prerequisites

- Node.js 20.9 or newer
- pnpm 9.x
- Docker Desktop or a local PostgreSQL 16 instance
- OpenCode, `cursor-agent`, or `claude` installed locally if you want to exercise the matching agent runtime end to end

## Local setup

```bash
cp .env.example .env
docker compose up -d

pnpm install
pnpm db:generate
pnpm db:migrate:dev
```

Start the development servers in two terminals:

```bash
pnpm api:dev
pnpm web:dev
```

Default local URLs:

- Web: `http://localhost:31961`
- API: `http://localhost:31947/api/v1`

## Database workflow

Use `pnpm db:migrate:dev` when you change the Prisma schema and want to evolve
the migration history.

The API development bootstrap currently runs `db push` on startup so local
prototype tables stay aligned with the latest schema during active development.
That behavior is convenient for local work, but migrations remain the source of
truth for committed schema changes.

## Repository layout

- `apps/api`: NestJS bootstrap application
- `apps/web`: Next.js shell
- `packages/api`: backend modules and orchestration logic
- `packages/graph-core`: graph model and invariants
- `packages/state` and `packages/app-ui`: client state and canvas UI
- `packages/db`: Prisma schema and database tooling
- `packages/sdk`: TypeScript SDK, including dynamic OpenAPI/catalog type generation
- `packages/sdk-python`: Python SDK and generated dataclass script
- `docs/`: product and architecture notes
- `status/`: current implementation notes and execution history

## Quality checks

Run these commands from the repository root before opening a pull request:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm typecheck` currently uses the monorepo build graph because several
packages validate TypeScript by compiling their workspace outputs.

`pnpm build` runs package-level `generate` tasks through Turbo before compiling dependents. If you change the dynamic OpenAPI surface, skill catalog schemas, or generated SDK outputs, run:

```bash
pnpm --filter @cepage/sdk generate
python packages/sdk-python/scripts/generate-python-sdk-types.py
```

Do not hand-edit files under `packages/sdk/src/generated/` or `packages/sdk-python/cepage/generated_types.py`.

## Documentation expectations

- Keep the top-level `README.md` accurate for new contributors.
- Link public-facing docs from `docs/README.md`.
- Update relevant ADRs under `docs/adr/` when the SDK/codegen or compiler architecture changes.
- If you add new environment variables, update `.env.example`.

## Security

Do not open a public issue for a security-sensitive report. Follow the process
described in `SECURITY.md`.

## Code of conduct

This project follows the community standards in `CODE_OF_CONDUCT.md`.
