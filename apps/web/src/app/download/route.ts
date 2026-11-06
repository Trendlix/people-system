import { NextResponse } from 'next/server';
import { API_URL } from '@/lib/api';

// The app, one fixed link for everyone (owner, 31 October 2026: "Always the latest build"; asked, "A fixed People link").
// The website's APK: each build is published as a GitHub release of the repository (.github/workflows/flutter-android.yml),
// its file always trendlix-people.apk, so GitHub's link to the latest release's file is always the newest build. Google
// Play (owner, 6 November 2026: "now i have google play console"; asked, "Play only"): once a Play build is the latest
// release ("Google Play is live"), People's app/latest answers Play's page for the employees (app-releases.ts), and this
// goes there instead. The app's "Update required" opens this; no GitHub account is needed. Public (lib/public-paths.ts).
const APK_URL = 'https://github.com/Trendlix/people-system/releases/latest/download/trendlix-people.apk';
const PLAY = /^https:\/\/play\.google\.com\//;

/** Where the app is now: Play's page once People says so, else the newest APK (also when People can't be asked). */
async function appUrl(): Promise<string> {
  try {
    const res = await fetch(`${API_URL}/api/app/latest`, { cache: 'no-store' });
    if (res.ok) {
      const body = (await res.json()) as { downloadUrl?: unknown };
      if (typeof body.downloadUrl === 'string' && PLAY.test(body.downloadUrl)) return body.downloadUrl;
    }
  } catch {
    // People unreachable: the APK, as before
  }
  return APK_URL;
}

export async function GET() {
  return NextResponse.redirect(await appUrl(), { status: 302, headers: { 'cache-control': 'no-store' } });
}
