import type { CapacitorConfig } from '@capacitor/cli';

// TrendLIX People, the employee app (owner, 20 October 2026: "a mobile app for the employees ... to check in and out,
// and apply for their requests"). The app is a Capacitor shell over the website's phone pages: it shows
// https://people.trendlix.com/app in a WebView and never talks to the API itself (the API is reachable only from the
// website). See README.md, section 2.
//
// After a change here run `npx cap sync android` (CI does it on every build): the settings are copied into the
// Android project as android/app/src/main/assets/capacitor.config.json, which is not kept in the repository.

/** The website the app opens. Every page, rule and permission check lives there. */
const SITE = 'https://people.trendlix.com';

const config: CapacitorConfig = {
  appId: 'com.trendlix.people',
  // the owner may rename the app (README section 5, Phase 5)
  appName: 'TrendLIX People',
  // bundled in the app: a tiny loader (never shown while server.url is set) and the offline page
  webDir: 'www',
  // the canvas colour of the website, so opening the app does not flash white before the first page
  backgroundColor: '#f4f5f7',
  // lets the website's server tell a request from the app ("TrendLIXPeople") from one from a phone's browser; the
  // pages themselves check for window.Capacitor (apps/web/src/lib/native.ts)
  appendUserAgent: 'TrendLIXPeople',
  server: {
    url: `${SITE}/app`,
    // the site only: every other link (a PDF on another domain, a map, a phone number) opens outside the app
    allowNavigation: ['people.trendlix.com'],
    // https only, as the site is; no plain-HTTP traffic is ever allowed
    cleartext: false,
    androidScheme: 'https',
    // shown from the app's own files when the site can't be reached (no connection, the site down, an HTTP error on
    // the page itself); its Retry button opens the site again
    errorPath: 'offline.html',
  },
  android: {
    // no http:// content inside the https pages
    allowMixedContent: false,
    // the modern bridge (addWebMessageListener), limited to the site's origin
    useLegacyBridge: false,
    // webContentsDebuggingEnabled is left to Capacitor: on in debug builds (the test APKs, so chrome://inspect works
    // from a computer), off in release builds
  },
};

export default config;
