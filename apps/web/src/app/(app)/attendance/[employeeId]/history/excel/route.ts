import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { historyApiExcelPath, readHistoryQuery } from '../../../../employees/[id]/attendance/history';
import { passSheetOn } from '../../../../payroll/files';
import { apiReason, textResponse as text } from '../../../../organization/templates/file-response';

// Serves a person's attendance history as an Excel workbook (owner, 23 October 2026: "Attendance history on the
// profile … an Excel export") from the API under the web domain, with the caller's session: the browser never talks to
// the API. The period is the Attendance tab's (?period=, a custom range's ?from=&to=; this month without them): the
// figures, the on-time trend and every day of it. The API decides who (HR, the CEO, Finance and the Super Admin; a
// C-level person's the CEO and the Super Admin; never a developer) and records each download, so links here are plain
// links, never prefetched.

const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(req: Request, ctx: RouteContext<'/attendance/[employeeId]/history/excel'>) {
  const { employeeId } = await ctx.params;
  if (!UUID.test(employeeId)) return text('Not found.', 404);
  const query = readHistoryQuery(Object.fromEntries(new URL(req.url).searchParams.entries()));
  let res: Response;
  try {
    res = await apiFetch(historyApiExcelPath(employeeId, query));
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 403) return text(await apiReason(res, 'The attendance history’s Excel isn’t open to you.'), 403);
  if (res.status === 404) return text('Not found: only HR, the CEO, Finance and the Super Admin download a person’s attendance history.', 404);
  if (res.status === 400) return text(await apiReason(res, 'Choose the period again, e.g. a custom range’s first and last day.'), 400);
  if (!res.ok) return text('The attendance history could not be loaded. Please try again.', 502);
  return passSheetOn(res, 'Attendance history.xlsx') ?? text('The attendance history could not be loaded. Please try again.', 502);
}
