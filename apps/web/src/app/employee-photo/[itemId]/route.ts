import { ApiError, apiFetch } from '@/lib/api';

// Serves an employee's personal photo from the API under the web domain, with the caller's session, for the picture
// beside their name (employees/ui.tsx Avatar). The API answers only for a personal photo kept as an image, and only to
// HR and the CEO; anything else is answered 404, which leaves the initials showing. Kept by the browser for ten
// minutes, as the API says, so the list of employees doesn't load every photo on every visit.

const UUID = /^[0-9a-f-]{36}$/i;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const notFound = () => new Response('Not found.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store' } });

export async function GET(_req: Request, ctx: RouteContext<'/employee-photo/[itemId]'>) {
  const { itemId } = await ctx.params;
  if (!UUID.test(itemId)) return notFound();

  let res: Response;
  try {
    res = await apiFetch(`/paperwork/${itemId}/photo`);
  } catch (err) {
    if (err instanceof ApiError) return notFound();
    throw err;
  }
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!res.ok || !IMAGE_TYPES.has(type)) return notFound();

  const headers = new Headers({
    'content-type': type,
    'cache-control': res.headers.get('cache-control') ?? 'private, max-age=600',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'",
  });
  // fetch unpacks a compressed body, so the length only holds when nothing was compressed on the way
  const length = res.headers.get('content-length');
  if (length && !res.headers.has('content-encoding')) headers.set('content-length', length);
  return new Response(res.body, { headers });
}
