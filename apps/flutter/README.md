# Trendlix People — the Flutter app: plan and development guide

Read this before every session of work on the app. Keep the **Status** section at the end up to date at the end of each
phase, and record every decision the owner makes here (with the date and their words) before building on it.

---

## 1. What the owner asked for (30 October 2026)

- The employee app is rebuilt in **Flutter** (owner: "lets start in the flutter one"; why: "to make it looks more
  cooler and apply my new UI", and "make it easier for the team members").
- Asked, the owner chose:
  - **"Replace it now"**: the Capacitor app (`apps/mobile`, built 20 October 2026) is no longer worked on. The Flutter
    app takes its place, with the same Android identity (`com.trendlix.people`) and signing key, so it installs over it.
  - **"Directly to People's server"**: the app calls the API itself (no website in between), trusting People's
    private authority (`API_CA_CERT`) for People's address only, and signing in as an app session.
  - **"Yes, install them"**: the Flutter SDK is on the owner's Mac (`~/development/flutter`, 3.47.7, the latest stable at
    least two weeks old on 30 October 2026) so every step is analysed and tested before it is pushed; the APK is
    built by GitHub Actions, as before.
  - **"The 3 easy wins first"**: sign-in (password, then fingerprint), **one-tap check-in**, **faster requests** and
    **approve in one move** first; then attendance, payslips, notifications and the rest of what the old app did.
- The look: the owner will send a **Figma** design. Until then the screens use a plain theme; every colour, font,
  radius and spacing lives in one place (`lib/theme/`), so the design is applied there without reworking the screens.
  The owner chose "Propose one for me" before deciding to send their own: the design wait does not hold up the build.
- Earlier decisions that still hold (apps/mobile/README.md, 20 October 2026): no store submission in the first
  version, an APK from GitHub Actions to install by hand; iPhone after the owner has an Apple Developer account;
  English interface, every string ready for Arabic later.

## 2. The shape of it

```
 Android / iOS phone
 ┌────────────────────────────────────────────┐
 │  Trendlix People (Flutter, apps/flutter)     │
 │  ├─ screens (lib/features/…)                 │
 │  ├─ the API client (lib/api/): HTTPS to      │
 │  │  People's server only, its private        │
 │  │  authority trusted for that host only,    │
 │  │  the session token in secure storage      │
 │  └─ native: location, fingerprint, camera,   │
 │     push (Flutter plugins)                   │
 └────────────────────────────────────────────┘
                  │ HTTPS, Authorization: Bearer <session>
                  ▼
   API (NestJS, VPS, srv2055591.hstgr.cloud:8443, Caddy's private CA) ──► PostgreSQL
```

- **Every rule stays in the API**: the app shows what the API answers and sends what the person chose; the API checks
  everything again (approvals, C-level hiding, limits, the office network, payroll locks).
- **Signing in**: `POST /api/auth/login` with the app's user agent ending in `TrendLIXPeople` (packages/shared
  sessions.ts `APP_USER_AGENT_MARK`), so it is an **app** session (its own kind, beside the web one). The API answers
  with the session cookie; the app keeps its token in secure storage and sends it as `Authorization: Bearer` (the API
  reads a bearer as well as the cookie: auth.guard.ts `readToken`). Fingerprint: the existing device credentials
  (`POST /api/auth/devices`, then `POST /api/auth/devices/sign-in`).
- **The server's certificate**: Caddy's private root (`API_CA_CERT`, a public certificate; deploy/ca-cert.sh prints it;
  kept as the GitHub Actions **variable** `API_CA_CERT`) is built into the app by CI and trusted only for People's
  host. A debug build may point at another address for testing.
- **The office network** (check-ins locked to it, 20 October 2026): the website signs the person's address
  (`WEB_KEY`). A direct app request has no website: the API takes the address Caddy saw for it (Phase 1 work).
- **State and navigation**: Riverpod and go_router; the API's JSON read into small Dart classes by hand (no code
  generation), each tested.

## 3. Phases (each ends with an APK from GitHub Actions and a short note to the owner)

- **Phase 0 — Scaffolding and CI**: the Flutter project (`com.trendlix.people`), the theme in one place, the API client
  with the private authority, `flutter analyze` and `flutter test` clean, `.github/workflows/flutter-android.yml`
  building the APK (the same signing key as the old app, `API_CA_CERT` from the variable).
- **Phase 1 — Sign-in and one-tap check-in**: password sign-in, the fingerprint offer and sign-in, Home with today's
  shift and one big Check in / Check out button (location, fake-GPS flag), the API's direct-request address for the
  office network.
- **Phase 2 — Faster requests**: leave, permission, work from home, official duty, reimbursement (receipt photo),
  correction, compensatory, home location, raise: each in a few taps with smart defaults (today, the usual hours, the
  balance shown), and My Requests.
- **Phase 3 — Approve in one move**: To Approve, one tap (or swipe) to approve or decline, Approve all, undo.
- **Phase 4 — The rest**: my attendance, payslips (PDF), notifications (push, the existing Firebase project and
  `GOOGLE_SERVICES_JSON`), custody and assets as the old app had them.
- **Phase 5 — The owner's design** (Figma), applied in `lib/theme/` and the screens' layout.
- **Phase 6 — iPhone** (after the owner has an Apple Developer account).

## 4. Rules for the work

- Pin what is added (the SDK by version, packages by the lock file); never a version released in the last two weeks
  when an older one does the job.
- No business rule in the app that the API doesn't also enforce; words the person reads come from one place per
  screen, ready for Arabic.
- Each phase: `flutter analyze` with no issues, `flutter test` green, the API's tests green for any server change,
  then commit (no co-author trailer) and push; the owner downloads the APK from the workflow run.

## 5. Status (update at the end of every phase)

- [x] Phase 0 — Scaffolding and CI (30 October 2026): the project (`com.trendlix.people`, "Trendlix People", the old
  app's icon and its T-on-black launch screen), the theme in `lib/theme/`, the API client (the private authority, the
  app's user agent, People's messages), a first screen that checks it reaches People (`GET /api/health`);
  `flutter analyze` clean, 9 tests; `.github/workflows/flutter-android.yml` builds a release APK signed with the old
  app's key, version code 1000 + the run (the old app stopped at 11), version name 0.2.<run>.
  - Installing it over the old app replaces it: until Phase 1–2 land, keep it on the owner's phone only, not the team's.
- [x] Phase 1 — Sign-in and one-tap check-in (30 October 2026), to try on a phone:
  - Sign-in with the work email and password (People's session from its cookie, kept in secure storage, sent as a
    bearer); then once "Sign in with your fingerprint?" (`POST /api/auth/devices`, the credential kept with whose it
    is); next time the fingerprint is asked for at once (`POST /api/auth/devices/sign-in`), the fingerprint or face
    only, never the phone's PIN. A credential People no longer knows is dropped with its reason; a session People
    refuses signs the app out ("Your session ended").
  - Home: the greeting, the shift, the day so far, and one big Check in / Check out button. The spot is read at the
    press (never tracked) with Android's mock flag; no location, no press, with what to do (turn location on, open the
    app's settings, try again). People's refusals in its words.
  - The API (`signed-ip.ts checkInIp`, deployed 30 October 2026): for an app session the website signed nothing for,
    the office network's lock reads the connection's address as Caddy wrote it (the last X-Forwarded-For entry).
  - No backup of the app's data; the old app's look until the Figma design (`lib/theme/`).
- [ ] Phase 2 — Faster requests — next.
