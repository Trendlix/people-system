import { MAPS_KEY_WEBSITES, MAPS_LANGUAGE, MAPS_REGION, type MapsKeyView } from '@trendlix/shared';
import type { Bounds } from './map-point';

// Google Maps for every map in the system (owner, 24 October 2026, on Check-in Setup's map, Leaflet on OpenStreetMap's
// tiles: "is there another map provider?"; offered Google Maps, Mapbox, or OpenStreetMap plus satellite, they chose
// "Google Maps"; told: a Map/Satellite switch, Google's place search, the key pasted in the system by a Super Admin, and
// today's map kept until a key is set). The pure part, tested (google-maps.test.ts) with fakes in place of Google:
// - which map and which search a page uses: Google's with a key, Leaflet and Nominatim without one, or once Google
//   refused the key on the page;
// - what the Maps JavaScript API is loaded with (Egypt, English), each map's options and the radius circles' look;
// - Google's errors in plain words, as "Check the key" says them;
// - the place search's request (Places API (New), in Egypt) and its suggestions read;
// - the page "Check the key" loads in a frame, with the key typed;
// - and what a Content-Security-Policy must allow for Google Maps, should the site ever send one beyond frame-ancestors.
// Relative imports: the tests run without the "@/" alias.

// ---------- which map, which search ----------

/** What /maps-key answered: Google's maps with the key, or OpenStreetMap's. */
export type MapsConfig = MapsKeyView;
export type GoogleMapsConfig = Extract<MapsKeyView, { provider: 'google' }>;

export const OPENSTREETMAP: MapsConfig = { provider: 'openstreetmap' };

/** A key's shape as the browser takes it (the API checked it when it was saved): letters, digits, "-" and "_". */
const KEY = /^[0-9A-Za-z_-]{20,100}$/;
const MAP_ID = /^[0-9A-Za-z_-]{1,100}$/;

/** /maps-key's answer read: Google's with a key of the right shape, anything else (none, a refusal, nonsense) OpenStreetMap's. */
export function mapsConfigFrom(json: unknown): MapsConfig {
  if (!json || typeof json !== 'object') return OPENSTREETMAP;
  const { provider, key, mapId } = json as Record<string, unknown>;
  if (provider !== 'google' || typeof key !== 'string' || !KEY.test(key)) return OPENSTREETMAP;
  return { provider: 'google', key, mapId: typeof mapId === 'string' && MAP_ID.test(mapId) ? mapId : null };
}

/** The map a page draws: Google's with a key (until Google refuses it on the page), else Leaflet's; none while still asking. */
export function mapProviderOf(config: MapsConfig | null, googleFailed: boolean): 'google' | 'leaflet' | null {
  if (!config) return null;
  return config.provider === 'google' && !googleFailed ? 'google' : 'leaflet';
}

/** The place search a form uses: Google's with a key (until it fails on the page), else OpenStreetMap's Nominatim. */
export function searchProviderOf(config: MapsConfig | null, googleFailed: boolean, placesFailed: boolean): 'google' | 'nominatim' {
  return config?.provider === 'google' && !googleFailed && !placesFailed ? 'google' : 'nominatim';
}

// ---------- loading and drawing ----------

/** What the Maps JavaScript API is loaded with (the loader's setOptions): the key, Egypt, English, the Map ID if any. */
export function googleLoaderOptions(config: GoogleMapsConfig) {
  return {
    key: config.key,
    v: 'weekly',
    language: MAPS_LANGUAGE,
    region: MAPS_REGION,
    ...(config.mapId && { mapIds: [config.mapId] }),
  };
}

/** The theme's accent and muted colours (globals.css: --color-accent, --color-muted), as the Leaflet maps draw them. */
export const ACCENT = '#2b59f0';
export const MUTED = '#5b6472';

/** A location's radius, and the faint ones around it (Google draws no dashed circle: a lighter, thinner line instead). */
export const CIRCLE_STYLE = { strokeColor: ACCENT, strokeOpacity: 1, strokeWeight: 2, fillColor: ACCENT, fillOpacity: 0.15 } as const;
export const FAINT_CIRCLE_STYLE = { strokeColor: MUTED, strokeOpacity: 0.6, strokeWeight: 1, fillColor: MUTED, fillOpacity: 0.08 } as const;

/** A circle fitted with some room around it (more above, where a pin by the top edge stands), and no closer than 18. */
export const FIT_PADDING = { top: 48, left: 24, right: 24, bottom: 24 } as const;
export const FIT_MAX_ZOOM = 18;

