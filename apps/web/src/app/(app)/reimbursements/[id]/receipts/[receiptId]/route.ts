import { redirect } from 'next/navigation';
import { REIMBURSEMENT_RECEIPT_TYPES } from '@trendlix/shared';
import { ApiError, apiFetch } from '@/lib/api';
import { textResponse as text } from '../../../../organization/templates/file-response';

// Serves one receipt of a reimbursement claim from the API under the web domain, with the caller's session: the browser
// never talks to the API (as the employee file's scans, app/paperwork/[itemId]). The API lets the claimant, the claim's
// direct manager, HR, Finance and the CEO open it, and writes each opening to the audit log, so links here are never
// prefetched: the claim page opens a receipt in the document viewer only when asked.

const UUID = /^[0-9a-f-]{36}$/i;
const FILE_TYPES = new Set<string>(REIMBURSEMENT_RECEIPT_TYPES);

export async function GET(_req: Request, ctx: RouteContext<'/reimbursements/[id]/receipts/[receiptId]'>) {
  const { id, receiptId } = await ctx.params;
  if (!UUID.test(id) || !UUID.test(receiptId)) return text('Not found.', 404);

  let res: Response;
  try {
    res = await apiFetch(`/reimbursements/${id}/receipts/${receiptId}`);
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 403) return text('Only the employee, their direct manager, HR, Finance and the CEO can open the receipts of a claim.', 403);
  if (!res.ok) return text(res.status === 404 ? 'Not found.' : 'This receipt could not be loaded. Please try again.', res.status === 404 ? 404 : 502);

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
