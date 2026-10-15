import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { passPdfOn, wantsDownload } from '@/lib/protected-pdf';
import { apiReason, textResponse as text } from '../../../file-response';

// Serves one version of a template filled in with a real employee's data, nothing saved (owner's request, 15 October
// 2026: "When previewing a template, fetch any demo data already uploaded"), from the API under the web domain with
// the caller's session. ?employeeId=, or ?offerId= for a job offer template, chooses whose data (else the API takes the
// best person or offer to preview it with). Filled in, it is only ever a protected PDF (owner's request, 15 October
// 2026: "No doc file export, just a protected PDF"): shown in the browser, or saved with ?download=1. The API checks the
// role (HR, Admin, CEO) and masks restricted data the caller may not see. Links here are plain links, never prefetched.

const ID = /^[0-9a-z-]{1,64}$/i;

export async function GET(req: Request, ctx: RouteContext<'/templates/versions/[versionId]/preview'>) {
  const { versionId } = await ctx.params;
  if (!ID.test(versionId)) return text('Not found.', 404);
  const params = new URL(req.url).searchParams;
  const employeeId = params.get('employeeId') || null;
  const offerId = params.get('offerId') || null;
  if ((employeeId && !ID.test(employeeId)) || (offerId && !ID.test(offerId))) return text('Not found.', 404);
  const download = wantsDownload(params);

  const query = new URLSearchParams();
  if (employeeId) query.set('employeeId', employeeId);
  if (offerId) query.set('offerId', offerId);
  if (download) query.set('download', '1');
  const q = query.toString();
  let res: Response;
  try {
    res = await apiFetch(`/templates/versions/${encodeURIComponent(versionId)}/preview${q ? `?${q}` : ''}`);
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 403) return text('Only HR, Admin and the CEO can preview templates.', 403);
  if (res.status === 404) return text(await apiReason(res, 'Not found.'), 404);
  // nobody to preview it with yet, someone never employed, an offer for another template, no PDF converter on the
  // server or the converter failing (there is no Word file instead): the API says which
  if (res.status === 400 || res.status === 409 || res.status === 503) return text(await apiReason(res, 'There is no preview of this template.'), res.status);
  if (!res.ok) return text('This preview could not be loaded. Please try again.', 502);
  return passPdfOn(res, { download, fallbackName: 'template preview.pdf' }) ?? text('This preview could not be loaded. Please try again.', 502);
}
