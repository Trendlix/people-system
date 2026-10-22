import { assetExportFileName, isAssetExport } from '@trendlix/shared';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { ASSET_STEP5_API } from '@/lib/asset-paths';
import { todayInCairo } from '../../../employees/ui';
import { passSheetOn } from '../../../payroll/files';
import { textResponse as text } from '../../../templates/file-response';

// Serves an Assets export (Assets step 5; owner, 22 October 2026: "exports"): the asset register, custody records,
// stock moves, maintenance log or counts as an Excel workbook, from the API under the web domain with the caller's
// session, so the browser never talks to the API. The API checks the Assets access, and leaves the money columns out
// for anyone but the CEO, Finance and a Super Admin. Links here are plain links, never prefetched.

export async function GET(_req: Request, { params }: RouteContext<'/assets/exports/[kind]'>) {
  const { kind } = await params;
  if (!isAssetExport(kind)) return text('There is no such export.', 404);
  let res: Response;
  try {
    res = await apiFetch(ASSET_STEP5_API.exportFile(kind));
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 403) return text('You don’t have access to Assets. An Admin gives it on the Users page.', 403);
  if (res.status === 404) return text('Not available yet: the server does not have the Assets exports yet.', 404);
  if (!res.ok) return text('The export could not be made. Please try again.', 502);
  return passSheetOn(res, assetExportFileName(kind, todayInCairo())) ?? text('The export could not be made. Please try again.', 502);
}
