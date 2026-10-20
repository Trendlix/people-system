import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { passPdfOn, wantsDownload } from '@/lib/protected-pdf';
import { apiReason, textResponse as text } from '../../../../../(app)/templates/file-response';
import { isPayslipLanguage, PAYSLIP_PDF_NAME } from '../../../../../(app)/payroll/payslips';
import { apiMyPayslipPath } from '../../data';

// The employee's own payslip for a month, in English or Arabic (owner, 20 October 2026: the employee app, "My
// attendance and payslips"), from the API under the web domain with the caller's session (GET /me/payslips/:lineId/
// :language): the browser never talks to the API. A protected PDF, opened in the page or (?download=1) saved. Anyone
// else's line isn't found; a run not marked paid yet, or a month on hold, says why in plain text. Never prefetched.

const ID = /^[0-9a-f-]{36}$/i;

export async function GET(req: Request, ctx: RouteContext<'/app/payslips/[lineId]/[language]'>) {
  const { lineId, language } = await ctx.params;
  if (!ID.test(lineId) || !isPayslipLanguage(language)) return text('Not found.', 404);
  const download = wantsDownload(new URL(req.url).searchParams);

  let res: Response;
  try {
    res = await apiFetch(apiMyPayslipPath(lineId, language, download));
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 404) return text('Not found.', 404);
  // not paid yet, or on hold that month (409), or the PDF converter is down (503): the API says so
  if (res.status === 400 || res.status === 409 || res.status === 422 || res.status === 503) {
    return text(await apiReason(res, 'This payslip could not be made.'), res.status);
  }
  if (!res.ok) return text('This payslip could not be loaded. Please try again.', 502);
  return passPdfOn(res, { download, fallbackName: PAYSLIP_PDF_NAME }) ?? text('This payslip could not be loaded. Please try again.', 502);
}
