import { redirect } from 'next/navigation';
import { LEAVE_DOCUMENT_TYPES } from '@trendlix/shared';
import { ApiError, apiFetch } from '@/lib/api';
import { textResponse as text } from '../../../../templates/file-response';

// Serves one document of a leave request (a medical certificate, proof of sitting the exam) from the API under the web
// domain, with the caller's session: the browser never talks to the API (as a claim's receipts). The API lets the
// employee, their direct manager, HR and the CEO open it, and writes each opening to the audit log, so links here are
// never prefetched: the request page opens a document in the document viewer only when asked.

const UUID = /^[0-9a-f-]{36}$/i;
const FILE_TYPES = new Set<string>(LEAVE_DOCUMENT_TYPES);

export async function GET(_req: Request, ctx: RouteContext<'/leave/[id]/documents/[docId]'>) {
  const { id, docId } = await ctx.params;
  if (!UUID.test(id) || !UUID.test(docId)) return text('Not found.', 404);

  let res: Response;
  try {
    res = await apiFetch(`/leave/requests/${id}/documents/${docId}`);
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 403) return text('Only the employee, their direct manager, HR and the CEO can open the documents of a leave request.', 403);
  if (!res.ok) return text(res.status === 404 ? 'Not found.' : 'This document could not be loaded. Please try again.', res.status === 404 ? 404 : 502);

  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!FILE_TYPES.has(type)) return text('Not found.', 404);

  const headers = new Headers({
    'content-type': type,
    // shown in the browser, never saved under another name; the API sends the cleaned file name
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
