import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { passSheetOn } from '../../../files';
import { apiReason, textResponse as text } from '../../../../organization/templates/file-response';
import { apiExcelPath } from '../vs-insurance';

// Serves the Payroll vs Social Insurance report as an Excel workbook (owner, 26 October 2026: "a comparison report between
// the actual payroll run and the social insurance data") from the API under the web domain, with the caller's session: the
// browser never talks to the API. The period is the page's (?from=&to=, months; the latest run's month without them). The
// API checks the role (HR, Finance and the CEO; never a developer) and records each download. Links here are plain links,
// never prefetched.

export async function GET(req: Request) {
  let res: Response;
  try {
    res = await apiFetch(apiExcelPath(new URL(req.url).searchParams));
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  // the API's own reason: not HR, Finance or the CEO, or a developer, who gets no files
  if (res.status === 403) return text(await apiReason(res, 'Only HR, Finance and the CEO can download the payroll vs social insurance report.'), 403);
  if (res.status === 404) return text('Not available yet: the server does not have this report yet.', 404);
  if (res.status === 400) return text(await apiReason(res, 'Choose the period as months, e.g. 2026-01 to 2026-03.'), 400);
  if (!res.ok) return text('The payroll vs social insurance report could not be loaded. Please try again.', 502);
  return passSheetOn(res, 'Payroll vs social insurance.xlsx') ?? text('The payroll vs social insurance report could not be loaded. Please try again.', 502);
}
