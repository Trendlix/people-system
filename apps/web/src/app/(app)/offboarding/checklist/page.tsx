import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BackLink, Empty, Loading } from '../../organization/ui';
import { saveChecklist } from '../actions';
import { loadChecklist, offboardingNotLoaded } from '../data';
import { ChecklistEditor } from '../forms';
import { OFFBOARDING_PATH } from '../offboarding';

// The default clearance checklist (owner, 22 October 2026: the full module; the brief: "The default items: an
// HR-editable list in a small settings section"): the items every new case starts with, after the two the system ticks
// (Assets returned, Final settlement paid), each with who clears it; renamed, moved, removed and added, saved together.
// A change never alters a case already open. HR, the CEO and a Super Admin.

export const metadata: Metadata = { title: 'Clearance Checklist · People System' };

async function Editor({ searchParams }: { searchParams: PageProps<'/offboarding/checklist'>['searchParams'] }) {
  const [loaded, query] = await Promise.all([loadChecklist(), searchParams]);
  if (loaded.kind !== 'ok') return <Empty>{offboardingNotLoaded(loaded, 'clearance checklist')}</Empty>;
  return (
    <div className="card space-y-4 p-6">
      {query.saved === '1' && (
        <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
          Saved. New cases start with this checklist.
        </p>
      )}
      <ChecklistEditor key={loaded.value.map((i) => i.id).join()} action={saveChecklist} items={loaded.value} />
    </div>
  );
}

export default function ClearanceChecklistPage({ searchParams }: PageProps<'/offboarding/checklist'>) {
  return (
    <div className="max-w-4xl space-y-6">
      <BackLink href={OFFBOARDING_PATH}>Offboarding</BackLink>
      <div>
        <h1 className="text-2xl font-semibold">Clearance Checklist</h1>
        <p className="mt-1 max-w-3xl text-muted">
          The items every new offboarding case starts with, after the two the system ticks itself: Assets returned and Final settlement paid. Each is
          cleared by the person in charge of it, or by HR. Cases already open keep their own items; HR can add a one-off item to a case.
        </p>
      </div>
      <Suspense fallback={<Loading />}>
        <Editor searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
