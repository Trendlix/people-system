'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { OFFICE_RADIUS_DEFAULT } from '@trendlix/shared';
import {
  CIRCLE_STYLE,
  FAINT_CIRCLE_STYLE,
  FAINT_PIN_SVG,
  FIT_MAX_ZOOM,
  FIT_PADDING,
  googleBounds,
  googleMapOptions,
  PIN_SVG,
  svgDataUrl,
  wrapLongitude,
  type GoogleMapsConfig,
} from '@/lib/google-maps';
import { boundsOf, CAIRO, CAIRO_ZOOM, circleBounds, fittedCircles, roundCoordinate, startView, type MapCircle, type MapView, type Point } from '@/lib/map-point';
import { googleLibs, type GoogleLibs } from './google';

// The maps on Google Maps (owner, 24 October 2026, on Check-in Setup's map: "is there another map provider?", then "Google
// Maps"), drawn when a key is set: the same two maps as location-map.tsx draws with Leaflet, with the same props and
// behaviour. One of locations, each a pin and its radius's circle, named on hover, fitted to them (the main office's with
// its sub-locations drawn faintly round it); and a location's form's map, where a click puts the pin, the pin can be
// dragged, the form's fields follow it and it follows them. Google's own: the Map/Satellite switch (Satellite with its
// Labels box), full screen, Egypt's map in English (lib/google-maps.ts). Scrolling the page past a map doesn't zoom it:
// with a mouse, Ctrl and the wheel zoom it, or the wheel alone once the map is clicked, until the pointer leaves it; on a
// phone one finger scrolls the page and two move the map. With a Map ID the pins are Google's newer ones (Advanced
// Markers), without one its classic markers; the same pictures either way.

type LatLng = google.maps.LatLngLiteral;

const latLngOf = (p: Point): LatLng => ({ lat: p.latitude, lng: p.longitude });

/** A position as Google gives it back (a LatLng, or a literal from an Advanced Marker), as a literal. */
function literalOf(p: google.maps.LatLng | google.maps.LatLngLiteral | google.maps.LatLngAltitudeLiteral | null | undefined): LatLng | null {
  if (!p) return null;
  if (typeof (p as google.maps.LatLng).lat === 'function') return (p as google.maps.LatLng).toJSON();
  const l = p as LatLng;
  return { lat: l.lat, lng: l.lng };
}

/** The map fitted to a view: a circle's box with room round it (no closer than zoom 18), or a centre and zoom. */
function show(libs: GoogleLibs, map: google.maps.Map, view: MapView) {
  if ('bounds' in view) {
    map.fitBounds(googleBounds(view.bounds), FIT_PADDING);
    libs.core.event.addListenerOnce(map, 'idle', () => {
      const zoom = map.getZoom();
      if (zoom !== undefined && zoom > FIT_MAX_ZOOM) map.setZoom(FIT_MAX_ZOOM);
    });
  } else {
    map.setCenter(latLngOf(view.centre));
    map.setZoom(view.zoom);
  }
}

/** A map in a box of its own inside `el`, starting on `view`; `dispose` takes it away. */
function createMap(libs: GoogleLibs, el: HTMLElement, view: MapView, config: GoogleMapsConfig) {
  const inner = document.createElement('div');
  inner.style.cssText = 'width:100%;height:100%';
  el.appendChild(inner);
  const map = new libs.maps.Map(inner, { ...googleMapOptions(config.mapId), center: latLngOf(CAIRO), zoom: CAIRO_ZOOM });
  show(libs, map, view);
  // with a mouse, a click lets the wheel zoom the map until the pointer leaves it; on a phone, Google's two fingers
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const leave = () => map.setOptions({ gestureHandling: 'cooperative' });
  if (!coarse) {
    map.addListener('click', () => map.setOptions({ gestureHandling: 'greedy' }));
    inner.addEventListener('mouseleave', leave);
  }
  return {
    map,
    dispose: () => {
      inner.removeEventListener('mouseleave', leave);
      libs.core.event.clearInstanceListeners(map);
      inner.remove();
    },
  };
}

/** A pin on a map, whichever kind of marker draws it. */
interface Pin {
  move(at: LatLng): void;
  at(): LatLng | null;
  on(event: 'drag' | 'dragend', f: () => void): void;
  remove(): void;
}

