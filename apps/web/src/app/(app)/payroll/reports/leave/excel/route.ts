import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { passSheetOn } from '../../../files';
import { apiReason, textResponse as text } from '../../../../organization/templates/file-response';
import { todayInCairo } from '../../../../employees/ui';
import { apiExcelPath } from '../leave-report';

// Serves the Leave report as an Excel workbook (owner, 26 October 2026: "can i get a report for the monthly leaves with all
// types?") from the API under the web domain, with the caller's session: the browser never talks to the API. The filters
// are the page's (?from=&to=, months, this month without them; department or team, employee). The API checks the role (HR
// and the CEO; never a developer) and records each download. Links here are plain links, never prefetched.

export async function GET(req: Request) {
  let res: Response;
  try {
    res = await apiFetch(apiExcelPath(new URL(req.url).searchParams, todayInCairo()));
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  // the API's own reason: not HR or the CEO, or a developer, who gets no files
  if (res.status === 403) return text(await apiReason(res, 'Only HR and the CEO can download the leave report.'), 403);
  if (res.status === 404) return text('Not available yet: the server does not have this report yet.', 404);
  if (res.status === 400) return text(await apiReason(res, 'Choose the period as months, e.g. 2026-01 to 2026-12.'), 400);
  if (!res.ok) return text('The leave report could not be loaded. Please try again.', 502);
  return passSheetOn(res, 'Leave.xlsx') ?? text('The leave report could not be loaded. Please try again.', 502);
}
