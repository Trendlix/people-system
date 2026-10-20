'use client';

import dynamic from 'next/dynamic';
import type { ComponentProps, ComponentType } from 'react';
import type { LeafletLocations, LeafletPicker } from './location-map';

// The check-in locations' maps (owner, 20 October 2026: "let me view location on map and add location from map"), as
// the page and its forms use them: Leaflet (location-map.tsx) needs the browser's window, so it is loaded only in the
// browser, after the page, and only on a page with a map (next/dynamic without server rendering). Each map's box is
// drawn at once, at its size, so nothing moves when the map comes in; if Leaflet can't be loaded, the box says so,
// and the fields still do everything the map does.

type LocationsProps = ComponentProps<typeof LeafletLocations>;
type PickerProps = ComponentProps<typeof LeafletPicker>;

const say = 'flex h-full items-center justify-center p-4 text-center text-sm text-muted';
const Waiting = () => <p className={say}>Loading the map…</p>;
const NotLoaded = () => <p className={say}>The map could not be loaded. The fields work without it; reload the page to try again.</p>;

const LazyLocations = dynamic(
  () =>
    import('./location-map').then(
      (m) => m.LeafletLocations,
      (): ComponentType<LocationsProps> => NotLoaded,
    ),
  { ssr: false, loading: Waiting },
);
const LazyPicker = dynamic(
  () =>
    import('./location-map').then(
      (m) => m.LeafletPicker,
      (): ComponentType<PickerProps> => NotLoaded,
    ),
  { ssr: false, loading: Waiting },
);

/** The box a map is drawn in; isolate keeps Leaflet's own layers (z-index 400 to 1000) under the page's menus and dialogs. */
const FRAME = 'isolate w-full overflow-hidden rounded-lg border border-line bg-line-soft';

/** A map of locations, each a pin and its circle, fitted to them all (`height`: its box's height classes). */
export function LocationsMap({ height = 'h-64 sm:h-80', ...props }: LocationsProps & { height?: string }) {
  return (
    <div className={`${FRAME} ${height}`}>
      <LazyLocations {...props} />
    </div>
  );
}

/** A location's form's map: click to put the pin, drag it to move it. */
export function PickPointMap(props: PickerProps) {
  return (
    <div className={`${FRAME} h-72 sm:h-96`}>
      <LazyPicker {...props} />
    </div>
  );
}
