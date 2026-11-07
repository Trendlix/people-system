# Trendlix People on the App Store

The owner's Apple Developer account was ready on 7 November 2026. They chose:

- **Unlisted App Store page:** a normal App Store app, approved by App Review, that opens only from its link and never shows in search. It is for employees only.
- **No location while checked in on iPhone (for now):** iPhones read the location at check-in and check-out only. Android also reads it hourly when HR switches that on.

Every build of the app (GitHub → Actions → *Flutter app*) also builds the iPhone app on a Mac, with the same version as the Android build. Once the secret below is set, each build from `main` is signed and uploaded to App Store Connect. Sending a version for review stays a manual step.

## 1. The API key (App Store Connect, as the Account Holder)

1. App Store Connect → **Users and Access** → **Integrations** → **App Store Connect API** → **Team Keys**. The first time, click **Request Access** and accept.
2. Click **Generate API Key** (or **+**):
   - Name: `People CI`;
   - Access: **Admin** (needed to make the certificate and the profile).
3. **Download** the key. Apple lets you download it only once. The file is `AuthKey_<Key ID>.p8`.
4. Note the **Key ID** (in the key's row) and the **Issuer ID** (above the list).

## 2. The signing (on the Mac)

```sh
mkdir -p ~/TrendLIX-Apple-Signing
mv ~/Downloads/AuthKey_<KEY ID>.p8 ~/TrendLIX-Apple-Signing/
python3 apps/flutter/tool/apple_signing.py --key-id <KEY ID> --issuer-id <ISSUER ID> \
  --key ~/TrendLIX-Apple-Signing/AuthKey_<KEY ID>.p8 --out ~/TrendLIX-Apple-Signing
```

The script does four things:

- registers `com.trendlix.people`;
- makes an Apple Distribution certificate;
- makes the App Store profile "Trendlix People App Store";
- writes everything into `~/TrendLIX-Apple-Signing`, with a `README.txt`.

Then add the one GitHub secret it explains: **APPLE_SIGNING_BASE64**, from `github-secret-APPLE_SIGNING_BASE64.txt`. Back up the folder.

The certificate lasts a year. Before it ends, run the script again and replace the secret.

## 3. Create the app (App Store Connect → Apps → + → New App)

| Field | Value |
|---|---|
| Platforms | iOS |
| Name | Trendlix People |
| Primary language | English (U.S.) |
| Bundle ID | com.trendlix.people |
| SKU | trendlix-people |
| User access | Full Access |

## 4. The first build

Push any change to `apps/flutter`, or open Actions → *Flutter app* → *Run workflow*. The job **Build the iPhone app** uploads the build. Apple then processes it for 10–30 minutes, and it shows under **TestFlight**.

To try it before review:

1. TestFlight → **Internal Testing** → add yourself.
2. Install the **TestFlight** app on your iPhone and open the invite.

## 4b. Filling the page by script

`python3 apps/flutter/tool/app_store_listing.py --version <the build's version>` fills sections 5–7 below through the API (with the App Store Connect key in `~/TrendLIX-Apple-Signing`), uploads the screenshots, sets a free price and Egypt, names the version as the build and chooses that build. It can't fill App Privacy (section 6), the App Review contact or the testing account's password: those are typed in App Store Connect once.

## 5. App Information

| Field | Value |
|---|---|
| Subtitle | Trendlix's employee app |
| Category | Business (secondary: Productivity) |
| Content rights | Does not contain third-party content |
| Age rating | Answer **None** / **No** to every question → 4+ |

## 6. App Privacy

| Field | Value |
|---|---|
| Privacy Policy URL | `https://people.trendlix.com/privacy` |
| Does the app collect data? | **Yes** |

For every data type below:

- Purpose: **App Functionality**;
- Linked to the user: **Yes**;
- Used for tracking: **No**.

| Category | Data types |
|---|---|
| Contact Info | Name, Email Address, Phone Number |
| Financial Info | Other Financial Info (expense claims) |
| Location | Precise Location |
| User Content | Photos or Videos (profile photo, receipts), Other User Content (documents and requests) |
| Identifiers | User ID |
| Other Data | Other Data Types (the phone's name and model, shown under the account's signed-in devices) |

Nothing else is collected:

- no health data;
- no contacts;
- no browsing or search history;
- no purchases;
- no diagnostics;
- no advertising data.

## 7. The version page (the app → iOS App → the version)

| Field | Value |
|---|---|
| Screenshots | **iPhone 6.9" display**: the five in `~/TrendLIX-Store-Screenshots/app-store` (1320 × 2868, invented people only), made by `apps/flutter/screenshots/` and `apps/flutter/tool/frame_screenshots.py`. The app is iPhone-only, so no iPad screenshots. |
| Promotional text | Check in, ask for leave and follow your requests, log hours and see your KPIs. |
| Keywords | HR,attendance,check in,leave,timesheet,KPI,employee,Trendlix |
| Support URL | `https://people.trendlix.com/privacy` (it gives hr@trendlix.com) |
| Copyright | 2026 Trendlix |
| Version | The build's version, e.g. 0.6.52. It must match the build you choose. |
| Build | The uploaded build |
| Version release | **Manually release this version**, so it never goes public before Apple makes it unlisted |

**Description:**

> Trendlix People is the employee app of Trendlix. Employees sign in with their work account to:
>
> • check in and out for work, with the place confirmed by location
> • ask for leave, work from home, official duty, permissions and compensatory days, and follow each request
> • log hours on a timesheet
> • see their attendance and KPIs
> • approve their team's requests (for managers)
>
> The app is for Trendlix employees only and needs an account from the company's HR.

**App Review Information:**

| Field | Value |
|---|---|
| Sign-in required | Yes |
| User name | testing@trendlix.com |
| Password | The testing account's password |

The account must be set up as the sample account first (Employees → **Test accounts** → *Sample account for app reviewers*; [the Google Play guide](google-play.md), step 0.3). Otherwise the app is empty after sign-in.
| Contact | The owner's name, phone and email |

**Notes for review:**

> Trendlix People is the HR app for Trendlix's own employees: attendance, leave and other requests, timesheets and KPIs. Accounts are created by the company's HR; there is no sign-up. Please sign in with the account above: a test employee with no real data. Check-in asks for the location while the app is in use, to confirm the employee is at a place they may check in from. We are requesting Unlisted App Distribution for this app, as it is for our employees only.

## 8. Send for review, and ask for unlisted distribution

1. **Add for Review**, then **Submit to App Review**. A first review usually takes one to three days.
2. Once it is submitted, the **Account Holder** fills in Apple's unlisted request form. It is linked from https://developer.apple.com/support/unlisted-app-distribution/. Give:
   - **App name:** Trendlix People;
   - **Apple ID:** App Information → General Information → Apple ID;
   - **Why unlisted:** "Trendlix People is the HR app for Trendlix's employees only (attendance, requests, timesheets and KPIs). Only employees with an account from our HR can use it, so it shouldn't be found in the App Store; HR sends employees the link."
3. When Apple approves both:
   - go to Pricing and Availability → **App Distribution Methods**, where **Unlisted** shows its link;
   - **Release** the version;
   - send the link to employees.
4. Then tell Claude the link, so `people.trendlix.com/download` can send iPhones there.

## 9. Later versions

Each push to `main` uploads a new build. To ship one:

1. App Store Connect → the app → **+** next to iOS App → the build's version (e.g. 0.6.60).
2. Choose the build and submit it for review.
3. Release it.

iPhones update from the App Store by themselves. The app's own "Update required" screen is Android-only for now.
