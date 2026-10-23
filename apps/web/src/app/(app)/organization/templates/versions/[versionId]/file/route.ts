import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { apiReason, passFileOn, textResponse as text } from '../../../file-response';

// Serves one version of a template's file from the API under the web domain, with the caller's session: the browser
// never talks to the API. The API checks the role (HR, Admin, CEO). The file is always downloaded; ?format=pdf is the
// same file as a PDF, shown in the browser (Preview, owner's request, 15 October 2026), which for a PDF template is the
// form as it was uploaded (Place Fields draws its pages from it). Links here are plain links, never prefetched.

const ID = /^[0-9a-z-]{1,64}$/i;

export async function GET(req: Request, ctx: RouteContext<'/organization/templates/versions/[versionId]/file'>) {
  const { versionId } = await ctx.params;
  if (!ID.test(versionId)) return text('Not found.', 404);
  const pdf = new URL(req.url).searchParams.get('format') === 'pdf';

  let res: Response;
  try {
    res = await apiFetch(`/templates/versions/${encodeURIComponent(versionId)}/file${pdf ? '?format=pdf' : ''}`);
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 403) return text('Only HR, Admin and the CEO can download templates.', 403);
  if (res.status === 404) return text('Not found.', 404);
  // no PDF converter on the server: the API says so, and the Word file can still be downloaded
  if (res.status === 409 || res.status === 503) return text(await apiReason(res, 'There is no preview of this file.'), res.status);
  if (!res.ok) return text('This file could not be loaded. Please try again.', 502);
  return passFileOn(res, pdf, 'template');
}
