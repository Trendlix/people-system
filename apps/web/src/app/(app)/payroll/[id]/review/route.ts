import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { loadPlaces } from '@/lib/places';
import { hasRole } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import type { PayrollRunView } from '@/lib/types';
import { apiReason, textResponse as text } from '../../../organization/templates/file-response';
import { XLSX } from '../../files';
import { reviewFileName, reviewWorkbook } from '../review-sheet';

// The run's Pay as a spreadsheet to review (owner, 2 November 2026: "i want to export this to review as a super admin
// only"): a Super Admin's only, of the run as the API shows it to them (so the C-level lines only when they see them).
// Made here from the page's own functions (review-sheet.ts). Links here are plain links, never prefetched.

const ID = /^[0-9a-f-]{36}$/i;
const REVIEW_SUPER_ADMIN_ONLY = 'Only a Super Admin can export the payroll for review.';

export async function GET(_req: Request, ctx: RouteContext<'/payroll/[id]/review'>) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return text('Not found.', 404);
  const user = await getCurrentUser();
  if (!hasRole(user, 'super_admin')) return text(REVIEW_SUPER_ADMIN_ONLY, 403);

  let res: Response;
  try {
    res = await apiFetch(`/payroll/runs/${id}`);
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 403) return text(await apiReason(res, 'Only HR, Finance and the CEO can see payroll.'), 403);
  if (res.status === 404) return text('Not found.', 404);
  if (!res.ok) return text('The payroll could not be loaded. Please try again.', 502);
  const [run, places] = await Promise.all([res.json() as Promise<PayrollRunView>, loadPlaces()]);
  const data = await reviewWorkbook(run, places, formatDateTime(new Date()));
  return new Response(new Uint8Array(data), {
    headers: {
      'content-type': XLSX,
      'content-disposition': `attachment; filename="${reviewFileName(run)}"`,
      'cache-control': 'private, no-store',
    },
  });
}
