# Deploying People System

| Part | Where | Address |
|---|---|---|
| Web (Next.js, `apps/web`) | Vercel, project `people-system` | `https://people.trendlix.com` |
| API (NestJS, `apps/api`) + PostgreSQL | Hostinger VPS (`srv2055591.hstgr.cloud`), Docker Compose in `/opt/people-system` | `https://srv2055591.hstgr.cloud:8443` |
| OCR (Python, `services/ocr`) | Same server, same Docker Compose | None outside: the API calls it at `http://ocr:8000` |
| PDF converter (Gotenberg, LibreOffice) | Same server, same Docker Compose | None outside: the API calls it at `http://pdf:3000` |
| Email | The company's own email provider, by SMTP | Set by a Super Admin in Organization → Email Settings; `deploy/.env` the fallback (see [Email](#email)) |
| Push notifications (the employee app) | Firebase Cloud Messaging (HTTP v1), from the API | Set in `deploy/.env` and a GitHub secret (see [Push notifications](#push-notifications-fcm)) |

The browser only talks to the web app on Vercel. Vercel calls the API server-to-server, so the API needs no CORS setup
and its address is never shown to browsers.

## How the server is shared with Prime ERP

Owner's decision, 14 October 2026: same server as Prime ERP, its own port.

- People System has its **own** containers (`deploy/docker-compose.yml`): PostgreSQL 17, the API, the OCR service,
  the PDF converter, Caddy for HTTPS, and a daily backup, on a Docker network of their own. Only Caddy opens a port: **8443**.
- Ports 80/443 belong to Prime ERP, and a public certificate can only be obtained through them. So People System's Caddy
  issues its certificate from a **private authority** of its own (`tls internal`, see `deploy/Caddyfile`). The web app
  on Vercel trusts exactly that authority through the setting `API_CA_CERT` (printed by `deploy/ca-cert.sh`); so does
  the pipeline's health check. Browsers never call the API, so they never see this certificate.
- Nothing is shared with Prime ERP: its own database, backups, deploy key on GitHub, and pipeline. Deploying one never
  restarts the other.

## Every day: CI/CD

A push to `main`:

- **Web:** Vercel builds and deploys `apps/web` by itself.
- **API:** if the push touches `apps/api`, `packages/shared`, `services/`, `deploy/` or the lock file, GitHub Actions
  (`.github/workflows/backend.yml`) signs in to the server with a key that can do one thing there, run `deploy/deploy.sh`:
  fetch, **save the database**, build the API and OCR images, restart, wait until healthy. Then it checks
  `https://srv2055591.hstgr.cloud:8443/api/health` (trusting `API_CA_CERT`) and prints `/api/version`.

The pipeline runs no tests: run them before pushing (`npm run build`, `npm test`, `npm run test:e2e -w @trendlix/api`).
"Run workflow" on the repository's Actions page deploys by hand; so does `./deploy.sh` on the server.

Which code the server runs: `curl -k https://srv2055591.hstgr.cloud:8443/api/version` answers with the last commit that
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

It ends with the list of containers; `api`, `db` and `ocr` should say `healthy`. The first build of the OCR image takes
a few minutes (see [The OCR service](#the-ocr-service)).

**5. The certificate's authority.** Caddy makes it on its first start:

```bash
./ca-cert.sh
```

It prints one line: save it as `API_CA_CERT` in Vercel (step 9) and as a repository **variable** on GitHub
(Settings → Secrets and variables → Actions → Variables). It stays the same across deploys; only if the volume
`caddy_data` is deleted does Caddy make a new one, and then this is run and saved again.

**6. Starting data** (roles, shifts A/B, company details, first admin). Safe to repeat; it never overwrites:

```bash
docker compose exec api npm run db:seed -w @trendlix/api
```

Then remove `SEED_ADMIN_PASSWORD` from `.env`.

**7. Check from anywhere:** `curl -k https://srv2055591.hstgr.cloud:8443/api/health` → `{"status":"ok","database":"ok"}`
(`-k` because the certificate comes from the private authority; a browser shows a warning for the same reason).

**8. The pipeline's key.**

```bash
./ci-key.sh
```

It prints two values. GitHub → Trendlix/people-system → Settings → Secrets and variables → Actions → New repository
secret: `VPS_SSH_KEY` and `VPS_KNOWN_HOSTS`, under **Repository secrets** (not Environment secrets: the workflow uses
no environment, so it cannot see those). Its key is named differently from Prime ERP's, so neither replaces the other.

**9. Vercel.** people-system → Settings → Environment Variables, Production: `API_URL` = `https://srv2055591.hstgr.cloud:8443`
(no trailing slash, no `/api`) and `API_CA_CERT` = the line from step 5. Then redeploy, because settings apply to new deployments only.

**10. The website's key** (for locking check-ins to the office network, see [below](#check-ins-locked-to-the-office-network-web_key)):

```bash
./web-key.sh   # writes WEB_KEY into .env if it has none, and prints it
./deploy.sh    # the API starts with it
```

Then in Vercel, the same page as step 9: `WEB_KEY` = the value it printed, and redeploy.

## The OCR service

`services/ocr` reads the text of national ID cards (phone photos), scanned certificates and signed contracts for the
API: PaddleOCR 3 with its Arabic and English models, on the CPU ([services/ocr/README.md](services/ocr/README.md)).

- **Internal only.** It opens no port and has no sign-in: only containers on People System's own Docker network reach
  it, and the API calls it at `http://ocr:8000` (`OCR_URL`). Photos and scans are read in memory and never written to
  disk or to its log, and it makes no connection to the internet: its models are inside the image.
- **Memory.** About 250 MB idle, about 1.1 GB while it reads a file, 1.4 GB at most on a dense page; Docker stops it at
  2 GB. Before the first deploy with it, `free -h` on the server must show at least **1.5 GB** in the `available`
  column, with Prime ERP and the rest of People System running. With less, add memory (or swap) first: otherwise
  reading a file can slow the whole server, Prime ERP included.
- **Disk.** The image is about 0.9 GB. `deploy.sh` builds it with the API; its first build takes a few minutes and
  downloads PaddleOCR and its models (the only time it needs the internet). Later deploys rebuild it only when
  `services/ocr` changes.
- **If it is down,** the API keeps working; only reading documents fails until it is back. Docker restarts it by itself.

Check it (in `/opt/people-system/deploy`):

```bash
docker compose ps ocr                 # "healthy"
docker compose exec api node -e "fetch('http://ocr:8000/health').then(r => r.text()).then(console.log)"   # {"status":"ok"}
docker compose logs -f ocr            # one line per file read: kind, size, pages, lines, seconds; never the text
docker stats --no-stream              # memory of each container
```

## The PDF converter

Filled documents leave the system only as protected PDFs (owner's request, 15 October 2026: "No doc file export, just
a protected PDF"): the API fills the Word template, the `pdf` container (Gotenberg's LibreOffice image,
`gotenberg/gotenberg:8.37.0-libreoffice`) turns it into a PDF, and the API encrypts that (AES-256, no password to open
it, printing allowed, editing and copying not). Generated documents, job offers and templates previewed with data are
never given as Word files.

- **Internal only**, like the OCR service: no port, reached by the API at `http://pdf:3000` (`PDF_URL`); documents are
  converted in memory and never leave the server.
- **Memory and disk.** A few hundred MB while converting; Docker stops it at 1 GB. The image is about 1.5 GB and is
  downloaded by the first deploy that has it.
- **Fonts.** The image is built from `deploy/pdf/Dockerfile`: Gotenberg's image with Microsoft's core fonts added
  (Arial, Times New Roman, Courier New, Georgia, Verdana …, from Debian's `ttf-mscorefonts-installer`), so templates set
  in Arial or Times New Roman, Arabic included, keep their layout. It also has Noto and Amiri. A font it still lacks
  (e.g. Segoe UI) is printed in the nearest one it has. The fonts are downloaded when the image is first built; if that
  fails the image is built anyway, without them (the build log says which fonts came).
- **If it is down,** documents can't be opened and offers can't be sent (the API says so); nothing falls back to the
  Word file. Don't turn on PDF/A in the converter: PDF/A forbids encryption.

```bash
docker compose ps pdf                 # "healthy"
docker compose logs -f pdf
```

## Email

The API sends the system's emails through the company's own email provider by SMTP: set-password links and
invitations, job offers, interview invitations and the emails to applicants. Until email is set up, HR copies each
link and sends it from their own mailbox.

**The way to set it up: Organization → Email Settings** (a Super Admin's only; owner, 23 October 2026: "why dont we add
SMTP setup in the organization setup"). No redeploy:

1. Choose the provider: Google Workspace, Microsoft 365 or Zoho Mail fill the server, the port and the security
   (`smtp.gmail.com`, `smtp.office365.com`, `smtp.zoho.com`, all 587 with STARTTLS); "Another provider" takes them
   by hand. Google needs an app password (with 2-step verification on); Microsoft 365 needs SMTP AUTH turned on for the
   mailbox; Zoho on zoho.eu or another region uses its regional server.
2. Enter the mailbox's username and password, the sender's name and address (e.g. `TrendLIX HR`, `hr@trendlix.com`),
   and a reply-to address if wanted.
3. **Send a test email**: it is sent with the values on screen, saved or not, and answers in plain words ("The username
   or password was refused", "Couldn't reach smtp.… on port 587", "The secure connection failed…", "The sender address
   isn't allowed for this mailbox").
4. Tick **Send the system's emails with these settings** and save. The page says where emails are sent from now.

The password is kept encrypted in the database (AES-256-GCM), never shown again ("Set · Replace"), never sent to the
browser, a developer or the audit log. Its key is derived from `JWT_SECRET`, so there is nothing more to set up; **if
`JWT_SECRET` is ever changed** (which also signs everyone out), the saved password can't be read any more: the page says
"The saved password can't be read any more: enter it again", and until it is, the server's settings below are used.

**The fallback: `deploy/.env`.** While the page isn't filled in and switched on, the API uses these, exactly as before
(see `deploy/.env.example`; after a change run `./deploy.sh`, or push any backend change):

| Setting | Example |
|---|---|
| `SMTP_HOST` | `smtp.gmail.com` (Google Workspace), `smtp.office365.com` (Microsoft 365), `smtp.zoho.com` (Zoho) |
| `SMTP_PORT` | `587` (STARTTLS), or `465` if the provider says so |
| `SMTP_USER` | the sending mailbox, e.g. `hr@trendlix.com` |
| `SMTP_PASS` | its password, or an app password (Google Workspace needs one; Microsoft 365 needs SMTP AUTH turned on for the mailbox) |
| `MAIL_FROM` | the sender candidates see: `"TrendLIX HR <hr@trendlix.com>"` |

Neither filled in: nothing is emailed, and the screens offer the links to send by hand. The server only needs to reach
the provider's SMTP server (outgoing, usually port 587 or 465).

The candidate's answers go to the HR user who sent the offer (reply-to), and the system emails them when the candidate
accepts or declines. The offer page candidates open is on the web app (`https://people.trendlix.com/offer/…`), never on
this server.

## Check-ins locked to the office network (WEB_KEY)

Owner's decision, 20 October 2026 ("allow me to lock checkin's to wifi name or ip, whatever is right"): Attendance →
Check-in Setup can lock Office staff's check-ins and check-outs to the office's internet line, by its **public IP** (a
browser can't read a Wi-Fi's name, and a hotspot can take any name). Off it, the press is refused and the person asks
for an attendance correction; HR's own recording of a day is never locked.

- **Why a key.** Anyone with a session can call the API on port 8443 directly, so the API never trusts an address a
  request merely names. The website (on Vercel) reads the visitor's address (`x-forwarded-for`, which Vercel sets itself)
  and signs it with `WEB_KEY`: an HMAC-SHA256 over the address, the time and the SHA-256 of the session token, sent only
  on the check-in's calls and Check-in Setup's. The API takes the address only with the right signature, within a minute
  either way, for the same session token.
- **Setting it up.** On the server: `./web-key.sh` (it makes the key in `deploy/.env` if there is none, never replacing
  one, and prints it), then `./deploy.sh`. In Vercel: people-system → Settings → Environment Variables, Production,
  `WEB_KEY` = the printed value; then redeploy. Check-in Setup says **Ready** once both sides have the same key.
- **Without it** on either side the lock can't be switched on, and while the server has none no one is refused. If the
  key in Vercel is removed or changed while the lock is on, Office staff's check-ins are refused until both match again
  (Check-in Setup says which side is missing): switch the lock off there first when changing it.
- **The office line needs a fixed IP** from the internet provider: if its address changes, check-ins are refused until
  HR adds the new one (in the office: Add the network I'm on now). An IPv6 line is added by its /64.
- **Nothing is kept of an employee's address**: not on the punch, not on the day, not in the audit log (a punch keeps the
  office network's name only). The employee app needs nothing of its own: it shows the website, so the same signature
  applies.

## Push notifications (FCM)

Owner's decision, 20 October 2026 ("Push notifications: yes"; apps/mobile/README.md, Phase 4): the API sends the
employee app's notifications (a request waiting for someone, a decision, a payslip, the check-in reminders) through
Firebase Cloud Messaging's HTTP v1 API, signed with the Firebase project's service account (no Firebase library). Every
notification is also kept in the person's inbox (the bell on the site and the phone pages), so nothing is lost while push
is off.

| Where | Setting | From |
|---|---|---|
| Server, `deploy/.env` | `FCM_PROJECT_ID` | the service account's JSON file (Firebase → Project settings → Service accounts → Generate new private key): `project_id` |
| Server, `deploy/.env` | `FCM_CLIENT_EMAIL` | the same file: `client_email` |
| Server, `deploy/.env` | `FCM_PRIVATE_KEY` | the same file: `private_key`, pasted as it is (one line with `\n` in it, in double quotes) |
| GitHub → Settings → Secrets → Actions | `GOOGLE_SERVICES_JSON` | the Android app's `google-services.json` (Firebase → Project settings → Your apps → `com.trendlix.people`), its whole contents |

- **On the server:** the three values in `deploy/.env`, then `./deploy.sh`. `docker compose logs api` says *Push
  notifications are off* when one is missing or the key doesn't read; nothing is said when they are right. The API needs
  to reach `oauth2.googleapis.com` and `fcm.googleapis.com` over HTTPS (outgoing only, as for email).
- **In GitHub:** the Mobile (Android) workflow writes `GOOGLE_SERVICES_JSON` to `apps/mobile/android/app/google-services.json`
  before the build (never committed: the repository is public; never printed). Without the secret the APK is built
  without push, with a notice on the run, and the app offers no notifications on the phone.
- **What is sent:** short and general, names and dates only, never a salary, an amount, a reason or a comment (a locked
  phone may show it); a C-level person's requests are never sent to HR. A phone FCM says is gone (the app removed, or
  signed out) is removed from `push_devices`.

## On the server

| Task | Command (in `/opt/people-system/deploy`) |
|---|---|
| Deploy by hand | `./deploy.sh` |
| API log | `docker compose logs -f api` |
| OCR log | `docker compose logs -f ocr` |
| PDF converter log | `docker compose logs -f pdf` |
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
- ID photos and scans sent to the OCR service never leave the server: it has no port of its own, reads them in memory
  only, logs nothing of their content, and makes no outside connection.
- The pipeline's key can only run `deploy.sh` (no shell, no file copy, no forwarding). The server's GitHub key is read-only.
- A check-in's address is trusted only as the website signed it with `WEB_KEY` (see above); a plain `x-forwarded-for`
  sent straight to the API is ignored, and no employee's address is kept.
- The Firebase service account (`FCM_PRIVATE_KEY`) lives only in `deploy/.env` on the server and is never logged; the
  app's `google-services.json` only in a GitHub secret. A push says no salary, amount, reason or comment.
