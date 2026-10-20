import { APP_LOCATION_NEEDED_MESSAGE, OFF_NETWORK_MESSAGE } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { appLocationRefusal, correctionLinkFor, offNetworkRefused } from './network-lock';

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

describe('a press inside the app without a location', () => {
  it('isn’t sent: it says to turn the location on, and how', () => {
    expect(appLocationRefusal(true, { locationError: 'denied' }, 'Allow it in Settings.')).toEqual([APP_LOCATION_NEEDED_MESSAGE, 'Allow it in Settings.']);
    expect(appLocationRefusal(true, { locationError: 'unsupported' }, null)).toEqual([APP_LOCATION_NEEDED_MESSAGE]);
    // with a location, or on the website: sent
    expect(appLocationRefusal(true, { latitude: 30, longitude: 31, accuracy: 10 }, null)).toBeNull();
    expect(appLocationRefusal(false, { locationError: 'denied' }, 'x')).toBeNull();
  });
});
