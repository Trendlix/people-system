import { ApiError, apiFetch } from '@/lib/api';
import { mapsConfigFrom, OPENSTREETMAP } from '@/lib/google-maps';

// The maps' key for the page asking (owner, 24 October 2026: "Google Maps"; components/map/provider.ts asks once a page,
// only a page that shows a map or a place search). The API decides with the caller's session: the Google Maps key to
// staff whose pages show a map, never to a developer, OpenStreetMap without a key; anything else it says (a refusal,
// the API down, a session gone) is answered as OpenStreetMap, so the page's maps keep working. Never kept by the browser
// or a cache on the way, so a key replaced or removed takes effect on the next page.

const answer = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' },
  });

export async function GET() {
  let res: Response;
  try {
    // the page asks by itself, not the person: not counted as activity (HR's and Admin's 15 minutes)
    res = await apiFetch('/maps/key', undefined, { background: true });
  } catch (err) {
    if (err instanceof ApiError) return answer(OPENSTREETMAP);
    throw err;
  }
  if (!res.ok) return answer(OPENSTREETMAP);
  try {
    return answer(mapsConfigFrom(await res.json()));
  } catch {
    return answer(OPENSTREETMAP);
  }
}
