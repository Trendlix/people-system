import { textResponse as text } from '../../templates/file-response';

// Passing a custody record's signed copy from the API on to the browser (Assets step 3), for the routes that serve it
// under the web domain with the caller's session (the record's page, My custody): a photo or a PDF only, shown in the
// browser, never saved under another name, never kept by it; anything else is answered 404.

const FILE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

export function fileResponse(res: Response, failed: string): Response {
  if (!res.ok) return text(res.status === 404 ? 'Not found.' : failed, res.status === 404 ? 404 : 502);
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!FILE_TYPES.has(type)) return text('Not found.', 404);
  const headers = new Headers({
    'content-type': type,
    // shown in the browser; the API sends the cleaned file name
    'content-disposition': (res.headers.get('content-disposition') ?? 'inline').replace(/^\s*attachment/i, 'inline'),
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
  });
  // the browser's PDF viewer doesn't open under default-src 'none'; a PDF's own scripts stay inside its sandbox anyway
  if (type !== 'application/pdf') headers.set('content-security-policy', "default-src 'none'");
  // fetch unpacks a compressed body, so the length only holds when nothing was compressed on the way
  const length = res.headers.get('content-length');
  if (length && !res.headers.has('content-encoding')) headers.set('content-length', length);
  return new Response(res.body, { headers });
}
