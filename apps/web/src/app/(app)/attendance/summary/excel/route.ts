import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { todayInCairo } from '../../../employees/ui';
import { passSheetOn } from '../../../payroll/files';
import { apiReason, textResponse as text } from '../../../organization/templates/file-response';
import { apiSummaryExcelPath, readSummaryPeriod } from '../../attendance';

// Serves the attendance Summary as an Excel workbook (owner's brief, 19 October 2026: "Summary … with Excel export, like
// the other reports") from the API under the web domain, with the caller's session: the browser never talks to the API.
// The period is the page's (?month=, or ?from=&to=; this month without them). The API checks the role (HR, the CEO and
// Finance) and records each download. Links here are plain links, never prefetched.

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const period = readSummaryPeriod(Object.fromEntries(params.entries()), todayInCairo());
  let res: Response;
  try {
    res = await apiFetch(apiSummaryExcelPath(period));
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 403) return text('Only HR, Finance and the CEO can download the attendance summary.', 403);
  if (res.status === 404) return text('Not available yet: the server does not have this report yet.', 404);
  if (res.status === 400) return text(await apiReason(res, 'Choose the months as YYYY-MM, e.g. 2026-10.'), 400);
  if (!res.ok) return text('The attendance summary could not be loaded. Please try again.', 502);
  return passSheetOn(res, 'Attendance.xlsx') ?? text('The attendance summary could not be loaded. Please try again.', 502);
}
