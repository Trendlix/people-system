import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';

// Serves a generated document's Word file (the Contracts tab's Download .docx) from the API under the web domain, with
// the caller's session: the browser never talks to the API. The API checks the role (HR, CEO). Always downloaded, never
// opened in the page, and links here are plain links, never prefetched.

const ID = /^[0-9a-z-]{1,64}$/i;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const FILE_TYPES = new Set([DOCX, 'application/octet-stream']);

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store' } });

export async function GET(_req: Request, ctx: RouteContext<'/employees/[id]/documents/[documentId]/file'>) {
  const { documentId } = await ctx.params;
  if (!ID.test(documentId)) return text('Not found.', 404);

  let res: Response;
  try {
    res = await apiFetch(`/documents/${encodeURIComponent(documentId)}/file`);
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 403) return text('Only HR and the CEO can download generated documents.', 403);
  if (res.status === 404) return text('Not found.', 404);
  if (!res.ok) return text('This file could not be loaded. Please try again.', 502);

  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!FILE_TYPES.has(type)) return text('This file could not be loaded. Please try again.', 502);

  const headers = new Headers({
    'content-type': type,
    // saved, never shown in the browser; the API sends the file's name
    'content-disposition': (res.headers.get('content-disposition') ?? 'attachment; filename="document.docx"').replace(/^\s*inline/i, 'attachment'),
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'",
  });
  // fetch unpacks a compressed body, so the length only holds when nothing was compressed on the way
  const length = res.headers.get('content-length');
  if (length && !res.headers.has('content-encoding')) headers.set('content-length', length);
  return new Response(res.body, { headers });
}
