import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { passSheetOn } from '../../../files';
import { apiReason, textResponse as text } from '../../../../organization/templates/file-response';
import { todayInCairo } from '../../../../employees/ui';
import { apiExcelPath } from '../salary-raises';

// Serves the Salary Raises report as an Excel workbook (owner's decision, 16 October 2026) from the API under the web
// domain, with the caller's session: the browser never talks to the API. The period is the page's (?from=&to=, months;
// this calendar year without them): the raises, by department, and who is due for review. The API checks the role (HR,
// Finance and the CEO) and records each download. Links here are plain links, never prefetched.

export async function GET(req: Request) {
  let res: Response;
  try {
    res = await apiFetch(apiExcelPath(new URL(req.url).searchParams, todayInCairo()));
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 403) return text('Only HR, Finance and the CEO can download the salary raises.', 403);
  if (res.status === 404) return text('Not available yet: the server does not have this report yet.', 404);
  if (res.status === 400) return text(await apiReason(res, 'Choose the period as months, e.g. 2026-01 to 2026-12.'), 400);
  if (!res.ok) return text('The salary raises could not be loaded. Please try again.', 502);
  return passSheetOn(res, 'Salary raises.xlsx') ?? text('The salary raises could not be loaded. Please try again.', 502);
}
