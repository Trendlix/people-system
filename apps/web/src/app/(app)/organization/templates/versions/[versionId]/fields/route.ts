import { ApiError, apiFetch } from '@/lib/api';
import type { TemplateFields } from '@/lib/types';
import { apiReason } from '../../../file-response';

// The fields placed on a PDF version, read from the API with the caller's session, for Place Fields' "Copy fields
// from" (an earlier version of the same form): only when asked. Answers JSON: { pages, fields }, or { message } with
// the API's reason. The API checks the role (HR, Admin, CEO).

const ID = /^[0-9a-z-]{1,64}$/i;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });

export async function GET(_req: Request, ctx: RouteContext<'/organization/templates/versions/[versionId]/fields'>) {
  const { versionId } = await ctx.params;
  if (!ID.test(versionId)) return json({ message: 'Not found.' }, 404);

  let res: Response;
  try {
    res = await apiFetch(`/templates/versions/${encodeURIComponent(versionId)}/fields`);
  } catch (err) {
    if (err instanceof ApiError) return json({ message: err.message }, err.status);
    throw err;
  }
  if (res.status === 401) return json({ message: 'Your session has ended. Reload the page to sign in again.' }, 401);
  if (res.status === 403) return json({ message: 'Only HR, Admin and the CEO can see the templates.' }, 403);
  if (!res.ok) return json({ message: await apiReason(res, 'The fields could not be loaded. Please try again.') }, res.status === 404 ? 404 : 502);
  try {
    const body = (await res.json()) as TemplateFields;
    return json({ pages: Array.isArray(body.pages) ? body.pages : [], fields: Array.isArray(body.fields) ? body.fields : [] });
  } catch {
    return json({ message: 'The server sent an answer that could not be read.' }, 502);
  }
}