/** A pin: Google's newer marker with a Map ID, its classic one without; the accent's drop, or a smaller grey one (`faint`). */
function makePin(libs: GoogleLibs, map: google.maps.Map, at: LatLng, opts: { advanced: boolean; faint?: boolean; draggable?: boolean; title?: string }): Pin {
  const svg = opts.faint ? FAINT_PIN_SVG : PIN_SVG;
  if (opts.advanced) {
    const content = document.createElement('div');
    content.innerHTML = svg;
    const m = new libs.marker.AdvancedMarkerElement({ map, position: at, content, title: opts.title ?? '', gmpDraggable: Boolean(opts.draggable) });
    return {
      move: (p) => {
        m.position = p;
      },
      at: () => literalOf(m.position),
      on: (event, f) => {
        m.addListener(event, f);
      },
      remove: () => {
        libs.core.event.clearInstanceListeners(m);
        m.map = null;
      },
    };
  }
  const [w, h] = opts.faint ? [20, 28] : [30, 42];
  const m = new libs.marker.Marker({
    map,
    position: at,
    title: opts.title,
    draggable: Boolean(opts.draggable),
    clickable: Boolean(opts.draggable || opts.title),
    icon: { url: svgDataUrl(svg), scaledSize: new libs.core.Size(w, h), anchor: new libs.core.Point(w / 2, h - 1) },
  });
  return {
    move: (p) => m.setPosition(p),
    at: () => literalOf(m.getPosition()),
    on: (event, f) => {
      m.addListener(event, f);
    },
    remove: () => {
      libs.core.event.clearInstanceListeners(m);
      m.setMap(null);
    },
  };
}

/** A circle's name on hover, as the map's tooltip (a name is set as text, never as HTML). */
function nameOnHover(circle: google.maps.Circle, name: string | undefined, el: HTMLElement) {
  if (!name) return;
  circle.addListener('mouseover', () => {
    el.title = name;
  });
  circle.addListener('mouseout', () => {
    el.title = '';
  });
}

/** None drawn faintly. */
const NONE: readonly MapCircle[] = [];

/**
 * A map of locations, each a pin and its radius's circle, fitted to them all; a location with a name has it on its pin
 * and circle. With none, Cairo. `around`: places drawn faintly for context, fitted too when near the first location.
 */
export function GoogleLocations({ config, circles, around = NONE, label }: { config: GoogleMapsConfig; circles: readonly MapCircle[]; around?: readonly MapCircle[]; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const drawn = JSON.stringify({ circles, around });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let gone = false;
    let dispose = () => {};
    const { circles: list, around: faint } = JSON.parse(drawn) as { circles: MapCircle[]; around: MapCircle[] };
    googleLibs(config).then(
      (libs) => {
        if (gone) return;
        const all = boundsOf(fittedCircles(list, faint));
        const made = createMap(libs, el, all ? { bounds: all } : { centre: CAIRO, zoom: CAIRO_ZOOM }, config);
        const drawnOn: { remove(): void }[] = [];
        const circle = (c: MapCircle, style: google.maps.CircleOptions, named: boolean) => {
          const shape = new libs.maps.Circle({ map: made.map, center: latLngOf(c), radius: c.radiusMetres, ...style, clickable: named && Boolean(c.name) });
          if (named) nameOnHover(shape, c.name, el);
          drawnOn.push({ remove: () => shape.setMap(null) });
        };
        // context only: named on its pin's hover, never a stop for the keyboard
        for (const c of faint) {
          circle(c, FAINT_CIRCLE_STYLE, false);
          drawnOn.push(makePin(libs, made.map, latLngOf(c), { advanced: Boolean(config.mapId), faint: true, title: c.name }));
        }
        for (const c of list) {
          circle(c, CIRCLE_STYLE, true);
          drawnOn.push(makePin(libs, made.map, latLngOf(c), { advanced: Boolean(config.mapId), title: c.name }));
        }
        dispose = () => {
          for (const d of drawnOn) d.remove();
          made.dispose();
        };
      },
      // Google's script didn't load: provider.ts turns the page's maps OpenStreetMap's
      () => {},
    );
    return () => {
      gone = true;
      dispose();
    };
  }, [drawn, config]);
  return <div ref={box} role="region" aria-label={label} className="h-full w-full" />;
}

/**
 * A location's form's map: `point` pinned with its `radiusMetres` circle; a click puts the pin there, and the pin can
 * be dragged (`onPick`, each coordinate to 6 decimals). A point from the fields moves the pin, the map following it
 * if it is out of view; each new `recentre` (a place found, the current location, a link pasted) fits the map to it.
 * The `around` locations are drawn faintly. It starts on the point, else on the locations, else on Cairo.
 */
