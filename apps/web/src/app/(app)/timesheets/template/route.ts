import { redirect } from 'next/navigation';
import { TIMESHEET_TEMPLATE_NAME } from '@trendlix/shared';
import { ApiError, apiFetch } from '@/lib/api';
import { passSheetOn } from '../../payroll/files';
import { apiReason, textResponse as text } from '../../organization/templates/file-response';
import { TIMESHEET_TEMPLATE_API } from '../timesheets';

// Serves the template for uploading hours (owner, 5 November 2026: "how to upload a bulk time log?"; "Our own Excel
// template") from the API under the web domain, with the caller's session: the browser never talks to the API. The API
// says who gets it (someone on timesheets, with the active clients and themselves; HR, the CEO and a Super Admin, with
// the employees on timesheets they may see). Links here are plain links, never prefetched.

export async function GET() {
  let res: Response;
  try {
    res = await apiFetch(TIMESHEET_TEMPLATE_API);
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  // the API's own reason: not on timesheets, or a developer, who gets no files
  if (res.status === 403) return text(await apiReason(res, 'The template is for those who log hours on a timesheet, and for HR.'), 403);
  if (res.status === 404) return text('Not available yet: the server does not have uploading hours yet.', 404);
  if (!res.ok) return text('The template could not be loaded. Please try again.', 502);
  return passSheetOn(res, TIMESHEET_TEMPLATE_NAME) ?? text('The template could not be loaded. Please try again.', 502);
}
