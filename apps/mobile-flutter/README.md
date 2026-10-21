# Trendlix People: the Flutter Shell (Plan and Guide)

**Status:** plan, written 21 October 2026. Nothing is built yet.

## 1. What the Owner Asked For (21 October 2026)

> "now i need some changes - need to build the native app hardware features like camera access and also location
> detector and so on features in FLUTTER => because i need andrio and iso cross plsatform technology. - rest app will be
> webview from the website as is. - neeed a plan after investagting and determine what feature need mobile hardware and
> what will be okay with website."

So:
- **The app becomes a Flutter app**, one codebase for Android and iOS.
- **Flutter owns** everything that needs the phone's hardware or the operating system.
- **Every screen stays the website's phone pages** (`https://people.trendlix.com/app`) inside a web view. Nothing on the website or the server is rebuilt.
- **It replaces** today's Capacitor shell (`apps/mobile`) once it does everything that shell does (§8).

## 2. The Shape

```
┌──────────────────────── Trendlix People (Flutter) ─────────────────────────┐
│  Native (Dart + plugins)                 │  Web view (flutter_inappwebview)  │
│  · location + fake-GPS                   │  people.trendlix.com/app/*        │
│  · camera / gallery                      │  every screen, every rule         │
│  · fingerprint / Face ID + secure store  │  user agent ends "TrendLIXPeople" │
│  · push (FCM / APNs)                     │  session cookie (as today)        │
│  · QR scanner · back button · offline    │                                   │
│  · files: pick, download, share, print   │  window.TrendlixNative  ◄── bridge│
└──────────────────────────────────────────┴───────────────────────────────────┘
                    │ (nothing native talks to the API)
                    ▼
     people.trendlix.com (Next.js on Vercel)  ──►  NestJS API (private)
```

- **The server stays private.** The app never talks to the API; the website does, as today. The app holds no server address and no keys.
- **The user agent keeps the hidden mark `TrendLIXPeople`.** It must not change: the server tells app sessions from website sessions by it, for the 15-minute rule, one session of each kind, and the app's location rule.
- **Sign-in is the website's session cookie,** kept by the web view's cookie store across restarts, as today.
- **App ids stay `com.trendlix.people`** on both platforms, so the Flutter Android app installs over today's (§8).

## 3. What Needs the Phone, and What the Website Already Does

### 3.1 Native (Flutter)