/**
 * A map's options: the Map/Satellite switch (Satellite with Google's Labels box), full screen, no Street View, Google's
 * own places not clickable (a click puts the pin), and "cooperative" gestures: scrolling the page past a map doesn't zoom
 * it (Ctrl and the wheel do, or the wheel once the map is clicked), and one finger on a phone scrolls the page. The Map
 * ID, when set, for Google's newer pins.
 */
export function googleMapOptions(mapId: string | null) {
  return {
    ...(mapId && { mapId }),
    mapTypeControl: true,
    mapTypeControlOptions: { mapTypeIds: ['roadmap', 'satellite', 'hybrid'] },
    streetViewControl: false,
    fullscreenControl: true,
    rotateControl: false,
    clickableIcons: false,
    keyboardShortcuts: true,
    gestureHandling: 'cooperative' as const,
  };
}

/** Leaflet's [[south, west], [north, east]] as Google's bounds. */
export const googleBounds = (b: Bounds) => ({ south: b[0][0], west: b[0][1], north: b[1][0], east: b[1][1] });

/** A longitude within −180 to 180, as the map's point is kept (a map dragged round the world goes past them). */
export const wrapLongitude = (lng: number): number => (((((lng + 180) % 360) + 360) % 360) - 180) + 0;

/** The pins, as the Leaflet maps draw them: the accent's drop, its point at the bottom; the faint ones smaller and grey. */
const PIN_PATH = 'M15 1C7.8 1 2 6.8 2 14c0 9.6 13 27 13 27s13-17.4 13-27C28 6.8 22.2 1 15 1z';
export const PIN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 42" width="30" height="42" aria-hidden="true" focusable="false" style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))">' +
  `<path d="${PIN_PATH}" fill="${ACCENT}" stroke="#fff" stroke-width="2"/><circle cx="15" cy="14" r="5" fill="#fff"/></svg>`;
export const FAINT_PIN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 42" width="20" height="28" aria-hidden="true" focusable="false" style="display:block;opacity:.75">' +
  `<path d="${PIN_PATH}" fill="${MUTED}" stroke="#fff" stroke-width="2.5"/><circle cx="15" cy="14" r="5" fill="#fff"/></svg>`;
/** A pin as a picture, for the classic markers (without a Map ID). */
export const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;

// ---------- Google's errors in plain words ----------

/** Where to fix each: the key's own page in Google Cloud. */
const KEY_PAGE = 'Google Cloud → APIs & Services → Credentials';
const SITES = MAPS_KEY_WEBSITES.join(' and ');

/**
 * The Maps JavaScript API's errors (developers.google.com/maps/documentation/javascript/error-messages), and the place
 * search's and the check's own, in plain words.
 */
export const GOOGLE_MAPS_ERRORS: Readonly<Record<string, string>> = {
  ApiNotActivatedMapError: `“Maps JavaScript API” isn’t enabled in the key’s project: enable it in Google Cloud → APIs & Services → Library.`,
  ApiProjectMapError: 'the key’s project can’t be used: check that the key is right and “Maps JavaScript API” is enabled in its project.',
  ApiTargetBlockedMapError: `the key isn’t allowed to use “Maps JavaScript API”: add it to the key’s API restrictions in ${KEY_PAGE}.`,
  BillingNotEnabledMapError: 'billing isn’t on for the key’s project: link a billing account in Google Cloud → Billing (the free monthly usage still applies).',
  DeletedApiProjectMapError: 'the key’s project was deleted: make a new key in the trendlix-people project.',
  ExpiredKeyMapError: `the key has expired or isn’t recognised: copy it again from ${KEY_PAGE}, or make a new one.`,
  InvalidKeyMapError: `Google doesn’t recognise this key: copy it again from ${KEY_PAGE}.`,
  MalformedCredentialsMapError: 'the key isn’t written right: copy it again, all 39 characters.',
  MissingKeyMapError: 'no key was sent: paste the key, then check it.',
  OverQuotaMapError: 'the key’s project went over its usage limit: check its quotas in Google Cloud.',
  ProjectDeniedMapError: 'Google refused the key’s project: check the project’s status in Google Cloud.',
  RefererDeniedMapError: 'Google blocked this website’s address for the key.',
  RefererNotAllowedMapError: `the key doesn’t allow this website: add ${SITES} to the key’s website restrictions in ${KEY_PAGE}.`,
  MapIdProblem: 'the Map ID doesn’t work with this key: copy it again from Google Maps Platform → Map management, or leave it empty.',
  // the place search (Places API (New))
  PlacesApiNotActivated: '“Places API (New)” isn’t enabled in the key’s project: enable it in Google Cloud → APIs & Services → Library.',
  PlacesApiTargetBlocked: `the key isn’t allowed to use “Places API (New)”: add it to the key’s API restrictions in ${KEY_PAGE}.`,
  PlacesRefererNotAllowed: `the key doesn’t allow this website for the place search: add ${SITES} to the key’s website restrictions.`,
  PlacesBillingNotEnabled: 'billing isn’t on for the key’s project: link a billing account in Google Cloud → Billing (the free monthly usage still applies).',
  PlacesInvalidKey: `Google doesn’t recognise this key for the place search: copy it again from ${KEY_PAGE}.`,
  // the check itself
  AuthFailure: `Google didn’t accept the key: check it, its website restrictions (${SITES}) and that both APIs are enabled.`,
  ScriptNotLoaded: 'Google Maps couldn’t be reached from this browser: check the internet connection, or a blocker of ads or scripts.',
  Timeout: 'Google didn’t answer in time: try again in a moment.',
};

