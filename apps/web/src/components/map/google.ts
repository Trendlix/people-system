'use client';

import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import { googleLoaderOptions, type GoogleMapsConfig } from '@/lib/google-maps';
import { markGoogleFailed } from './provider';

// Google's Maps JavaScript API, through its official loader (@googlemaps/js-api-loader; owner, 24 October 2026: "Google
// Maps"): loaded once a page, only when a map or a Google place search is shown, with the key the page was given (Egypt,
// English; lib/google-maps.ts googleLoaderOptions). Google calls gm_authFailure when it refuses the key: the page's maps
// then turn OpenStreetMap's (provider.ts).

declare global {
  interface Window {
    gm_authFailure?: () => void;
  }
}

export interface GoogleLibs {
  core: google.maps.CoreLibrary;
  maps: google.maps.MapsLibrary;
  marker: google.maps.MarkerLibrary;
}

let loaded: Promise<GoogleLibs> | null = null;
let places: Promise<google.maps.PlacesLibrary> | null = null;

/** The libraries a map draws with, the script loaded on the first call. A failure turns the page's maps OpenStreetMap's. */
export function googleLibs(config: GoogleMapsConfig): Promise<GoogleLibs> {
  if (!loaded) {
    window.gm_authFailure = markGoogleFailed;
    setOptions(googleLoaderOptions(config));
    loaded = Promise.all([importLibrary('core'), importLibrary('maps'), importLibrary('marker')]).then(([core, maps, marker]) => ({ core, maps, marker }));
    loaded.catch(markGoogleFailed);
  }
  return loaded;
}

/** The place search's library (Places API (New)), loaded on the first search. */
export function placesLibrary(config: GoogleMapsConfig): Promise<google.maps.PlacesLibrary> {
  places ??= googleLibs(config).then(() => importLibrary('places'));
  return places;
}
