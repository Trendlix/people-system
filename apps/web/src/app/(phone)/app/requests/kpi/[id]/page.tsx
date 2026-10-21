import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ScorecardDetail } from '../../../../../(app)/kpis/scorecards/[id]/scorecard-detail';
import { PhoneLoading } from '../../../ui';

// On the phone pages (owner, 20 October 2026: the employee app): the employee's own KPI scorecard (owner, 21 October
// 2026: "Self, manager, HR, sign-off"), to rate themself and to sign, with every step: the site's page
// (kpis/scorecards/[id]/scorecard-detail.tsx), its back link to the phone pages' My Requests, and what is done on it
// coming back here.

export const metadata: Metadata = { title: 'KPI Scorecard · Trendlix People' };

export default function PhoneRequestsKpiPage({ params, searchParams }: PageProps<'/app/requests/kpi/[id]'>) {
  return (
    <Suspense fallback={<PhoneLoading />}>
      <ScorecardDetail params={params} searchParams={searchParams} surface="requests" />
    </Suspense>
  );
}
