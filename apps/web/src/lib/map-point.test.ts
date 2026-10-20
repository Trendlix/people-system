import { describe, expect, it } from 'vitest';
import {
  boundsOf,
  CAIRO,
  CAIRO_ZOOM,
  circleBounds,
  isLink,
  isShortMapLink,
  mapHref,
  nextSearchAt,
  nominatimUrl,
  placesFrom,
  pointFromText,
  pointOf,
  startView,
} from './map-point';

// The check-in locations on a map (owner, 20 October 2026: "let me view location on map and add location from map"):
// a point from what is pasted, the circle's fit, where a form's map starts, and the place search on Nominatim.

const at = (latitude: number, longitude: number) => ({ latitude, longitude });

describe('a point from what is pasted', () => {
  it('reads "lat, lng" as Google Maps copies it, and with an Arabic comma, Arabic digits or a space between decimals', () => {
    expect(pointFromText('30.045770, 31.192300')).toEqual(at(30.04577, 31.1923));
    expect(pointFromText(' 30.0457 ، 31.1923 ')).toEqual(at(30.0457, 31.1923));
    expect(pointFromText('٣٠٫٠٤٥٧, ٣١٫١٩٢٣')).toEqual(at(30.0457, 31.1923));
    expect(pointFromText('30.0457 31.1923')).toEqual(at(30.0457, 31.1923));
    expect(pointFromText('-33.8688197, 151.2092955')).toEqual(at(-33.86882, 151.209296));
    expect(pointFromText('30.05,31.19')).toEqual(at(30.05, 31.19));
  });

  it('reads the common Google Maps links', () => {
    // the map's centre
    expect(pointFromText('https://www.google.com/maps/@30.0457297,31.1897251,17z?entry=ttu')).toEqual(at(30.04573, 31.189725));
    // a point asked for: q=, q=loc:, query= (Maps URLs), ll=
    expect(pointFromText('https://maps.google.com/?q=30.05,31.19')).toEqual(at(30.05, 31.19));
    expect(pointFromText('https://maps.google.com/maps?q=30.05%2C31.19&z=17')).toEqual(at(30.05, 31.19));
    expect(pointFromText('https://www.google.com/maps?q=loc:30.0457,+31.1923')).toEqual(at(30.0457, 31.1923));
    expect(pointFromText('https://www.google.com/maps/search/?api=1&query=30.0457%2C31.1923')).toEqual(at(30.0457, 31.1923));
    expect(pointFromText('https://maps.google.com/maps?ll=30.0457,31.1923&z=16&t=m')).toEqual(at(30.0457, 31.1923));
    // the place's own point (!3d…!4d…) before the map's centre (@…) in the same link
    const place =
      'https://www.google.com/maps/place/Trendlix/@30.0457297,31.1897251,17z/data=!3m1!4b1!4m6!3m5!1s0x14584126e3c1b0a5:0x2f5d0c6a2e1b4f3d!8m2!3d30.0457251!4d31.1923!16s%2Fg%2F11c0abcd';
    expect(pointFromText(place)).toEqual(at(30.045725, 31.1923));
    // a dropped pin's link: its degrees in the path, its point in the data
    expect(pointFromText("https://www.google.com/maps/place/30%C2%B002'44.8%22N+31%C2%B011'32.3%22E/@30.0457,31.1898,17z/data=!4m4!3m3!8m2!3d30.04577!4d31.1923")).toEqual(
      at(30.04577, 31.1923),
    );
    // a search for a point, in the path
    expect(pointFromText('https://www.google.com/maps/search/30.0457,+31.1923?entry=tts')).toEqual(at(30.0457, 31.1923));
    // a place name in q=, the point in ll=
    expect(pointFromText('https://maps.apple.com/?q=Trendlix&ll=30.0457,31.1923')).toEqual(at(30.0457, 31.1923));
  });

  it('reads OpenStreetMap links, the one "See it on a map" opens among them', () => {
    expect(pointFromText(mapHref(at(30.04577, 31.1923)))).toEqual(at(30.04577, 31.1923));
    expect(pointFromText('https://www.openstreetmap.org/#map=18/30.04577/31.19230')).toEqual(at(30.04577, 31.1923));
  });

  it('reads degrees, minutes and seconds, as Google Maps names a dropped pin', () => {
    expect(pointFromText('30°02\'44.8"N 31°11\'32.3"E')).toEqual(at(30.045778, 31.192306));
    expect(pointFromText('33°52\'07.8"S, 151°12\'33.5"W')).toEqual(at(-33.868833, -151.209306));
    expect(pointFromText('30°75\'00.0"N 31°11\'32.3"E')).toBeNull();
  });

  it('finds no point in a name, one number, a short link or what is out of range', () => {
    for (const text of ['', '  ', 'Trendlix Al Mahrouki', '15 Al Doctor Al Mahrouki Street', '10 6', '30.0457', 'https://maps.app.goo.gl/AbCdEf123', '95, 31.19', '30.05, 181']) {
      expect(pointFromText(text)).toBeNull();
    }
    expect(pointFromText('https://www.google.com/maps/place/Cairo+Tower')).toBeNull();
  });

  it('tells a link from numbers typed, and a short link from a full one', () => {
    expect([isLink('https://maps.google.com/?q=30,31'), isLink('www.google.com/maps/@30,31,17z'), isLink('30.05, 31.19'), isLink('30.0457')]).toEqual([true, true, false, false]);
    expect([isShortMapLink('https://maps.app.goo.gl/AbCdEf123'), isShortMapLink('https://goo.gl/maps/xyz'), isShortMapLink('https://www.google.com/maps/@30,31,17z')]).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('keeps a point within range, to 6 decimals', () => {
    expect(pointOf(30.123456789, 31.987654321)).toEqual(at(30.123457, 31.987654));
    expect([pointOf(null, 31), pointOf(30, undefined), pointOf(NaN, 31), pointOf(-91, 31), pointOf(30, 180.5)]).toEqual([null, null, null, null, null]);
    expect(pointOf(-90, -180)).toEqual(at(-90, -180));
  });
});

describe('fitting the map to a location', () => {
  /** Metres between two latitudes, or along a parallel, as Leaflet measures them (a sphere of 6,371 km). */
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;

  it("covers the circle's radius north and south, and as far east and west", () => {
    const [[south, west], [north, east]] = circleBounds({ latitude: 30.04577, longitude: 31.1923, radiusMetres: 150 });
    expect(rad(north - 30.04577) * R).toBeCloseTo(150, 6);
    expect(rad(30.04577 - south) * R).toBeCloseTo(150, 6);
    expect(rad(east - 31.1923) * R * Math.cos(rad(30.04577))).toBeCloseTo(150, 6);
    expect(east - 31.1923).toBeCloseTo(31.1923 - west, 9);
    // wider in degrees east and west than north and south, away from the equator
    expect(east - west).toBeGreaterThan(north - south);
    // a bigger radius, a bigger box
    const [[s2], [n2]] = circleBounds({ latitude: 30.04577, longitude: 31.1923, radiusMetres: 1500 });
    expect((n2 - s2) / (north - south)).toBeCloseTo(10, 6);
  });

  it('fits all the locations for the overview, and none without one', () => {
    const a = { latitude: 30.04577, longitude: 31.1923, radiusMetres: 150 };
    const b = { latitude: 30.0596, longitude: 31.3462, radiusMetres: 1000 };
    const [[south, west], [north, east]] = boundsOf([a, b])!;
    expect(south).toBe(circleBounds(a)[0][0]);
    expect(west).toBe(circleBounds(a)[0][1]);
    expect(north).toBe(circleBounds(b)[1][0]);
    expect(east).toBe(circleBounds(b)[1][1]);
    expect(boundsOf([a])).toEqual(circleBounds(a));
    expect(boundsOf([])).toBeNull();
  });

  it("starts a form's map on its point, else on the locations there are, else on Cairo", () => {
    const point = at(30.04577, 31.1923);
    const office = { ...point, radiusMetres: 200, name: 'Trendlix Al Mahrouki' };
    expect(startView(point, 300, [office])).toEqual({ bounds: circleBounds({ ...point, radiusMetres: 300 }) });
    expect(startView(point, null, [])).toEqual({ bounds: circleBounds({ ...point, radiusMetres: 150 }) });
    expect(startView(null, 150, [office])).toEqual({ bounds: circleBounds(office) });
    expect(startView(null, 150, [])).toEqual({ centre: CAIRO, zoom: CAIRO_ZOOM });
  });
});

describe('the place search (Nominatim)', () => {
  it('asks for places in Egypt only, in English and Arabic, five at most', () => {
    const url = new URL(nominatimUrl('  Al Doctor   Al Mahrouki Street '));
    expect(url.origin + url.pathname).toBe('https://nominatim.openstreetmap.org/search');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'Al Doctor Al Mahrouki Street',
      format: 'jsonv2',
      countrycodes: 'eg',
      'accept-language': 'en,ar',
      limit: '5',
    });
    expect(new URL(nominatimUrl('شارع المحروقي')).searchParams.get('q')).toBe('شارع المحروقي');
  });

  it('reads the places found, each once, leaving out those without a name or a point', () => {
    const answer = [
      { place_id: 1, lat: '30.0457251', lon: '31.1923000', display_name: 'Trendlix, 15, Al Doctor Al Mahrouki Street, Agouza, Giza, Egypt' },
      { place_id: 2, lat: '30.0457251', lon: '31.1923000', display_name: 'Trendlix, 15, Al Doctor Al Mahrouki Street, Agouza, Giza, Egypt' },
      { place_id: 3, lat: 'north', lon: '31.19', display_name: 'Nowhere' },
      { place_id: 4, lat: '30.05', lon: '31.2', display_name: '  ' },
      { place_id: 5, lat: '30.0444', lon: '31.2357', display_name: 'ميدان التحرير, Cairo, Egypt' },
      null,
    ];
    expect(placesFrom(answer)).toEqual([
      { name: 'Trendlix, 15, Al Doctor Al Mahrouki Street, Agouza, Giza, Egypt', latitude: 30.045725, longitude: 31.1923 },
      { name: 'ميدان التحرير, Cairo, Egypt', latitude: 30.0444, longitude: 31.2357 },
    ]);
    expect([placesFrom({ error: 'Bad request' }), placesFrom(null), placesFrom([])]).toEqual([[], [], []]);
    const many = Array.from({ length: 8 }, (_, i) => ({ lat: String(30 + i / 100), lon: '31.2', display_name: `Place ${i}` }));
    expect(placesFrom(many)).toHaveLength(5);
  });

  it('goes at most once a second', () => {
    expect(nextSearchAt(null, 5_000)).toBe(5_000);
    expect(nextSearchAt(5_000, 5_300)).toBe(6_000);
    expect(nextSearchAt(5_000, 6_000)).toBe(6_000);
    expect(nextSearchAt(5_000, 9_000)).toBe(9_000);
    // a search about to go holds the next one a second after it
    expect(nextSearchAt(6_000, 5_400)).toBe(7_000);
  });
});
