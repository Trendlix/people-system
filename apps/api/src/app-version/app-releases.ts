// The app's newest build, for its force update (owner, 31 October 2026: "in the next build i would prefare to apply the
// force update rule"; "Always the latest build", "A fixed People link"). Each APK the app's workflow builds is published
// as a GitHub release of this repository (.github/workflows/flutter-android.yml), tagged app-<version>, its file named
// trendlix-people.apk; the website's /download sends people to the newest one. Pure code, tested.

/** The repository the app's builds are released in. Its releases are the app's only. */
export const APP_RELEASES_URL = 'https://api.github.com/repos/Trendlix/people-system/releases/latest';

/** The fixed link the app sends people to: the website's /download, which goes to the newest APK. */
export const APP_DOWNLOAD_URL = 'https://people.trendlix.com/download';

/**
 * Whether the app may tell people to remove the old version before installing the new one (owner, 31 October 2026:
 * "remind him to remove the old version till posted to the app store or google playstore"). Set it to false once the app
 * is installed from Google Play and the App Store (and point APP_DOWNLOAD_URL at the store). Until then it says so only
 * when it is needed (owner, 2 November 2026: "if it is not applicable skip it"): when the phone's build isn't signed with
 * the newest one's key, as Android then refuses the update (removeOldFirstFor).
 */
export const APP_REMOVE_OLD_FIRST = true;

/** What GET /api/app/latest answers: the newest build's version (null when it can't be told) and where to get it. */
export interface LatestApp {
  version: string | null;
  publishedAt: string | null;
  downloadUrl: string;
  /** Remove the old version before installing the new one: as the asking phone needs it (removeOldFirstFor). */
  removeOldFirst: boolean;
  /**
   * The oldest version signed with the newest one's key, as its release says ("Same signing key since app-0.6.28",
   * flutter-android.yml): a phone on it or later updates in place. Null when the release doesn't say (built before it).
   */
  sameKeySince?: string | null;
}

const VERSION = /^\d+(\.\d+){1,3}$/;

/** The release notes' line saying since which version the build's signing key is the same (flutter-android.yml). */
const SAME_KEY_SINCE = /^Same signing key since app-(\d+(?:\.\d+){1,3})\s*$/m;

/** The newest build from GitHub's answer for the latest release: its tag app-0.6.15 → 0.6.15; null when it isn't one. */
export function latestFromRelease(release: unknown): LatestApp | null {
  if (!release || typeof release !== 'object') return null;
  const { tag_name: tag, published_at: at, draft, prerelease, body } = release as Record<string, unknown>;
  if (draft === true || prerelease === true || typeof tag !== 'string') return null;
  const version = tag.replace(/^app-/, '');
  if (!tag.startsWith('app-') || !VERSION.test(version)) return null;
  const sameKeySince = typeof body === 'string' ? (SAME_KEY_SINCE.exec(body)?.[1] ?? null) : null;
  return { version, publishedAt: typeof at === 'string' ? at : null, downloadUrl: APP_DOWNLOAD_URL, removeOldFirst: APP_REMOVE_OLD_FIRST, sameKeySince };
}

/** The app's version from its user agent ("Trendlix People/0.6.26 (android) …", the app's userAgentOf); null otherwise. */
export function appVersionOf(userAgent: string | null | undefined): string | null {
  const m = /^Trendlix People\/(\d+(?:\.\d+){1,3})\b/.exec(userAgent ?? '');
  return m ? m[1] : null;
}

/** -1, 0 or 1 as `a` is older than, the same as or newer than `b` ("0.6.9" < "0.6.10"). */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [a.split('.').map(Number), b.split('.').map(Number)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/**
 * Whether the phone running `mine` has to remove its version before installing the newest (owner, 2 November 2026: "if
 * it is not applicable skip it"): not when its build is signed with the newest one's key, which Android then installs
 * over it as an update; yes when it may not be (the newest release doesn't say since when its key is the same, or the
 * phone's version isn't known), as Android refuses an update signed with another key.
 */
export function removeOldFirstFor(latest: Pick<LatestApp, 'sameKeySince'>, mine: string | null): boolean {
  if (!APP_REMOVE_OLD_FIRST) return false;
  if (!latest.sameKeySince || !mine) return true;
  return compareVersions(mine, latest.sameKeySince) < 0;
}

/** The answer to a phone: the newest build, removeOldFirst as that phone needs it. */
export function latestFor(latest: LatestApp, userAgent: string | null | undefined): LatestApp {
  const { sameKeySince, ...answer } = latest;
  return { ...answer, removeOldFirst: removeOldFirstFor({ sameKeySince }, appVersionOf(userAgent)) };
}

/** Nothing known: the app then never blocks (it can't tell it's old). */
export const UNKNOWN_APP: LatestApp = { version: null, publishedAt: null, downloadUrl: APP_DOWNLOAD_URL, removeOldFirst: APP_REMOVE_OLD_FIRST };
