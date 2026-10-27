import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { apiReason, textResponse as text } from '../../../../organization/templates/file-response';
import { todayInCairo } from '../../../../employees/ui';
import { apiFilePath, FALLBACK_NAMES, isFileKind, passSheetOn, valueDateFrom } from '../../../files';

// Serves a run's Excel files from the API under the web domain, with the caller's session: the browser never talks to
// the API. The payroll register (any status), and once the CEO approved the run the bank files: CIB's Payroll System
// file (?valueDate=, typed as DD/MM/YYYY; today when none) and the ACH file. The API checks the role (HR, Finance, the
// CEO) and the status, and records each bank file made. When a file can't be made (the run isn't approved, the
// company's CIB account isn't set), the API's reason is shown as plain text. Links here are plain links, never
// prefetched.

const ID = /^[0-9a-f-]{36}$/i;

export async function GET(req: Request, ctx: RouteContext<'/payroll/[id]/files/[kind]'>) {
  const { id, kind } = await ctx.params;
  if (!ID.test(id) || !isFileKind(kind)) return text('Not found.', 404);
  const valueDate = kind === 'cib' ? valueDateFrom(new URL(req.url).searchParams.get('valueDate'), todayInCairo()) : null;
  if (kind === 'cib' && !valueDate) return text('Enter the value date as DD/MM/YYYY, e.g. 16/10/2026.', 400);

  let res: Response;
  try {
    res = await apiFetch(apiFilePath(id, kind, valueDate));
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  // the ETA file is refused, with the API's reason, to someone who doesn't see everyone's pay: it reports all of it
  if (res.status === 403) {
    return text(kind === 'eta' ? await apiReason(res, 'Only HR, Finance and the CEO can download payroll files.') : 'Only HR, Finance and the CEO can download payroll files.', 403);
  }
  if (res.status === 404) return text('Not found.', 404);
  if (res.status === 400 || res.status === 409 || res.status === 422 || res.status === 503) {
    return text(await apiReason(res, 'This file could not be made.'), res.status);
  }
  if (!res.ok) return text('This file could not be loaded. Please try again.', 502);
  return passSheetOn(res, FALLBACK_NAMES[kind]) ?? text('This file could not be loaded. Please try again.', 502);
}
