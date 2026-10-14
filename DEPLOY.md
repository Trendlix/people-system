# Deploying People System

| Part | Where | Address |
|---|---|---|
| Web (Next.js, `apps/web`) | Vercel, project `people-system` | `https://people.trendlix.com` |
| API (NestJS, `apps/api`) + PostgreSQL | Hostinger VPS shared with Prime ERP (`srv2055591.hstgr.cloud`), Docker Compose in `/opt/people-system` | `https://srv2055591.hstgr.cloud:8443` |

The browser only talks to the web app on Vercel. Vercel calls the API server-to-server, so the API needs no CORS setup
and its address is never shown to browsers.

## How the server is shared with Prime ERP

Owner's decision, 14 October 2026: same server as Prime ERP, its own port.

- People System has its **own** containers (`deploy/docker-compose.yml`): PostgreSQL 17, the API, and a daily backup.
  None of them opens a port.
- **Prime ERP's Caddy** already holds ports 80/443 and the HTTPS certificate for `srv2055591.hstgr.cloud`. It also listens
  on **8443** and passes that to People System's API (the last site of Prime ERP's `production/deploy/Caddyfile`).
- The two systems meet only on the Docker network **`edge`**: Caddy and People System's API, nothing else. Each system's
  `deploy.sh` creates it if it is missing. Prime ERP's database and API are not on it.
- Each system has its own database, backups, deploy key on GitHub, and pipeline. Deploying one never restarts the other.

## Every day: CI/CD

A push to `main`:

- **Web:** Vercel builds and deploys `apps/web` by itself.
- **API:** if the push touches `apps/api`, `packages/shared`, `deploy/` or the lock file, GitHub Actions
  (`.github/workflows/backend.yml`) signs in to the server with a key that can do one thing there, run `deploy/deploy.sh`:
  fetch, **save the database**, build the API image, restart, wait until healthy. Then it checks
  `https://srv2055591.hstgr.cloud:8443/api/health` and prints `/api/version`.

The pipeline runs no tests: run them before pushing (`npm run build`, `npm test`, `npm run test:e2e -w @trendlix/api`).
"Run workflow" on the repository's Actions page deploys by hand; so does `./deploy.sh` on the server.

Which code the server runs: `curl https://srv2055591.hstgr.cloud:8443/api/version` answers with the last commit that
changed the API and its date.

## First time on the server (once)

Run on the VPS as `root`, in this order.

**1. Port 8443 is free, and open in the firewall.** This must print nothing:

```bash
ss -ltnp | grep ':8443 '
```

Then in Hostinger's panel: VPS → Firewall → allow incoming TCP **8443**.

**2. A read-only key for this repository.** The server already has a deploy key for Prime ERP, and GitHub accepts a
key on one repository only, so this one gets its own name:

```bash
ssh-keygen -t ed25519 -N "" -C "people-system-read" -f ~/.ssh/people_system_deploy
cat ~/.ssh/people_system_deploy.pub
```

GitHub → Trendlix/people-system → Settings → Deploy keys → Add deploy key: paste it, leave "Allow write access" off.
Then:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github-people-system
  HostName github.com
  User git
  IdentityFile ~/.ssh/people_system_deploy
  IdentitiesOnly yes
EOF
git clone git@github-people-system:Trendlix/people-system.git /opt/people-system
```

**3. Settings.**

```bash
cd /opt/people-system/deploy
cp .env.example .env
openssl rand -hex 24      # paste as POSTGRES_PASSWORD
openssl rand -base64 48   # paste as JWT_SECRET
nano .env                 # also SEED_ADMIN_EMAIL and a NEW SEED_ADMIN_PASSWORD
```

**4. First deploy.**

```bash
./deploy.sh
```

It ends with the list of containers; `api` and `db` should say `healthy`.

**5. Caddy on port 8443.** Prime ERP's change (Caddy also listening on 8443) is deployed by Prime ERP's own pipeline
when it is pushed. Its deploy recreates Prime ERP's Caddy, which takes a few seconds.

**6. Starting data** (roles, shifts A/B, company details, first admin). Safe to repeat; it never overwrites:

```bash
docker compose exec api npm run db:seed -w @trendlix/api
```

Then remove `SEED_ADMIN_PASSWORD` from `.env`.

**7. Check from anywhere:** `https://srv2055591.hstgr.cloud:8443/api/health` → `{"status":"ok","database":"ok"}`.

**8. The pipeline's key.**

```bash
./ci-key.sh
```

It prints two values. GitHub → Trendlix/people-system → Settings → Secrets and variables → Actions → New repository
secret: `VPS_SSH_KEY` and `VPS_KNOWN_HOSTS`. Its key is named differently from Prime ERP's, so neither replaces the other.

**9. Vercel.** people-system → Settings → Environment Variables: `API_URL` = `https://srv2055591.hstgr.cloud:8443`
(no trailing slash, no `/api`). Then redeploy, because settings apply to new deployments only.

## On the server

| Task | Command (in `/opt/people-system/deploy`) |
|---|---|
| Deploy by hand | `./deploy.sh` |
| API log | `docker compose logs -f api` |
| Container state | `docker compose ps` |
| Restore a save | `docker compose exec -T db pg_restore -U people -d people_system --clean --if-exists < backups/<file>` |

Backups: a full save every day and before every deploy, in `deploy/backups/` (14 days kept). They hold national IDs and
salaries: keep a copy off the server too, and restrict who can read it.

## Security notes

- Sign-in sessions last 8 hours and are stored in an HttpOnly, Secure cookie on the Vercel domain.
- After 10 failed sign-ins for the same email within 15 minutes, that email is refused for 15 minutes.
- Every sign-in, failed sign-in and change to the company profile, departments, job titles and shifts is written to the `audit_log` table.
- The company representative's national ID is stored but never returned in full by the API, and never written to the audit log.
- Logos are checked by their content (PNG, JPEG or WebP only, up to 1 MB); SVG is refused because it can contain scripts.
- The pipeline's key can only run `deploy.sh` (no shell, no file copy, no forwarding). The server's GitHub key is read-only.
