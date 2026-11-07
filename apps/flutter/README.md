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
- **Phase 6 — iPhone** (7 November 2026: "my apple developer account is ready"; asked, "Unlisted App Store page"): built
  and uploaded to App Store Connect by CI (job "iphone"), signed with `tool/apple_signing.py`'s secret; the owner's
  icon and the T on black at launch; no location while checked in on iPhone yet, and no location gate on iPhones and
  iPads: iOS asks at the first Check in (7 November 2026, for Apple's review). Steps: docs/app-store.md. On iPads
  too (7 November 2026: "can the app be optimized for ipad screen?"): a page keeps to a column in the middle
  (`lib/theme/wide.dart`, at most 760 wide), the tab bar to 560, and the tiles go four across from 640; a phone is
  unchanged. Store pictures for the 13" iPad (2048 × 2732) come with the iPhone's.
- **Planned, after Apple approves the unlisted page — iPhone location while checked in** (owner, 7 November 2026:
  "yes" to "location when leaving the check-in area"). iOS can't wake an app every hour, so it uses iOS's own events:
  - when People has the hourly location on (today's `locationPings`) and the person checks in: an area around the
    check-in's place (the office's own radius, else about 200 m), and iOS wakes the app when the phone leaves it; also
    iOS's "significant change" (about 500 m) as a fallback. Both stop at check-out and at sign-out;
  - each wake sends a ping to `POST /api/me/attendance/pings`, the same as Android's, so HR sees "away" on the day's
    records as now (pings closer than 20 minutes apart aren't kept);
  - native Swift in `ios/Runner` (CLLocationManager region monitoring + significant changes; neither needs the
    "location" background mode), sending with the session token from the Keychain; no new package;
  - needs "Always": after the check-in, the same explanation as Android's (button "Continue", Apple's rule), then iOS's
    prompt; refused, nothing else changes, and the pings say "Location off";
  - update the location wording in Info.plist ("never read in the background" goes), the privacy policy and App Privacy,
    and the review notes (why "Always": the attendance rule HR switches on); test on an iPhone through TestFlight.

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
  - Attendance: the month switcher, Today's panel (the shared press), the week/month calendar, the figures, Your days, a
    day's details, Ask for a correction, My corrections.
  - Profile: the head card, the four facts, Personal / Contact / Employment / Payroll (payslips paid and held, never a
    salary), Ask to change my details (the change request HR decides), Documents; the account's screens: Change
    Password, Profile Image (HR sets the photo: the screen says so, no pretend upload), Your Sessions (with the
    fingerprint's phones), Your Interview Hours.
  - Sheets open over the tab bar. Follow-ups: one correction flow instead of two (Requests' and Attendance's), PUT and
    multipart in `PeopleClient` (now in the features), opening files and payslip PDFs in the app.
- [x] The owner's notes after trying 0.5.5 on a phone (31 October 2026), version 0.6:
  - Corrections: asked on the day or within 2 working days of it ("asking for correction is to be locked after 2 working
    days": People's rule, by the shift's working days without official holidays and their leave; HR still corrects any
    day); "I worked remotely or at a client" is gone ("Remove it, point to OD"): both forms point to official duty.
  - Attendance: the attendance rate through the month ("show the weekly attendance percentage and monthly percentage
    ongoing through the month"): People's own figure (days attended ÷ working days expected), the month so far, this
    week and each week, in the owner's colours; the figures without the notes under them ("to save more space").
  - Dashboard: Official duty in place of Fix attendance; the time worked in the owner's colours ("below 80% color it red,
    from 80 to 90 color it yellow, above 90% green", of the shift's hours a day), breaks counted in it ("dont calculate
    breaks, they are included in the working hours": People counts the first check-in to the last check-out).
  - Never told one is exempt from check-in ("dont show for the employee that he is exempted": People leaves it out).
  - My assets ("every employee sees his assets"): More → My assets, and the Profile's HR records; what they hold now and
    their custody records, read only.
  - Profile: KPIs in place of Payroll ("replace payslips with the KPI's"; payslips stay on the website).
  - KPIs ("employees and managers can perform the KPI's from the mobile app"): My KPIs (rate yourself, sign) and Team
    KPIs for whoever scores a team's (score, send, sign); HR's calibration stays on the website.
  - Signing in without the password (0.6.3–0.6.4): Forgot password ("add forget password to the app": People emails a
    link to set a new one), and a code by email ("and i can add OTP via Mail for app login if the user didn't remember
    his password", "via app and web": 6 digits, once, 10 minutes, 5 tries, a new one a minute on; signed in as with the
    password, the fingerprint offered after it). The website has the same at /login/code.
- [x] Later on 31 October 2026: the counter ticks every second by People's clock (0.6.2); the attendance rate and Hours
  this week by the hours, as the payroll measures attendance, and Forgot password (0.6.3); sign in with a code by email
  (0.6.4); Sign out always in reach in the menu (0.6.5); the app locked behind the fingerprint or face whenever it
  opens with a session kept or comes back after a minute away ("ask for the fingerprint or the faceid again, as a
  security step"; `lib/auth/app_lock.dart`; 0.6.6); Profile → Documents with each paper's state and no contract (0.6.7);
  the whole app only with the location on ("app has to be location enabled to work": `lib/platform/location_gate.dart`;
  Android only since 7 November 2026) and the phone's last position sent with each request (`x-people-location`, read at
  most once a minute in use, once allowed) for
  People's activity log (0.6.8).
- [x] Phase 3 — Approve in one move (4 November 2026, owner: "For roles who approve requests, why there is no approve button in the app?"; asked, "Now: everyday requests"): To approve at the top of the Requests tab — leave, permission, work from home, official duty, compensatory days, attendance corrections and expense claims waiting for the person's step, oldest first; Approve in one tap, Reject with why, Approve all; the same two buttons on the request's page. A claim is approved for its amount. Raises, pay raises, KPIs and check-in locations are still decided on the website. No undo: People has none for a decision.
- [x] Timesheets (4 November 2026, owner: "Timesheet in app/website", "Direct manager, weekly", "Only those HR switches on"): My timesheet (Dashboard → Log hours in the shift card's place, and More → My timesheet, only for those on timesheets): the week Sunday–Saturday with the one before and after, each day's lines (a client — theirs first — or a task, the hours in quarter hours, a note) added, changed or removed in a sheet, Save, Send for approval (saving first), where it stands (waiting for whom, approved, rejected with why) and the earlier weeks not sent. Weeks of hours in To approve (Approve, Reject with why, Approve all) and a read-only week page with the same buttons. API: GET/PUT /api/me/timesheet, POST /api/me/timesheet/submit, GET /api/timesheets?status=waiting, GET /api/timesheets/:id, POST /api/timesheets/:id/decide (PeopleClient gained `put`).
- [ ] Phase 4 — push notifications (Firebase); opening files and payslip PDFs in the app.
