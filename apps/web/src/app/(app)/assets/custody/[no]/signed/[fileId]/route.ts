import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { CUSTODY_API } from '@/lib/asset-paths';
import { textResponse as text } from '../../../../../templates/file-response';
import { fileResponse } from '../../../file-proxy';
import { custodyCodeFromParam } from '../../../../custody';

// Serves a custody record's signed copy (Assets step 3) from the API under the web domain, with the caller's session: the
// browser never talks to the API. The API lets anyone with Assets access who may see the record open it (a C-level
// person's only those who see them); shown in the browser, never kept by it.

const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(_req: Request, ctx: RouteContext<'/assets/custody/[no]/signed/[fileId]'>) {
  const { no, fileId } = await ctx.params;
  const code = custodyCodeFromParam(no);
  if (!code || !UUID.test(fileId)) return text('Not found.', 404);
  let res: Response;
  try {
    res = await apiFetch(CUSTODY_API.signedFile(code, fileId));
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 403) return text('Only those with Assets access can open the signed copies.', 403);
  return fileResponse(res, 'This signed copy could not be loaded. Please try again.');
}
