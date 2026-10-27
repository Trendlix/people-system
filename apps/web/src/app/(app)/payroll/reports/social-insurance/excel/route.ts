import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { passSheetOn } from '../../../files';
import { apiReason, textResponse as text } from '../../../../organization/templates/file-response';
import { todayInCairo } from '../../../../employees/ui';
import { apiExcelPath } from '../social-insurance';

// Serves a view of the Social Insurance report as an Excel workbook (owner, 27 October 2026: "is there a report for the
// social insurance? to be filled from the social insurance tab"; he chose all three, each to download) from the API under
// the web domain, with the caller's session: the browser never talks to the API. The view and its filters are the page's
// (?view=register|contributions|missing, ?department=, the register's ?status=, the month's ?month=). The API checks the
// role (HR, Finance and the CEO; the missing data HR and the CEO; never a developer) and records each download. Links
// here are plain links, never prefetched.

export async function GET(req: Request) {
  let res: Response;
  try {
    res = await apiFetch(apiExcelPath(new URL(req.url).searchParams, todayInCairo()));
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  // the API's own reason: not HR, Finance or the CEO (the missing data: not HR or the CEO), or a developer, who gets no files
  if (res.status === 403) return text(await apiReason(res, 'Only HR, Finance and the CEO can download the social insurance report.'), 403);
  if (res.status === 404) return text('Not available yet: the server does not have this report yet.', 404);
  if (res.status === 400) return text(await apiReason(res, 'Choose the month as a month, e.g. 2026-10, and the department from the list.'), 400);
  if (!res.ok) return text('The social insurance report could not be loaded. Please try again.', 502);
  return passSheetOn(res, 'Social insurance.xlsx') ?? text('The social insurance report could not be loaded. Please try again.', 502);
}
