import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { KPI_API } from '@/lib/kpi-paths';
import { passSheetOn } from '../../../payroll/files';
import { apiReason, textResponse as text } from '../../../templates/file-response';
import { kpiExcelName, readMonth } from '../../scorecard';

// Serves a month's KPI scorecards as an Excel workbook (owner's brief, 21 October 2026: "All KPIs … every scorecard by
// month with its step, calibration, pillar averages by department, and an Excel export") from the API under the web
// domain, with the caller's session: the browser never talks to the API. The month is the page's (?month=YYYY-MM). The
// API checks the role (HR, the CEO and a Super Admin) and leaves out the C-level people for HR. Links here are plain
// links, never prefetched.

export async function GET(req: Request) {
  const month = readMonth({ month: new URL(req.url).searchParams.get('month') ?? undefined });
  if (!month) return text('Choose the month, e.g. 2026-10.', 400);
  let res: Response;
  try {
    res = await apiFetch(KPI_API.export(month));
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 403) return text('Only HR, the CEO and a Super Admin can download the KPI scorecards.', 403);
  if (res.status === 404) return text('Not available yet: the server does not have the KPI workbook yet.', 404);
  if (res.status === 400) return text(await apiReason(res, 'Choose the month, e.g. 2026-10.'), 400);
  if (!res.ok) return text('The KPI scorecards could not be loaded. Please try again.', 502);
  return passSheetOn(res, kpiExcelName(month)) ?? text('The KPI scorecards could not be loaded. Please try again.', 502);
}
