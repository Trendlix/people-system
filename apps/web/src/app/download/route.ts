import { NextResponse } from 'next/server';

// The app's newest APK, one fixed link for everyone (owner, 31 October 2026: "Always the latest build"; asked, "A fixed
// People link"): each build is published as a GitHub release of the repository (.github/workflows/flutter-android.yml),
// its file always trendlix-people.apk, so GitHub's link to the latest release's file is always the newest build. The
// app's "Update required" opens this; no GitHub account is needed. Public (lib/public-paths.ts).
const APK_URL = 'https://github.com/Trendlix/people-system/releases/latest/download/trendlix-people.apk';

export function GET() {
  return NextResponse.redirect(APK_URL, { status: 302, headers: { 'cache-control': 'no-store' } });
}
