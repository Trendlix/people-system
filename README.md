# People System · TrendLIX Management System

Spec, prototype screens and decisions live in `../trendlix-hrms-handoff` (start with its `README.md` and `docs/`).
Deployment: see [DEPLOY.md](DEPLOY.md).

## What's live

| Module | Status |
|---|---|
| Sign-in, roles (Employee, Manager, HR, Finance, CEO, Admin), audit log | Done |
| 1 · Organisation: departments, job titles with job descriptions, shifts | Done. HR and Admin edit, everyone else views |
| 2 · Employees | Next |
| 3 · Contracts | Next |

## Layout

| Path | What it is |
|---|---|
| `apps/web` | Next.js frontend (port 3000). Talks only to the API, server-side. |
| `apps/api` | NestJS API (port 3001, all routes under `/api`) |
| `apps/api/prisma/schema.prisma` | Database schema (Prisma 7); migrations in `apps/api/prisma/migrations` |
| `packages/shared` | Types and value lists used by both apps |

## Requirements

- Node.js 22 or newer
- PostgreSQL 17, installed locally with **Postgres.app** (`/Applications/Postgres.app`)

## First-time setup

```bash
npm install
cp apps/api/.env.example apps/api/.env   # fill in DATABASE_URL, JWT_SECRET, SEED_ADMIN_*
cp apps/web/.env.example apps/web/.env
npm run db:deploy -w @trendlix/api       # create the tables
npm run db:seed -w @trendlix/api         # roles, shifts A/B and the admin account from SEED_ADMIN_*
```

Locally the database is `trendlix_hrms`, owned by the `trendlix` user; end-to-end tests use a separate `trendlix_hrms_test` database (`TEST_DATABASE_URL`).

## Every day

1. Make sure PostgreSQL is running: open Postgres.app and press **Start** (turn on "Automatically start at login" in its settings).
2. From this folder: `npm run dev`, then open http://localhost:3000 and sign in.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Run API + web in watch mode |
| `npm run build` | Build shared, API and web |
| `npm test` | API unit tests |
| `npm run test:e2e -w @trendlix/api` | API end-to-end tests against the test database (needs PostgreSQL running) |
| `npm run db:migrate -w @trendlix/api` | After editing `schema.prisma`: create a migration, apply it locally, regenerate the client |
| `npm run db:deploy -w @trendlix/api` | Apply existing migrations (production) |
| `npm run db:seed -w @trendlix/api` | Load roles, shifts and the first admin (safe to repeat) |
| `npm run db:studio -w @trendlix/api` | Browse the database in the browser |

If Postgres.app doesn't show the server, start it from the terminal:

```bash
/Applications/Postgres.app/Contents/Versions/17/bin/pg_ctl -D "$HOME/Library/Application Support/Postgres/var-17" -l "$HOME/Library/Application Support/Postgres/var-17/postgresql.log" start
```
