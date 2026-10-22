import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BackLink, Empty, Loading } from '../../organization/ui';
import { ChecklistEditor } from '../../offboarding/forms';
import { saveOnboardingChecklist } from '../actions';
import { loadOnboardingDefaults, onboardingNotLoaded } from '../data';
import { ONBOARDING_PATH } from '../onboarding';

// The default onboarding items (owner, 22 October 2026, the ATS's Phase 2; the brief: "Default items (HR-editable, like
// offboarding's clearance defaults), each with an owner role"): the items every new checklist starts with, after the
// three the system ticks; renamed, moved, removed and added, saved together. A change never alters a checklist already
// open. HR, the CEO and a Super Admin.

export const metadata: Metadata = { title: 'Onboarding Checklist · People System' };

async function Editor({ searchParams }: { searchParams: PageProps<'/onboarding/checklist'>['searchParams'] }) {
  const [loaded, query] = await Promise.all([loadOnboardingDefaults(), searchParams]);
  if (loaded.kind !== 'ok') return <Empty>{onboardingNotLoaded(loaded, 'onboarding checklist')}</Empty>;
  return (
    <div className="card space-y-4 p-6">
      {query.saved === '1' && (
        <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
          Saved. New checklists start with these items.
        </p>
      )}
      <ChecklistEditor key={loaded.value.map((i) => i.id).join()} action={saveOnboardingChecklist} items={loaded.value} />
    </div>
  );
}

export default function OnboardingDefaultsPage({ searchParams }: PageProps<'/onboarding/checklist'>) {
  return (
    <div className="max-w-4xl space-y-6">
      <BackLink href={ONBOARDING_PATH}>Onboarding</BackLink>
      <div>
        <h1 className="text-2xl font-semibold">Onboarding Checklist</h1>
        <p className="mt-1 max-w-3xl text-muted">
          The items every new onboarding checklist starts with, after the three the system ticks itself: Contract signed, KPI template in place and Equipment
          handed over. Each is cleared by the person in charge of it, or by HR. Checklists already open keep their own items.
        </p>
      </div>
      <Suspense fallback={<Loading />}>
        <Editor searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
