# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Is Paperclip

Control plane for AI-agent companies. Node.js + React monorepo that orchestrates teams of AI agents with org charts, budgets, governance, goal alignment, and agent coordination. See `AGENTS.md` for contributor guidelines and `doc/SPEC-implementation.md` for the V1 build contract.

## Commands

```sh
pnpm install              # install deps (pnpm 9+, Node 20+ required)
pnpm dev                  # start API + UI with file watching (http://localhost:3100)
pnpm dev:once             # start without watching
pnpm build                # build all packages
pnpm -r typecheck         # typecheck everything
pnpm test:run             # run vitest across all projects
pnpm test:e2e             # playwright e2e tests
pnpm db:generate          # generate drizzle migration after schema change
pnpm db:migrate           # apply migrations
```

Single test file: `pnpm vitest run <path-to-test-file>`

Verification before hand-off: `pnpm -r typecheck && pnpm test:run && pnpm build`

## Monorepo Structure

| Package | Purpose |
|---------|---------|
| `server/` | Express 5 REST API, WebSocket live events, orchestration services |
| `ui/` | React 19 + Vite 6 SPA (Tailwind CSS 4) |
| `cli/` | Admin CLI (`pnpm paperclipai <command>`) |
| `packages/db/` | Drizzle ORM schema, migrations, DB clients (PostgreSQL 17) |
| `packages/shared/` | Shared types, constants, validators, API path constants |
| `packages/adapters/` | Agent adapter implementations (Claude, Codex, Cursor, Gemini, OpenClaw, etc.) |
| `packages/adapter-utils/` | Shared adapter utilities |
| `packages/plugins/` | Plugin system (SDK, examples, scaffolding) |

## Architecture

**Three-layer stack:** DB schema (`packages/db`) → Express API (`server/`) → React UI (`ui/`). `packages/shared/` provides types and validators used across all layers.

**Server routes** live in `server/src/routes/` organized by domain (agents, issues, companies, approvals, projects, goals, costs, routines, etc.). Services in `server/src/services/` handle orchestration (heartbeat scheduling, workspace runtime, plugin lifecycle, budget enforcement).

**UI** uses React Router for page routing, TanStack Query for data fetching, and proxies `/api` requests to the backend via Vite dev proxy. Company selection context scopes all pages.

**Real-time:** WebSocket (`ws`) for live events from server to UI.

**Auth:** better-auth for board sessions, hashed bearer API keys for agents. Company-scoped access enforcement on all routes.

**Database:** Embedded PostgreSQL by default in dev (no setup needed, data at `~/.paperclip/instances/default/db/`). Leave `DATABASE_URL` unset for auto mode.

## Key Invariants

These must be preserved in all changes:

- **Company scoping** — every entity belongs to a company; boundaries enforced in routes/services
- **Single-assignee task model** — issues assigned to one agent at a time with atomic checkout
- **Approval gates** — governed actions require approval workflows
- **Budget hard-stop** — agents auto-pause when budget exceeded
- **Activity logging** — all mutations get activity log entries
- **Contract sync** — schema/API changes must update all layers: `packages/db` → `packages/shared` → `server/` → `ui/`

## Database Changes

1. Edit schema in `packages/db/src/schema/*.ts`
2. Export new tables from `packages/db/src/schema/index.ts`
3. Run `pnpm db:generate` (compiles then generates migration)
4. Run `pnpm -r typecheck` to validate

Note: `drizzle.config.ts` reads compiled schema from `dist/schema/*.js`, so the generate script compiles first.

## Adding API Endpoints

When adding new routes in `server/src/routes/`:
- Apply company access checks
- Enforce actor permissions (board vs agent)
- Write activity log entries for mutations
- Return consistent HTTP errors (`400/401/403/404/409/422/500`)

## Test Projects

Vitest workspace projects (defined in root `vitest.config.ts`): `packages/db`, `packages/adapters/codex-local`, `packages/adapters/opencode-local`, `server`, `ui`, `cli`. E2E tests use Playwright at `tests/e2e/`.

## Lockfile Policy

Do not commit `pnpm-lock.yaml` in pull requests. CI on master regenerates it.
