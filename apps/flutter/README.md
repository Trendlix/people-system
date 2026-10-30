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
- The look: the owner's **Figma** design. Every colour, font, radius and spacing lives in one place (`lib/theme/`), so
  the design is applied there without reworking the screens. The owner chose "Propose one for me" before deciding to
  send their own: the design wait does not hold up the build.
  - 30 October 2026, the owner: "this is the desktop version figma link" — the file "PeopleTrendlix" (seven desktop
    screens: Dashboard with a side or top menu, light and dark; My Requests light and dark; My KPIs; My Attendance).
    Read through Figma's API with the owner's read-only token (kept in `~/.figma-token` on the Mac, never in the repo).
    Its look is applied to the phone app now, laid out for a phone; the phone version of the design, when it comes,
    adjusts the layouts.
  - 30 October 2026, the owner: "in the same figma link, i added a mobile flutter app folder, go through it and through
    its instructions for the building" — the page "Mobile Flutter App": ten screens, light and dark (Dashboard, Requests,
    Attendance, Profile, More, Change Password, Profile Image, Your Sessions, Your Interview Hours, New leave). It has
    no written notes (no comments, annotations or prototype links): the screens are the instructions. They set the
    app's shape: a header (the wordmark's tile, the sun/moon, the bell, the avatar), a floating frosted tab bar
    (Dashboard, Requests, Attendance, Profile, More, which opens the account's menu), the requests' forms as bottom
    sheets. The bar's two looks in the file (a dark glass bar on three light screens, a frosted one on the other
    seventeen) are made one: the frosted bar everywhere.
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
- **Phase 5 — The owner's design** (Figma), applied in `lib/theme/` and the screens' layout: the desktop version's look
  first (30 October 2026), then the phone version's screens (the same day), which also carry Phase 2's requests and
  more of Phase 4 (attendance, the profile, the account's screens).
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
  - No backup of the app's data.
- [~] Phase 5, first part — the desktop design's look (30 October 2026, version 0.3), to try on a phone:
  - The design's system in `lib/theme/`: Instrument Sans (cut from Google Fonts' variable font to 400/500/600/700,
    SIL Open Font License in `assets/fonts/OFL.txt`, shown in the app's licences); its light and dark colours
    (`Palette`: #EDEDEB page, white cards, #DEDED9 lines, #111110 ink; #0D0D0C page, #1C1C1A cards, #30302D lines,
    #F4F4EF ink); cards of radius 18 with a thin line and a soft shadow, controls of 12, pill badges; tight headings,
    small spaced capitals over a card's title; thin line icons (Flutter's `cupertino_icons`).
  - The TrendLIX wordmark from the file (`assets/brand`), with "Trend" in off-white for the dark look.
  - Light or dark as the phone is set, until the person taps the sun/moon in Home's header; their pick is kept.
  - Sign-in: the wordmark, "Welcome back.", the form in a card. Home: the design's header (the app's name, the switch,
    the avatar with Sign out), the date and greeting, the Today card with its badge, the work-time ring (the hours
    worked of the shift's, moving while checked in), the one big button, what a press came to right under it (scrolled
    into view), and today's check-ins listed as the design lists a schedule.
  - Pending the phone version of the design; the website (`apps/web`) keeps its look until the owner says otherwise.
- [x] Phase 5, second part — the phone design's frame and Dashboard (30 October 2026), version 0.4:
  - The frame: header, frosted tab bar, More menu (View profile, Change profile image, Password & security, Devices &
    sign-ins, Hiring availability, Sign out), the bell with the unread count and the inbox in a sheet; messages show
    above the tab bar. The type and colours of the phone design in `lib/theme/` (titles of 40, cards of 20 corners,
    the dark card that turns light on the dark look).
  - The Dashboard: the greeting, Today's shift (the clock, then the time worked; Check in for work in one tap), quick
    actions (Request leave, Fix attendance, View requests, My performance), at a glance (leave balance, hours this week,
    open requests, next holiday), coming up (the official holidays: People has no meetings calendar for employees),
    leave balance, weekly hours, documents needed. My performance lists one's KPI scorecards (rating and signing stay on
    the website for now).
- [x] The phone design's tabs (30 October 2026), version 0.5, to try on a phone:
  - Requests (Phase 2, faster requests): My Requests as designed (annual leave with its ring, requests this year,
    permission left, every request in one list with All / Approved / Waiting, other leave, a card for each request one
    may start), and a bottom sheet for each of the nine kinds with smart defaults and every rule shown before sending:
    leave (the covering colleague, the stand-in, documents by camera or gallery), permission, work from home,
    attendance correction, official duty, compensatory day, reimbursement (receipt photos), check-in location,
    resignation. Each request has its page (its facts, who decides, every step, Cancel where People allows). Files are
    listed by name (opening them stays on the website for now); photos only, no PDF picking yet.
  - Attendance: the month switcher, Today's panel (the shared press), the week/month calendar, the figures (no
    attendance rate: the owner's 23 October decision), Your days, a day's details, Ask for a correction, My corrections.
  - Profile: the head card, the four facts, Personal / Contact / Employment / Payroll (payslips paid and held, never a
    salary), Ask to change my details (the change request HR decides), Documents; the account's screens: Change
    Password, Profile Image (HR sets the photo: the screen says so, no pretend upload), Your Sessions (with the
    fingerprint's phones), Your Interview Hours.
  - Sheets open over the tab bar. Follow-ups: one correction flow instead of two (Requests' and Attendance's), PUT and
    multipart in `PeopleClient` (now in the features), opening files and payslip PDFs in the app.
- [ ] Phase 3 — Approve in one move — not in the phone design; to be placed in the Requests tab in its style — next.
- [ ] Phase 4 — push notifications (Firebase), custody and assets.
