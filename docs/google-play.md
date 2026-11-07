# Trendlix People on Google Play

The owner set up a Google Play Console account on 6 November 2026 and chose the following:

- **Organization** account;
- **Employees only**, as a closed testing track that is never listed publicly;
- **Include** the hourly background location;
- **Play only**: the website's APK is retired once Play is live.

This is what to do in the Play Console, in order. The answers to its forms are below.

## 0. Before the Console

1. Add the two GitHub secrets from `~/TrendLIX-Play-Upload-Key/README.txt`: `PLAY_UPLOAD_KEYSTORE_BASE64` and `PLAY_UPLOAD_PASSWORD`.
2. Push any change to `apps/flutter` (or open Actions → *Flutter app* → *Run workflow*). The run's Artifacts then hold `trendlix-people-<version>.aab`.
3. In People, create the reviewers' account (Google signs in to check the app), `testing@trendlix.com`:
   - an employee profile with an employment (Work from home arrangement, no contract);
   - a sign-in with a password, linked to the profile;
   - the Employee role only;
   - no real data;
   - on its profile, Basic Data → **Test Account** → *Make it a test account*. It then stays out of payroll, lists, counts and reports, and its requests notify nobody. HR finds it under Employees → **Test accounts**.

## 1. Create the app

Play Console → **Create app**:

| Field | Value |
|---|---|
| App name | Trendlix People |
| Default language | English (United States) |
| App or game | App |
| Free or paid | Free |
| Declarations | Tick both |

## 2. App signing

Leave **Play App Signing** on (the default). Google keeps the key that signs the app, and our builds are signed with the upload key. When the Console asks for the upload certificate, use `upload-cert.pem`.

## 3. Closed testing (employees only)

Testing → **Closed testing** → Create track (for example "Employees"):

1. **Testers:** add an email list of the employees' **Google accounts**, the ones signed in to Play on their phones. That can be a personal Gmail; a work email only works if the company uses Google Workspace.
2. **Create new release:** upload the `.aab`. Release name: its version. Notes: "Trendlix People for employees."
3. **Countries:** Egypt (and any other country where employees are).
4. Copy the **opt-in link** (`https://play.google.com/apps/testing/com.trendlix.people`). Employees open it, tap *Become a tester*, then install from Play.

## 4. App content (Policy → App content)

| Section | Answer |
|---|---|
| Privacy policy | `https://people.trendlix.com/privacy` |
| App access | All or some functionality is restricted → add the reviewer account's email and password. Instructions: "Sign in with these details. Check in needs location permission; tap Allow." |
| Ads | No ads |
| Content rating | Category: Utility / Productivity. Answer **No** to violence, sexuality, language, drugs, gambling and user interaction. Result: Everyone / PEGI 3. |
| Target audience | 18 and over only |
| News app | No |
| Government app | No |
| Financial features | None |
| Health | None |
| Data safety | See section 6 below |
| Location permissions | See section 5 below |

## 5. Background location declaration

Policy → App content → **Sensitive permissions → Location permissions**.

**Feature that needs it:**

> While an employee is checked in at work, and only if their company has switched on "Hourly Location", the app reads the phone's location about once an hour in the background. It sends the location to the company's HR to confirm the employee is still at the place they checked in. It stops at check-out or sign-out.

**Why it can't work only while the app is open:**

> Employees don't keep the app open during the working day. The hourly check must run while the app is closed, or it can't confirm attendance across the day.

**Prominent disclosure (as the app shows it, before asking):**

> "Trendlix People collects location data to confirm you're at the place you checked in, every hour while you're checked in, even when the app is closed or not in use. It is sent to HR and stops when you check out."

**Video (30–60 seconds, screen recording on a phone, upload to YouTube as Unlisted and paste the link):**

1. Sign in with the reviewer account.
2. Tap **Check in** and allow location *While using the app*.
3. The **Location while checked in** explanation appears. Show it, then tap **Continue**.
4. Android's permission screen opens. Choose **Allow all the time**.
5. Back in the app, show the person is checked in.

