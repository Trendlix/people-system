import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { passSheetOn } from '../../../payroll/files';
import { textResponse as text } from '../../../templates/file-response';

// Serves the leave import template (owner, 21 October 2026: "Our Excel template": the system gives a template to
// download, HR fills it and uploads it) from the API under the web domain, with the caller's session: the browser never
// talks to the API. The API checks the role (HR, and the CEO) and lists the employees the caller may see. Links here are
// plain links, never prefetched.

export async function GET() {
  let res: Response;
  try {
    res = await apiFetch('/leave/import/template');
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 403) return text('Only HR imports leave (and the CEO, for C-level people).', 403);
  if (res.status === 404) return text('Not available yet: the server does not have the leave import yet.', 404);
  if (!res.ok) return text('The template could not be loaded. Please try again.', 502);
  return passSheetOn(res, 'Leave import template.xlsx') ?? text('The template could not be loaded. Please try again.', 502);
}
