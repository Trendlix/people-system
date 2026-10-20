import { OFFICE_RADIUS_DEFAULT } from '@trendlix/shared';
import { latin, roundCoordinate } from './setup';

// The check-in locations on a map (owner, 20 October 2026: "let me view location on map and add location from map"):
// the pure part, tested. A point read from what is pasted (a Google Maps or OpenStreetMap link, "30.0457, 31.1923", or
// degrees, minutes and seconds), the area a location's circle covers, for the map to fit it, where a map starts, and
// the place search on OpenStreetMap's Nominatim (only in Egypt, in English and Arabic, at most one search a second, as
// its usage policy asks). Relative imports: the tests run without the "@/" alias.

/** A point on the map, each coordinate to 6 decimals. */
export interface Point {
  latitude: number;
  longitude: number;
}

/** A location's point and radius as a map draws them, with its name for the overview's tooltips. */
export interface MapCircle extends Point {
  radiusMetres: number;
  name?: string;
}

/** Where a map starts with no point and no location yet: Cairo (Tahrir Square), at the city's zoom. */
export const CAIRO: Point = { latitude: 30.0444, longitude: 31.2357 };
export const CAIRO_ZOOM = 11;

const inRange = (latitude: number, longitude: number) =>
  Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;

/** A point if both are numbers within range (latitude -90 to 90, longitude -180 to 180), each to 6 decimals; else none. */
export function pointOf(latitude: number | null | undefined, longitude: number | null | undefined): Point | null {
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || !inRange(latitude, longitude)) return null;
  return { latitude: roundCoordinate(latitude), longitude: roundCoordinate(longitude) };
}

// ---------- a point from what is pasted ----------

const NUM = String.raw`[-+]?\d{1,3}(?:\.\d+)?`;
const DEC = String.raw`-?\d{1,3}\.\d+`;
/** The text as a whole, two numbers: "30.0457, 31.1923", "30.0457،31.1923"; or "30.0457 31.1923" (a space only between two decimals, so "10 6" stays a search). */
const WHOLE_PAIR = new RegExp(String.raw`^(${NUM})\s*[,،]\s*(${NUM})$`);
const WHOLE_SPACED = new RegExp(String.raw`^(${DEC})\s+(${DEC})$`);
/** A Google Maps place's own point, in the link's data: "!3d30.0457!4d31.1923". */
const PLACE = new RegExp(String.raw`!3d(${NUM})!4d(${NUM})`);
/** A point asked for in the link: ?q=30.05,31.19 (also q=loc:…), query= (Google's Maps URLs), ll= and sll= (Google, Apple), center=, destination=, daddr=. */
const ASKED = new RegExp(String.raw`[?&](?:q|query|ll|sll|center|destination|daddr)=(?:loc:)?\s*(${NUM})\s*[,،]\s*(${NUM})`, 'i');
/** OpenStreetMap's marker: ?mlat=30.05&mlon=31.19 (the link this page's "See it on a map" opens). */
const MLAT = new RegExp(String.raw`[?&]mlat=(${NUM})`, 'i');
const MLON = new RegExp(String.raw`[?&]mlon=(${NUM})`, 'i');
/** The map's centre in a Google Maps link: "/@30.05,31.19,17z". */
const CENTRE = new RegExp(String.raw`@(${NUM}),\s*(${NUM})`);
/** OpenStreetMap's view: "#map=18/30.05/31.19". */
const OSM_VIEW = new RegExp(String.raw`#map=\d{1,2}(?:\.\d+)?/(${NUM})/(${NUM})`);
/** Two decimal numbers anywhere in a link: "/maps/search/30.05,+31.19". */
const ANY_PAIR = new RegExp(String.raw`(${DEC})\s*[,،]\s*(${DEC})`);
/** Degrees, minutes and seconds, as Google Maps names a dropped pin: 30°02'44.8"N 31°11'32.3"E. */
const DMS = /(\d{1,3})\s*°\s*(\d{1,2})\s*['′’]\s*(\d{1,2}(?:\.\d+)?)\s*["″”]\s*([NS])[\s,،]*(\d{1,3})\s*°\s*(\d{1,2})\s*['′’]\s*(\d{1,2}(?:\.\d+)?)\s*["″”]\s*([EW])/i;

/** The text with a link's escapes (%2C, %C2%B0) and pluses as spaces undone; as it is if it can't be. */
function unescaped(s: string): string {
  const spaced = s.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(spaced);
  } catch {
    return spaced;
  }
}

const pair = (m: RegExpExecArray | null): Point | null => (m ? pointOf(Number(m[1]), Number(m[2])) : null);

function fromDms(m: RegExpExecArray | null): Point | null {
  if (!m) return null;
  const part = (d: string, min: string, sec: string, hemisphere: string, negative: string) => {
    if (Number(min) >= 60 || Number(sec) >= 60) return NaN;
    const value = Number(d) + Number(min) / 60 + Number(sec) / 3600;
    return hemisphere.toUpperCase() === negative ? -value : value;
  };
  return pointOf(part(m[1], m[2], m[3], m[4], 'S'), part(m[5], m[6], m[7], m[8], 'W'));
}

/**
 * The point in what is pasted into the search or into Latitude, each coordinate to 6 decimals: "lat, lng" (a comma or
 * an Arabic comma between them, or a space between two decimals; Arabic digits too), a Google Maps link (the place's own point, !3d…!4d…,
 * before the point asked for, ?q= / query= / ll=, before the map's centre, /@lat,lng,17z), an OpenStreetMap link
 * (mlat and mlon, or #map=zoom/lat/lng), or degrees, minutes and seconds. None if there is no point in it, or it is
 * out of range. A short link (maps.app.goo.gl) has no point in it: see isShortMapLink.
 */
