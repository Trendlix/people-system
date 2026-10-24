import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';
import {
  autocompleteRequest,
  blockedForGoogleMaps,
  GOOGLE_MAPS_CSP,
  GOOGLE_MAPS_ERRORS,
  googleBounds,
  googleLoaderOptions,
  googleMapOptions,
  KEY_CHECK_MESSAGE,
  KEY_CHECK_PATH,
  KEY_CHECK_START,
  keyCheckHtml,
  keyCheckResultOf,
  keyCheckStart,
  keyCheckText,
  mapProviderOf,
  mapsConfigFrom,
  mapsErrorCodeIn,
  mapsErrorText,
  mapsScriptUrl,
  OPENSTREETMAP,
  placesErrorCode,
  searchProviderOf,
  suggestionsFrom,
  wrapLongitude,
} from './google-maps';

// Google Maps for every map (owner, 24 October 2026, on Check-in Setup's map: "is there another map provider?", then
// "Google Maps"). Google itself can't be called here without a key: its part is behind these small functions, tested with
// fakes. Every key below is made up.

const KEY = 'AIzaSyD-made_up_for_the_tests_only_Ab3x';
const GOOGLE = { provider: 'google', key: KEY, mapId: null } as const;

describe('which map and which search a page uses', () => {
  it('reads /maps-key: Google’s with a key, OpenStreetMap’s with none or anything else', () => {
    expect(mapsConfigFrom({ provider: 'google', key: KEY, mapId: '8f348c1e4e8b0e6a' })).toEqual({ provider: 'google', key: KEY, mapId: '8f348c1e4e8b0e6a' });
    expect(mapsConfigFrom({ provider: 'google', key: KEY })).toEqual(GOOGLE);
    expect(mapsConfigFrom({ provider: 'openstreetmap' })).toEqual(OPENSTREETMAP);
    expect(mapsConfigFrom({ message: 'Files with pay or personal IDs aren’t open to developers.' })).toEqual(OPENSTREETMAP);
    expect(mapsConfigFrom(null)).toEqual(OPENSTREETMAP);
    expect(mapsConfigFrom('nonsense')).toEqual(OPENSTREETMAP);
    // a key of no key's shape (it goes into a script's address), and a Map ID that isn't one
    expect(mapsConfigFrom({ provider: 'google', key: 'abc"><script>' })).toEqual(OPENSTREETMAP);
    expect(mapsConfigFrom({ provider: 'google', key: KEY, mapId: 'x y' })).toEqual(GOOGLE);
  });

  it('draws Google’s map with a key, Leaflet’s without one, and Leaflet’s once Google refuses the key', () => {
    expect(mapProviderOf(null, false)).toBeNull();
    expect(mapProviderOf(GOOGLE, false)).toBe('google');
    expect(mapProviderOf(OPENSTREETMAP, false)).toBe('leaflet');
    expect(mapProviderOf(GOOGLE, true)).toBe('leaflet');
  });

  it('searches with Google’s Places with a key, and falls back to Nominatim without one or when Google’s fails', () => {
    expect(searchProviderOf(GOOGLE, false, false)).toBe('google');
    expect(searchProviderOf(OPENSTREETMAP, false, false)).toBe('nominatim');
    expect(searchProviderOf(null, false, false)).toBe('nominatim');
    expect(searchProviderOf(GOOGLE, false, true)).toBe('nominatim');
    expect(searchProviderOf(GOOGLE, true, false)).toBe('nominatim');
  });
});

describe('loading and drawing', () => {
  it('loads the Maps JavaScript API in English, for Egypt, with the Map ID when there is one', () => {
    expect(googleLoaderOptions(GOOGLE)).toEqual({ key: KEY, v: 'weekly', language: 'en', region: 'EG' });
    expect(googleLoaderOptions({ ...GOOGLE, mapId: 'abc123' })).toMatchObject({ mapIds: ['abc123'] });
  });

  it('gives every map the Map/Satellite switch, full screen, no Street View, and cooperative gestures', () => {
    const o = googleMapOptions(null);
    expect(o).toMatchObject({ mapTypeControl: true, fullscreenControl: true, streetViewControl: false, clickableIcons: false, gestureHandling: 'cooperative' });
    expect(o.mapTypeControlOptions.mapTypeIds).toEqual(['roadmap', 'satellite', 'hybrid']);
    expect('mapId' in o).toBe(false);
    expect(googleMapOptions('abc123')).toMatchObject({ mapId: 'abc123' });
  });

  it('fits Leaflet’s bounds and keeps a point’s longitude within −180 to 180', () => {
    expect(
      googleBounds([
        [30, 31],
        [30.1, 31.2],
      ]),
    ).toEqual({ south: 30, west: 31, north: 30.1, east: 31.2 });
    expect(wrapLongitude(31.2357)).toBeCloseTo(31.2357, 9);
    expect(wrapLongitude(391.2357)).toBeCloseTo(31.2357, 9);
    expect(wrapLongitude(-328.7643)).toBeCloseTo(31.2357, 9);
    expect(wrapLongitude(-180)).toBe(-180);
  });
});

