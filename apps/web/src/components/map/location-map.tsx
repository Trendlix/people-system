'use client';

import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useEffectEvent, useRef } from 'react';
import { OFFICE_RADIUS_DEFAULT } from '@trendlix/shared';
import { boundsOf, CAIRO, CAIRO_ZOOM, circleBounds, roundCoordinate, startView, type MapCircle, type MapView, type Point } from '@/lib/map-point';

// The check-in locations on a map (owner, 20 October 2026: "let me view location on map and add location from map"),
// drawn with Leaflet on OpenStreetMap's tiles (no key; their attribution stays on the map). Loaded only in the browser,
// through maps.tsx, as Leaflet needs the window. Two maps: one of locations, each a pin and its radius's circle (on a
// location's card, and the overview of them all, named in tooltips), fitted to them; and a location's form's map, where
// a click puts the pin and the pin can be dragged, the form's fields following (and the pin following the fields). On
// a page of maps, scrolling past one doesn't zoom it: the mouse wheel zooms a map only once it is clicked, until the
// pointer leaves it; on a phone one finger scrolls the page until the map is tapped. The keyboard pans (arrows) and
// zooms (+ and -) a map once it has the focus. Shared since 20 October 2026 with the home locations' maps (owner: "allow
// other users to request to add their home locations when working from home").

/** OpenStreetMap's own tiles, on the address its tile policy names (one host, no a/b/c subdomains). */
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILES_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** The theme's accent and muted colours (globals.css: --color-accent, --color-muted). */
const ACCENT = '#2b59f0';
const MUTED = '#5b6472';
const CIRCLE: L.CircleMarkerOptions = { color: ACCENT, weight: 2, fillColor: ACCENT, fillOpacity: 0.15 };
const OTHER_CIRCLE: L.CircleMarkerOptions = { color: MUTED, weight: 1, dashArray: '4 4', fillColor: MUTED, fillOpacity: 0.08 };
/** A circle fitted with some room around it (more above, where a pin by the top edge stands), and no closer than OpenStreetMap's tiles go sharp. */
const FIT: L.FitBoundsOptions = { paddingTopLeft: [24, 48], paddingBottomRight: [24, 24], maxZoom: 18 };

/** A pin drawn in the page (Leaflet's own marker pictures go missing once bundled): the accent's drop, its point at the bottom. */
const PIN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 42" width="30" height="42" aria-hidden="true" focusable="false" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))">' +
  `<path d="M15 1C7.8 1 2 6.8 2 14c0 9.6 13 27 13 27s13-17.4 13-27C28 6.8 22.2 1 15 1z" fill="${ACCENT}" stroke="#fff" stroke-width="2"/>` +
  '<circle cx="15" cy="14" r="5" fill="#fff"/></svg>';

const pinIcon = () => L.divIcon({ className: 'location-pin', html: PIN_SVG, iconSize: [30, 42], iconAnchor: [15, 41], tooltipAnchor: [0, -34] });

/** A name as a tooltip's text: as text, never as HTML (Leaflet sets a string as HTML, and names are typed by people). */
function textOf(name: string): HTMLElement {
  const span = document.createElement('span');
  span.textContent = name;
  return span;
}

function show(map: L.Map, view: MapView) {
  if ('bounds' in view) map.fitBounds(view.bounds, FIT);
  else map.setView([view.centre.latitude, view.centre.longitude], view.zoom);
}

/** A map in `el` with OpenStreetMap's tiles, starting on `view`; the wheel (and on a phone, one finger) moves it only once it is clicked or tapped. */
function createMap(el: HTMLElement, view: MapView): L.Map {
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const map = L.map(el, { scrollWheelZoom: false, dragging: !coarse, keyboard: true });
  L.tileLayer(TILES, { maxZoom: 19, attribution: TILES_ATTRIBUTION }).addTo(map);
  show(map, view);
  const wake = () => {
    map.scrollWheelZoom.enable();
    map.dragging.enable();
  };
  map.on('click focus', wake);
  map.on('mouseout', () => map.scrollWheelZoom.disable());
  map.on('blur', () => {
    map.scrollWheelZoom.disable();
    if (coarse) map.dragging.disable();
  });
  // the map's box can change size without the window doing so (a form opening beside it)
  if (typeof ResizeObserver === 'function') {
    const watch = new ResizeObserver(() => map.invalidateSize());
    watch.observe(el);
    map.on('unload', () => watch.disconnect());
  }
  return map;
}

/**
 * A map of locations, each a pin and its radius's circle, fitted to them all; a location with a name has it in a
 * tooltip over its pin and circle. With none, Cairo.
 */
