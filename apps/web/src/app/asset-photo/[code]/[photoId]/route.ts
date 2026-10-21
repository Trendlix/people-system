import { isAssetCode, normalAssetCode } from '@trendlix/shared';
import { ApiError, apiFetch } from '@/lib/api';
import { ASSET_API } from '@/lib/asset-paths';

// Serves an asset's photo from the API under the web domain, with the caller's session (owner's brief, 21 October 2026:
// "Photos upload, up to 6 per asset … served through the API with permission checks"), for the register's thumbnails and
// the asset's page. The API answers only to those with Assets access, and only for a photo kept as an image; anything
// else is answered 404 here, which leaves the outline showing. Kept by the browser for ten minutes, as the API says.

const UUID = /^[0-9a-f-]{36}$/i;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const notFound = () => new Response('Not found.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store' } });

export async function GET(_req: Request, ctx: RouteContext<'/asset-photo/[code]/[photoId]'>) {
  const { code: raw, photoId } = await ctx.params;
  const code = normalAssetCode(raw);
  if (!isAssetCode(code) || !UUID.test(photoId)) return notFound();

  let res: Response;
  try {
    res = await apiFetch(ASSET_API.photo(code, photoId));
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
