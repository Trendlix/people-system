import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { todayInCairo } from '../../../employees/ui';
import { passSheetOn } from '../../../payroll/files';
import { textResponse as text } from '../../../templates/file-response';
import { holidaysYear } from '../holidays';

// Serves the template for importing a year's holidays (owner's request, 16 October 2026: "allow me to import yearly
// holiday list") from the API under the web domain, with the caller's session: the browser never talks to the API.
// ?year= is the year the Holidays tab shows, for the template's example row (this year when it isn't one). The API
// checks the role (HR and Admin, who import). Links here are plain links, never prefetched.

export async function GET(req: Request) {
  const year = holidaysYear(new URL(req.url).searchParams.get('year') ?? undefined, todayInCairo());
  let res: Response;
  try {
    res = await apiFetch(`/payroll/holidays/template.xlsx?year=${year}`);
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 403) return text('Only HR and Admin can import holidays.', 403);
  // a server from before the import
  if (res.status === 404) return text('Not available yet: the server does not have the holidays template yet.', 404);
  if (!res.ok) return text('The template could not be loaded. Please try again.', 502);
  return passSheetOn(res, `Holidays template ${year}.xlsx`) ?? text('The template could not be loaded. Please try again.', 502);
}
