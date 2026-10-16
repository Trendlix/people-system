import { redirect } from 'next/navigation';
import { readPeriod } from '../salary-raises/salary-raises';
import { todayInCairo } from '../../../employees/ui';
import { ApiError, apiFetch } from '@/lib/api';
import { passSheetOn } from '../../files';
import { apiReason, textResponse as text } from '../../../templates/file-response';
import { apiWorkbookPath } from '../reports';

// Serves the payroll statistics as an Excel workbook (owner, 17 October 2026: "Reports (Statistics)" under Payroll) from
// the API under the web domain, with the caller's session: the browser never talks to the API. The period is the page's
// (?from=&to=, months; this calendar year without them). The API checks the role (HR, Finance and the CEO) and records
// each download. Links here are plain links, never prefetched.

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const period = readPeriod({ from: params.get('from') ?? undefined, to: params.get('to') ?? undefined }, todayInCairo());
  let res: Response;
  try {
    res = await apiFetch(apiWorkbookPath(period));
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 403) return text('Only HR, Finance and the CEO can download the payroll statistics.', 403);
  if (res.status === 404) return text('Not available yet: the server does not have this report yet.', 404);
  if (res.status === 400) return text(await apiReason(res, 'Choose the period as months, e.g. 2026-01 to 2026-12.'), 400);
  if (!res.ok) return text('The payroll statistics could not be loaded. Please try again.', 502);
  return passSheetOn(res, 'Payroll statistics.xlsx') ?? text('The payroll statistics could not be loaded. Please try again.', 502);
}
