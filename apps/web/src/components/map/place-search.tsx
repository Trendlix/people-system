'use client';

import { useEffect, useRef, useState } from 'react';
import { useFieldIds } from '@/components/form';
import { autocompleteRequest, suggestionsFrom, type PlaceSuggestion } from '@/lib/google-maps';
import { coordinateText, isShortMapLink, nextSearchAt, nominatimUrl, placesFrom, pointFromText, roundCoordinate, SEARCH_MIN_LENGTH, SHORT_LINK_TEXT, type Place, type Point } from '@/lib/map-point';
import { markPlacesFailed, useSearchProvider } from './provider';

// A location's form's search for the place (owner, 20 October 2026: "let me view location on map and add location from
// map"): a name or an address, found in Egypt by OpenStreetMap's Nominatim, asked from the browser, in English and
// Arabic. Nominatim's usage policy: no search as it is typed (only on Enter or Search), at most one a second (the page's
// forms together), what was found kept rather than asked again, and its attribution shown. A Google Maps or
// OpenStreetMap link, or a point ("30.0457, 31.1923"), pasted in puts the pin at once, without asking anyone. Shared
// since 20 October 2026 with the home locations' form (owner: "allow other users to request to add their home locations
// when working from home"). Google's place search since 24 October 2026 (owner: "Google Maps"; told "Google's place
// search"): with the Google Maps key set, Places API (New)'s autocomplete, in Egypt, suggesting as it is typed (a moment
// after the typing stops) and on Enter or Search, one session a place chosen (as Google bills it); its point read only
// for the place chosen. Should Google's search refuse, the page's searches turn OpenStreetMap's, this one too. Without a
// key, OpenStreetMap's as before.

/** When the page's last search went (or the next is to go): at most one a second, whichever form asks. */
let lastSearchAt: number | null = null;
/** What each search found, while the page is open: asking again doesn't ask Nominatim again. */
const found = new Map<string, Place[]>();
/** How long Google's suggestions wait after the last key pressed. */
const SUGGEST_AFTER_MS = 350;

/** A Nominatim search booked: how long until it may go (at most one a second for the page's forms together). */
function bookSearch(): number {
  const now = Date.now();
  const when = nextSearchAt(lastSearchAt, now);
  lastSearchAt = when;
  return when - now;
}

const pointText = (p: Point) => `${coordinateText(p.latitude)}, ${coordinateText(p.longitude)}`;

type Choice = { key: string; name: string; choose: () => void };

