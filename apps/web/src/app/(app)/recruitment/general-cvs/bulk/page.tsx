import type { Metadata } from 'next';
import { Suspense } from 'react';
import { positionGroups } from '@trendlix/shared';
import { getCurrentUser } from '@/lib/session';
import { BackLink, Empty, Loading } from '../../../organization/ui';
import { loadCvPositionsOrNone, loadCvUploads, recruitmentNotLoaded } from '../../data';
import { tabHref } from '../../general';
import { BulkUpload } from '../../general-forms';
import { managesRecruitment } from '../../recruitment';

// Bulk upload of general CVs (owner, 22 October 2026: "is there a way to easy apply from linkedin?" … "why not"): many
// CVs at once, each read for the name, email and mobile, checked by HR row by row (the source, the position: owner, 25
// October 2026, "Position, grouped by team"), then saved as general CVs. The batch waits for a day.

export const metadata: Metadata = { title: 'Bulk Upload CVs · People System' };

async function Bulk() {
  const user = await getCurrentUser();
  if (!managesRecruitment(user)) return <Empty>Only HR and a Super Admin upload CVs.</Empty>;
  const target = { kind: 'general' } as const;
  const [loaded, { positions }] = await Promise.all([loadCvUploads(target), loadCvPositionsOrNone()]);
  if (loaded.kind !== 'ok') return <Empty>{recruitmentNotLoaded(loaded, 'bulk upload')}</Empty>;
  return <BulkUpload target={target} initial={loaded.value} positions={positionGroups(positions, { withHidden: true })} doneHref={tabHref('general')} />;
}

export default function GeneralBulkPage() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <BackLink href={tabHref('general')}>General CVs</BackLink>
        <h1 className="text-2xl font-semibold">Bulk Upload CVs</h1>
        <p className="max-w-3xl text-sm text-muted">Many CVs at once, kept as general CVs: each is read for the name, email and mobile for you to check.</p>
      </div>
      <Suspense fallback={<Loading />}>
        <Bulk />
      </Suspense>
    </div>
  );
}
