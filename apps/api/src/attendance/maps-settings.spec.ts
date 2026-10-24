import {
  DEVELOPER_ACTS_AS,
  isMapsKey,
  MAP_ID_PROBLEM,
  MAPS_KEY_PROBLEM,
  MAPS_KEY_ROLES,
  MAPS_KEY_WEBSITES,
  mapIdOf,
  mapsKeyEnding,
  mapsKeyOf,
  mapsSettingsProblems,
  maskedMapsKey,
  maskForDeveloper,
  receivesMapsKey,
} from '@trendlix/shared';

// Google Maps for every map (owner, 24 October 2026, on Check-in Setup's map: "is there another map provider?", then
// "Google Maps"): the key's rules (its shape, how a saved one is shown, who receives it at runtime) and, found the same
// day, people's points on a map hidden from a developer while the company's locations stay.

/** A made-up key of Google's shape: "AIza" and 35 more. */
const KEY = 'AIzaSyD-made_up_for_the_tests_only_Ab3x';

describe('the Google Maps key', () => {
  it('is a Google API key: AIza and 35 letters, digits, - or _', () => {
    expect(KEY).toHaveLength(39);
    expect(isMapsKey(KEY)).toBe(true);
    expect(isMapsKey(KEY.slice(0, 38))).toBe(false);
    expect(isMapsKey(`${KEY}x`)).toBe(false);
    expect(isMapsKey(KEY.replace('AIza', 'AIzb'))).toBe(false);
    expect(isMapsKey(KEY.replace('_', ' '))).toBe(false);
    expect(isMapsKey(`${KEY.slice(0, 30)}<script>`)).toBe(false);
  });

  it('is read as pasted: spaces and quotes around it gone, empty as none', () => {
    expect(mapsKeyOf(`  ${KEY}\n`)).toBe(KEY);
    expect(mapsKeyOf(`"${KEY}"`)).toBe(KEY);
    expect(mapsKeyOf(`“${KEY}”`)).toBe(KEY);
    expect(mapsKeyOf('   ')).toBeNull();
    expect(mapsKeyOf(null)).toBeNull();
    expect(mapIdOf('  8f348c1e4e8b0e6a ')).toBe('8f348c1e4e8b0e6a');
    expect(mapIdOf('')).toBeNull();
  });

  it('is shown once saved by its last four characters only', () => {
    expect(mapsKeyEnding(KEY)).toBe('Ab3x');
    expect(maskedMapsKey(KEY)).toBe('…Ab3x');
    expect(maskedMapsKey(KEY)).not.toContain(KEY.slice(0, 8));
    expect(mapsKeyEnding(null)).toBeNull();
    // too short to show any of it
    expect(mapsKeyEnding('AIza1234')).toBeNull();
  });

  it('says what is wrong with a save: the key’s shape, the Map ID’s; none keeps the saved key', () => {
    expect(mapsSettingsProblems({ key: KEY, mapId: null })).toEqual([]);
    expect(mapsSettingsProblems({ key: null, mapId: '8f348c1e4e8b0e6a' })).toEqual([]);
    expect(mapsSettingsProblems({ key: 'not-a-key', mapId: null })).toEqual([MAPS_KEY_PROBLEM]);
    expect(mapsSettingsProblems({ key: null, mapId: 'has spaces in it' })).toEqual([MAP_ID_PROBLEM]);
    expect(mapsSettingsProblems({ key: 'AIza', mapId: 'x' })).toEqual([MAPS_KEY_PROBLEM, MAP_ID_PROBLEM]);
    // the words never carry what was typed
    expect(mapsSettingsProblems({ key: 'AIzaSecretButWrong', mapId: null }).join(' ')).not.toContain('SecretButWrong');
  });

  it('goes to those whose pages show a map: anyone with an employee profile, HR, Admin, a Super Admin, the CEO', () => {
    expect(MAPS_KEY_ROLES).toEqual(['hr', 'admin', 'super_admin', 'ceo']);
    expect(receivesMapsKey({ roles: ['employee'], employeeId: 'e1' })).toBe(true);
    expect(receivesMapsKey({ roles: ['employee', 'manager'], employeeId: 'e1' })).toBe(true);
    for (const role of ['hr', 'admin', 'super_admin', 'ceo'] as const) expect(receivesMapsKey({ roles: [role], employeeId: null })).toBe(true);
    // no page of theirs shows a map: Finance without a profile, an account that is nobody's
    expect(receivesMapsKey({ roles: ['finance'], employeeId: null })).toBe(false);
    expect(receivesMapsKey({ roles: ['employee'] })).toBe(false);
  });

  it('never goes to a developer, though they are answered with a Super Admin’s sight', () => {
    expect(receivesMapsKey({ roles: [...DEVELOPER_ACTS_AS], developer: true, employeeId: 'e1' })).toBe(false);
    expect(receivesMapsKey({ roles: ['employee', 'developer'], developer: true, employeeId: 'e1' })).toBe(false);
  });

  it('is restricted to the website, which the phone app opens too', () => {
    expect(MAPS_KEY_WEBSITES).toEqual(['people.trendlix.com/*']);
  });
});

describe('people’s points on a map, for a developer', () => {
  const home = {
    id: 'h1',
    kind: 'home',
    employee: { id: 'e1', employeeCode: 'EMP-0001', fullNameEn: 'Hana Home', fullNameAr: 'هنا' },
    latitude: 30.123456,
    longitude: 31.654321,
    label: 'Home, 12 Nile Street, Maadi',
    radiusMetres: 100,
    accuracyMetres: 12,
    status: 'approved',
  };

  it('hides a home location’s point, its reading’s accuracy and its label, on every home location page', () => {
    for (const path of ['/api/home-locations', '/api/home-locations/h1', '/api/me/home-locations']) {
      const shown = maskForDeveloper([home], path) as (typeof home)[];
      expect(shown[0]).toMatchObject({ latitude: null, longitude: null, accuracyMetres: null, label: null, radiusMetres: 100, status: 'approved' });
    }
  });

  it('hides where each check-in and check-out was pressed, on the attendance pages', () => {
    const day = { people: [{ employee: { id: 'e1', fullNameEn: 'Hana Home' }, punches: [{ kind: 'in', place: 'home', latitude: 30.1, longitude: 31.2, accuracyMetres: 9, pointFrom: 'press', locationName: null }] }] };
    for (const path of ['/api/attendance', '/api/attendance/people/e1', '/api/me/attendance/today', '/api/attendance/team']) {
      const shown = maskForDeveloper(day, path) as typeof day;
      expect(shown.people[0].punches[0]).toMatchObject({ kind: 'in', place: 'home', latitude: null, longitude: null, accuracyMetres: null });
    }
  });

  it('keeps the company’s own check-in locations on Check-in Setup, with their points', () => {
    const locations = [{ id: 'l1', name: 'Main Office', latitude: 30.0596, longitude: 31.3462, radiusMetres: 150, isMain: true, people: [] }];
    expect(maskForDeveloper(locations, '/api/attendance/check-in-setup/locations')).toEqual(locations);
    expect((maskForDeveloper(locations, '/api/attendance/check-in-setup/locations/l1') as typeof locations)[0].latitude).toBe(30.0596);
  });

  it('keeps a label elsewhere (a list’s option, a status), which is no home', () => {
    expect(maskForDeveloper({ label: 'Approved' }, '/api/leave/types')).toEqual({ label: 'Approved' });
  });
});