export function PlaceSearch({
  onPoint,
  keepText = 'Save the location to keep it.',
}: {
  onPoint: (p: Point) => void;
  /** What keeps the point, said once the pin is put (a home location's form: sending the request). */
  keepText?: string;
}) {
  const fid = useFieldIds();
  const field = useRef<HTMLInputElement>(null);
  const search = useSearchProvider();
  const [text, setText] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const asking = useRef<AbortController | null>(null);
  // Google's: the session (one a place chosen), its last answer (to put the pin with) and which ask is the latest
  const session = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const answer = useRef<google.maps.places.AutocompleteSuggestion[]>([]);
  const latest = useRef({ ask: 0 });

  // leaving the page: the search waiting to go, or on its way, is dropped
  useEffect(() => {
    const asks = latest.current;
    return () => {
      if (timer.current) clearTimeout(timer.current);
      asking.current?.abort();
      asks.ask++;
    };
  }, []);

  function put(p: Point, where: string) {
    onPoint(p);
    setPlaces([]);
    setSuggestions([]);
    setStatus(`Pin put ${where}, at ${pointText(p)}. ${keepText}`);
  }

  function showFound(query: string, count: number) {
    setBusy(false);
    setStatus(
      count
        ? `${count === 1 ? 'One place' : `${count} places`} found: choose one to put the pin there.`
        : `No place found in Egypt for “${query}”. Try another name or the street, or click the map.`,
    );
  }

  // ---------- OpenStreetMap's Nominatim ----------

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
      setPlaces(list);
      showFound(query, list.length);
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

  function nominatim(query: string, said = '') {
    // pressed again before it went: only the last one goes
    if (timer.current) clearTimeout(timer.current);
    setSuggestions([]);
    const known = found.get(query.toLowerCase());
    if (known) {
      setPlaces(known);
      return showFound(query, known.length);
    }
    const wait = bookSearch();
    setBusy(true);
    setStatus(`${said}Searching…`);
    timer.current = setTimeout(() => void ask(query), wait);
  }

  // ---------- Google's place search ----------

  async function suggest(query: string) {
    if (search.provider !== 'google') return nominatim(query);
    timer.current = null;
    const mine = ++latest.current.ask;
    setBusy(true);
    setStatus('Searching…');
    try {
      // the loader only now, on a page that searches
      const { placesLibrary } = await import('./google');
      const lib = await placesLibrary(search.config);
      session.current ??= new lib.AutocompleteSessionToken();
      const { suggestions: list } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions(autocompleteRequest(query, session.current));
      if (mine !== latest.current.ask) return;
      answer.current = list;
      const shown = suggestionsFrom(list);
      setPlaces([]);
      setSuggestions(shown);
      showFound(query, shown.length);
    } catch {
      if (mine !== latest.current.ask) return;
      // Google's search refused (or didn't answer): OpenStreetMap's from now on, this search too
      markPlacesFailed();
      setBusy(false);
      nominatim(query, 'Google’s place search didn’t answer, so OpenStreetMap’s is used. ');
    }
  }

  async function chooseSuggestion(s: PlaceSuggestion) {
    const prediction = answer.current[s.index]?.placePrediction;
    if (!prediction) return;
    const mine = ++latest.current.ask;
    setBusy(true);
    setStatus(`Putting the pin on ${s.name}…`);
    try {
      const place = prediction.toPlace();
      await place.fetchFields({ fields: ['location'] });
      // the session ends with the place chosen: the next search starts another
      session.current = null;
      if (mine !== latest.current.ask) return;
      const at = place.location;
      if (!at) throw new Error('No point');
      setBusy(false);
      put({ latitude: roundCoordinate(at.lat()), longitude: roundCoordinate(at.lng()) }, `on ${s.name}`);
    } catch {
      if (mine !== latest.current.ask) return;
      setBusy(false);
      setStatus('Google didn’t give that place’s point. Choose another, or click the map to put the pin.');
    }
  }

  // ---------- what is typed ----------

  function typed(value: string) {
    setText(value);
    if (search.provider === 'google') {
      // what was asked for the text before is dropped
      if (timer.current) clearTimeout(timer.current);
      latest.current.ask++;
      setBusy(false);
    }
    const p = pointFromText(value);
    if (p) return put(p, 'on the point pasted');
    if (isShortMapLink(value)) return setStatus(SHORT_LINK_TEXT);
    // Google's suggests as it is typed, a moment after the typing stops (Nominatim's only on Enter or Search)
    const query = value.trim().replace(/\s+/g, ' ');
    if (search.provider === 'google' && query.length >= SEARCH_MIN_LENGTH) timer.current = setTimeout(() => void suggest(query), SUGGEST_AFTER_MS);
  }

  function find() {
    const query = text.trim().replace(/\s+/g, ' ');
    const p = pointFromText(query);
    if (p) return put(p, 'on the point pasted');
    if (isShortMapLink(query)) return setStatus(SHORT_LINK_TEXT);
    if (query.length < SEARCH_MIN_LENGTH) return setStatus(`Type at least ${SEARCH_MIN_LENGTH} letters of the place’s name or address.`);
    if (search.provider === 'google') {
      if (timer.current) clearTimeout(timer.current);
      return void suggest(query);
    }
    nominatim(query);
  }

  const choices: Choice[] = suggestions.length
    ? suggestions.map((s) => ({ key: s.id, name: s.name, choose: () => void chooseSuggestion(s) }))
    : places.map((p) => ({ key: `${p.name}|${p.latitude}|${p.longitude}`, name: p.name, choose: () => put(p, `on ${p.name}`) }));

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
              if (search.ready) find();
            }
          }}
          aria-describedby={`${fid('place-hint')} ${fid('place-status')}`}
          className="input min-w-0 flex-1"
        />
        <button type="button" onClick={find} disabled={busy || !search.ready} className="btn btn-secondary shrink-0">
          {busy ? 'Searching…' : 'Search'}
        </button>
      </div>
      <p id={fid('place-hint')} className="hint">
        {search.provider === 'google' ? (
          <>In Egypt, in English or Arabic, suggested as you type; a Google Maps link or a point (30.0457, 31.1923) puts the pin at once. Places from Google Maps.</>
        ) : (
          <>
            In Egypt, in English or Arabic; a Google Maps link or a point (30.0457, 31.1923) puts the pin at once. Search by{' '}
            <a href="https://nominatim.openstreetmap.org/" target="_blank" rel="noreferrer">
              Nominatim
            </a>
            , places ©{' '}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
              OpenStreetMap contributors
            </a>
            .
          </>
        )}
      </p>
      <p id={fid('place-status')} role="status" className="text-sm text-muted">
        {status}
      </p>
      {choices.length > 0 && (
        <ul aria-label="Places found" className="divide-y divide-line-soft overflow-hidden rounded-lg border border-line bg-card">
          {choices.map((c) => (
            <li key={c.key}>
              <button
                type="button"
                onClick={() => {
                  c.choose();
                  field.current?.focus();
                }}
                className="block min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-canvas focus-visible:bg-canvas"
              >
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
