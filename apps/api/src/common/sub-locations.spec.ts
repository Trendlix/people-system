import {
  CHECK_IN_FLAG_LABELS,
  CHECK_IN_FLAG_SHORT_LABELS,
  CHECK_IN_FLAGS,
  checkInFlags,
  checkInPlaceAt,
  checkInPlacesText,
  countsAsRemote,
  dayFromPunches,
  MAIN_OFFICE_LINK_REFUSED,
  MAIN_OFFICE_REMOVE_REFUSED,
  NETWORK_NEEDED_TEXT,
  networkNeededText,
  pressPlaceLabel,
  punchFlags,
  punchMessages,
  punchNetwork,
  SMALL_RADIUS_HINT,
  subLocationLabel,
  waivesNetworkLock,
  zonedMoment,
  type CheckInPlaces,
  type NetworkLockSetting,
} from '@trendlix/shared';

// The main office and its sub-locations (owner, 20 October 2026: "main office location is the hero and other locations
// are like sub locations. shown with their name and linked users"; "own sublocation shows the sub location name", "will
// check it and shows remote too / any checkin rather than the office location counts remote and named with the location
// name (Remote - Location name)"; packages/shared sub-locations.ts): where a press was, in order (the main office, their
// own sub-location, any sub-location, home, remote, unknown), the flags on and off an office day, the words, and the
// office network's lock waived at one's own sub-location (Claude's default).

// the main office, a studio and a client's site at invented points in Cairo, a home, and points around them
const MAIN = { name: 'Head office', latitude: 30.0596, longitude: 31.3462, radiusMetres: 150 };
const STUDIO = { name: 'Studio', latitude: 30.0444, longitude: 31.2357, radiusMetres: 100 };
const CLIENT = { name: 'Client X', latitude: 30.0131, longitude: 31.2089, radiusMetres: 200 };
const HOME = { latitude: 30.0726, longitude: 31.3474, radiusMetres: 100 };
const AT_MAIN = { latitude: 30.0601, longitude: 31.3465, accuracy: 18 };
const AT_STUDIO = { latitude: 30.0446, longitude: 31.2359, accuracy: 12.4 };
const AT_CLIENT = { latitude: 30.0134, longitude: 31.2091, accuracy: 20 };
const AT_HOME = { latitude: 30.0728, longitude: 31.3476, accuracy: 9 };
const CAFE = { latitude: 29.9792, longitude: 31.1342, accuracy: 30 }; // Giza, far from them all

/** The places as a person sees them: linked to the sub-locations named. */
const placesFor = (...linked: string[]): CheckInPlaces => ({
  main: MAIN,
  subLocations: [STUDIO, CLIENT].map((s) => ({ ...s, linked: linked.includes(s.name) })),
});

const LOCK: NetworkLockSetting = { lock: true, networks: [{ label: 'Main office line', range: '41.33.10.0/24' }], serverKey: true };
const OFFICE_PERSON = { workArrangement: 'office' };
const OFF_NETWORK = '197.45.1.9';

