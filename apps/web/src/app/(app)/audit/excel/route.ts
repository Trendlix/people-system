import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { passSheetOn } from '../../payroll/files';
import { apiReason, textResponse as text } from '../../templates/file-response';
import { apiExportPathOf } from '../audit';

// Serves the Audit Log as an Excel workbook (owner, 19 October 2026: "an Audit Log page showing who changed what and
// when") from the API under the web domain, with the caller's session: the browser never talks to the API. The filters
// are the page's (?from=&to=&user=&action=&type=&record=&employee=&q=): the newest 10,000 entries that match. The API
// checks the role (the Super Admin and the CEO) and records each download. Links here are plain links, never prefetched.

export async function GET(req: Request) {
  let res: Response;
  try {
    res = await apiFetch(apiExportPathOf(new URL(req.url).searchParams));
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 403) return text('Only the Super Admin and the CEO can export the audit log.', 403);
  if (res.status === 400) return text(await apiReason(res, 'Check the filters, then export again.'), 400);
  if (res.status === 404) return text(await apiReason(res, 'Not available yet: the server does not have the audit log yet.'), 404);
  if (!res.ok) return text('The audit log could not be exported. Please try again.', 502);
  return passSheetOn(res, 'Audit log.xlsx') ?? text('The audit log could not be exported. Please try again.', 502);
}
