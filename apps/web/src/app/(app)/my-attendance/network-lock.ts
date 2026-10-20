import { APP_LOCATION_NEEDED_MESSAGE, OFF_NETWORK_MESSAGE, OFF_NETWORK_STATUS } from '@trendlix/shared';
import { APP_PATHS, appCorrectionHref } from '../../../lib/surface';
import { askCorrectionHref } from '../attendance/corrections/corrections';

// What the check-in panel says of the office network's lock and of the app's location rule (owner, 20 October 2026:
// check-ins locked to the office network, "Off the office network: refuse it", the way out an attendance correction;
// and inside the app "Refuse without location", "App only"). Pure, tested; relative imports, as vitest doesn't know the
// "@/" paths.

/** Whether the API refused the press off the office network (409 with its message). */
export const offNetworkRefused = (status: number, messages: readonly string[]): boolean => status === OFF_NETWORK_STATUS && messages.includes(OFF_NETWORK_MESSAGE);

/** Where "Ask for a correction" goes for the day: the phone pages' form inside them, else the site's. */
export const correctionLinkFor = (pathname: string | null | undefined, date: string): string =>
  pathname === APP_PATHS.home || pathname?.startsWith(`${APP_PATHS.home}/`) ? appCorrectionHref(date) : askCorrectionHref(date);

/**
 * Inside the app, a press without a location isn't sent: what the panel says instead (the API's own words), with how to
 * turn it on when there is something to say. Null: send it (a location was read, or this is the website).
 */
export function appLocationRefusal(inApp: boolean, location: object, help: string | null): string[] | null {
  if (!inApp || !('locationError' in location)) return null;
  return help ? [APP_LOCATION_NEEDED_MESSAGE, help] : [APP_LOCATION_NEEDED_MESSAGE];
}