describe('where a press was: the main office, then sub-locations, then home', () => {
  it('is Office within the main office, its name kept, for anyone linked or not', () => {
    expect(checkInPlaceAt(AT_MAIN, placesFor())).toEqual({ place: 'office', accuracyMetres: 18, location: 'Head office' });
    expect(checkInPlaceAt(AT_MAIN, placesFor('Studio'), HOME)).toEqual({ place: 'office', accuracyMetres: 18, location: 'Head office' });
  });

  it('is remote within one’s own sub-location, named, and linked', () => {
    expect(checkInPlaceAt(AT_STUDIO, placesFor('Studio'))).toEqual({ place: 'remote', accuracyMetres: 12, location: 'Studio', subLocation: { name: 'Studio', linked: true } });
  });

  it('is remote within another’s sub-location too, named, not linked', () => {
    expect(checkInPlaceAt(AT_CLIENT, placesFor('Studio'))).toEqual({ place: 'remote', accuracyMetres: 20, location: 'Client X', subLocation: { name: 'Client X', linked: false } });
    expect(checkInPlaceAt(AT_STUDIO, placesFor())).toMatchObject({ place: 'remote', subLocation: { name: 'Studio', linked: false } });
  });

  it('prefers the main office, then one’s own sub-location, then the nearest other', () => {
    // a sub-location around the main office: the main office first
    const around = { name: 'Annex', latitude: MAIN.latitude, longitude: MAIN.longitude, radiusMetres: 500 };
    expect(checkInPlaceAt(AT_MAIN, { main: MAIN, subLocations: [{ ...around, linked: true }] }).place).toBe('office');
    // two overlapping sub-locations: one's own even when the other is nearer
    const wide = { name: 'Wide yard', latitude: AT_STUDIO.latitude, longitude: AT_STUDIO.longitude, radiusMetres: 2000 };
    const both = { main: MAIN, subLocations: [{ ...wide, linked: false }, { ...STUDIO, linked: true }] };
    expect(checkInPlaceAt(AT_STUDIO, both).location).toBe('Studio');
    const neither = { main: MAIN, subLocations: [{ ...wide, linked: false }, { ...STUDIO, linked: false }] };
    expect(checkInPlaceAt(AT_STUDIO, neither).location).toBe('Wide yard');
  });

  it('reads a sub-location before the home, then Home, then remote, then unknown without a reading', () => {
    const homeAtStudio = { latitude: STUDIO.latitude, longitude: STUDIO.longitude, radiusMetres: 100 };
    expect(checkInPlaceAt(AT_STUDIO, placesFor(), homeAtStudio)).toMatchObject({ place: 'remote', location: 'Studio' });
    expect(checkInPlaceAt(AT_HOME, placesFor(), HOME)).toEqual({ place: 'home', accuracyMetres: 9 });
    expect(checkInPlaceAt(CAFE, placesFor('Studio'), HOME)).toEqual({ place: 'remote', accuracyMetres: 30 });
    expect(checkInPlaceAt(null, placesFor('Studio'), HOME)).toEqual({ place: 'unknown', accuracyMetres: null });
    expect(checkInPlaceAt({ latitude: 120, longitude: 31 }, placesFor()).place).toBe('unknown');
  });

  it('is remote with sub-locations only, and unknown with no location at all (home still Home)', () => {
    expect(checkInPlaceAt(CAFE, { main: null, subLocations: [{ ...STUDIO, linked: false }] }).place).toBe('remote');
    expect(checkInPlaceAt(CAFE, { main: null, subLocations: [] })).toEqual({ place: 'unknown', accuracyMetres: 30 });
    expect(checkInPlaceAt(AT_HOME, { main: null, subLocations: [] }, HOME).place).toBe('home');
  });
});

describe('the flags at a sub-location', () => {
  const own = { name: 'Studio', linked: true };
  const other = { name: 'Client X', linked: false };

  it('flags no one at their own sub-location, on any day', () => {
    expect(checkInFlags('anywhere', 'remote', false, false, own)).toEqual([]);
    // an office day: it is their place, not outside the office
    expect(checkInFlags('office', 'remote', false, false, own)).toEqual([]);
    // with an approved home: not "not at home or the office" either
    expect(checkInFlags('anywhere', 'remote', false, true, own)).toEqual([]);
  });

  it('flags another’s sub-location "Not their location", and outside the office on an office day as before', () => {
    expect(checkInFlags('anywhere', 'remote', false, false, other)).toEqual(['not_their_location']);
    expect(checkInFlags('office', 'remote', false, false, other)).toEqual(['outside_office', 'not_their_location']);
    // one flag for it with a home: not "not at home or the office" too
    expect(checkInFlags('anywhere', 'remote', false, true, other)).toEqual(['not_their_location']);
  });

  it('keeps the fake GPS flag, and the other flags as they were away from the sub-locations', () => {
    expect(checkInFlags('office', 'remote', true, false, own)).toEqual(['fake_gps']);
    expect(checkInFlags('anywhere', 'remote', true, false, other)).toEqual(['fake_gps', 'not_their_location']);
    expect(checkInFlags('office', 'remote')).toEqual(['outside_office']);
    expect(checkInFlags('anywhere', 'remote', false, true)).toEqual(['not_home_or_office']);
    expect(checkInFlags('office', 'unknown')).toEqual(['location_unknown']);
    // a sub-location is read only on a remote press (an office one, on the office network, is Office)
    expect(checkInFlags('office', 'office', false, false, other)).toEqual([]);
  });

  it('flags a check-in only; a check-out keeps fake GPS alone', () => {
    expect(punchFlags('in', 'anywhere', 'remote', false, false, other)).toEqual(['not_their_location']);
    expect(punchFlags('out', 'office', 'remote', false, false, other)).toEqual([]);
    expect(punchFlags('out', 'anywhere', 'remote', true, false, other)).toEqual(['fake_gps']);
  });

  it('is a known flag with its words, kept on the day', () => {
    expect(CHECK_IN_FLAGS).toContain('not_their_location');
    expect(CHECK_IN_FLAG_SHORT_LABELS.not_their_location).toBe('Not their location');
    expect(CHECK_IN_FLAG_LABELS.not_their_location).toBe('Checked in at a sub-location they aren’t linked to');
    const at = (time: string) => new Date(zonedMoment('2026-10-20', time)).toISOString();
    const day = dayFromPunches(
      '2026-10-20',
      [
        { kind: 'in', at: at('09:00'), place: 'remote', flags: ['not_their_location'] },
        { kind: 'out', at: at('17:00'), place: 'remote', flags: [] },
      ],
      null,
    );
    expect(day).toMatchObject({ place: 'remote', flags: ['not_their_location'] });
  });

  it('counts a sub-location as remote for every other rule', () => {
    expect(countsAsRemote(checkInPlaceAt(AT_STUDIO, placesFor('Studio')).place)).toBe(true);
  });
});

