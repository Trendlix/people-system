import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { apiReason, textResponse as text } from '../../../../../organization/templates/file-response';
import { apiBatchFilePath, BATCH_FALLBACK_NAME, passSheetOn } from '../../../../files';

// Serves a bank transfer batch's file (owner, 5 November 2026: "allow me to select a group of people for the transfer")
// from the API under the web domain, with the caller's session: the CIB or ACH file of the people ticked for it, as
// made when it was first downloaded. The API checks the role (HR, Finance, the CEO), that nobody in it is hidden from
// the caller, and records each download. Its refusals are shown as plain text. Links here are plain links, never
// prefetched.

const ID = /^[0-9a-f-]{36}$/i;

export async function GET(_req: Request, ctx: RouteContext<'/payroll/[id]/bank-batches/[batchId]/file'>) {
  const { id, batchId } = await ctx.params;
  if (!ID.test(id) || !ID.test(batchId)) return text('Not found.', 404);

  let res: Response;
  try {
    res = await apiFetch(apiBatchFilePath(id, batchId));
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 403) return text(await apiReason(res, 'Only HR, Finance and the CEO can download the bank files.'), 403);
  if (res.status === 404) return text('Not found.', 404);
  if (res.status === 400 || res.status === 409 || res.status === 422 || res.status === 503) {
    return text(await apiReason(res, 'This file could not be made.'), res.status);
  }
  if (!res.ok) return text('This file could not be loaded. Please try again.', 502);
  return passSheetOn(res, BATCH_FALLBACK_NAME) ?? text('This file could not be loaded. Please try again.', 502);
}
