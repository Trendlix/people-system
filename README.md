# People System · TrendLIX Management System

Spec, prototype screens and decisions live in `../trendlix-hrms-handoff` (start with its `README.md` and `docs/`).
Deployment: see [DEPLOY.md](DEPLOY.md).

## What's live

| Module | Status |
|---|---|
| Sign-in, roles (Employee, Manager, HR, Finance, CEO, Admin, Super Admin), audit log; the **Audit Log** page: who changed what and when, filtered by days, who, action, record and person (an employee's History, from their profile), exported to Excel | Done. **Only a Super Admin deletes records**; Super Admin has Admin's rights plus deleting, and only a Super Admin grants the role. The Audit Log is the Super Admin's and the CEO's; restricted values stay masked |
| 1 · Organization: company profile and logo, departments and their teams, job titles (on a department or a team) with grade ranges and rich-text job descriptions, grades, shifts, allowance kinds (taxed / insured or not), org chart (PDF A4/A3, PNG, SVG) | Done. HR and Admin edit, everyone else views |
| Users: sign-in accounts, roles, temporary passwords; everyone can change their own password | Done. Admin and Super Admin |
| 2 · Employees: directory, profile (personal, contact, education, employment with grade), national ID and bank (restricted, every view audited), completeness of all data and papers | Done. HR edits; HR, CEO and Finance see everyone, a manager their team, an employee themself. **C-level** (a grade marked confidential, G9 · Executive): only the CEO, the Super Admin and the person themself see their details and pay; everyone else gets their directory card, their payroll lines are one hidden row, and HR's stages of their requests go to the CEO |
| Employees confirm their own details (statement in English and Arabic) and ask for changes, approved by HR or Admin | Done |
| Employee file: scanned paperwork per employment type, text read by OCR and searchable, "Fill from ID card photos", scanning from network scanners (`tools/scan-helper`), crop and adjust | Done. HR and CEO |
| 3 · Contracts: versions per employment (fixed term only, 3-month probation once per employer), monthly or hourly pay, days a week, allowances, ending rules, endings approved by HR then the CEO (Labour Law 14/2025), undo signing (Super Admin), salary calculator | Done |
| Job offers: drafted by HR, filled in from the offer template, sent by email (SMTP) or as a link, accepted or declined by the candidate on a public page; accepting makes the profile, employment and draft contract | Done. HR; CEO views. Email needs the SMTP settings (DEPLOY.md) |
| Templates: the document library (23 slots), Word templates in Arabic, English or both, their {{tags}} checked against the tag list, published versions, tag reference; documents filled in for each employee | Done (Super Admin only: uploads, edits, publishes) |
| Sessions: server-side sessions; HR, Admin and Super Admin signed out after 15 minutes without activity (a warning a minute before); one website and one app session a person, the newest of a kind wins; Your Sessions; View as (Super Admin) | Done |
| Employment types by Labour Law 14/2025 (full-time with commission, part-time by the hour, trainee renewed once, unpaid internship, freelance outside the law), department heads and team leads (default manager, approve when there is none) | Done |
| Raises: asked by HR, decided by the CEO, amendment or new contract from the 1st; Raise Requests, Salary Raises report | Done. Hidden from employees and managers for now (one switch, `EMPLOYEE_LEVEL_SEES_RAISES`) |
| 4 · Leave: every leave of the law, balances by calendar year, Year Closing (carry over or pay), permission requests (4 hours a month, 2 a day), manager then HR | Done |
| 5 · Attendance: Zoho People import, check-in on the system (website and app) with a live counter, the spot of each press with a Map link (HR, CEO, Super Admin and the person), corrections, Daily Attendance, Summary; make-up hours within the month counted until a shift's limit (8 PM on MORNING) | Done |
| Check-in Setup: check-in locations on a map, the office network lock (WEB_KEY), refusing presses without a location, home locations approved by HR then the CEO | Done. The lock needs `deploy/web-key.sh` and WEB_KEY in Vercel (DEPLOY.md) |
| 6 · Payroll: monthly runs approved by the CEO, tax and social insurance, CIB and ACH bank files, additions and deductions, loans and installments, recurring deductions, reimbursements (manager, HR, Finance), final settlements, reports, Payroll Setup, payslips (PDF, English and Arabic) | Done |
| 7 · KPIs: four pillars with fixed weights (Delivery & Timeliness 30%, Quality of Work 25%, Clients & Teamwork 25%, Discipline & Growth 20%); a template per job title built from its JD (metrics with a criteria scale, the automatic Attendance metric, samples, copies), draft and published versions applying from next month; a KPI role library (23 agency roles, a general template per kind of department, a universal one): "Draft templates for every job title" from the role each title (else its department) matches, in English or Arabic, a team leadership metric for heads, leads, managers, directors and supervisors, metrics linked to the JD's duties, never published by itself; "From the role library" for one job title; "Publish selected drafts"; a scorecard a person and month, opened on the 1st of the next: self-rating, the manager in charge scores, HR calibrates (a reason for each change), sign-off by both, final by the 10th; levels shown; the next month's payroll takes the final % (in full from 80%, in proportion below, none final: not cut), on the payroll line and the payslip; My KPIs, Team KPIs (heatmap), All KPIs (by department, Excel), KPI Templates with the deadlines; on Approvals and the phone pages | Done. C-level people's scored by the CEO, never shown to HR |
| 8 · Assets, step 1 of 5 (the register): each user's Assets access on the Users page (none, viewer, custodian, manager; a Super Admin always a manager, the CEO and Finance at least viewers), the five groups (Studio installed, Production kit, IT and devices, Office furniture and equipment, Consumables and stock), type codes and codes PREFIX-TYPE-NNNN given in the database (never changed, never given again), statuses (custody only by a handover), consumables by quantity, rooms, production kits (PK-KIT-A …), up to 6 photos an asset, the asset's page at /assets/{code} with its QR code and a printed label, the capitalization threshold, the values (purchase cost, supplier and invoice, market value low / mid / high, book value or Expensed) and "Needs values"; the phone pages (/app/assets: the list, adding with the camera, an asset's page). Step 2, the **Claude connector** ([Connector](#connector)): a remote MCP server at /api/mcp that the owner adds to their own Claude, signed in to with OAuth (the system's sign-in, then "Allow Claude to use your Assets access in Trendlix People?"), reading the register, who holds what, overdue returns, stock, counts due, rooms and kits, and drafting assets; **Drafts from Claude** (never assets until confirmed on the Add form, where the code is given and the photos added; or discarded), Assets → Connect Claude | Steps 1 and 2 done. The values only for the CEO, Finance and the Super Admin, never sent to anyone else, through Claude too; deleting an asset the Super Admin's, only one never in custody. Next: custody, kits / stock / repairs / disposal, counts / labels / dashboard |
| Notifications: the bell and inbox, push to the phone (FCM), the check-in reminder every 10 minutes for 2 hours with a popup, "Still checked in?" | Done. Push needs the FCM settings (DEPLOY.md) |
| The employee mobile app **Trendlix People** (`apps/mobile`, Capacitor): the phone pages at `/app`, native location with fake-GPS flag, camera, fingerprint sign-in, push; debug APKs from GitHub Actions | Phases 0–5 done; iPhone after an Apple Developer account ([plan](apps/mobile/README.md)) |
| Not built yet | Offboarding's clearance checklist, exit interview and leavers log; recruitment beyond job offers; projects and timesheets; an attendance device; email notifications |

## Layout

| Path | What it is |
|---|---|
| `apps/web` | Next.js frontend (port 3000). Talks only to the API, server-side. |
| `apps/api` | NestJS API (port 3001, all routes under `/api`) |
| `apps/api/prisma/schema.prisma` | Database schema (Prisma 7); migrations in `apps/api/prisma/migrations` |
| `packages/shared` | Types and value lists used by both apps |
| `tools/scan-helper` | TrendLIX Scan Helper (Go): runs on HR's computers and scans from the office's network scanners for the web app ([README](tools/scan-helper/README.md)) |
| `services/ocr` | OCR service (Python, PaddleOCR): reads national ID cards and scanned documents for the API; internal only, port 8000 on the Docker network ([README](services/ocr/README.md)) |
| `deploy/` | What the server runs: Docker Compose (PostgreSQL, API, OCR, PDF converter, daily backup), `deploy.sh`, `ci-key.sh` ([DEPLOY.md](DEPLOY.md)) |
| `.github/workflows/backend.yml` | CI/CD: deploys the API to the server on every push to `main` that touches it |
| `apps/mobile` | The employee app, Trendlix People (Capacitor 8 over the phone pages at `/app`); its plan and guide: [README](apps/mobile/README.md) |
| `.github/workflows/mobile-android.yml` | Builds the Android APK on every change to the app (kept 30 days as an artifact; a `mobile-v*` tag makes a release) |

## Conventions

- **Dates and times on screen:** every date is DD/MM/YYYY (14/10/2026) and every time is 12-hour (9:00 AM), on every screen. Show them with the helpers in `apps/web/src/lib/format.ts` (`formatDate`, `formatTime`, `formatDateTime`) and take them in forms with `DateInput` (a field with a mini calendar) / `TimeInput` (hour, minutes in quarters and AM/PM selectors) from `apps/web/src/components/date-time-inputs.tsx` (never the browser's own pickers, which follow the computer's region). Server actions read them with `dateFrom` / `timeFrom` from `apps/web/src/lib/form-data.ts`.
- **The API** sends and accepts dates as YYYY-MM-DD and times as HH:mm (24-hour); only the web app converts.
- **Moments** (created at, updated at) are shown in Cairo time.
- Titles and headings are Title Case; labels, buttons and messages are sentence case.

## Connector

The Claude connector (Assets, step 2; owner, 21 October 2026: "the connection method"): Claude reads the Assets section and drafts assets on the owner's own Claude subscription, with no Anthropic API key and no API billing. What it follows, read on 21 October 2026:

- **MCP specification, revision 2026-07-28:** the [Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) (read at 2025-11-25, as the 2026-07-28 page didn't load; POST only here, stateless, JSON answers; the `Origin` header checked, 403 when it's another site's) and [Authorization](https://modelcontextprotocol.io/specification/latest/basic/authorization): OAuth 2.1 with PKCE (S256 only, `code_challenge_methods_supported`), [Protected Resource Metadata](https://datatracker.ietf.org/doc/html/rfc9728) (a 401 with `WWW-Authenticate: Bearer resource_metadata="…"`, the document at `/.well-known/oauth-protected-resource` and `…/api/mcp`), [Authorization Server Metadata](https://datatracker.ietf.org/doc/html/rfc8414) at `/.well-known/oauth-authorization-server`, [resource indicators](https://www.rfc-editor.org/rfc/rfc8707.html) (every token is bound to `https://people.trendlix.com/api/mcp`), `iss` on the way back ([RFC 9207](https://datatracker.ietf.org/doc/html/rfc9207)), refresh tokens rotated for public clients. In this revision [client registration](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration) prefers Client ID Metadata Documents and calls dynamic client registration ([RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591)) deprecated but supported.
- **Anthropic's connector docs:** [Authentication for connectors](https://claude.com/docs/connectors/building/authentication) (Claude's hosted apps return to `https://claude.ai/api/mcp/auth_callback`, which "may change to" `https://claude.com/api/mcp/auth_callback`; DCR and CIMD are both supported by default, CIMD only when the metadata advertises `client_id_metadata_document_supported` and `none`; Claude registers as a public client; a 401 with `WWW-Authenticate` starts sign-in; refresh on a 401 or 5 minutes before expiry, `invalid_grant` for a dead refresh token; 10 seconds for discovery, registration and tokens; traffic from `160.79.104.0/21`), [Lazy authentication](https://claude.com/docs/connectors/building/lazy-authentication) (answer the 401 before the MCP SDK runs) and [Add a connector that isn't in the directory](https://claude.com/docs/connectors/custom/add-unlisted) (Customize → Connectors → Add custom connector, any plan; the Free plan, one).
- **MCP TypeScript SDK:** `@modelcontextprotocol/sdk` **1.32.1** (the v1 line the brief names, with security fixes until at least January 2027; v2, `@modelcontextprotocol/server`, is the new stable line and a later move), served from a Next.js route handler with `WebStandardStreamableHTTPServerTransport` (`sessionIdGenerator: undefined`, `enableJsonResponse: true`), a server and transport per request, as Vercel needs; tool schemas in `zod` 4.6.7.

How it is built:

- **Website** (`apps/web`): `/api/mcp` (lib/connector/mcp.ts checks the request before the SDK, then the 12 tools of lib/connector/tools.ts), the metadata documents, `/oauth/register`, `/oauth/token` (form-encoded), `/oauth/revoke` (passed on to the API) and the consent page `/oauth/authorize` (the system's sign-in first when needed). Claude registers itself (DCR); Client ID Metadata Documents aren't advertised, but one on claude.ai or claude.com is accepted if Claude sends it.
- **API** (`apps/api/src/connector`): the clients (Claude's return addresses only), codes (5 minutes, once, PKCE), tokens (opaque, kept as SHA-256: access an hour, refresh rotated, used again a minute later the connection ends) and a third kind of session, `connector` (one a person, no 15 minutes, 90 days without a refresh). Its token reaches only the routes marked `@ConnectorScope()` (the Assets reads and the drafts); confirming or discarding a draft, values, photos, deleting, custody, counts and settings stay the website's. It ends on Your Sessions, on the Users page, with a password change or reset, or when the account is deactivated. Everything it changes is in the audit log as the person's, "via Claude connector".
- Claude Code's loopback return addresses aren't accepted: only Claude's hosted apps connect.

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