export function pointFromText(raw: string): Point | null {
  const text = unescaped(latin(raw).replace(/[−–]/g, '-')).trim();
  if (!text) return null;
  const whole = pair(WHOLE_PAIR.exec(text)) ?? pair(WHOLE_SPACED.exec(text));
  if (whole) return whole;
  const mlat = MLAT.exec(text);
  const mlon = MLON.exec(text);
  return (
    pair(PLACE.exec(text)) ??
    pair(ASKED.exec(text)) ??
    (mlat && mlon ? pointOf(Number(mlat[1]), Number(mlon[1])) : null) ??
    pair(CENTRE.exec(text)) ??
    pair(OSM_VIEW.exec(text)) ??
    fromDms(DMS.exec(text)) ??
    pair(ANY_PAIR.exec(text))
  );
}

/** A link rather than numbers typed: Latitude takes the point from one as soon as it is in. */
export const isLink = (text: string): boolean => /https?:\/\/|www\.|maps\.|goo\.gl/i.test(text);

/** A short Google Maps link: it only redirects, so the point can't be read from it here. */
export const isShortMapLink = (text: string): boolean => /(?:maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(text);

export const SHORT_LINK_TEXT =
  'A short maps.app.goo.gl link has no point in it: open it, then copy the address from the browser’s address bar, or the point itself, e.g. 30.0457, 31.1923.';

// ---------- fitting the map ----------

/** [[south, west], [north, east]], as Leaflet's fitBounds takes them. */
export type Bounds = [[number, number], [number, number]];

/** The Earth's radius as Leaflet draws a circle (L.CRS.Earth.R), so the fit matches the circle drawn. */
const EARTH_RADIUS_METRES = 6_371_000;

/** The box a location's circle fills: its radius north and south, and as far east and west (wider in degrees away from the equator). */
export function circleBounds(c: Pick<MapCircle, 'latitude' | 'longitude' | 'radiusMetres'>): Bounds {
  const dLat = (c.radiusMetres / EARTH_RADIUS_METRES) * (180 / Math.PI);
  const dLng = dLat / Math.max(Math.cos((c.latitude * Math.PI) / 180), 0.01);
  return [
    [c.latitude - dLat, c.longitude - dLng],
    [c.latitude + dLat, c.longitude + dLng],
  ];
}

/** The box all the circles fill, for the overview to fit them all; none without a circle. */
export function boundsOf(circles: readonly Pick<MapCircle, 'latitude' | 'longitude' | 'radiusMetres'>[]): Bounds | null {
  if (!circles.length) return null;
  const boxes = circles.map(circleBounds);
  return [
    [Math.min(...boxes.map((b) => b[0][0])), Math.min(...boxes.map((b) => b[0][1]))],
    [Math.max(...boxes.map((b) => b[1][0])), Math.max(...boxes.map((b) => b[1][1]))],
  ];
}

export type MapView = { bounds: Bounds } | { centre: Point; zoom: number };

/**
 * Where a location's form map starts: on its point, fitted to its circle (150 m while the radius isn't a number); with
 * no point yet, on the locations there are; with none, on Cairo.
 */
export function startView(point: Point | null, radiusMetres: number | null, around: readonly MapCircle[]): MapView {
  if (point) return { bounds: circleBounds({ ...point, radiusMetres: radiusMetres ?? OFFICE_RADIUS_DEFAULT }) };
  const all = boundsOf(around);
  return all ? { bounds: all } : { centre: CAIRO, zoom: CAIRO_ZOOM };
}

// ---------- the place search (OpenStreetMap's Nominatim) ----------

export const NOMINATIM_SEARCH = 'https://nominatim.openstreetmap.org/search';
/** At most one search a second, as Nominatim's usage policy asks (for everyone on the page together). */
export const SEARCH_GAP_MS = 1000;
/** Fewer letters than this find too much to be of use. */
export const SEARCH_MIN_LENGTH = 3;
export const SEARCH_LIMIT = 5;

/** A search for a place by name or address, in Egypt only, named in English where it has an English name, else Arabic. */
export function nominatimUrl(query: string): string {
  const params = new URLSearchParams({
    q: query.trim().replace(/\s+/g, ' '),
    format: 'jsonv2',
    countrycodes: 'eg',
    'accept-language': 'en,ar',
    limit: String(SEARCH_LIMIT),
  });
  return `${NOMINATIM_SEARCH}?${params}`;
}

/** A place found: its name as Nominatim gives it in full, and its point. */
export interface Place extends Point {
  name: string;
}

/** The places Nominatim answered with (its JSON), each once, the ones without a name or a point left out. */
export function placesFrom(json: unknown): Place[] {
  if (!Array.isArray(json)) return [];
  const places: Place[] = [];
  for (const item of json as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const { display_name: name, lat, lon } = item as Record<string, unknown>;
    const point = typeof name === 'string' && name.trim() ? pointOf(Number(lat), Number(lon)) : null;
    if (!point || places.some((p) => p.name === name && p.latitude === point.latitude && p.longitude === point.longitude)) continue;
    places.push({ name: (name as string).trim(), ...point });
    if (places.length === SEARCH_LIMIT) break;
  }
  return places;
}

/** When the next search may go: now, or a second after the last one (asked or about to go). */
export const nextSearchAt = (last: number | null, now: number, gap = SEARCH_GAP_MS): number => (last === null ? now : Math.max(now, last + gap));
