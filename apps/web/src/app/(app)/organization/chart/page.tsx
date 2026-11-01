import { Suspense } from 'react';
import { apiGet } from '@/lib/api';
import type { OrgChart } from '@/lib/types';
import { BackLink, Empty, Loading } from '../ui';
import { OrgChartView } from './org-chart-view';

// The company's org chart, drawn from Departments & Job Titles (owner's request, 15 October 2026: "export the company org
// chart from what is made in this page"), to download as a PDF (A4 or A3), a PNG or an SVG, or to print. Everyone who
// can open the Organization section sees it; the people's names only HR, the CEO and Finance (GET /org-chart).

async function Chart() {
  const chart = await apiGet<OrgChart>('/org-chart');
  if (chart.departments.length === 0) {
    return <Empty>No departments yet.</Empty>;
  }
  return <OrgChartView chart={chart} />;
}

export default function OrgChartPage() {
  return (
    <>
      <BackLink href="/organization/departments">Departments & Job Titles</BackLink>
      <h2 className="mt-2 mb-4 text-lg font-semibold">Org Chart</h2>
      <Suspense fallback={<Loading />}>
        <Chart />
      </Suspense>
    </>
  );
}
