import { ApiError, apiFetch } from '@/lib/api';

// Serves a new photo an employee sent HR (owner, 31 October 2026: "allow them to upload a new photo as a request and
// approved from the HR") from the API under the web domain, with the caller's session: to the employee who sent it and
// to those who decide it (the API checks); anything else is answered 404. Never kept by the browser.

const UUID = /^[0-9a-f-]{36}$/i;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const notFound = () => new Response('Not found.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store' } });

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return notFound();

  let res: Response;
  try {
    res = await apiFetch(`/photo-requests/${id}/photo`);
  } catch (err) {
    if (err instanceof ApiError) return notFound();
    throw err;
  }
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!res.ok || !IMAGE_TYPES.has(type)) return notFound();

  const headers = new Headers({
    'content-type': type,
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'",
  });
  // fetch unpacks a compressed body, so the length only holds when nothing was compressed on the way
  const length = res.headers.get('content-length');
  if (length && !res.headers.has('content-encoding')) headers.set('content-length', length);
  return new Response(res.body, { headers });
}
