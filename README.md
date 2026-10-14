# TrendLIX Management System (HRMS)

Spec, prototype screens and decisions live in `../trendlix-hrms-handoff` (start with its `README.md` and `docs/`).

## Layout

| Path | What it is |
|---|---|
| `apps/web` | Next.js frontend (port 3000) |
| `apps/api` | NestJS API (port 3001, all routes under `/api`) |
| `apps/api/prisma/schema.prisma` | Database schema (Prisma 7) |
| `packages/shared` | Types and value lists used by both apps |

## Requirements

- Node.js 22 or newer
- PostgreSQL 17, installed with **Postgres.app** (`/Applications/Postgres.app`)

## First-time setup

```bash
npm install
cp apps/api/.env.example apps/api/.env   # then put the real database password in it
cp apps/web/.env.example apps/web/.env
```

The local database is `trendlix_hrms`, owned by the `trendlix` user.

## Every day

1. Make sure PostgreSQL is running: open Postgres.app and press **Start** (turn on "Automatically start at login" in its settings so you don't have to).
2. From this folder:

```bash
npm run dev        # starts the API and the web app together
```

Open http://localhost:3000. The page says **"API and database: connected"** when everything is up. The API health check is http://localhost:3001/api/health.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Run API + web in watch mode |
| `npm run build` | Build shared, API and web |
| `npm test` | API unit tests |
| `npm run test:e2e -w @trendlix/api` | API end-to-end tests (needs PostgreSQL running) |
| `npm run db:migrate -w @trendlix/api` | Create and apply a migration after editing `schema.prisma` |
| `npm run db:studio -w @trendlix/api` | Browse the database in the browser |

If Postgres.app doesn't show the server, start it from the terminal:

```bash
/Applications/Postgres.app/Contents/Versions/17/bin/pg_ctl -D "$HOME/Library/Application Support/Postgres/var-17" -l "$HOME/Library/Application Support/Postgres/var-17/postgresql.log" start
```
