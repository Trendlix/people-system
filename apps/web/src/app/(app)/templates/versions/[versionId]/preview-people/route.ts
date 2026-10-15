import { ApiError, apiFetch } from '@/lib/api';
import { apiReason } from '../../../file-response';
import { readPeople } from '../../../preview-people';

// The people to preview a version of a template with, best first (owner's request, 15 October 2026), for the template
// page's "Preview as": read from the API with the caller's session only when asked, as working out how much of the
// template each person has filled in takes the server a moment. Answers JSON: the people, or { message } with the
// API's reason. The API checks the role (HR, Admin, CEO).

const ID = /^[0-9a-z-]{1,64}$/i;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });

export async function GET(_req: Request, ctx: RouteContext<'/templates/versions/[versionId]/preview-people'>) {
  const { versionId } = await ctx.params;
  if (!ID.test(versionId)) return json({ message: 'Not found.' }, 404);

  let res: Response;
  try {
    res = await apiFetch(`/templates/versions/${encodeURIComponent(versionId)}/preview-people`);
  } catch (err) {
    if (err instanceof ApiError) return json({ message: err.message }, err.status);
    throw err;
  }
  if (res.status === 401) return json({ message: 'Your session has ended. Reload the page to sign in again.' }, 401);
  if (res.status === 403) return json({ message: 'Only HR, Admin and the CEO can preview templates.' }, 403);
  if (!res.ok) return json({ message: await apiReason(res, 'The people could not be loaded. Please try again.') }, res.status === 404 ? 404 : 502);
  try {
    return json(readPeople(await res.json()));
  } catch {
    return json({ message: 'The server sent an answer that could not be read.' }, 502);
  }
}