| # | Feature | Used by | Why it can't stay web | Flutter piece |
|---|---|---|---|---|
| 1 | **Location with fake-GPS detection** | Check-in/out (Home, My Attendance), home-location requests, "Use my current location" (Check-in Setup) | A browser can't tell a fake-GPS location. The app's location rule refuses a press without a location, which needs real permission handling. | `geolocator`: `Position.isMocked` on Android. On iOS 15+, `CLLocation.sourceInformation.isSimulatedBySoftware`: check `geolocator`'s support, else a small Swift method. |
| 2 | **Camera and gallery** | Reimbursement receipts, leave documents (sick notes), asset photos, signed custody forms (Assets step 3) | Reliable camera opening and photos resized on the phone (12 MB down to a few hundred KB) | `image_picker` (camera + gallery, `maxWidth`/`imageQuality`) |
| 3 | **Fingerprint / Face ID sign-in** | Sign-in page, Home offer, Your Sessions | The secret must sit in the phone's secure hardware and open only with the person's biometrics; a web page can't do that | `biometric_storage` (Android Keystore with user authentication; iOS Keychain with biometry, `.biometryCurrentSet`) or `local_auth` + `flutter_secure_storage`. Choose the one that **binds the secret to the biometric** and is invalidated when one is added, as today. |
| 4 | **Push notifications** | Approvals, decisions, payslips, check-in reminders, "Still checked in?" | Alerts while the app is closed need FCM, plus APNs on iOS | `firebase_core` + `firebase_messaging`; `flutter_local_notifications` for alerts while the app is open, the "general" channel and the tag that replaces the check-in reminder |
| 5 | **Tapping a notification opens its page** | Every notification | The tap arrives in native code | `firebase_messaging` `onMessageOpenedApp` / `getInitialMessage` → load the link in the web view |
| 6 | **QR scanner (new)** | Assets: scan a label to open the asset; counts later | Fast in-app scanning; the phone's camera app leaves the app | `mobile_scanner` → `/app/assets/{code}` |
| 7 | **Android back button / iOS swipe back** | Everywhere | It belongs to the app, not a page | `PopScope` → web view back; at Home, "Press back again to exit"; iOS `allowsBackForwardNavigationGestures` |
| 8 | **Offline screen** | Any page with no connection | A page can't show itself without the internet | `connectivity_plus` + a native screen with **Try again** and the wordmark |
| 9 | **File picking in web forms** (`<input type="file">`) | Leave documents, reimbursements, asset photos, imports | Android web views don't open a picker on their own | Web view file-chooser handling (built into `flutter_inappwebview`) |
| 10 | **Downloads** (Excel exports, PDFs) | Reports, scorecards, payslips | A web view drops downloads unless handled | `onDownloadStartRequest` → save + `share_plus` / open |
| 11 | **Printing** | The Print buttons (job offers, documents) | `window.print()` does nothing in a web view | `printing` (the system print dialog), through the bridge |
| 12 | **External links** | Map links, `tel:`, `mailto:`, links that open in a new tab | They must open in Google/Apple Maps, the dialer or mail | `url_launcher` + the web view's new-window handling |
| 13 | **Icon, splash, name** | The app itself | It belongs to the app | `flutter_launcher_icons`, `flutter_native_splash` from `apps/mobile/assets/source` (the T. icon, the wordmark, #000000, red #E21D3B) |
| 14 | **Device facts** | Fingerprint credential name ("Google Pixel 8"), app version | Native information | `device_info_plus`, `package_info_plus` |
| 15 | **Permissions and their texts** | Location, camera, photos, notifications, Face ID | The operating system asks | `permission_handler`; iOS `Info.plist` strings, the Android manifest |

**Later, not now:**
- background location while checked in (postponed by the owner on 20 October; it would need "Always" location and a foreground service);
- NFC;
- offline screens.

### 3.2 Stays Website (Web View), With No Hardware

All screens and rules: Home, check-in counter, Requests (leave, permission, reimbursement, correction, work from home, home location, raise for HR/CEO), approvals, Attendance and Daily Attendance, payslips (drawn with pdf.js on the page), KPIs (self-rating, scoring, sign-off), the notification inbox, Assets pages, Leave Import, maps (Leaflet), date and time pickers, Your Sessions, and every HR page.

These need nothing native:
- **The office network lock** (decided on the server, from the address the website signs).
- **The 15-minute idle rule** (server sessions).
- **The 10-minute check-in popup** (a web modal, plus native push for the phone alert).
- **Pull to refresh** (already on the pages; it can stay web, or move to the web view's own controller in F5).
- **Clipboard** (copying works in web views).

## 4. The Bridge: `window.TrendlixNative`

Flutter injects one JavaScript object into every page (`flutter_inappwebview`'s `addJavaScriptHandler`, wrapped by a small injected script). The website's `apps/web/src/lib/native.ts` already has every function below for the Capacitor shell. It gets a second adapter that uses `window.TrendlixNative` when present. **The pages don't change.**

| Call | Answer | Errors (codes only; the website words them) |
|---|---|---|
| `platform()` | `'android' \| 'ios'` | none |
| `getPosition({ timeoutMs, maximumAgeMs })` | `{ latitude, longitude, accuracy, timestamp, mock: boolean \| null }` | `DENIED`, `LOCATION_OFF`, `TIMEOUT`, `UNAVAILABLE` |
| `takePhoto({ source: 'camera' \| 'gallery' })` | `{ name, type: 'image/jpeg', base64 }`, resized to about 1600 px | `CANCELLED`, `DENIED`, `FAILED` |
| `biometricStatus()` | `{ available, reason, enrolled, id, deviceName }` | none |
| `enrollBiometric({ id, secret, title, cancel })` | `{ ok: true }` | `CANCELLED`, `LOCKOUT`, `NOT_AVAILABLE`, `FAILED` |
| `unlockBiometric({ title, cancel })` | `{ id, secret }` | `CANCELLED`, `LOCKOUT`, `KEY_INVALIDATED`, `NOT_AVAILABLE`, `FAILED` |
| `clearBiometric()` | `{ ok: true }` | none |
| `pushStatus()` | `'unavailable' \| 'prompt' \| 'granted' \| 'denied'` | none |
| `registerForPush({ ask })` | `{ token, platform }` | `DENIED`, `UNAVAILABLE`, `TIMEOUT` |
| `forgetPush()` | `{ ok: true }` (deletes the FCM token on the phone) | none |
| `scanQr()` | `{ text }` | `CANCELLED`, `DENIED` |
| `print({ url } \| { base64, name })` | `{ ok: true }` | `FAILED` |
| `share({ url } \| { base64, name, type })` | `{ ok: true }` | `CANCELLED`, `FAILED` |
| `exitApp()` | none | none |

Events from Flutter to the page, as `CustomEvent`s on `window`: `trendlix:push-opened` (with the notification's data, already routed by Flutter too), `trendlix:push-received`, `trendlix:back` (the page may handle it first: close a dialog, then let Flutter go back).

Rules:
- The bridge only answers pages from `https://people.trendlix.com`. Flutter checks the origin of every call.
- Secrets (the fingerprint credential) never touch logs on either side.

## 5. The Website's Side

1. **`lib/native.ts`:** a `flutter` adapter next to the Capacitor one, picked by `window.TrendlixNative`. `isNativeApp()` and `nativePlatform()` cover both shells. Unit tests for the adapter with a fake bridge.
2. **QR scanning:** a "Scan QR" button on the Assets pages, shown when `scanQr` exists.
3. **Print and share:** the Print buttons call `print` inside the app. Downloads either use `share`, or let Flutter catch the download.
4. **Nothing else changes.** The pages, the API and the server rules stay as they are.
5. **During the switch** both shells work, so Capacitor APKs already installed keep working until people update.

## 6. Project and Builds

- **Folder:** `apps/mobile-flutter/` (a Flutter project; not an npm workspace).
  - `lib/`:
    - `main.dart`
    - `webview/`: the web view, cookies, downloads, file chooser, new windows
    - `bridge/`: the handlers and their origin check
    - `features/`: location, camera, biometric, push, qr, print, share
    - `offline/`
  - `android/`, `ios/`
- **Flutter:** the current stable release, pinned in `.fvmrc` / CI. Every plugin is pinned exactly in `pubspec.yaml`.
- **Checks:** `flutter analyze`, `dart format --set-exit-if-changed`, `flutter test` (unit tests for the bridge and the error mapping).
- **This Mac has no Flutter SDK and no Xcode.** Either install the Flutter SDK locally (no admin rights needed) for analyze and test, or run them in CI only. iOS builds need macOS: GitHub's macOS runners.
- **GitHub Actions**, `.github/workflows/mobile-flutter.yml`:
  - **Android:**
    - ubuntu, Java 21, Flutter, `flutter build apk --debug` with the **same signing key** as today's APKs: the `ANDROID_DEBUG_KEYSTORE_BASE64` secret or the cached debug keystore.
    - `google-services.json` from the `GOOGLE_SERVICES_JSON` secret, as now.
    - The artifact is `trendlix-people-<version>.apk`.
  - **iOS:**
    - macOS runner, `flutter build ios --simulator` (no account needed) as an artifact.
    - With the Apple account: a signed build to **TestFlight**. The certificates, the profile, `GoogleService-Info.plist` and an App Store Connect API key go into GitHub Secrets.
  - **Triggers:** pushes touching `apps/mobile-flutter/**`, run by hand, and `mobile-v*` tags make a release.

## 7. Phases

Each phase ends with an APK, and from F1 an iOS simulator build.

| Phase | Builds | Done when | Estimate |
|---|---|---|---|
| **F0 · Scaffolding + CI** | Flutter project, app ids, name "Trendlix People", icon and splash from the logos, the workflow (APK + iOS simulator) | A push builds both; the APK installs over today's app | ½ day |
| **F1 · The web view shell** | `/app` in `flutter_inappwebview`, the UA mark, cookies kept, file chooser, downloads, new windows and external links, back button / swipe, offline screen, pull to refresh | Sign-in, every page, attaching a file and a download work in the APK | 1 day |
| **F2 · Bridge + location + camera** | `window.TrendlixNative`, the origin check, `getPosition` with `mock`, `takePhoto`; the website's Flutter adapter | Check-in uses native location, a fake-GPS app is flagged, a receipt photo uploads | 1 day |
| **F3 · Fingerprint / Face ID** | `biometricStatus`/`enroll`/`unlock`/`clear`, bound to the biometric, invalidated when one is added | The next open signs in with a fingerprint (Face ID on iPhone in F6) | ½ day |
| **F4 · Push** | FCM on Android (APNs on iOS once the account exists), foreground display, the replacing tag, taps opening the page, `forgetPush` on sign-out | An approval reaches the phone, closed or open, and a tap opens it | 1 day |
| **F5 · QR, print, share, polish** | The QR scanner and the Assets button, print, share, permission texts, TalkBack/VoiceOver checks | Scanning a label opens the asset; Print opens the system dialog | ½–1 day |
| **F6 · iPhone release** | Signing, TestFlight, APNs key, Face ID text, App Store privacy answers | The owner installs it from TestFlight | ½ day after the Apple account is ready |
| **F7 · Retire Capacitor** | Remove `apps/mobile` and its workflow, and the Capacitor adapter from `native.ts`, once the Flutter APK has replaced it everywhere | One app, one shell | ¼ day |

**Total:** about **5–6 days** of building for Android plus the iOS simulator build. iPhone release follows the Apple account.

## 8. Moving From Capacitor to Flutter

- **The same Android app id and the same signing key** mean the Flutter APK installs **over** today's app, and people keep their session cookie. The cookie store is the system web view's on Android; check it in F1, and if it isn't kept, people sign in once more.
- **Fingerprint sign-in:** the Capacitor plugin's stored secret can't be read by the Flutter app. People turn fingerprint sign-in on once more. The server's device credential is replaced for the same phone name, as today.
- **Push tokens:** Flutter registers a new token on first open, and the old one is cleaned up when FCM reports it gone. Nothing needed.
- **The website** supports both shells during the switch (§5.5).

## 9. What the Owner Provides

| When | What |
|---|---|
| Now | Nothing new for Android: the Firebase file and the server keys are already set. |
| F4 (iOS push) / F6 | An **Apple Developer account** (company: D-U-N-S number; $99/year). Then: the iOS app `com.trendlix.people` added in Firebase, its `GoogleService-Info.plist` saved as a GitHub secret, an **APNs key** uploaded to Firebase, and an App Store Connect API key for CI. All of these go into GitHub Secrets or Firebase, never into chat. |
| F6 | App Store privacy answers: location (at the press only), photos, camera; no tracking. Accounts are made by the company, so Apple's account-deletion rule doesn't apply; say so in the review notes. |

## 10. Risks and Things to Check While Building

- **Fake GPS on iOS:** Apple reports simulated locations only from iOS 15, and only for some tools. It's a weaker signal than Android's.
- **Android file inputs** and **iOS cookie persistence** (WKWebView) in `flutter_inappwebview`: test early (F1).
- **App Store guideline 4.2** (apps that are "just a website"): the native features (location rule, fingerprint/Face ID, push, QR scanner, camera) are the case for approval.
- **Two shells for a short while:** keep the bridge contract (§4) as the single source of truth, with tests on both sides.
