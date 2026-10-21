import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ScorecardDetail } from '../../../../../(app)/kpis/scorecards/[id]/scorecard-detail';
import { PhoneLoading } from '../../../ui';

// On the phone pages (owner, 20 October 2026: the employee app, "managers and team leads approve from the phone"): a KPI
// scorecard waiting for the caller (owner, 21 October 2026: "Self, manager, HR, sign-off"), the manager's scoring, HR's
// calibration or the manager's sign-off, with every step: the site's page (kpis/scorecards/[id]/scorecard-detail.tsx),
// its back link to the phone pages' To Approve, and what is done on it coming back here.

export const metadata: Metadata = { title: 'KPI Scorecard · Trendlix People' };

export default function PhoneApproveKpiPage({ params, searchParams }: PageProps<'/app/approve/kpi/[id]'>) {
  return (
    <Suspense fallback={<PhoneLoading />}>
      <ScorecardDetail params={params} searchParams={searchParams} surface="approve" />
    </Suspense>
  );
}
