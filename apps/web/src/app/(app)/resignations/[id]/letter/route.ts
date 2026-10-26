import { redirect } from 'next/navigation';
import { RESIGNATION_LETTER_TYPES } from '@trendlix/shared';
import { ApiError, apiFetch } from '@/lib/api';
import { textResponse as text } from '../../../organization/templates/file-response';

// Serves the signed letter of a resignation request from the API under the web domain, with the caller's session (as a
// reimbursement's receipts). The API lets the employee, HR and the CEO open it and writes each opening to the audit log, so
// the link is never prefetched.

const UUID = /^[0-9a-f-]{36}$/i;
const FILE_TYPES = new Set<string>(RESIGNATION_LETTER_TYPES);

export async function GET(_req: Request, ctx: RouteContext<'/resignations/[id]/letter'>) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return text('Not found.', 404);
  let res: Response;
  try {
    res = await apiFetch(`/resignation-requests/${id}/letter`);
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 403) return text('Only the employee, HR and the CEO can open the letter.', 403);
  if (!res.ok) return text(res.status === 404 ? 'Not found.' : 'This letter could not be loaded. Please try again.', res.status === 404 ? 404 : 502);
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!FILE_TYPES.has(type)) return text('Not found.', 404);
  const headers = new Headers({
    'content-type': type,
    'content-disposition': (res.headers.get('content-disposition') ?? 'inline').replace(/^\s*attachment/i, 'inline'),
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
  });
  if (type !== 'application/pdf') headers.set('content-security-policy', "default-src 'none'");
  const length = res.headers.get('content-length');
  if (length && !res.headers.has('content-encoding')) headers.set('content-length', length);
  return new Response(res.body, { headers });
}
