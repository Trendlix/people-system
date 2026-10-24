import { MAP_ID_PROBLEM, MAPS_KEY_PROBLEM, type MapsSettingsView } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { MAPS_STEPS, mapsIntentOf, mapsSavedText, mapsSettingsBody, mapsStatus, seesMapsSettings } from './maps-setup';

// Check-in Setup → Google Maps (owner, 24 October 2026: "Google Maps"): who sees it, what its form sends, what it says,
// and the steps in Google Cloud. Every key below is made up.

const KEY = 'AIzaSyD-made_up_for_the_tests_only_Ab3x';
const form = (values: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
};
const view = (over: Partial<MapsSettingsView> = {}): MapsSettingsView => ({ keySet: false, keyEnding: null, mapId: null, updatedAt: null, updatedBy: null, ...over });

describe('Check-in Setup → Google Maps', () => {
  it('is a Super Admin’s', () => {
    expect(seesMapsSettings({ roles: ['super_admin'] })).toBe(true);
    expect(seesMapsSettings({ roles: ['admin'] })).toBe(false);
    expect(seesMapsSettings({ roles: ['hr', 'ceo'] })).toBe(false);
  });

  it('sends the key typed, or none to keep the saved one, and the Map ID or none', () => {
    expect(mapsSettingsBody(form({ browserKey: ` ${KEY} `, mapId: '8f348c1e4e8b0e6a' }))).toEqual({ body: { browserKey: KEY, mapId: '8f348c1e4e8b0e6a' }, errors: [] });
    expect(mapsSettingsBody(form({ browserKey: '', mapId: '' }))).toEqual({ body: { mapId: null }, errors: [] });
    expect(mapsSettingsBody(form({ mapId: 'abc123' }))).toEqual({ body: { mapId: 'abc123' }, errors: [] });
    expect(mapsSettingsBody(form({ browserKey: 'not a key', mapId: 'no spaces allowed' })).errors).toEqual([MAPS_KEY_PROBLEM, MAP_ID_PROBLEM]);
  });

  it('tells Save from Remove the key', () => {
    expect(mapsIntentOf(form({ intent: 'remove' }))).toBe('remove');
    expect(mapsIntentOf(form({ intent: 'save' }))).toBe('save');
    expect(mapsIntentOf(form({}))).toBe('save');
  });

  it('says which maps the system draws, the key by its last four characters only', () => {
    expect(mapsStatus(view())).toEqual({ tone: 'neutral', text: expect.stringMatching(/^The maps are OpenStreetMap’s: no Google Maps key is set\./) });
    const on = mapsStatus(view({ keySet: true, keyEnding: 'Ab3x', mapId: 'abc123' }));
    expect(on).toEqual({ tone: 'ok', text: 'Every map is Google Maps (key …Ab3x, Map ID abc123), with Map and Satellite, and Google’s place search.' });
    expect(mapsSavedText(view({ keySet: true, keyEnding: 'Ab3x' }))).toMatch(/^Saved\. Every map is Google’s/);
    expect(mapsSavedText(view())).toBe('Saved. The maps stay on OpenStreetMap until a key is set.');
  });

  it('shows the steps in the company’s Google Cloud project', () => {
    const all = MAPS_STEPS.join('\n');
    expect(MAPS_STEPS).toHaveLength(6);
    for (const words of ['trendlix-people', '“Maps JavaScript API” and “Places API (New)”', 'Create credentials → API key', 'Websites', 'people.trendlix.com/*', 'people.trendlix.com/app', 'Restrict key', 'billing account', 'Check the key']) {
      expect(all).toContain(words);
    }
  });
});