/** A code of the Maps JavaScript API, or ours, in plain words; an unknown one as Google names it. */
export const mapsErrorText = (code: string, detail?: string | null): string =>
  GOOGLE_MAPS_ERRORS[code] ?? (detail ? `Google answered: ${detail}` : `Google answered “${code}”.`);

/** The code in what the Maps JavaScript API writes to the console: "Google Maps JavaScript API error: RefererNotAllowedMapError …". */
export function mapsErrorCodeIn(text: string): string | null {
  const m = /Google Maps JavaScript API (?:error|warning): ([A-Za-z]+)/.exec(text);
  return m && /MapError$/.test(m[1]) ? m[1] : null;
}

/** The place search's refusal (Places API (New)'s message), as one of our codes; null when it isn't about the key. */
export function placesErrorCode(message: string): string | null {
  if (/referr?er/i.test(message)) return 'PlacesRefererNotAllowed';
  if (/has not been used in project|SERVICE_DISABLED|is disabled|not been enabled|API has not been used/i.test(message)) return 'PlacesApiNotActivated';
  if (/billing/i.test(message)) return 'PlacesBillingNotEnabled';
  if (/API_KEY_SERVICE_BLOCKED|not authorized to use this (service|API)|are blocked/i.test(message)) return 'PlacesApiTargetBlocked';
  if (/API_KEY_INVALID|API key not valid|invalid api key/i.test(message)) return 'PlacesInvalidKey';
  return null;
}

/** What "Check the key" found: the key works, or why not. */
export interface KeyCheckResult {
  ok: boolean;
  code?: string | null;
  detail?: string | null;
}

/** "The key works", or "Google refused the key: <why>", as the page says it. */
export function keyCheckText(r: KeyCheckResult): string {
  if (r.ok) return 'The key works: the map and Google’s place search both answered.';
  const code = r.code ?? 'AuthFailure';
  if (code === 'ScriptNotLoaded' || code === 'Timeout') return `The check couldn’t finish: ${mapsErrorText(code)}`;
  return `Google refused the key: ${mapsErrorText(code, r.detail)}`;
}

// ---------- the place search ----------

/** A place search's request to Places API (New): in Egypt (as the OpenStreetMap search is), in English. */
export function autocompleteRequest<T>(input: string, sessionToken: T) {
  return { input: input.trim().replace(/\s+/g, ' '), includedRegionCodes: ['eg'], region: 'eg', language: MAPS_LANGUAGE, sessionToken };
}

/** A suggestion, as the form lists it: its text, and the index of Google's own to put the pin with. */
export interface PlaceSuggestion {
  id: string;
  name: string;
  index: number;
}

/** Google's suggestions (AutocompleteSuggestion), each place once, the ones without a name left out, at most `limit`. */
export function suggestionsFrom(list: readonly { placePrediction?: { placeId?: string; text?: { toString(): string } | null } | null }[], limit = 5): PlaceSuggestion[] {
  const out: PlaceSuggestion[] = [];
  list.forEach((s, index) => {
    const p = s.placePrediction;
    const name = p?.text?.toString().trim();
    if (!p?.placeId || !name || out.some((o) => o.id === p.placeId) || out.length >= limit) return;
    out.push({ id: p.placeId, name, index });
  });
  return out;
}

// ---------- "Check the key" ----------

/**
 * The check's page: one of the website's own, framed by the form, so Google sees the website's address (as the key's
 * restriction asks; a frame written in place would be "about:srcdoc" to it). It holds no key.
 */
