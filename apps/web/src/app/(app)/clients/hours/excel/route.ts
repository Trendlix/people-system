import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { todayInCairo } from '@/lib/date-picker';
import { passSheetOn } from '../../../payroll/files';
import { apiReason, textResponse as text } from '../../../organization/templates/file-response';
import { apiExcelPath } from '../client-hours';

// Serves Client Hours as an Excel workbook (owner, 4 November 2026: "Full salary, hours tracked"; the client reports): a
// summary by client and person and every line of the month, from the API under the web domain, with the caller's
// session: the browser never talks to the API. The month is the page's (?month=YYYY-MM, this month without it). The API
// checks the role (HR, the CEO, Finance and a Super Admin; never a developer) and records each download. Links here are
// plain links, never prefetched.

export async function GET(req: Request) {
  let res: Response;
  try {
    res = await apiFetch(apiExcelPath(new URL(req.url).searchParams, todayInCairo()));
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  // the API's own reason: not one who reads the client accounts, or a developer, who gets no files
  if (res.status === 403) return text(await apiReason(res, 'Only HR, the CEO, Finance and a Super Admin can download client hours.'), 403);
  if (res.status === 404) return text('Not available yet: the server does not have this report yet.', 404);
  if (res.status === 400) return text(await apiReason(res, 'Choose the month as YYYY-MM, e.g. 2026-11.'), 400);
  if (!res.ok) return text('Client hours could not be loaded. Please try again.', 502);
  return passSheetOn(res, 'Client hours.xlsx') ?? text('Client hours could not be loaded. Please try again.', 502);
}
