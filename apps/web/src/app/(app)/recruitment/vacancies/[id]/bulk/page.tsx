import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BackLink, Empty, Loading } from '../../../../organization/ui';
import { loadCvUploads, loadVacancy, recruitmentNotLoaded } from '../../../data';
import { BulkUpload } from '../../../general-forms';
import { vacancyHref } from '../../../recruitment';

// Bulk upload of a vacancy's CVs (owner, 22 October 2026: "is there a way to easy apply from linkedin?" … "why not"):
// the CVs LinkedIn's Easy Apply (or another channel) sends, dropped at once, each read for the name, email and mobile,
// checked by HR row by row, then saved as applications at Applied, the source LinkedIn unless changed. Only while the
// vacancy is open or on hold. The batch waits for a day.

export const metadata: Metadata = { title: 'Bulk Upload CVs · People System' };

async function Bulk({ params }: { params: PageProps<'/recruitment/vacancies/[id]/bulk'>['params'] }) {
  const { id } = await params;
  const loaded = await loadVacancy(id);
  if (loaded.kind !== 'ok') return <Empty>{recruitmentNotLoaded(loaded, 'vacancy')}</Empty>;
  const v = loaded.value;
  const head = (
    <div className="space-y-2">
      <BackLink href={vacancyHref(v.id)}>{v.title}</BackLink>
      <h1 className="text-2xl font-semibold">Bulk Upload CVs</h1>
      <p className="max-w-3xl text-sm text-muted">
        {v.number} · each CV is saved as an application at Applied, after you check the name, email and mobile read from it.
      </p>
    </div>
  );
  if (v.viewer !== 'manages') return <Empty>Only HR and a Super Admin upload CVs.</Empty>;
  if (v.status !== 'open' && v.status !== 'on_hold')
    return (
      <div className="space-y-4">
        {head}
        <Empty>CVs are uploaded to an open vacancy (or one on hold).</Empty>
      </div>
    );
  const target = { kind: 'vacancy', vacancyId: v.id } as const;
  const uploads = await loadCvUploads(target);
  return (
    <div className="space-y-4">
      {head}
      {uploads.kind !== 'ok' ? <Empty>{recruitmentNotLoaded(uploads, 'bulk upload')}</Empty> : <BulkUpload target={target} initial={uploads.value} positions={[]} doneHref={vacancyHref(v.id)} />}
    </div>
  );
}

export default function VacancyBulkPage({ params }: PageProps<'/recruitment/vacancies/[id]/bulk'>) {
  return (
    <div className="max-w-6xl">
      <Suspense fallback={<Loading />}>
        <Bulk params={params} />
      </Suspense>
    </div>
  );
}
