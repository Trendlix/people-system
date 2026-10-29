import type { Metadata } from 'next';
import { Suspense } from 'react';
import { positionGroups } from '@trendlix/shared';
import { getCurrentUser } from '@/lib/session';
import { BackLink, Empty, Loading } from '../../../organization/ui';
import { loadCvPositionsOrNone, loadCvUploads, loadVacancies, recruitmentNotLoaded } from '../../data';
import { readBulkTarget, tabHref, vacancyChoices } from '../../general';
import { BulkUpload } from '../../general-forms';
import { managesRecruitment } from '../../recruitment';

// Bulk upload of CVs from the Applicants page (owner, 22 October 2026: "is there a way to easy apply from linkedin?" …
// "why not"): many CVs at once, each read for the name, email and mobile, checked by HR row by row (the source, the
// position: owner, 25 October 2026, "Position, grouped by team"), then saved as general CVs. The batch waits for a day.
// Since 29 October 2026 (owner: "when uploading bulk CVs, allow me to add them to an open vacancy directly as a bulk"),
// Save to sends the whole batch to an open vacancy (or one on hold) instead, saved there as applications at Applied, as a
// vacancy's own bulk upload does; ?vacancy= names it, so a refresh finds the batch there.

export const metadata: Metadata = { title: 'Bulk Upload CVs · People System' };

async function Bulk({ searchParams }: { searchParams: PageProps<'/recruitment/general-cvs/bulk'>['searchParams'] }) {
  const user = await getCurrentUser();
  if (!managesRecruitment(user)) return <Empty>Only HR and a Super Admin upload CVs.</Empty>;
  const [query, vacancies, { positions }] = await Promise.all([searchParams, loadVacancies({ status: 'active', q: '' }), loadCvPositionsOrNone()]);
  // without the vacancies, the batch still goes to the general CVs
  const destinations = vacancies.kind === 'ok' ? vacancyChoices(vacancies.value) : [];
  const target = readBulkTarget(query, destinations);
  const loaded = await loadCvUploads(target);
  if (loaded.kind !== 'ok') return <Empty>{recruitmentNotLoaded(loaded, 'bulk upload')}</Empty>;
  return <BulkUpload target={target} initial={loaded.value} positions={positionGroups(positions, { withHidden: true })} destinations={destinations} />;
}

export default function GeneralBulkPage({ searchParams }: PageProps<'/recruitment/general-cvs/bulk'>) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <BackLink href={tabHref('general')}>General CVs</BackLink>
        <h1 className="text-2xl font-semibold">Bulk Upload CVs</h1>
        <p className="max-w-3xl text-sm text-muted">
          Many CVs at once, saved as general CVs or added to an open vacancy as applications: each is read for the name, email and mobile for you to check.
        </p>
      </div>
      <Suspense fallback={<Loading />}>
        <Bulk searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
