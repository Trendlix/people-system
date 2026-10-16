import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { apiReason, textResponse as text } from '../../../templates/file-response';
import { apiPayslipsZipPath, passZipOn, PAYSLIPS_ZIP_NAME } from '../../payslips';

// Serves all of a paid run's English payslips as one ZIP from the API under the web domain, with the caller's session:
// the browser never talks to the API (owner's decisions, 16 October 2026). The API checks the role (HR, Finance, the
// CEO) and that the run is paid; when it isn't, the API's reason is shown as plain text. Links here are plain links,
// never prefetched.

const ID = /^[0-9a-f-]{36}$/i;

export async function GET(_req: Request, ctx: RouteContext<'/payroll/[id]/payslips'>) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return text('Not found.', 404);

  let res: Response;
  try {
    res = await apiFetch(apiPayslipsZipPath(id));
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 403) return text('Only HR, Finance and the CEO can download payslips.', 403);
  if (res.status === 404) return text('Not found.', 404);
  // not paid yet (409), or the PDF converter is down (503): the API says so
  if (res.status === 400 || res.status === 409 || res.status === 422 || res.status === 503) {
    return text(await apiReason(res, 'The payslips could not be made.'), res.status);
  }
  if (!res.ok) return text('The payslips could not be loaded. Please try again.', 502);
  return passZipOn(res, PAYSLIPS_ZIP_NAME) ?? text('The payslips could not be loaded. Please try again.', 502);
}