describe('the office network’s lock at one’s own sub-location (Claude’s default)', () => {
  it('lets a locked Office person linked to it check in off the network', () => {
    const read = checkInPlaceAt(AT_STUDIO, placesFor('Studio'));
    expect(waivesNetworkLock(read, false)).toBe(true);
    expect(punchNetwork(LOCK, OFFICE_PERSON, OFF_NETWORK, waivesNetworkLock(read, false))).toEqual({ network: null, refused: false });
  });

  it('still refuses someone not linked to it, anywhere else, and on a mock location', () => {
    const other = checkInPlaceAt(AT_CLIENT, placesFor('Studio'));
    expect(waivesNetworkLock(other, false)).toBe(false);
    expect(punchNetwork(LOCK, OFFICE_PERSON, OFF_NETWORK, waivesNetworkLock(other, false))).toEqual({ network: null, refused: true });
    expect(waivesNetworkLock(checkInPlaceAt(CAFE, placesFor('Studio')), false)).toBe(false);
    expect(waivesNetworkLock(checkInPlaceAt(AT_MAIN, placesFor('Studio')), false)).toBe(false);
    expect(waivesNetworkLock(checkInPlaceAt(AT_STUDIO, placesFor('Studio')), true)).toBe(false);
    expect(punchNetwork(LOCK, OFFICE_PERSON, OFF_NETWORK)).toEqual({ network: null, refused: true });
  });

  it('tells a locked person linked to sub-locations where they may check in off it', () => {
    expect(networkNeededText()).toBe(NETWORK_NEEDED_TEXT);
    expect(networkNeededText(['Studio'])).toBe(`${NETWORK_NEEDED_TEXT} At your own check-in place (Studio) you can check in off it.`);
    expect(networkNeededText(['Studio', 'Client X', 'Studio'])).toBe(`${NETWORK_NEEDED_TEXT} At your own check-in places (Studio, Client X) you can check in off it.`);
  });
});

describe('the words', () => {
  it('shows a sub-location press as "Remote - Studio", any other by its place', () => {
    expect(subLocationLabel('  Client   X ')).toBe('Remote - Client X');
    expect(pressPlaceLabel('remote', 'Studio')).toBe('Remote - Studio');
    expect(pressPlaceLabel('remote', null)).toBe('Remote');
    expect(pressPlaceLabel('remote', ' ')).toBe('Remote');
    // an office press keeps "Office", its location's name aside
    expect(pressPlaceLabel('office', 'Head office')).toBe('Office');
    expect(pressPlaceLabel('home')).toBe('Home');
    expect(pressPlaceLabel('unknown')).toBe('Location unknown');
  });

  it('names a person’s check-in places, and the refusals', () => {
    expect(checkInPlacesText(['Studio', 'Client X'])).toBe('Check-in places: Studio, Client X');
    expect(checkInPlacesText([])).toBeNull();
    expect(MAIN_OFFICE_REMOVE_REFUSED).toContain('Make another location the main office first');
    expect(MAIN_OFFICE_LINK_REFUSED).toContain('sub-location');
    expect(SMALL_RADIUS_HINT).toBe('Phones are often 10–30 m off; 50–80 m is safer.');
  });

  it('tells the employee where a sub-location press was, and its flag', () => {
    const at = new Date(zonedMoment('2026-10-20', '09:05')).toISOString();
    expect(punchMessages({ kind: 'in', at, place: 'remote', flags: [], locationName: 'Studio' }, [])).toEqual(['Checked in at 9:05 AM, remote at Studio.']);
    const flagged = punchMessages({ kind: 'in', at, place: 'remote', flags: ['not_their_location'], locationName: 'Client X' }, []);
    expect(flagged[0]).toBe('Checked in at 9:05 AM, remote at Client X.');
    expect(flagged[1]).toContain('Not their location: you checked in at Client X');
    // an office press is "at the office" whatever its location's name
    expect(punchMessages({ kind: 'in', at, place: 'office', flags: [], locationName: 'Head office' }, [])).toEqual(['Checked in at 9:05 AM, at the office.']);
  });
});
