'use client';

import { useEffect, useRef, useState } from 'react';
import { useFieldIds } from '@/components/form';
import { isShortMapLink, nextSearchAt, nominatimUrl, placesFrom, pointFromText, SEARCH_MIN_LENGTH, SHORT_LINK_TEXT, type Place, type Point } from './map-point';
import { coordinateText } from './setup';

// A location's form's search for the place (owner, 20 October 2026: "let me view location on map and add location from
// map"): a name or an address, found in Egypt by OpenStreetMap's Nominatim, asked from the browser, in English and
// Arabic. Nominatim's usage policy: no search as it is typed (only on Enter or Search), at most one a second (the page's
// forms together), what was found kept rather than asked again, and its attribution shown. A Google Maps or
// OpenStreetMap link, or a point ("30.0457, 31.1923"), pasted in puts the pin at once, without asking anyone.

/** When the page's last search went (or the next is to go): at most one a second, whichever form asks. */
let lastSearchAt: number | null = null;
/** What each search found, while the page is open: asking again doesn't ask Nominatim again. */
const found = new Map<string, Place[]>();

const pointText = (p: Point) => `${coordinateText(p.latitude)}, ${coordinateText(p.longitude)}`;

export function PlaceSearch({ onPoint }: { onPoint: (p: Point) => void }) {
  const fid = useFieldIds();
  const field = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const asking = useRef<AbortController | null>(null);

  // leaving the page: the search waiting to go, or on its way, is dropped
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      asking.current?.abort();
    };
  }, []);

  function put(p: Point, where: string) {
    onPoint(p);
    setPlaces([]);
    setStatus(`Pin put ${where}, at ${pointText(p)}. Save the location to keep it.`);
  }

  function showFound(query: string, list: Place[]) {
    setBusy(false);
    setPlaces(list);
    setStatus(
      list.length
        ? `${list.length === 1 ? 'One place' : `${list.length} places`} found: choose one to put the pin there.`
        : `No place found in Egypt for “${query}”. Try another name or the street, or click the map.`,
    );
  }

  function typed(value: string) {
    setText(value);
    const p = pointFromText(value);
    if (p) put(p, 'on the point pasted');
    else if (isShortMapLink(value)) setStatus(SHORT_LINK_TEXT);
  }

  async function ask(query: string) {
    timer.current = null;
    asking.current?.abort();
    const request = new AbortController();
    asking.current = request;
    try {
      const res = await fetch(nominatimUrl(query), { signal: request.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`Nominatim answered ${res.status}`);
      const list = placesFrom(await res.json());
      found.set(query.toLowerCase(), list);
      showFound(query, list);
    } catch {
      if (request.signal.aborted) return;
      setPlaces([]);
      setStatus('The search didn’t answer. Try again in a moment, or click the map to put the pin.');
    } finally {
      if (asking.current === request) {
        asking.current = null;
        setBusy(false);
      }
    }
  }

  function search() {
    const query = text.trim().replace(/\s+/g, ' ');
    const p = pointFromText(query);
    if (p) return put(p, 'on the point pasted');
    if (isShortMapLink(query)) return setStatus(SHORT_LINK_TEXT);
    if (query.length < SEARCH_MIN_LENGTH) return setStatus(`Type at least ${SEARCH_MIN_LENGTH} letters of the place’s name or address.`);
    // pressed again before it went: only the last one goes
    if (timer.current) clearTimeout(timer.current);
    const known = found.get(query.toLowerCase());
    if (known) return showFound(query, known);
    const now = Date.now();
    const when = nextSearchAt(lastSearchAt, now);
    lastSearchAt = when;
    setBusy(true);
    setStatus('Searching…');
    timer.current = setTimeout(() => void ask(query), when - now);
  }

  return (
    <div className="space-y-2">
      <label htmlFor={fid('place')} className="label">
        Search for the place
      </label>
      <div className="flex gap-2">
        <input
          ref={field}
          id={fid('place')}
          type="search"
          autoComplete="off"
          enterKeyHint="search"
          placeholder="A name, an address or a Google Maps link"
          value={text}
          onChange={(e) => typed(e.target.value)}
          onKeyDown={(e) => {
            // Enter searches here rather than saving the form
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              search();
            }
          }}
          aria-describedby={`${fid('place-hint')} ${fid('place-status')}`}
          className="input min-w-0 flex-1"
        />
        <button type="button" onClick={search} disabled={busy} className="btn btn-secondary shrink-0">
          {busy ? 'Searching…' : 'Search'}
        </button>
      </div>
      <p id={fid('place-hint')} className="hint">
        In Egypt, in English or Arabic; a Google Maps link or a point (30.0457, 31.1923) puts the pin at once. Search by{' '}
        <a href="https://nominatim.openstreetmap.org/" target="_blank" rel="noreferrer">
          Nominatim
        </a>
        , places ©{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap contributors
        </a>
        .
      </p>
      <p id={fid('place-status')} role="status" className="text-sm text-muted">
        {status}
      </p>
      {places.length > 0 && (
        <ul aria-label="Places found" className="divide-y divide-line-soft overflow-hidden rounded-lg border border-line bg-white">
          {places.map((p) => (
            <li key={`${p.name}|${p.latitude}|${p.longitude}`}>
              <button
                type="button"
                onClick={() => {
                  put(p, `on ${p.name}`);
                  field.current?.focus();
                }}
                className="block min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-canvas focus-visible:bg-canvas"
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