For step 3 to appear, HR must first switch on Organization → Check-in Setup → **Hourly Location**.

## 6. Data safety

Data is **encrypted in transit**: yes. Data is **never sold or shared with third parties for their own use**. There is no account creation inside the app; HR creates the accounts.

| Data type | Collected | Shared | Optional? | Purpose |
|---|---|---|---|---|
| Location: precise | Yes | No | Required for check-in | App functionality |
| Location: approximate | Yes | No | Required for check-in | App functionality |
| Personal info: name, email address, user IDs, phone number | Yes | No | Required | App functionality, account management |
| Financial info: other (expense claims) | Yes | No | Required | App functionality |
| Photos | Yes | No | Optional | App functionality |
| Files and docs | Yes | No | Optional | App functionality |
| Device or other IDs (device name) | Yes | No | Required | Account management, security |

Not collected:

- contacts;
- messages;
- health;
- web history;
- audio;
- calendar;
- app activity for analytics;
- crash data, unless a crash reporter is added later.

## 7. Store listing (Grow → Store presence → Main store listing)

| Field | Value |
|---|---|
| App name | Trendlix People |
| Short description (≤ 80 characters) | Trendlix's employee app: check in, requests, timesheets and KPIs. |
| Category | Business |
| Contact email | hr@trendlix.com (confirm) |
| Website | https://people.trendlix.com |

**Full description:**

> Trendlix People is the employee app of Trendlix. Employees sign in with their work account to:
>
> - check in and out for work, with the place confirmed by location;
> - ask for leave, work from home, official duty, permissions and compensatory days, and follow each request;
> - log hours on a timesheet;
> - see their attendance and KPIs;
> - approve their team's requests (for managers).
>
> Location: when the company switches it on, the app reads your location every hour while you're checked in, even when the app is closed, to confirm you're still at the place you checked in. It stops when you check out.
>
> The app is for Trendlix employees only and needs an account from the company's HR.

The location paragraph is there because Google's reviewers check that a feature using background location is described in the store listing.

**Graphics:**

- **App icon:** 512 × 512 PNG.
- **Feature graphic:** 1024 × 500.
- **Screenshots:** the five in `~/TrendLIX-Store-Screenshots/google-play` (1080 × 2160, invented people only), made by `apps/flutter/screenshots/` and `apps/flutter/tool/frame_screenshots.py`. The icon and feature graphic are there too.

## 8. Going live, and moving everyone to Play

1. **Send for review.** Publishing overview → Send changes for review. A first review takes a few days. The background location declaration can take longer.
2. **Add employees.** When the closed track is available, send employees the opt-in link.
3. **Switch everyone over.** GitHub → Actions → *Flutter app* → *Run workflow* → tick **"Google Play is live"** → Run. Phones still on the website's APK then show *Update required*: they remove that version and get the app from Play. people.trendlix.com/download goes to the Play page.
4. **Later versions.** Each push builds a new `.aab`. Upload it as a new release on the closed track, or let the build upload it (below). When Google has made it available, the app updates itself through Play.

## 9. Uploading by itself (after the first release)

Google's API can't make an app's first release, so the first `.aab` is uploaded by hand. After that, every Play build can go to the closed track by itself:

1. **Google Cloud** (console.cloud.google.com), as the Play Console's owner:
   - Enable the **Google Play Android Developer API** (`androidpublisher.googleapis.com`). Not the "Android Developer Console API".
   - IAM & Admin → Service Accounts → Create one ("play-uploader", no roles).
   - Keys → Add key → JSON.
2. **Play Console:** Users and permissions → Invite new users → the service account's email → app permission for Trendlix People, **Release to testing tracks**.
3. **GitHub:** add the secret **PLAY_SERVICE_ACCOUNT_JSON** (the whole JSON file). The track is Play's first closed track, `alpha`. If you named your own track, add a repository variable **PLAY_TRACK** with its name.
