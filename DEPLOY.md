# Deploying People System

| Part | Where | Folder |
|---|---|---|
| Web (Next.js) | Vercel | `apps/web` |
| API (NestJS) | Hostinger | `apps/api` |
| Database | PostgreSQL 15 or newer | — |

The browser only talks to the web app on Vercel. Vercel calls the API server-to-server, so the API needs no CORS setup and its address is never shown to browsers.

## 1. Database

The API needs **PostgreSQL**. Hostinger's shared and cloud hosting plans come with MySQL, not PostgreSQL, so use one of:

- a **Hostinger VPS** with PostgreSQL installed on it, or
- a managed PostgreSQL service (e.g. Neon, Supabase).

The database will hold national IDs and salaries, so check where the provider stores data before choosing.

Create an empty database and a user that owns it, and note the connection string:

```
postgresql://USER:PASSWORD@HOST:5432/DATABASE?schema=public
```

## 2. API on Hostinger

Needs Node.js 22 or newer. Deploy the **whole repository** (it's one project with several apps), not only `apps/api`.

### Environment variables

Set these in Hostinger's panel, or put them in `apps/api/.env`:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | The port Hostinger gives the app (defaults to 3001) |
| `DATABASE_URL` | Connection string from step 1 |
| `JWT_SECRET` | A long random string, e.g. the output of `openssl rand -base64 48`. Keep it secret; changing it signs everyone out. |
| `SEED_ADMIN_EMAIL` | Email of the first admin account (first deploy only) |
| `SEED_ADMIN_PASSWORD` | Its password (first deploy only; remove it afterwards) |

### Commands (run from the repository root)

```bash
npm ci --include=dev                 # dev tools are needed to build
npm run build -w @trendlix/shared
npm run build -w @trendlix/api
npm run db:deploy -w @trendlix/api   # creates/updates the database tables
npm run db:seed -w @trendlix/api     # FIRST DEPLOY ONLY: roles, shifts A/B, admin account
npm run start:prod -w @trendlix/api  # starts the API
```

On later deploys run everything except `db:seed`.

On a VPS, keep the API running with PM2 and serve it over HTTPS (Nginx + Let's Encrypt, or Hostinger's SSL), for example at `https://api.yourdomain.com`:

```bash
pm2 start npm --name people-api -- run start:prod -w @trendlix/api
pm2 save
```

**Check:** `https://api.yourdomain.com/api/health` should return `{"status":"ok","database":"ok"}`.

## 3. Web on Vercel

1. In Vercel, **Add New → Project** and import the GitHub repository.
2. **Root Directory:** `apps/web`. Framework preset: Next.js (detected). Leave the build and install commands as they are.
3. **Environment variable:** `API_URL` = the API address from step 2, e.g. `https://api.yourdomain.com` (no trailing slash, no `/api`).
4. Deploy, open the site and sign in with `SEED_ADMIN_EMAIL`.

## Security notes

- Sign-in sessions last 8 hours and are stored in an HttpOnly, Secure cookie on the Vercel domain.
- After 10 failed sign-ins for the same email within 15 minutes, that email is refused for 15 minutes.
- Every sign-in, failed sign-in and change to departments, job titles and shifts is written to the `audit_log` table.
