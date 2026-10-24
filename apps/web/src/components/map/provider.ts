'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { mapProviderOf, mapsConfigFrom, OPENSTREETMAP, searchProviderOf, type GoogleMapsConfig, type MapsConfig } from '@/lib/google-maps';

// Which maps a page draws (owner, 24 October 2026: "Google Maps"; told "until a key is set, today's map keeps working"):
// the website's /maps-key is asked once a page, and only by a page that shows a map or a place search, so Google's script
// is loaded only there. Google's with a key; OpenStreetMap's without one, for a developer (never given the key), when the
// key can't be had, or once Google refuses the key on this page (gm_authFailure: every map turns Leaflet's, rather than
// Google's grey "can't load Google Maps correctly"). The place search turns OpenStreetMap's too when Google's fails.

interface State {
  config: MapsConfig | null;
  /** Google refused the key on this page, or its script couldn't be loaded. */
  googleFailed: boolean;
  /** Google's place search refused (Places API (New) not enabled for the key, say) while the maps still work. */
  placesFailed: boolean;
}

let state: State = { config: null, googleFailed: false, placesFailed: false };
let asked: Promise<MapsConfig> | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const snapshot = () => state;
/** On the server, and in the browser before the page has asked: still asking. */
const SERVER: State = { config: null, googleFailed: false, placesFailed: false };

/** GET /maps-key, as it is now (not the page's answer kept): "Check the key" checks the saved key with it. */
export async function freshMapsConfig(): Promise<MapsConfig> {
  try {
    const res = await fetch('/maps-key', { cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' } });
    return res.ok ? mapsConfigFrom(await res.json()) : OPENSTREETMAP;
  } catch {
    return OPENSTREETMAP;
  }
}

/** The page's maps: asked once, then kept while the page is open. */
export function askMapsConfig(): Promise<MapsConfig> {
  asked ??= freshMapsConfig().then((config) => {
    set({ config });
    return config;
  });
  return asked;
}

/** Google refused the key, or its script didn't load: every map on the page turns OpenStreetMap's. */
export const markGoogleFailed = () => {
  if (!state.googleFailed) set({ googleFailed: true });
};

/** Google's place search refused: the page's searches turn OpenStreetMap's. */
export const markPlacesFailed = () => {
  if (!state.placesFailed) set({ placesFailed: true });
};

function useMapsState(): State {
  const s = useSyncExternalStore(subscribe, snapshot, () => SERVER);
  useEffect(() => {
    void askMapsConfig();
  }, []);
  return s;
}

/** The map to draw: Google's (with its key) or Leaflet's; null while the page is still asking. */
export function useMapProvider(): { provider: 'google'; config: GoogleMapsConfig } | { provider: 'leaflet' } | null {
  const s = useMapsState();
  const provider = mapProviderOf(s.config, s.googleFailed);
  if (provider === 'google') return { provider, config: s.config as GoogleMapsConfig };
  return provider ? { provider } : null;
}

/** The place search to use: Google's (with its key) or OpenStreetMap's Nominatim; `ready`: the page has asked. */
export function useSearchProvider(): { provider: 'google'; config: GoogleMapsConfig; ready: true } | { provider: 'nominatim'; ready: boolean } {
  const s = useMapsState();
  const provider = searchProviderOf(s.config, s.googleFailed, s.placesFailed);
  return provider === 'google' ? { provider, config: s.config as GoogleMapsConfig, ready: true } : { provider, ready: s.config !== null };
}
