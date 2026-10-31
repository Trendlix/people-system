// The app's newest build, for its force update (owner, 31 October 2026: "in the next build i would prefare to apply the
// force update rule"; "Always the latest build", "A fixed People link"). Each APK the app's workflow builds is published
// as a GitHub release of this repository (.github/workflows/flutter-android.yml), tagged app-<version>, its file named
// trendlix-people.apk; the website's /download sends people to the newest one. Pure code, tested.

/** The repository the app's builds are released in. Its releases are the app's only. */
export const APP_RELEASES_URL = 'https://api.github.com/repos/Trendlix/people-system/releases/latest';

/** The fixed link the app sends people to: the website's /download, which goes to the newest APK. */
export const APP_DOWNLOAD_URL = 'https://people.trendlix.com/download';

/** What GET /api/app/latest answers: the newest build's version (null when it can't be told) and where to get it. */
export interface LatestApp {
  version: string | null;
  publishedAt: string | null;
  downloadUrl: string;
}

const VERSION = /^\d+(\.\d+){1,3}$/;

/** The newest build from GitHub's answer for the latest release: its tag app-0.6.15 → 0.6.15; null when it isn't one. */
export function latestFromRelease(release: unknown): LatestApp | null {
  if (!release || typeof release !== 'object') return null;
  const { tag_name: tag, published_at: at, draft, prerelease } = release as Record<string, unknown>;
  if (draft === true || prerelease === true || typeof tag !== 'string') return null;
  const version = tag.replace(/^app-/, '');
  if (!tag.startsWith('app-') || !VERSION.test(version)) return null;
  return { version, publishedAt: typeof at === 'string' ? at : null, downloadUrl: APP_DOWNLOAD_URL };
}

/** Nothing known: the app then never blocks (it can't tell it's old). */
export const UNKNOWN_APP: LatestApp = { version: null, publishedAt: null, downloadUrl: APP_DOWNLOAD_URL };