describe('Google’s errors in plain words', () => {
  it('names the common ones', () => {
    expect(mapsErrorText('RefererNotAllowedMapError')).toContain('people.trendlix.com/*');
    expect(mapsErrorText('ApiNotActivatedMapError')).toContain('Maps JavaScript API');
    expect(mapsErrorText('BillingNotEnabledMapError')).toContain('billing');
    expect(mapsErrorText('InvalidKeyMapError')).toContain('doesn’t recognise');
    expect(mapsErrorText('ApiTargetBlockedMapError')).toContain('API restrictions');
    expect(mapsErrorText('SomethingNewMapError')).toBe('Google answered “SomethingNewMapError”.');
    for (const words of Object.values(GOOGLE_MAPS_ERRORS)) expect(words).toMatch(/[.:]$|\)\.$/);
  });

  it('reads the code from what the Maps JavaScript API writes to the console', () => {
    expect(
      mapsErrorCodeIn(
        'Google Maps JavaScript API error: RefererNotAllowedMapError\nhttps://developers.google.com/maps/documentation/javascript/error-messages#referer-not-allowed-map-error\nYour site URL to be authorized: https://people.trendlix.com/',
      ),
    ).toBe('RefererNotAllowedMapError');
    expect(mapsErrorCodeIn('Google Maps JavaScript API error: ApiNotActivatedMapError')).toBe('ApiNotActivatedMapError');
    // a warning that is no refusal, and anything else
    expect(mapsErrorCodeIn('Google Maps JavaScript API warning: RetiredVersion')).toBeNull();
    expect(mapsErrorCodeIn('Uncaught TypeError')).toBeNull();
  });

  it('reads the place search’s refusals', () => {
    expect(placesErrorCode('PLACES_AUTOCOMPLETE: PERMISSION_DENIED: Places API (New) has not been used in project 123 before or it is disabled.')).toBe('PlacesApiNotActivated');
    expect(placesErrorCode('PERMISSION_DENIED: Requests from referer https://people.trendlix.com/ are blocked.')).toBe('PlacesRefererNotAllowed');
    expect(placesErrorCode('API_KEY_SERVICE_BLOCKED: Requests to this API places.googleapis.com method are blocked.')).toBe('PlacesApiTargetBlocked');
    expect(placesErrorCode('This API method requires billing to be enabled.')).toBe('PlacesBillingNotEnabled');
    expect(placesErrorCode('INVALID_ARGUMENT: API key not valid. Please pass a valid API key.')).toBe('PlacesInvalidKey');
    expect(placesErrorCode('Network error')).toBeNull();
  });

  it('says plainly whether the key works', () => {
    expect(keyCheckText({ ok: true })).toBe('The key works: the map and Google’s place search both answered.');
    expect(keyCheckText({ ok: false, code: 'RefererNotAllowedMapError' })).toMatch(/^Google refused the key: the key doesn’t allow this website/);
    expect(keyCheckText({ ok: false, code: 'PlacesApiNotActivated' })).toMatch(/^Google refused the key: “Places API \(New\)” isn’t enabled/);
    expect(keyCheckText({ ok: false, code: 'Places', detail: 'Something else' })).toBe('Google refused the key: Google answered: Something else');
    expect(keyCheckText({ ok: false, code: 'Timeout' })).toMatch(/^The check couldn’t finish: Google didn’t answer in time/);
    expect(keyCheckText({ ok: false, code: 'ScriptNotLoaded' })).toMatch(/^The check couldn’t finish: Google Maps couldn’t be reached/);
    expect(keyCheckText({ ok: false })).toMatch(/^Google refused the key: Google didn’t accept the key/);
  });
});

describe('the place search', () => {
  it('asks Places API (New) for places in Egypt, in English, within the session', () => {
    const token = { session: 1 };
    expect(autocompleteRequest('  Cairo   Festival City ', token)).toEqual({ input: 'Cairo Festival City', includedRegionCodes: ['eg'], region: 'eg', language: 'en', sessionToken: token });
  });

  it('lists Google’s suggestions, each place once, without the nameless, at most five', () => {
    const fake = (placeId: string | undefined, text: string | null) => ({ placePrediction: { placeId, text: text === null ? null : { toString: () => text } } });
    const list = [
      fake('p1', 'Cairo Tower, Zamalek'),
      { placePrediction: null },
      fake('p1', 'Cairo Tower, Zamalek'),
      fake('p2', '  '),
      fake(undefined, 'No id'),
      fake('p3', 'Cairo Festival City'),
      fake('p4', 'Four'),
      fake('p5', 'Five'),
      fake('p6', 'Six'),
      fake('p7', 'Seven'),
    ];
    expect(suggestionsFrom(list)).toEqual([
      { id: 'p1', name: 'Cairo Tower, Zamalek', index: 0 },
      { id: 'p3', name: 'Cairo Festival City', index: 5 },
      { id: 'p4', name: 'Four', index: 6 },
      { id: 'p5', name: 'Five', index: 7 },
      { id: 'p6', name: 'Six', index: 8 },
    ]);
  });
});