export function GooglePicker({
  config,
  point,
  radiusMetres,
  around,
  recentre,
  onPick,
  label,
}: {
  config: GoogleMapsConfig;
  point: Point | null;
  radiusMetres: number | null;
  around: readonly MapCircle[];
  recentre: number;
  onPick: (p: Point) => void;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState<{ libs: GoogleLibs; map: google.maps.Map } | null>(null);
  const pinRef = useRef<Pin | null>(null);
  const circleRef = useRef<google.maps.Circle | null>(null);

  const pick = useEffectEvent((at: LatLng) => {
    onPick({ latitude: roundCoordinate(at.lat), longitude: roundCoordinate(wrapLongitude(at.lng)) });
  });
  const firstView = useEffectEvent(() => startView(point, radiusMetres, around));
  const fitPoint = useEffectEvent(() => {
    if (point && ready) show(ready.libs, ready.map, { bounds: circleBounds({ ...point, radiusMetres: radiusMetres ?? OFFICE_RADIUS_DEFAULT }) });
  });

  // the map, once
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let gone = false;
    let dispose = () => {};
    googleLibs(config).then(
      (libs) => {
        if (gone) return;
        const made = createMap(libs, el, firstView(), config);
        made.map.addListener('click', (e: google.maps.MapMouseEvent) => {
          const at = e.latLng?.toJSON();
          if (at) pick(at);
        });
        dispose = () => {
          pinRef.current?.remove();
          circleRef.current?.setMap(null);
          pinRef.current = circleRef.current = null;
          made.dispose();
        };
        setReady({ libs, map: made.map });
      },
      () => {},
    );
    return () => {
      gone = true;
      dispose();
    };
  }, [config]);

  // the other locations, faintly (a click on one still puts the pin there)
  const aroundKey = JSON.stringify(around);
  useEffect(() => {
    const el = box.current;
    if (!ready || !el) return;
    const { libs, map } = ready;
    const circles = (JSON.parse(aroundKey) as MapCircle[]).map((c) => {
      const circle = new libs.maps.Circle({ map, center: latLngOf(c), radius: c.radiusMetres, ...FAINT_CIRCLE_STYLE, clickable: Boolean(c.name) });
      nameOnHover(circle, c.name, el);
      circle.addListener('click', (e: google.maps.MapMouseEvent) => {
        const at = e.latLng?.toJSON();
        if (at) pick(at);
      });
      return circle;
    });
    return () => {
      for (const c of circles) {
        libs.core.event.clearInstanceListeners(c);
        c.setMap(null);
      }
    };
  }, [ready, aroundKey]);

  // the pin and its circle, following the fields
  const lat = point?.latitude;
  const lng = point?.longitude;
  useEffect(() => {
    if (!ready) return;
    const { libs, map } = ready;
    if (lat === undefined || lng === undefined) {
      pinRef.current?.remove();
      circleRef.current?.setMap(null);
      pinRef.current = circleRef.current = null;
      return;
    }
    const at: LatLng = { lat, lng };
    if (pinRef.current) {
      pinRef.current.move(at);
    } else {
      const pin = makePin(libs, map, at, { advanced: Boolean(config.mapId), draggable: true, title: 'Drag the pin to move the point' });
      pin.on('drag', () => {
        const p = pin.at();
        if (p) circleRef.current?.setCenter(p);
      });
      pin.on('dragend', () => {
        const p = pin.at();
        if (p) pick(p);
      });
      pinRef.current = pin;
    }
    if (radiusMetres !== null && radiusMetres > 0) {
      if (circleRef.current) {
        circleRef.current.setCenter(at);
        circleRef.current.setRadius(radiusMetres);
      } else {
        circleRef.current = new libs.maps.Circle({ map, center: at, radius: radiusMetres, ...CIRCLE_STYLE, clickable: false });
      }
    } else {
      circleRef.current?.setMap(null);
      circleRef.current = null;
    }
    if (!map.getBounds()?.contains(at)) map.panTo(at);
  }, [ready, lat, lng, radiusMetres, config.mapId]);

  // a place found, the current location or a link pasted: the map fitted to the point
  useEffect(() => {
    if (recentre > 0) fitPoint();
  }, [recentre]);

  return <div ref={box} role="region" aria-label={label} className="h-full w-full" />;
}
