import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { passSheetOn } from '../../../payroll/files';
import { textResponse as text } from '../../../organization/templates/file-response';

// Serves the Missing Details report as an Excel workbook (owner's request, 16 October 2026) from the API under the web
// domain, with the caller's session: the browser never talks to the API. Everyone with something missing, one row
// each, and each missing item on a sheet of its own. The API checks the role (HR and the CEO). Links here are plain
// links, never prefetched.

export async function GET() {
  let res: Response;
  try {
    res = await apiFetch('/employees/missing.xlsx');
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 403) return text('Only HR and the CEO can download the missing details.', 403);
  // a server from before the report takes "missing.xlsx" for a profile's id
  if (res.status === 400 || res.status === 404) return text('Not available yet: the server does not have this report yet.', 404);
  if (!res.ok) return text('The missing details could not be loaded. Please try again.', 502);
  return passSheetOn(res, 'Missing details.xlsx') ?? text('The missing details could not be loaded. Please try again.', 502);
}
