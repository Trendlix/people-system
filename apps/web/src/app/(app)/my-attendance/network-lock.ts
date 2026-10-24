import {
  APP_LOCATION_NEEDED_MESSAGE,
  isGpsOutsideMessage,
  isGpsTooRoughMessage,
  NO_LOCATION_MESSAGE,
  NO_LOCATION_STATUS,
  OFF_NETWORK_MESSAGE,
  OFF_NETWORK_STATUS,
} from '@trendlix/shared';
import { FROM_REFUSAL } from '../../../lib/requested-place';
import { APP_PATHS, appCorrectionHref } from '../../../lib/surface';
import { askCorrectionHref } from '../attendance/corrections/corrections';

// What the check-in panel says of the office network's lock and of the app's location rule (owner, 20 October 2026:
// check-ins locked to the office network, "Off the office network: refuse it", the way out an attendance correction;
// and inside the app "Refuse without location", "App only"; and on the website the company's switch refusing presses
// without a location, "Company switch + exceptions"). And the GPS lock (owner, 24 October 2026: "Yes, add a GPS lock
// too"): a press refused outside the check-in locations or on a reading too rough links to ask for a correction too, and a
// press refused for where it was (outside them, or off the office network with a reading) offers "Request this place"
// (the same day: "allow the employee to request adding this location to his profile"). Pure, tested; relative imports,
// as vitest doesn't know the "@/" paths.

/** Whether the API refused the press off the office network (409 with its message). */
export const offNetworkRefused = (status: number, messages: readonly string[]): boolean => status === OFF_NETWORK_STATUS && messages.includes(OFF_NETWORK_MESSAGE);

/** Whether the API refused a website press for having no location (409 with its message, how to allow it in the browser). */
export const noLocationRefused = (status: number, messages: readonly string[]): boolean => status === NO_LOCATION_STATUS && messages.includes(NO_LOCATION_MESSAGE);

/** Whether the API refused the press by the GPS lock: outside the check-in locations, or a reading too rough to tell (409). */
export const locationLockRefused = (status: number, messages: readonly string[]): boolean =>
  status === OFF_NETWORK_STATUS && messages.some((m) => isGpsOutsideMessage(m) || isGpsTooRoughMessage(m));

/**
 * Whether the press was refused for where it was, so the place can be asked for: outside the check-in locations, or off
 * the office network, with a reading sent (`hadReading`). A reading too rough, or none, can't be asked for.
 */
export const placeRefused = (status: number, messages: readonly string[], hadReading: boolean): boolean =>
  hadReading && status === OFF_NETWORK_STATUS && messages.some((m) => isGpsOutsideMessage(m) || m === OFF_NETWORK_MESSAGE);

/** Where "Request this place" goes: the phone pages' form inside them, else the site's; the reading handed over in the tab. */
export const requestPlaceHref = (pathname: string | null | undefined): string =>
  pathname === APP_PATHS.home || pathname?.startsWith(`${APP_PATHS.home}/`) ? `${APP_PATHS.newHome}?from=${FROM_REFUSAL}` : `/home-locations/new?from=${FROM_REFUSAL}`;

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
