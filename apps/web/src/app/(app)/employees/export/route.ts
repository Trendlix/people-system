import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { textResponse as text } from '../../organization/templates/file-response';
import { passSheetOn } from '../../payroll/files';
import { todayInCairo } from '../ui';

// The chosen people of the Employees list as a spreadsheet (owner, 1 November 2026: bulk actions, "Export & message"),
// from the API under the web domain with the caller's session. The API checks who may and leaves out the C-level
// people hidden from them.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const ids = (new URL(req.url).searchParams.get('ids') ?? '').split(',').filter((x) => UUID.test(x));
  if (!ids.length) return text('Choose the people to export first.', 400);
  let res: Response;
  try {
    res = await apiFetch(`/employees/bulk/export.xlsx?ids=${ids.join(',')}`);
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 403) return text('You can’t export employees.', 403);
  if (res.status === 404) return text('Not available yet: the server doesn’t have this export yet.', 404);
  if (!res.ok) return text('The export could not be made. Please try again.', 502);
  return passSheetOn(res, `Employees ${todayInCairo()}.xlsx`) ?? text('The export could not be made. Please try again.', 502);
}
