import { ApiError, apiFetch } from '@/lib/api';
import { apiReason } from '../../../templates/file-response';
import { UUID } from '../../actions-common';

// The figures the Labour Law's limits are checked with for one employee (owner, 18 October 2026, after reading the law:
// "Block above 10%", "Warn above 25%, record the consent"), for Unsettled's record form and Recurring Deductions' forms,
// read when HR chooses the employee: their current contract's monthly gross, the limit on installments, their
// installments already planned or applied per month, about what the gross comes to in tax and insurance, and their
// recurring deductions not ended (GET /payroll/advances/limit). Answers JSON: those figures, or { message } with the API's reason.
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
