import { APP_USER_AGENT_MARK, appPhoneOf } from '@trendlix/shared';
import { appVersionOf, compareVersions } from './app-releases.js';

// The iPhone app's forced update (owner, 10 November 2026: "when pushing make the update force to all builds, as some
// all builds dont make force update"): the App Store's version, read from Apple's lookup (Egypt's store, where the app
// is), is the newest an iPhone can install. An iPhone build older than it is held: the app's own gate says so with the
// way to the App Store (update_gate.dart, GET /api/app/ios-latest), and People refuses its requests (426) with words
// saying so, so a build from before the gate (0.6.48, the first in the store) is held too. Until the app is in the
// store the lookup has nothing and nobody is held; a TestFlight build newer than the store's never is. Pure code, tested.

/** The app on the App Store (App Store Connect's id). */
export const APP_STORE_ID = '6831911915';

/** Apple's lookup of the app in Egypt's store, where it is offered. */
export const APP_STORE_LOOKUP_URL = `https://itunes.apple.com/lookup?id=${APP_STORE_ID}&country=eg`;

/** Its page in the store, when the lookup doesn't give it. */
export const APP_STORE_PAGE = `https://apps.apple.com/eg/app/id${APP_STORE_ID}`;

/** What GET /api/app/ios-latest answers: the store's version (null: not in the store, or not known) and its page. */
export interface IosLatest {
  version: string | null;
  storeUrl: string;
}

export const NO_IOS_LATEST: IosLatest = { version: null, storeUrl: APP_STORE_PAGE };

const VERSION = /^\d+(\.\d+){1,3}$/;

/** The store's version from Apple's lookup answer ({ resultCount, results: [{ version, trackViewUrl }] }). */
export function iosLatestFromLookup(body: unknown): IosLatest {
  const results = body && typeof body === 'object' ? (body as { results?: unknown }).results : null;
  const app = Array.isArray(results) ? (results[0] as Record<string, unknown> | undefined) : undefined;
  const version = typeof app?.version === 'string' && VERSION.test(app.version) ? app.version : null;
  const url = typeof app?.trackViewUrl === 'string' && app.trackViewUrl.startsWith('https://') ? app.trackViewUrl : APP_STORE_PAGE;
  return { version, storeUrl: url };
}

/** Whether a request comes from the iPhone app (its user agent: "Trendlix People/0.6.48 (iOS) TrendLIXPeople"). */
export const fromIphoneApp = (userAgent: string | null | undefined): boolean =>
  !!userAgent && userAgent.trim().endsWith(APP_USER_AGENT_MARK) && appPhoneOf(userAgent) === 'ios';

/** Why People refuses an iPhone build older than the store's; null when it isn't (or either version isn't known). */
export function outdatedIphone(userAgent: string | null | undefined, latest: IosLatest): string | null {
  if (!fromIphoneApp(userAgent) || !latest.version) return null;
  const mine = appVersionOf(userAgent);
  if (!mine || compareVersions(mine, latest.version) >= 0) return null;
  return `Update Trendlix People from the App Store: version ${latest.version} is out, and this iPhone has ${mine}.`;
}

/** The addresses an outdated build may still reach: whether it is outdated, and the server's version. */
export const answeredWhenOutdated = (path: string): boolean => /^\/api\/(app\/|version\b|health\b)/.test(path);
