import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { CUSTODY_API } from '@/lib/asset-paths';
import { fileResponse } from '../../../../assets/custody/file-proxy';
import { textResponse as text } from '../../../../organization/templates/file-response';
import { custodyCodeFromParam } from '../../../../assets/custody';

// Serves the person's own signed custody form (Assets step 3; owner, 21 October 2026: "Yes, My custody") from the API
// under the web domain, with their session: the API answers only for a record of their own, whatever their Assets
// access. Shown in the browser, never kept by it.

const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(_req: Request, ctx: RouteContext<'/my-custody/[no]/files/[fileId]'>) {
  const { no, fileId } = await ctx.params;
  const code = custodyCodeFromParam(no);
  if (!code || !UUID.test(fileId)) return text('Not found.', 404);
  let res: Response;
  try {
    res = await apiFetch(CUSTODY_API.myFile(code, fileId));
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  return fileResponse(res, 'This signed form could not be loaded. Please try again.');
}
