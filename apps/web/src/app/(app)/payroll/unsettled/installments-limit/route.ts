import { ApiError, apiFetch } from '@/lib/api';
import { apiReason } from '../../../templates/file-response';
import { UUID } from '../../actions-common';

// The share-of-pay warning's figures for one employee (owner, 18 October 2026: a warning, never a block, when a
// month's installments pass the share of the pay set in Payroll Setup), for Unsettled's record form, read when HR
// chooses the employee: their current contract's monthly gross, the percent, and their installments already planned or
// applied per month (GET /payroll/advances/limit). Answers JSON: those figures, or { message } with the API's reason.
// The API checks the role (HR, Finance and the CEO, as salaries).

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });

export async function GET(req: Request) {
  const employeeId = new URL(req.url).searchParams.get('employeeId') ?? '';
  if (!UUID.test(employeeId)) return json({ message: 'Choose the employee.' }, 400);

  let res: Response;
  try {
    res = await apiFetch(`/payroll/advances/limit?employeeId=${encodeURIComponent(employeeId)}`);
  } catch (err) {
    if (err instanceof ApiError) return json({ message: err.message }, err.status);
    throw err;
  }
  if (res.status === 401) return json({ message: 'Your session has ended. Reload the page to sign in again.' }, 401);
  if (res.status === 403) return json({ message: 'Only HR, Finance and the CEO can see the pay.' }, 403);
  if (!res.ok) return json({ message: await apiReason(res, 'The pay could not be loaded.') }, res.status === 404 ? 404 : 502);
  try {
    return json(await res.json());
  } catch {
    return json({ message: 'The server sent an answer that could not be read.' }, 502);
  }
}
