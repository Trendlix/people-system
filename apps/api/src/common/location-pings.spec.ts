import { appPhoneOf, dayPingsOrder, noPingReason, pingStatus, PING_NEAR_METRES, type PingCheckIn, type PingRead, type PingView } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';

// Hourly location pings while checked in (owner, 1 November 2026: "flag if someone is not in the checked in location"):
// each read against where they checked in.

const OFFICE = { latitude: 30.0601, longitude: 31.3465 };
const checkIn = (o: Partial<PingCheckIn> = {}): PingCheckIn => ({ place: 'office', locationName: 'Main office', ...OFFICE, ...o });
const ping = (o: Partial<PingRead> = {}): PingRead => ({ place: 'office', location: 'Main office', ...OFFICE, accuracy: 12, ...o });
/** About this many metres north of the office. */
const north = (metres: number) => ({ latitude: OFFICE.latitude + metres / 111_320, longitude: OFFICE.longitude });

describe('a ping against the check-in', () => {
  it('is at the office while inside it, away once outside', () => {
    expect(pingStatus(checkIn(), ping())).toEqual({ status: 'at_place', distanceMetres: 0 });
    const away = pingStatus(checkIn(), ping({ place: 'remote', location: null, ...north(2000) }));
    expect(away.status).toBe('away');
    expect(away.distanceMetres).toBeGreaterThan(1900);
  });

  it('is at home while inside the approved home, and at a named place while within it', () => {
    expect(pingStatus(checkIn({ place: 'home', locationName: null }), ping({ place: 'home', location: null })).status).toBe('at_place');
    expect(pingStatus(checkIn({ place: 'home', locationName: null }), ping({ place: 'remote', location: null })).status).toBe('away');
    expect(pingStatus(checkIn({ place: 'remote', locationName: 'Acme' }), ping({ place: 'remote', location: 'Acme' })).status).toBe('at_place');
    expect(pingStatus(checkIn({ place: 'remote', locationName: 'Acme' }), ping({ place: 'remote', location: 'Studio' })).status).toBe('away');
  });

  it('checked in elsewhere: still there within its spot’s reach, accuracy allowed for; can’t tell without a spot', () => {
    const elsewhere = checkIn({ place: 'remote', locationName: null });
    expect(pingStatus(elsewhere, ping({ place: 'remote', location: null, ...north(PING_NEAR_METRES - 50) })).status).toBe('at_place');
    expect(pingStatus(elsewhere, ping({ place: 'remote', location: null, ...north(PING_NEAR_METRES + 60), accuracy: 100 })).status).toBe('at_place');
    expect(pingStatus(elsewhere, ping({ place: 'remote', location: null, ...north(PING_NEAR_METRES + 400) })).status).toBe('away');
    expect(pingStatus(checkIn({ place: 'unknown', locationName: null, latitude: null, longitude: null }), ping({ place: 'remote', location: null }))).toEqual({
      status: 'unknown',
      distanceMetres: null,
    });
  });
});

// a day's hourly location on Daily Attendance (owner, 10 November 2026: "can it be embeded in the attendance page?")
describe('a day’s hourly location for everyone', () => {
  it('tells the app’s phone from its sign-in', () => {
    expect(appPhoneOf('Trendlix People/0.6.52 (iOS) TrendLIXPeople')).toBe('ios');
    expect(appPhoneOf('Trendlix People/0.6.52 (android) TrendLIXPeople')).toBe('android');
    expect(appPhoneOf('Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 Mobile Safari/537.36 TrendLIXPeople')).toBe('android');
    expect(appPhoneOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) TrendLIXPeople')).toBe('ios');
    expect(appPhoneOf(null)).toBe('other');
  });

  it('says why someone checked in has none', () => {
    const now = new Date('2026-11-10T12:00:00Z');
    const long = { checkIn: '2026-11-10T07:00:00Z', checkOut: null };
    expect(noPingReason({ phone: 'ios', ...long }, now)).toBe('iphone');
    expect(noPingReason({ phone: null, ...long }, now)).toBe('no_app');
    expect(noPingReason({ phone: 'android', ...long }, now)).toBe('none_received');
    expect(noPingReason({ phone: 'other', ...long }, now)).toBe('none_received');
    // the first ping comes an hour after the check-in: checked in 30 minutes ago, or out after 40 minutes
    expect(noPingReason({ phone: 'android', checkIn: '2026-11-10T11:30:00Z', checkOut: null }, now)).toBe('too_soon');
    expect(noPingReason({ phone: 'ios', checkIn: '2026-11-10T07:00:00Z', checkOut: '2026-11-10T07:40:00Z' }, now)).toBe('too_soon');
  });

  it('shows the flagged first, then those with pings, then those without; by name', () => {
    const ping = { at: '', status: 'at_place', placeText: '', distanceMetres: null, accuracyMetres: null, latitude: null, longitude: null } as PingView;
    const p = (name: string, flagged: number, pings: number) => ({ employee: { fullNameEn: name }, flagged, pings: Array.from({ length: pings }, () => ping) });
    const order = dayPingsOrder([p('Zed', 0, 0), p('Amal', 0, 3), p('Omar', 1, 2), p('Lina', 2, 2), p('Bassem', 0, 0)]);
    expect(order.map((x) => x.employee.fullNameEn)).toEqual(['Lina', 'Omar', 'Amal', 'Bassem', 'Zed']);
  });
});
