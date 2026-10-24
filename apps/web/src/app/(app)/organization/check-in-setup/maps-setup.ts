import { MAPS_APIS, MAPS_KEY_WEBSITES, MAPS_PROJECT, mapIdOf, mapsKeyOf, mapsSettingsProblems, type MapsSettingsInput, type MapsSettingsView, type Role } from '@trendlix/shared';
import { isSuperAdmin } from '../../../../lib/roles';
import type { FormState } from '../../../../lib/types';
import type { ViewAs } from '../../../../lib/view-as';

// Organization → Check-in Setup → Google Maps (owner, 24 October 2026, on this page's map: "is there another map
// provider?"; offered Google Maps, Mapbox, or OpenStreetMap plus satellite: "Google Maps"; told the key "is pasted in the
// system by a Super Admin (no server or Vercel step), as Email Settings does" and "until a key is set, today's map keeps
// working"). A Super Admin's only: the browser key, never shown again once saved ("…Ab3x · Replace"), an optional Map ID,
// "Check the key" with its result in plain words, and the steps in the company's Google Cloud project. Pure code, tested
// (maps-setup.test.ts); the API checks every request again (packages/shared maps-settings.ts). Relative imports: the
// tests run without the "@/" alias.

/** The section, for links into it (the Audit Log's "Open the Google Maps settings"). */
export const MAPS_ID = 'google-maps';

type Viewer = { roles: readonly Role[]; developer?: boolean; viewAs?: ViewAs | null };

/**
 * Who sees the section: a Super Admin (a developer, answered with a Super Admin's sight, is told it isn't theirs; one
 * viewing as someone is asked to switch back, as the API refuses them).
 */
export const seesMapsSettings = (user: Viewer): boolean => isSuperAdmin(user);

/** The form's buttons: Save, and Remove the key. ("Check the key" runs in the browser, without the form.) */
export type MapsIntent = 'save' | 'remove';
export const mapsIntentOf = (fd: FormData): MapsIntent => (fd.get('intent') === 'remove' ? 'remove' : 'save');

const text = (fd: FormData, key: string): string => {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
};

/** PUT /maps-settings's body from the form (an empty key box keeps the saved key), with what is wrong with it. */
export function mapsSettingsBody(fd: FormData): { body: MapsSettingsInput; errors: string[] } {
  const key = mapsKeyOf(text(fd, 'browserKey'));
  const mapId = mapIdOf(text(fd, 'mapId'));
  return { body: { ...(key && { browserKey: key }), mapId }, errors: mapsSettingsProblems({ key, mapId }) };
}

/** What the form's action answers: a save's message, or a refusal's reasons. */
export interface MapsFormState extends FormState {
  /** Bumped by each save that went through, so the form closes the key box it had open. */
  saved?: number;
}

/** What a save that went through says. */
export const mapsSavedText = (view: MapsSettingsView): string =>
  view.keySet
    ? 'Saved. Every map is Google’s from the next page opened (reload this page to see it here).'
    : 'Saved. The maps stay on OpenStreetMap until a key is set.';

export const MAPS_REMOVED_TEXT = 'The key was removed: every map is OpenStreetMap’s from the next page opened.';
export const MAPS_REMOVE_CONFIRM = 'Remove the Google Maps key? Every map goes back to OpenStreetMap, without the satellite view or Google’s place search.';

/** The section's status: which maps the system draws now. */
export function mapsStatus(view: MapsSettingsView): { tone: 'ok' | 'neutral'; text: string } {
  if (view.keySet) {
    const ending = view.keyEnding ? ` (key …${view.keyEnding}${view.mapId ? `, Map ID ${view.mapId}` : ''})` : '';
    return { tone: 'ok', text: `Every map is Google Maps${ending}, with Map and Satellite, and Google’s place search.` };
  }
  return { tone: 'neutral', text: 'The maps are OpenStreetMap’s: no Google Maps key is set. Set one for Google’s maps, the satellite view and Google’s place search.' };
}

/** Said to a developer, and to a Super Admin viewing as someone. */
export const MAPS_NOT_FOR_DEVELOPERS = 'The Google Maps key isn’t open to developers: the maps you see are OpenStreetMap’s.';

const quoted = (list: readonly string[]) => list.map((s) => `“${s}”`).join(' and ');

/**
 * The steps in Google Cloud, as the page shows them: the project the owner already has (trendlix-people, from Firebase),
 * the two APIs, a key of its own restricted to the website (the phone app opens the same address) and to the two APIs,
 * and billing on. Then the key pasted here and checked.
 */
export const MAPS_STEPS: readonly string[] = [
  `In Google Cloud (console.cloud.google.com), choose the project ${MAPS_PROJECT}. Under APIs & Services → Library, enable ${quoted(MAPS_APIS)}.`,
  'Under APIs & Services → Credentials, choose Create credentials → API key. Make a new key for the maps; leave Firebase’s own keys as they are.',
  `Open the new key. Under Application restrictions choose Websites, and add ${MAPS_KEY_WEBSITES.join(' and ')}. The phone app opens the same address (people.trendlix.com/app), so it needs nothing more.`,
  `Under API restrictions choose Restrict key, tick only ${quoted(MAPS_APIS)}, and save.`,
  'Under Billing, make sure the project has a billing account linked. Google’s free monthly usage covers this system’s maps and searches.',
  'Paste the key here, save, then press Check the key.',
];

/** What the Map ID box says under it. */
export const MAP_ID_HINT =
  'Optional. Google’s newer pins (Advanced Markers) need one: Google Maps Platform → Map management → Create Map ID, of type JavaScript. Without one the classic pins are used, which look the same.';
