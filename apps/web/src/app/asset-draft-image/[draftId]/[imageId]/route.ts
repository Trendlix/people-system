import { ApiError, apiFetch } from '@/lib/api';
import { ASSET_API } from '@/lib/asset-paths';

// Serves a draft's product image from the API under the web domain, with the caller's session (owner, 21 October 2026:
// "let the mcp connector fetch the product photo and add it"), for Drafts from Claude and the Add form filled in from a
// draft. The API answers only an Assets custodian or manager, and only an image kept as a JPEG, PNG or WebP; anything
// else is answered 404 here. Kept by the browser for ten minutes, as the API says, as an asset's photos are.

const UUID = /^[0-9a-f-]{36}$/i;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const notFound = () => new Response('Not found.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store' } });

export async function GET(_req: Request, ctx: RouteContext<'/asset-draft-image/[draftId]/[imageId]'>) {
  const { draftId, imageId } = await ctx.params;
  if (!UUID.test(draftId) || !UUID.test(imageId)) return notFound();

  let res: Response;
  try {
    res = await apiFetch(ASSET_API.draftImage(draftId, imageId));
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
