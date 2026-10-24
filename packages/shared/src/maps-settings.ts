// Google Maps for every map in the system (owner, 24 October 2026, on Organization → Check-in Setup's map, drawn with
// Leaflet on OpenStreetMap's tiles: "is there another map provider?"; offered Google Maps, Mapbox, or OpenStreetMap plus
// satellite, they chose "Google Maps"). What they were told:
// - every map gets a Map/Satellite switch, and the place search is Google's;
// - the key is pasted in the system by a Super Admin (no server or Vercel step), as Email Settings is;
// - until a key is set, today's map (OpenStreetMap) keeps working.
// The key is a browser key: Google restricts it to the website's address and to two APIs, and every page that draws a
// Google map hands it to the browser, so it is public by nature. Even so it is never shown in full once saved ("…Ab3x ·
// Replace"), never written to the audit log (only "changed"), and given at runtime only to signed-in staff whose pages
// show a map; never to a developer, whose maps stay on OpenStreetMap. Pure code: the API checks a save and decides who
// receives the key with it, the web fills the form with it. Tested in apps/api/src/attendance/maps-settings.spec.ts.

import type { Role } from './index.js';

/** A Google API key as Google Cloud makes it: "AIza" and 35 letters, digits, "-" or "_" (39 characters in all). */
const GOOGLE_KEY = /^AIza[0-9A-Za-z_-]{35}$/;
/** A Map ID as Google Maps Platform → Map management shows it: letters, digits, "-" or "_" (usually 16 hex digits). */
const MAP_ID = /^[0-9A-Za-z_-]{4,100}$/;

export const MAPS_LIMITS = { key: 100, mapId: 100 } as const;

/** The Google Cloud project the owner already has (made by Firebase for the phone app's notifications). */
export const MAPS_PROJECT = 'trendlix-people';
/** The two APIs the key is for, by the names Google Cloud's library gives them. */
export const MAPS_APIS = ['Maps JavaScript API', 'Places API (New)'] as const;
/**
 * The website addresses the key is restricted to. The phone app is a Capacitor shell over the website: it opens
 * https://people.trendlix.com/app in its web view (apps/mobile/capacitor.config.ts server.url), so its pages come from
 * the same address and need nothing more.
 */
export const MAPS_KEY_WEBSITES = ['people.trendlix.com/*'] as const;

/** Maps in Egypt, in English: the map's region (borders and names as Egypt's) and the language of its controls. */
export const MAPS_REGION = 'EG';
export const MAPS_LANGUAGE = 'en';

/** The refusals: anyone but a Super Admin, a Super Admin viewing as someone, and someone with no page showing a map. */
export const MAPS_SETTINGS_SUPER_ADMIN_ONLY = 'Only a Super Admin can see or change the Google Maps settings.';
export const MAPS_SETTINGS_OWN_ACCOUNT = 'Switch back to your own account to see or change the Google Maps settings.';
export const MAPS_KEY_NOT_YOURS = 'The maps’ key goes only to the people whose pages show a map.';

/** Said when the key typed isn't a Google API key. */
export const MAPS_KEY_PROBLEM = 'A Google Maps key is 39 characters starting “AIza”: copy it again from Google Cloud → APIs & Services → Credentials.';
export const MAP_ID_PROBLEM = 'A Map ID is letters and digits only, as Google Maps Platform → Map management shows it, e.g. 8f348c1e4e8b0e6a; or leave it empty.';

/** The key as typed, tidied: spaces and quotes around it gone (as a copy from a page may bring them); empty: none. */
export function mapsKeyOf(raw: string | null | undefined): string | null {
  const key = (raw ?? '').trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  return key || null;
}

/** The Map ID as typed, tidied; empty: none. */
export const mapIdOf = (raw: string | null | undefined): string | null => (raw ?? '').trim() || null;

/** Whether a text is a Google API key's shape. */
export const isMapsKey = (key: string): boolean => GOOGLE_KEY.test(key);

/** The last four characters of a key, as the page shows a saved one ("…Ab3x"); none without one. */
export const mapsKeyEnding = (key: string | null | undefined): string | null => (key && key.length > 8 ? key.slice(-4) : null);

/** A saved key as it is shown: "…Ab3x", never in full. */
export const maskedMapsKey = (key: string | null | undefined): string | null => {
  const ending = mapsKeyEnding(key);
  return ending ? `…${ending}` : null;
};

/** What is wrong with a save (none: it can be saved). `key`: the key typed, none to keep the saved one. */
export function mapsSettingsProblems(input: { key: string | null; mapId: string | null }): string[] {
  const problems: string[] = [];
  if (input.key !== null && !isMapsKey(input.key)) problems.push(MAPS_KEY_PROBLEM);
  if (input.mapId !== null && !MAP_ID.test(input.mapId)) problems.push(MAP_ID_PROBLEM);
  return problems;
}

/** The settings as GET /maps-settings answers them (a Super Admin's): the key's last four characters only. */
export interface MapsSettingsView {
  /** Whether a key is saved: the maps are Google's. */
  keySet: boolean;
  /** Its last four characters ("Ab3x"), for "…Ab3x · Replace"; none without one. */
  keyEnding: string | null;
  mapId: string | null;
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
}

/** What PUT /maps-settings takes. An empty or left-out key keeps the saved one; an empty Map ID clears it. */
export interface MapsSettingsInput {
  browserKey?: string | null;
  mapId: string | null;
}

/** GET /maps/key's answer: Google's maps with the key (and the Map ID, if one is set), or OpenStreetMap's. */
export type MapsKeyView = { provider: 'google'; key: string; mapId: string | null } | { provider: 'openstreetmap' };

/**
 * Whose pages show a map, and who receives the key at runtime: anyone with an employee profile (their own home
 * location's request and its map, on the website and in the app), HR (Check-in Setup, the homes to decide), Admin
 * (Check-in Setup; a Super Admin as an Admin) and the CEO (the homes to decide). Never a developer: the key is the
 * company's, and their maps stay on OpenStreetMap.
 */
export const MAPS_KEY_ROLES: readonly Role[] = ['hr', 'admin', 'super_admin', 'ceo'];

export function receivesMapsKey(user: { roles: readonly Role[]; developer?: boolean; employeeId?: string | null }): boolean {
  if (user.developer) return false;
  return Boolean(user.employeeId) || user.roles.some((r) => MAPS_KEY_ROLES.includes(r));
}
