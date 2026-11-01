import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Empty, Loading } from '../ui';
import { saveChecklist } from '../../offboarding/actions';
import { loadChecklist, offboardingNotLoaded } from '../../offboarding/data';
import { ChecklistEditor } from '../../offboarding/forms';

// The default clearance checklist (owner, 22 October 2026: the full module; the brief: "The default items: an
// HR-editable list in a small settings section"): the items every new case starts with, after the two the system ticks
// (Assets returned, Final settlement paid), each with who clears it; renamed, moved, removed and added, saved together.
// A change never alters a case already open. HR, the CEO and a Super Admin.

export const metadata: Metadata = { title: 'Clearance Checklist · People System' };

async function Editor({ searchParams }: { searchParams: PageProps<'/organization/clearance-checklist'>['searchParams'] }) {
  const [loaded, query] = await Promise.all([loadChecklist(), searchParams]);
  if (loaded.kind !== 'ok') return <Empty>{offboardingNotLoaded(loaded, 'clearance checklist')}</Empty>;
  return (
    <div className="card space-y-4 p-6">
      {query.saved === '1' && (
        <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
          Saved.
        </p>
      )}
      <ChecklistEditor key={loaded.value.map((i) => i.id).join()} action={saveChecklist} items={loaded.value} />
    </div>
  );
}

// Under Organization since 23 October 2026 (owner: "Check-in Setup, KPI Pillars and deadlines, Recruitment and
// checklists, Templates"), in the setup menu's Hiring & Leaving, which gives the heading.
export default function ClearanceChecklistPage({ searchParams }: PageProps<'/organization/clearance-checklist'>) {
  return (
    <div className="max-w-4xl space-y-6">
      <Suspense fallback={<Loading />}>
        <Editor searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
