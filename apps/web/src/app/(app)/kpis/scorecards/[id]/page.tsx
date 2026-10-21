import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '../../../organization/ui';
import { ScorecardDetail } from './scorecard-detail';

// A KPI scorecard (owner, 21 October 2026: "Self, manager, HR, sign-off"): scorecard-detail.tsx, shared with the phone
// pages (owner, 20 October 2026: the employee app), where the employee rates themself and signs, and the manager and HR
// take their steps.

export const metadata: Metadata = { title: 'KPI Scorecard · People System' };

export default function KpiScorecardPage({ params, searchParams }: PageProps<'/kpis/scorecards/[id]'>) {
  return (
    <div className="max-w-6xl">
      <Suspense fallback={<Loading />}>
        <ScorecardDetail params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