export const KEY_CHECK_PATH = '/maps-key/check';
/** The messages between the form and the check's frame, each with the check's own id: the form starts it, the frame answers. */
export const KEY_CHECK_START = 'people-maps-key-check-start';
export const KEY_CHECK_MESSAGE = 'people-maps-key-check';
/** The only script the check's frame loads: Google's Maps JavaScript API. */
const SCRIPT_PREFIX = 'https://maps.googleapis.com/maps/api/js?';

/** JSON safe inside a <script>: no "</script>" or "<!--" can end it. */
const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/** The Maps JavaScript API's address with the key, as the check loads it (the page's maps load it through the loader). */
export function mapsScriptUrl(key: string, mapId: string | null, callback: string): string {
  const params = new URLSearchParams({ key, v: 'weekly', language: MAPS_LANGUAGE, region: MAPS_REGION, loading: 'async', callback, libraries: 'places,marker' });
  if (mapId) params.set('map_ids', mapId);
  return `${SCRIPT_PREFIX}${params}`;
}

/** What the form sends the check's frame once it has loaded (by postMessage, to the website's own address only; never in an address). */
export function keyCheckStart(id: string, key: string, mapId: string | null) {
  return { source: KEY_CHECK_START, id, src: mapsScriptUrl(key, mapId, '__checkReady'), mapId };
}

/**
 * The page "Check the key" loads in a frame (KEY_CHECK_PATH): it waits for the form's start (from the website itself
 * only), then draws a map of Cairo with the key (and the Map ID, with one of Google's newer pins on it), then makes one
 * place search, in Egypt. It tells the form what happened: the key works, or Google's error by its code (written to the
 * console by the Maps JavaScript API; gm_authFailure when the key is refused), or the place search's refusal. A frame of
 * its own, as Google Maps loads once a page and the form's page may have its maps loaded with the saved key already.
 */
