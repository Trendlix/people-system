import { pingStatus, PING_NEAR_METRES, type PingCheckIn, type PingRead } from '@trendlix/shared';
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