export function LeafletLocations({ circles, label }: { circles: readonly MapCircle[]; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const drawn = JSON.stringify(circles);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const list = JSON.parse(drawn) as MapCircle[];
    const all = boundsOf(list);
    const map = createMap(el, all ? { bounds: all } : { centre: CAIRO, zoom: CAIRO_ZOOM });
    for (const c of list) {
      const at: L.LatLngTuple = [c.latitude, c.longitude];
      const named = Boolean(c.name);
      const circle = L.circle(at, { radius: c.radiusMetres, ...CIRCLE, interactive: named }).addTo(map);
      const pin = L.marker(at, { icon: pinIcon(), keyboard: false, interactive: named }).addTo(map);
      if (c.name) {
        pin.bindTooltip(textOf(c.name), { direction: 'top' });
        circle.bindTooltip(textOf(c.name), { sticky: true });
      }
    }
    return () => {
      map.remove();
    };
  }, [drawn]);
  return <div ref={box} role="region" aria-label={label} className="h-full w-full" />;
}

/**
 * A location's form's map: `point` pinned with its `radiusMetres` circle; a click puts the pin there, and the pin can
 * be dragged (`onPick`, each coordinate to 6 decimals). A point from the fields moves the pin, the map following it
 * if it is out of view; each new `recentre` (a place found, the current location, a link pasted) fits the map to it.
 * The `around` locations are drawn faintly. It starts on the point, else on the locations, else on Cairo.
 */
export function LeafletPicker({
  point,
  radiusMetres,
  around,
  recentre,
  onPick,
  label,
}: {
  point: Point | null;
  radiusMetres: number | null;
  around: readonly MapCircle[];
  recentre: number;
  onPick: (p: Point) => void;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const pinRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);

  const pick = useEffectEvent((at: L.LatLng) => {
    const w = at.wrap();
    onPick({ latitude: roundCoordinate(w.lat), longitude: roundCoordinate(w.lng) });
  });
  const firstView = useEffectEvent(() => startView(point, radiusMetres, around));
  const fitPoint = useEffectEvent(() => {
    if (point) mapRef.current?.fitBounds(circleBounds({ ...point, radiusMetres: radiusMetres ?? OFFICE_RADIUS_DEFAULT }), FIT);
  });

  // the map, once
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const map = createMap(el, firstView());
    map.on('click', (e: L.LeafletMouseEvent) => pick(e.latlng));
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = pinRef.current = circleRef.current = null;
    };
  }, []);

  // the other locations, faintly (a click on one still puts the pin there)
  const aroundKey = JSON.stringify(around);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const circles = (JSON.parse(aroundKey) as MapCircle[]).map((c) => {
      const circle = L.circle([c.latitude, c.longitude], { radius: c.radiusMetres, ...OTHER_CIRCLE, interactive: Boolean(c.name) });
      if (c.name) circle.bindTooltip(textOf(c.name), { sticky: true });
      return circle;
    });
    const group = L.layerGroup(circles).addTo(map);
    return () => {
      group.remove();
    };
  }, [aroundKey]);

  // the pin and its circle, following the fields
  const lat = point?.latitude;
  const lng = point?.longitude;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (lat === undefined || lng === undefined) {
      pinRef.current?.remove();
      circleRef.current?.remove();
      pinRef.current = circleRef.current = null;
      return;
    }
    const at = L.latLng(lat, lng);
    if (pinRef.current) {
      pinRef.current.setLatLng(at);
    } else {
      const pin = L.marker(at, { icon: pinIcon(), draggable: true, autoPan: true, keyboard: false, title: 'Drag the pin to move the point' }).addTo(map);
      pin.on('drag', () => circleRef.current?.setLatLng(pin.getLatLng()));
      pin.on('dragend', () => pick(pin.getLatLng()));
      pinRef.current = pin;
    }
    if (radiusMetres !== null && radiusMetres > 0) {
      if (circleRef.current) circleRef.current.setLatLng(at).setRadius(radiusMetres);
      else circleRef.current = L.circle(at, { radius: radiusMetres, ...CIRCLE, interactive: false }).addTo(map);
    } else {
      circleRef.current?.remove();
      circleRef.current = null;
    }
    if (!map.getBounds().contains(at)) map.panTo(at);
  }, [lat, lng, radiusMetres]);

  // a place found, the current location or a link pasted: the map fitted to the point
  useEffect(() => {
    if (recentre > 0) fitPoint();
  }, [recentre]);

  return <div ref={box} role="region" aria-label={label} className="h-full w-full" />;
}