export function keyCheckHtml(): string {
  const settings = { start: KEY_CHECK_START, message: KEY_CHECK_MESSAGE, prefix: SCRIPT_PREFIX, centre: { lat: 30.0444, lng: 31.2357 }, request: autocompleteRequest('Cairo Tower', null) };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Check the Key</title><style>html,body,#map{margin:0;height:100%;font:14px system-ui,sans-serif;background:#e8eaed}</style></head><body><div id="map"></div><script>
(function () {
  var s = ${scriptJson(settings)};
  var id = null, mapId = null, done = false, codes = [];
  function send(r) {
    if (done || id === null) return;
    done = true;
    parent.postMessage({ source: s.message, id: id, ok: !!r.ok, code: r.code || null, detail: r.detail || null }, location.origin);
  }
  function note(args) {
    var text = Array.prototype.map.call(args, function (a) { return String(a && a.message ? a.message : a); }).join(' ');
    var m = /Google Maps JavaScript API (?:error|warning): ([A-Za-z]+)/.exec(text);
    if (m && /MapError$/.test(m[1])) { codes.push(m[1]); send({ ok: false, code: m[1] }); }
  }
  var error = console.error, warn = console.warn;
  console.error = function () { note(arguments); return error.apply(console, arguments); };
  console.warn = function () { note(arguments); return warn.apply(console, arguments); };
  window.gm_authFailure = function () { setTimeout(function () { send({ ok: false, code: codes[0] || 'AuthFailure' }); }, 300); };
  function places() {
    if (done) return;
    google.maps.importLibrary('places').then(function (lib) {
      var request = s.request;
      request.sessionToken = new lib.AutocompleteSessionToken();
      return lib.AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
    }).then(function () { setTimeout(function () { send({ ok: true }); }, 500); }, function (err) {
      send({ ok: false, code: 'Places', detail: String(err && err.message ? err.message : err) });
    });
  }
  window.__checkReady = function () {
    Promise.all([google.maps.importLibrary('maps'), google.maps.importLibrary('core')]).then(function (libs) {
      var options = { center: s.centre, zoom: 12, disableDefaultUI: true, mapTypeControl: true };
      if (mapId) options.mapId = mapId;
      var map = new libs[0].Map(document.getElementById('map'), options);
      if (mapId) {
        google.maps.importLibrary('marker').then(function (lib) { new lib.AdvancedMarkerElement({ map: map, position: s.centre }); }).catch(function () { send({ ok: false, code: 'MapIdProblem' }); });
      }
      var settled = false;
      function drawn() { if (settled) return; settled = true; setTimeout(places, 2500); }
      libs[1].event.addListenerOnce(map, 'tilesloaded', drawn);
      libs[1].event.addListenerOnce(map, 'idle', drawn);
      setTimeout(function () { if (!settled) send({ ok: false, code: 'Timeout' }); }, 15000);
    }).catch(function (err) {
      send({ ok: false, code: 'AuthFailure', detail: String(err && err.message ? err.message : err) });
    });
  };
  // the form's start: from the website itself, once, and only Google's script
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (id !== null || e.source !== parent || e.origin !== location.origin || !d || d.source !== s.start) return;
    if (typeof d.id !== 'string' || typeof d.src !== 'string' || d.src.indexOf(s.prefix) !== 0) return;
    id = d.id;
    mapId = typeof d.mapId === 'string' && /^[0-9A-Za-z_-]{1,100}$/.test(d.mapId) ? d.mapId : null;
    var script = document.createElement('script');
    script.src = d.src;
    script.async = true;
    script.onerror = function () { send({ ok: false, code: 'ScriptNotLoaded' }); };
    document.head.appendChild(script);
  });
})();
</script></body></html>`;
}

/** The check's message, read: only this check's (its id), from its own frame; null for any other message. */
export function keyCheckResultOf(data: unknown, id: string): KeyCheckResult | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.source !== KEY_CHECK_MESSAGE || d.id !== id) return null;
  const text = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 500) : null);
  const code = text(d.code);
  const detail = text(d.detail);
  // the place search's refusal, by what Google said
  if (code === 'Places') return { ok: false, code: (detail && placesErrorCode(detail)) ?? 'Places', detail };
  return { ok: d.ok === true, code, detail };
}

// ---------- Content-Security-Policy ----------

/**
 * What Google Maps needs a Content-Security-Policy to allow (Google's "Content Security Policy guide" for the Maps
 * JavaScript API, the allowlist way), the place search (places.googleapis.com) among *.googleapis.com. The site sends no
 * such policy today (next.config.ts: frame-ancestors only, which limits who frames the site, not what it loads); a test
 * checks every policy it sends either leaves these alone or allows them.
 */
export const GOOGLE_MAPS_CSP: Readonly<Record<string, readonly string[]>> = {
  'script-src': ['https://*.googleapis.com', 'https://*.gstatic.com', '*.google.com', 'https://*.ggpht.com', '*.googleusercontent.com', 'blob:'],
  'img-src': ['https://*.googleapis.com', 'https://*.gstatic.com', '*.google.com', '*.googleusercontent.com', 'data:'],
  'frame-src': ['*.google.com'],
  'connect-src': ['https://*.googleapis.com', '*.google.com', 'https://*.gstatic.com', 'data:', 'blob:'],
  'font-src': ['https://fonts.gstatic.com'],
  'style-src': ["'unsafe-inline'", 'https://fonts.googleapis.com'],
  'worker-src': ['blob:'],
};

/** Which directive stands in for one a policy leaves out (CSP Level 3's fallbacks). */
const FALLBACK: Readonly<Record<string, readonly string[]>> = {
  'script-src': ['script-src', 'default-src'],
  'style-src': ['style-src', 'default-src'],
  'img-src': ['img-src', 'default-src'],
  'connect-src': ['connect-src', 'default-src'],
  'font-src': ['font-src', 'default-src'],
  'frame-src': ['frame-src', 'child-src', 'default-src'],
  'worker-src': ['worker-src', 'child-src', 'script-src', 'default-src'],
};

/**
 * What a Content-Security-Policy would block of Google Maps ("script-src https://*.gstatic.com"), none when it leaves
 * them alone (no directive that limits them) or allows them (each source, or "*", or "https:" for an https one).
 */
export function blockedForGoogleMaps(policy: string): string[] {
  const directives = new Map<string, string[]>();
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name && !directives.has(name.toLowerCase())) directives.set(name.toLowerCase(), sources);
  }
  const blocked: string[] = [];
  for (const [directive, needed] of Object.entries(GOOGLE_MAPS_CSP)) {
    const by = FALLBACK[directive].find((d) => directives.has(d));
    if (!by) continue;
    const allowed = directives.get(by)!;
    for (const source of needed) {
      // "*" and "https:" cover hosts, never data:, blob: or a keyword such as 'unsafe-inline'
      const host = !source.startsWith("'") && !source.endsWith(':');
      if (!allowed.includes(source) && !(host && (allowed.includes('*') || allowed.includes('https:')))) blocked.push(`${directive} ${source}`);
    }
  }
  return blocked;
}
