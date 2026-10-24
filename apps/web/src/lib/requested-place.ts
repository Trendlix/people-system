// "Request this place" (owner, 24 October 2026: "if the location refused the checkin and out, allow the employee to
// request adding this location to his profile"): when a check-in or check-out is refused for its location, the panel
// hands the reading it sent (its point and accuracy) to the request form through this browser tab's session storage,
// never through the address (a point in a link would be kept in the browser's history and the server's logs). The form
// takes it once, if it is fresh (within 15 minutes), and fills the point in. Storage can be missing (a private window,
// blocked site data): then the form starts empty. Pure but for the storage passed in; relative imports only.

/** The session storage key the reading is handed over under. */
export const REQUESTED_PLACE_KEY = 'trendlix:requested-place';

/** How long a handed-over reading stays usable. */
export const REQUESTED_PLACE_MAX_AGE_MS = 15 * 60_000;

/** `?from=refusal` on the form's address: it was opened from a refused press. */
export const FROM_REFUSAL = 'refusal';

/** A reading handed over: its point, its accuracy in metres (none: unknown) and when it was read (ms). */
export interface RequestedPlace {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  at: number;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const storeOf = (store?: Store | null): Store | null => {
  if (store !== undefined) return store;
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

const isNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Keeps the refused press's reading for the form. Never throws. */
export function saveRequestedPlace(place: { latitude: number; longitude: number; accuracy?: number | null }, now = Date.now(), store?: Store | null): boolean {
  const s = storeOf(store);
  if (!s || !isNumber(place.latitude) || !isNumber(place.longitude)) return false;
  try {
    s.setItem(REQUESTED_PLACE_KEY, JSON.stringify({ latitude: place.latitude, longitude: place.longitude, accuracy: isNumber(place.accuracy) ? place.accuracy : null, at: now }));
    return true;
  } catch {
    return false;
  }
}

/** The reading handed over, taken once (removed as it is read); null when none, unreadable or older than 15 minutes. Never throws. */
export function takeRequestedPlace(now = Date.now(), store?: Store | null): RequestedPlace | null {
  const s = storeOf(store);
  if (!s) return null;
  try {
    const raw = s.getItem(REQUESTED_PLACE_KEY);
    s.removeItem(REQUESTED_PLACE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<RequestedPlace>;
    if (!isNumber(p.latitude) || !isNumber(p.longitude) || Math.abs(p.latitude) > 90 || Math.abs(p.longitude) > 180 || !isNumber(p.at)) return null;
    if (now - p.at > REQUESTED_PLACE_MAX_AGE_MS || p.at > now + 60_000) return null;
    return { latitude: p.latitude, longitude: p.longitude, accuracy: isNumber(p.accuracy) && p.accuracy >= 0 ? p.accuracy : null, at: p.at };
  } catch {
    return null;
  }
}
