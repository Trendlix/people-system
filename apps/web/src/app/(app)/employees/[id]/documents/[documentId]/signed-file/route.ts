import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';

// Serves a generated document's signed copy (a photo or a PDF, the Contracts tab's View signed copy) from the API under
// the web domain, with the caller's session: the browser never talks to the API. The API checks the role (HR, CEO).
// Shown in the page's document viewer, so links here are never prefetched.

const ID = /^[0-9a-z-]{1,64}$/i;
const FILE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store' } });

export async function GET(_req: Request, ctx: RouteContext<'/employees/[id]/documents/[documentId]/signed-file'>) {
  const { documentId } = await ctx.params;
  if (!ID.test(documentId)) return text('Not found.', 404);

  let res: Response;
  try {
    res = await apiFetch(`/documents/${encodeURIComponent(documentId)}/signed-file`);
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 403) return text('Only HR and the CEO can open generated documents.', 403);
  if (!res.ok) return text(res.status === 404 ? 'Not found.' : 'This file could not be loaded. Please try again.', res.status === 404 ? 404 : 502);

  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!FILE_TYPES.has(type)) return text('Not found.', 404);

  const headers = new Headers({
    'content-type': type,
    // shown in the browser, never saved under another name; the API sends the cleaned file name
    'content-disposition': (res.headers.get('content-disposition') ?? 'inline').replace(/^\s*attachment/i, 'inline'),
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
  });
  // Browsers' built-in PDF viewers refuse to run under "default-src 'none'"; a PDF's own scripts stay inside the
  // viewer's sandbox anyway, so the policy is only sent with images.
  if (type !== 'application/pdf') headers.set('content-security-policy', "default-src 'none'");
  // fetch unpacks a compressed body, so the length only holds when nothing was compressed on the way
  const length = res.headers.get('content-length');
  if (length && !res.headers.has('content-encoding')) headers.set('content-length', length);
  return new Response(res.body, { headers });
}