describe('Check the key', () => {
  it('loads the Maps JavaScript API with the key typed, in English, for Egypt, with the places and marker libraries', () => {
    const url = new URL(mapsScriptUrl(KEY, 'abc123', '__checkReady'));
    expect(url.origin + url.pathname).toBe('https://maps.googleapis.com/maps/api/js');
    expect(Object.fromEntries(url.searchParams)).toEqual({ key: KEY, v: 'weekly', language: 'en', region: 'EG', loading: 'async', callback: '__checkReady', libraries: 'places,marker', map_ids: 'abc123' });
  });

  it('starts the check with the key’s script, sent to the check’s page (never in its address)', () => {
    expect(KEY_CHECK_PATH).toBe('/maps-key/check');
    const start = keyCheckStart('check-1', KEY, 'abc123');
    expect(start).toEqual({ source: KEY_CHECK_START, id: 'check-1', src: mapsScriptUrl(KEY, 'abc123', '__checkReady'), mapId: 'abc123' });
    expect(KEY_CHECK_PATH).not.toContain(KEY);
  });

  it('makes a check page that holds no key, takes the start from the website only, loads only Google’s script', () => {
    const html = keyCheckHtml();
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toContain('AIza');
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html).toContain('e.origin !== location.origin');
    expect(html).toContain('e.source !== parent');
    expect(html).toContain('"prefix":"https://maps.googleapis.com/maps/api/js?"');
    expect(html).toContain('gm_authFailure');
    expect(html).toContain(KEY_CHECK_MESSAGE);
    expect(html).toContain(KEY_CHECK_START);
  });

  it('reads only its own check’s message, the place search’s refusal by what Google said', () => {
    expect(keyCheckResultOf({ source: KEY_CHECK_MESSAGE, id: 'a', ok: true }, 'a')).toEqual({ ok: true, code: null, detail: null });
    expect(keyCheckResultOf({ source: KEY_CHECK_MESSAGE, id: 'b', ok: true }, 'a')).toBeNull();
    expect(keyCheckResultOf({ source: 'someone-else', id: 'a', ok: true }, 'a')).toBeNull();
    expect(keyCheckResultOf('a', 'a')).toBeNull();
    expect(keyCheckResultOf({ source: KEY_CHECK_MESSAGE, id: 'a', ok: false, code: 'RefererNotAllowedMapError' }, 'a')).toMatchObject({ ok: false, code: 'RefererNotAllowedMapError' });
    expect(keyCheckResultOf({ source: KEY_CHECK_MESSAGE, id: 'a', ok: false, code: 'Places', detail: 'Places API (New) has not been used in project 1 before or it is disabled' }, 'a')).toMatchObject({
      ok: false,
      code: 'PlacesApiNotActivated',
    });
    // "ok" only when it says so
    expect(keyCheckResultOf({ source: KEY_CHECK_MESSAGE, id: 'a', ok: 'yes' }, 'a')).toMatchObject({ ok: false });
  });
});

describe('Content-Security-Policy', () => {
  it('lists what Google Maps needs, the place search among *.googleapis.com', () => {
    expect(GOOGLE_MAPS_CSP['script-src']).toEqual(expect.arrayContaining(['https://*.googleapis.com', 'https://*.gstatic.com']));
    expect(GOOGLE_MAPS_CSP['connect-src']).toEqual(expect.arrayContaining(['https://*.googleapis.com']));
    expect(GOOGLE_MAPS_CSP['img-src']).toEqual(expect.arrayContaining(['https://*.googleapis.com', 'https://*.gstatic.com', 'data:']));
    expect(GOOGLE_MAPS_CSP['worker-src']).toEqual(['blob:']);
  });

  it('finds what a policy would block: none when it limits only who frames the site, or allows Google’s list', () => {
    expect(blockedForGoogleMaps("frame-ancestors 'self'")).toEqual([]);
    expect(blockedForGoogleMaps('')).toEqual([]);
    const allowing = Object.entries(GOOGLE_MAPS_CSP)
      .map(([d, sources]) => `${d} 'self' ${sources.join(' ')}`)
      .join('; ');
    expect(blockedForGoogleMaps(`default-src 'self'; ${allowing}`)).toEqual([]);
    expect(blockedForGoogleMaps("default-src 'self'")).toEqual(expect.arrayContaining(['script-src https://*.googleapis.com', 'img-src data:', 'worker-src blob:']));
    // https: covers the hosts, not data: or blob:
    expect(blockedForGoogleMaps('img-src https:')).toEqual(['img-src data:']);
  });

  it('every policy the site sends lets Google Maps load (today: frame-ancestors only)', async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const policies = rules.flatMap((r) => r.headers.filter((h) => h.key.toLowerCase() === 'content-security-policy').map((h) => h.value));
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) expect(blockedForGoogleMaps(policy)).toEqual([]);
  });
});
