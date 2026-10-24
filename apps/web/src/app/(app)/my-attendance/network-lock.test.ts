import { APP_LOCATION_NEEDED_MESSAGE, GPS_TOO_ROUGH_MESSAGE, gpsOutsideMessage, NO_LOCATION_MESSAGE, OFF_NETWORK_MESSAGE } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { REQUESTED_PLACE_KEY, saveRequestedPlace, takeRequestedPlace } from '../../../lib/requested-place';
import { appLocationRefusal, correctionLinkFor, locationLockRefused, noLocationRefused, offNetworkRefused, placeRefused, requestPlaceHref } from './network-lock';

// The check-in panel's words for the office network's lock and the app's location rule (owner, 20 October 2026).

describe('a press refused off the office network', () => {
  it('is the API’s 409 with its message', () => {
    expect(offNetworkRefused(409, [OFF_NETWORK_MESSAGE])).toBe(true);
    expect(offNetworkRefused(409, [APP_LOCATION_NEEDED_MESSAGE])).toBe(false);
    expect(offNetworkRefused(403, [OFF_NETWORK_MESSAGE])).toBe(false);
  });

  it('links to ask for a correction of the day, on the phone pages inside them', () => {
    expect(correctionLinkFor('/my-attendance', '2026-10-20')).toBe('/my-attendance/correct?date=2026-10-20');
    expect(correctionLinkFor('/', '2026-10-20')).toBe('/my-attendance/correct?date=2026-10-20');
    expect(correctionLinkFor('/app', '2026-10-20')).toBe('/app/requests/new/correction?date=2026-10-20');
    expect(correctionLinkFor('/app/attendance', '2026-10-20')).toBe('/app/requests/new/correction?date=2026-10-20');
    expect(correctionLinkFor('/approvals', '2026-10-20')).toBe('/my-attendance/correct?date=2026-10-20');
    expect(correctionLinkFor(null, '2026-10-20')).toBe('/my-attendance/correct?date=2026-10-20');
  });
});

describe('a website press refused without a location (owner, 20 October 2026: "Company switch + exceptions")', () => {
  it('is the API’s 409 with its message, which says how to allow the location in the browser', () => {
    expect(noLocationRefused(409, [NO_LOCATION_MESSAGE])).toBe(true);
    expect(noLocationRefused(409, [OFF_NETWORK_MESSAGE])).toBe(false);
    expect(noLocationRefused(409, [APP_LOCATION_NEEDED_MESSAGE])).toBe(false);
    expect(noLocationRefused(400, [NO_LOCATION_MESSAGE])).toBe(false);
    expect(NO_LOCATION_MESSAGE).toContain('in your browser');
  });
});

describe('a press inside the app without a location', () => {
  it('isn’t sent: it says to turn the location on, and how', () => {
    expect(appLocationRefusal(true, { locationError: 'denied' }, 'Allow it in Settings.')).toEqual([APP_LOCATION_NEEDED_MESSAGE, 'Allow it in Settings.']);
    expect(appLocationRefusal(true, { locationError: 'unsupported' }, null)).toEqual([APP_LOCATION_NEEDED_MESSAGE]);
    // with a location, or on the website: sent
    expect(appLocationRefusal(true, { latitude: 30, longitude: 31, accuracy: 10 }, null)).toBeNull();
    expect(appLocationRefusal(false, { locationError: 'denied' }, 'x')).toBeNull();
  });
});

describe('a press refused by the GPS lock (owner, 24 October 2026: "Yes, add a GPS lock too")', () => {
  const outside = gpsOutsideMessage({ name: 'Trendlix Al Mahrouki', distanceMetres: 1200 });

  it('is the API’s 409 with how far they are, or that the reading is too rough', () => {
    expect(outside).toBe("You're about 1.2 km from Trendlix Al Mahrouki; check in at the office, or ask HR for an attendance correction.");
    expect(locationLockRefused(409, [outside])).toBe(true);
    expect(locationLockRefused(409, [gpsOutsideMessage(null, true)])).toBe(true);
    expect(locationLockRefused(409, [GPS_TOO_ROUGH_MESSAGE])).toBe(true);
    expect(locationLockRefused(409, [OFF_NETWORK_MESSAGE])).toBe(false);
    expect(locationLockRefused(409, [NO_LOCATION_MESSAGE])).toBe(false);
    expect(locationLockRefused(400, [outside])).toBe(false);
  });

  it('offers "Request this place" when refused for where it was, with a reading; never for a rough one or none', () => {
    expect(placeRefused(409, [outside], true)).toBe(true);
    expect(placeRefused(409, [OFF_NETWORK_MESSAGE], true)).toBe(true);
    expect(placeRefused(409, [OFF_NETWORK_MESSAGE], false)).toBe(false);
    expect(placeRefused(409, [GPS_TOO_ROUGH_MESSAGE], true)).toBe(false);
    expect(placeRefused(409, [NO_LOCATION_MESSAGE], true)).toBe(false);
  });

  it('opens the request form on the site, or the phone pages’ inside them', () => {
    expect(requestPlaceHref('/my-attendance')).toBe('/home-locations/new?from=refusal');
    expect(requestPlaceHref('/')).toBe('/home-locations/new?from=refusal');
    expect(requestPlaceHref('/app')).toBe('/app/requests/new/home?from=refusal');
    expect(requestPlaceHref('/app/attendance')).toBe('/app/requests/new/home?from=refusal');
  });

  it('hands the reading to the form through the tab, once, while fresh; never through the address', () => {
    const kept = new Map<string, string>();
    const store = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k) };
    expect(saveRequestedPlace({ latitude: 30.05, longitude: 31.25, accuracy: 18 }, 1_000, store)).toBe(true);
    expect(kept.has(REQUESTED_PLACE_KEY)).toBe(true);
    expect(takeRequestedPlace(2_000, store)).toEqual({ latitude: 30.05, longitude: 31.25, accuracy: 18, at: 1_000 });
    expect(takeRequestedPlace(3_000, store)).toBeNull();
    saveRequestedPlace({ latitude: 30.05, longitude: 31.25 }, 1_000, store);
    expect(takeRequestedPlace(1_000 + 16 * 60_000, store)).toBeNull();
    expect(takeRequestedPlace(0, null)).toBeNull();
    expect(requestPlaceHref('/my-attendance')).not.toContain('30.05');
  });
});
