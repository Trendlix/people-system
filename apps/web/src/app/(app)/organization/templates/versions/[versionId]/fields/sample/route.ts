import { PDF_FIELDS_MAX } from '@trendlix/shared';
import { ApiError, apiFetch } from '@/lib/api';
import { passPdfOn } from '@/lib/protected-pdf';
import { apiReason, textResponse as text } from '../../../../file-response';

// Test print, on Place Fields: the fields being placed, saved or not, sent to the API, which fills the form with sample
// values (no one's data) and answers a PDF: shown in the new tab the page's form opened, exactly as the form will
// print. The page posts the fields as a form (`fields`, JSON) so the browser opens the answer itself; JSON is taken
// too. Nothing is saved; the API checks the role (HR, Admin, CEO) and the fields, and its refusal is said as text.

const ID = /^[0-9a-z-]{1,64}$/i;

/** The fields posted: a JSON list under `fields`, from the page's form or a JSON body; null when there is none. */
async function postedFields(req: Request): Promise<unknown[] | null> {
  try {
    const type = req.headers.get('content-type') ?? '';
    const raw = type.includes('application/json') ? ((await req.json()) as { fields?: unknown }).fields : JSON.parse(String((await req.formData()).get('fields') ?? ''));
    return Array.isArray(raw) ? raw : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request, ctx: RouteContext<'/organization/templates/versions/[versionId]/fields/sample'>) {
  const { versionId } = await ctx.params;
  if (!ID.test(versionId)) return text('Not found.', 404);
  const fields = await postedFields(req);
  if (!fields) return text('The fields could not be read. Go back to the page and try again.', 400);
  if (fields.length > PDF_FIELDS_MAX) return text(`A form can have at most ${PDF_FIELDS_MAX} fields.`, 400);

  let res: Response;
  try {
    res = await apiFetch(`/templates/versions/${encodeURIComponent(versionId)}/fields/sample`, { method: 'POST', body: JSON.stringify({ fields }) });
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  // a 303, so that the browser asks for the sign-in page rather than posting to it
  if (res.status === 401) return Response.redirect(new URL('/login', req.url), 303);
  if (res.status === 403) return text('Only HR, Admin and the CEO can test print templates.', 403);
  if (res.status === 404) return text(await apiReason(res, 'Not found.'), 404);
  // a field the API can't print (its reason names it), a Word version, or no PDF tools on the server
  if (res.status === 400 || res.status === 409 || res.status === 503) return text(await apiReason(res, 'There is no test print of this form.'), res.status);
  if (!res.ok) return text('The test print could not be made. Please try again.', 502);
  return passPdfOn(res, { download: false, fallbackName: 'test print.pdf' }) ?? text('The test print could not be made. Please try again.', 502);
}
