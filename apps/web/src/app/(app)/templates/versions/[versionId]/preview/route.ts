import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { apiReason, passFileOn, textResponse as text } from '../../../file-response';

// Serves one version of a template filled in with a real employee's data, nothing saved (owner's request, 15 October
// 2026: "When previewing a template, fetch any demo data already uploaded"), from the API under the web domain with
// the caller's session. ?employeeId= chooses whose data (else the API takes the best person to preview it with); it is
// a PDF shown in the browser, or (?format=docx) the Word file, downloaded. The API checks the role (HR, Admin, CEO) and
// masks restricted data the caller may not see. Links here are plain links, never prefetched.

const ID = /^[0-9a-z-]{1,64}$/i;

export async function GET(req: Request, ctx: RouteContext<'/templates/versions/[versionId]/preview'>) {
  const { versionId } = await ctx.params;
  if (!ID.test(versionId)) return text('Not found.', 404);
  const params = new URL(req.url).searchParams;
  const employeeId = params.get('employeeId') || null;
  if (employeeId && !ID.test(employeeId)) return text('Not found.', 404);
  const pdf = params.get('format') !== 'docx';

  const query = new URLSearchParams({ format: pdf ? 'pdf' : 'docx' });
  if (employeeId) query.set('employeeId', employeeId);
  let res: Response;
  try {
    res = await apiFetch(`/templates/versions/${encodeURIComponent(versionId)}/preview?${query}`);
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 403) return text('Only HR, Admin and the CEO can preview templates.', 403);
  if (res.status === 404) return text(await apiReason(res, 'Not found.'), 404);
  // nobody to preview it with yet, someone never employed, or no PDF converter on the server (the Word file can still
  // be had, with ?format=docx): the API says which
  if (res.status === 400 || res.status === 409 || res.status === 503) return text(await apiReason(res, 'There is no preview of this template.'), res.status);
  if (!res.ok) return text('This preview could not be loaded. Please try again.', 502);
  return passFileOn(res, pdf, 'template preview');
}
