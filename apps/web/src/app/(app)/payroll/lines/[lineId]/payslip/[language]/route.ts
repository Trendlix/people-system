import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { passPdfOn } from '@/lib/protected-pdf';
import { apiReason, textResponse as text } from '../../../../../templates/file-response';
import { apiPayslipPath, isPayslipLanguage, PAYSLIP_PDF_NAME } from '../../../../payslips';

// Serves one employee's payslip for a month, in English or Arabic, from the API under the web domain, with the caller's
// session: the browser never talks to the API (owner's decisions, 16 October 2026). It is a protected PDF, opened in the
// browser's PDF viewer. The API checks the role (HR, Finance, the CEO), and draws the payslip and stores it the first
// time it is asked for (that is how the Arabic one is made). When there is none (the run isn't paid, the employee was on
// hold that month), the API's reason is shown as plain text. Links here are plain links, never prefetched.

const ID = /^[0-9a-f-]{36}$/i;

export async function GET(_req: Request, ctx: RouteContext<'/payroll/lines/[lineId]/payslip/[language]'>) {
  const { lineId, language } = await ctx.params;
  if (!ID.test(lineId) || !isPayslipLanguage(language)) return text('Not found.', 404);

  let res: Response;
  try {
    res = await apiFetch(apiPayslipPath(lineId, language));
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 403) return text('Only HR, Finance and the CEO can open payslips.', 403);
  if (res.status === 404) return text('Not found.', 404);
  // not paid yet, or on hold that month (409), or the PDF converter is down (503): the API says so
  if (res.status === 400 || res.status === 409 || res.status === 422 || res.status === 503) {
    return text(await apiReason(res, 'This payslip could not be made.'), res.status);
  }
  if (!res.ok) return text('This payslip could not be loaded. Please try again.', 502);
  return passPdfOn(res, { download: false, fallbackName: PAYSLIP_PDF_NAME }) ?? text('This payslip could not be loaded. Please try again.', 502);
}
