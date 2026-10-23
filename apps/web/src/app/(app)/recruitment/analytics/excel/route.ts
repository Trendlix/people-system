import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { todayInCairo } from '../../../employees/ui';
import { passSheetOn } from '../../../payroll/files';
import { apiReason, textResponse as text } from '../../../organization/templates/file-response';
import { analyticsSearch, readAnalyticsQuery } from '../../hiring';

// Serves the recruitment analytics as an Excel workbook (Phase 2, owner, 22 October 2026) from the API under the web
// domain, with the caller's session: the browser never talks to the API. The API checks the role (HR, the CEO and a
// Super Admin) and records each download.

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const q = readAnalyticsQuery(Object.fromEntries(params.entries()), todayInCairo());
  let res: Response;
  try {
    res = await apiFetch(`/recruitment/analytics/export${analyticsSearch(q)}`);
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 403) return text('Only HR, the CEO and a Super Admin can download the recruitment analytics.', 403);
  if (res.status === 404) return text('Not available yet: the server does not have this report yet.', 404);
  if (res.status === 400) return text(await apiReason(res, 'Choose a year, e.g. 2026.'), 400);
  if (!res.ok) return text('The recruitment analytics could not be loaded. Please try again.', 502);
  return passSheetOn(res, `Recruitment ${q.year}.xlsx`) ?? text('The recruitment analytics could not be loaded. Please try again.', 502);
}
