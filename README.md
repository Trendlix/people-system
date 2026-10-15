# People System · TrendLIX Management System

Spec, prototype screens and decisions live in `../trendlix-hrms-handoff` (start with its `README.md` and `docs/`).
Deployment: see [DEPLOY.md](DEPLOY.md).

## What's live

| Module | Status |
|---|---|
| Sign-in, roles (Employee, Manager, HR, Finance, CEO, Admin, Super Admin), audit log | Done. **Only a Super Admin deletes records**; Super Admin has Admin's rights plus deleting, and only a Super Admin grants the role |
| 1 · Organization: company profile and logo, departments and their teams, job titles (on a department or a team) with grade ranges and rich-text job descriptions, grades, shifts | Done. HR and Admin edit, everyone else views |
| Users: sign-in accounts, roles, temporary passwords; everyone can change their own password | Done. Admin and Super Admin |
| 2 · Employees: directory, profile (personal, contact, education, employment with grade), national ID and bank (restricted, every view audited), completeness of all data and papers | Done. HR edits; HR, CEO and Finance see everyone, a manager their team, an employee themself |
| Employees confirm their own details (statement in English and Arabic) and ask for changes, approved by HR or Admin | Done |
| Employee file: scanned paperwork per employment type, text read by OCR and searchable, "Fill from ID card photos", scanning from network scanners (`tools/scan-helper`), crop and adjust | Done. HR and CEO |
| 3 · Contracts: versions per employment (fixed term, 3-month probation once per employer), ending rules, endings approved by HR then the CEO (Labour Law 14/2025) | Phase 1 done; document generation (templates) next |
| Templates: the document library (23 slots), Word templates uploaded as drafts, their {{tags}} checked against the tag list, published versions, tag reference | Library done (HR, Admin; CEO views); filling templates in for employees next |

## Layout

| Path | What it is |
|---|---|
| `apps/web` | Next.js frontend (port 3000). Talks only to the API, server-side. |
| `apps/api` | NestJS API (port 3001, all routes under `/api`) |
| `apps/api/prisma/schema.prisma` | Database schema (Prisma 7); migrations in `apps/api/prisma/migrations` |
| `packages/shared` | Types and value lists used by both apps |
| `tools/scan-helper` | TrendLIX Scan Helper (Go): runs on HR's computers and scans from the office's network scanners for the web app ([README](tools/scan-helper/README.md)) |
| `services/ocr` | OCR service (Python, PaddleOCR): reads national ID cards and scanned documents for the API; internal only, port 8000 on the Docker network ([README](services/ocr/README.md)) |
| `deploy/` | What the server runs: Docker Compose (PostgreSQL, API, OCR, daily backup), `deploy.sh`, `ci-key.sh` ([DEPLOY.md](DEPLOY.md)) |
| `.github/workflows/backend.yml` | CI/CD: deploys the API to the server on every push to `main` that touches it |

## Conventions

- **Dates and times on screen:** every date is DD/MM/YYYY (14/10/2026) and every time is 12-hour (9:00 AM), on every screen. Show them with the helpers in `apps/web/src/lib/format.ts` (`formatDate`, `formatTime`, `formatDateTime`) and take them in forms with `DateInput` / `TimeInput` from `apps/web/src/components/date-time-inputs.tsx` (plain text fields: the browser's own pickers follow the computer's region). Server actions read them with `dateFrom` / `timeFrom` from `apps/web/src/lib/form-data.ts`.
- **The API** sends and accepts dates as YYYY-MM-DD and times as HH:mm (24-hour); only the web app converts.
- **Moments** (created at, updated at) are shown in Cairo time.
- Titles and headings are Title Case; labels, buttons and messages are sentence case.

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

Locally the database is `trendlix_hrms`, owned by the `trendlix` user; end-to-end tests use a separate `trendlix_hrms_test` database (`TEST_DATABASE_URL`), emptied and seeded again at the start of every run (only a database whose name contains "test" is ever emptied).

## Every day

1. Make sure PostgreSQL is running: open Postgres.app and press **Start** (turn on "Automatically start at login" in its settings).
2. From this folder: `npm run dev`, then open http://localhost:3000 and sign in.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Run API + web in watch mode |
| `npm run build` | Build shared, API and web |
| `npm test` | Unit tests of the API and of the web app (e.g. the ID scan's card geometry) |
| `npm run test:e2e -w @trendlix/api` | API end-to-end tests against the test database (needs PostgreSQL running) |
| `npm run db:migrate -w @trendlix/api` | After editing `schema.prisma`: create a migration, apply it locally, regenerate the client |
| `npm run db:deploy -w @trendlix/api` | Apply existing migrations (production) |
| `npm run db:seed -w @trendlix/api` | Load roles, shifts, company details and the first admin (safe to repeat) |
| `npm run db:studio -w @trendlix/api` | Browse the database in the browser |

If Postgres.app doesn't show the server, start it from the terminal:

```bash
/Applications/Postgres.app/Contents/Versions/17/bin/pg_ctl -D "$HOME/Library/Application Support/Postgres/var-17" -l "$HOME/Library/Application Support/Postgres/var-17/postgresql.log" start
```
