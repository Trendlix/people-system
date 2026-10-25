import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { KPI_PRACTICE_BANNER, KPI_PRACTICE_NOTE, kpiMonthName, type KpiPracticeRow } from '@trendlix/shared';
import { DeleteForm } from '@/components/form';
import { KPI_PATHS } from '@/lib/kpi-paths';
import { canDelete } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { Empty, Loading } from '../../../organization/ui';
import { kpiNotLoaded, loadPracticeChoices, loadPracticeRows } from '../../data';
import { deletedText, practiceLabel, rowTemplateText, seesKpiPractice, startedText } from '../../practice';
import { deleteAllPractice, deletePractice, startPractice } from '../../practice-actions';
import { AllKpisTabs, PracticeBadge, StatusBadge } from '../../ui';
import { DeleteAllPracticeForm } from './delete-all-form';
import { StartPracticeForm } from './start-form';
import { joinShown, shownCode } from '@/lib/hidden';

// Practice scorecards (owner, 22 October 2026: "i want to test the KPI's .. and it is locked to dates, HR and Admin..
// how?", choosing "Practice scorecards"): All KPIs' Practice tab, for HR and the Super Admin. "Start a practice
// scorecard" for anyone HR may see (never a C-level person for HR), any month from their join date to this one, from
// their job title's draft or a published version; then every practice scorecard: whose, which month, the version (a
// draft marked), where it stands, who started it and when, each opening on its page, where its starter (or a Super
// Admin) takes every step. Only a Super Admin deletes one, or all of them (optionally only their own). None of them is
// counted anywhere: not in payroll, the figures, the Excel or anyone's waiting lists, and nobody is told of them.

export const metadata: Metadata = { title: 'Practice Scorecards · People System' };

/** The practice scorecards, newest started first, each with the way in and (a Super Admin) Delete. */
function PracticeList({ rows, deletes }: { rows: KpiPracticeRow[]; deletes: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Employee</th>
            <th scope="col">Month</th>
            <th scope="col">Template</th>
            <th scope="col">Step</th>
            <th scope="col">Started</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="align-top">
              <td className="min-w-48">
                <Link href={KPI_PATHS.scorecard(r.id)} className="font-semibold">
                  {r.employee.fullNameEn}
                </Link>
                <PracticeBadge className="ml-1.5" />
                <span className="block text-xs text-muted">{joinShown([r.jobTitle, r.department]) || shownCode(r.employee.employeeCode)}</span>
              </td>
              <td className="whitespace-nowrap">{kpiMonthName(r.month)}</td>
              <td className="whitespace-nowrap">
                {rowTemplateText(r)}
                {r.template.draft && <span className="ml-1.5 badge">Draft</span>}
              </td>
              <td className="min-w-36">
                <StatusBadge status={r.status} scorer={r.scorer} />
              </td>
              <td className="min-w-44 text-xs">
                {startedText(r)}
                {r.mine && <span className="block text-muted">Yours</span>}
              </td>
              <td className="text-right">
                <div className="flex flex-wrap items-start justify-end gap-2">
                  <Link href={KPI_PATHS.scorecard(r.id)} className="btn btn-primary min-h-9 px-3 whitespace-nowrap no-underline">
                    Open<span className="sr-only"> the practice scorecard of {r.employee.fullNameEn}</span>
                  </Link>
                  {deletes && (
                    <DeleteForm
                      action={deletePractice.bind(null, r.id)}
                      confirmText={`Delete the practice scorecard of ${r.employee.fullNameEn} for ${kpiMonthName(r.month)}? Nothing real changes.`}
                    />
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function Practice({ searchParams }: { searchParams: PageProps<'/kpis/all/practice'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!seesKpiPractice(user)) return <Empty>Only HR, the CEO and a Super Admin start and see practice scorecards.</Empty>;
  const [rows, choices] = await Promise.all([loadPracticeRows(), loadPracticeChoices()]);
  const deletes = canDelete(user);
  const deleted = deletedText(query);
  return (
    <div className="space-y-6">
      <AllKpisTabs current="practice" />
      <div role="note" className="rounded-lg border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn">
        <p className="font-semibold">{KPI_PRACTICE_BANNER}</p>
        <p className="mt-0.5">{KPI_PRACTICE_NOTE}</p>
      </div>
      {deleted && (
        <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
          {deleted}
        </p>
      )}

      <section aria-labelledby="practice-start" className="space-y-3">
        <h2 id="practice-start" className="text-lg font-semibold">
          Start a Practice Scorecard
        </h2>
        {choices.kind === 'ok' ? <StartPracticeForm choices={choices.value} action={startPractice} /> : <Empty>{kpiNotLoaded(choices, 'people to choose from')}</Empty>}
      </section>

      <section aria-labelledby="practice-list" className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
          <h2 id="practice-list" className="font-semibold">
            Practice Scorecards
          </h2>
          {deletes && rows.kind === 'ok' && rows.value.length > 0 && (
            <DeleteAllPracticeForm action={deleteAllPractice} total={rows.value.length} mine={rows.value.filter((r) => r.mine).length} />
          )}
        </div>
        <div className="mt-3">
          {rows.kind !== 'ok' ? (
            <p className="px-5 pb-5 text-sm text-muted">{kpiNotLoaded(rows, 'practice scorecards')}</p>
          ) : rows.value.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted">No practice scorecards yet. Start one above to try the steps today.</p>
          ) : (
            <>
              <PracticeList rows={rows.value} deletes={deletes} />
              <p className="border-t border-line px-5 py-3 text-sm text-muted">{practiceLabel(rows.value.length)}, newest first.</p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

export default function PracticeScorecardsPage({ searchParams }: PageProps<'/kpis/all/practice'>) {
  return (
    <div className="max-w-7xl">
      <h1 className="text-2xl font-semibold">Practice Scorecards</h1>
      <p className="mt-1 text-muted">
        Try the whole KPI flow today: start a practice scorecard for anyone and any month, from a draft or a published template, then take every step
        yourself (the self-rating, the manager&apos;s scoring, HR&apos;s calibration and the sign-off), or view as the person and act as them.
      </p>
      <div className="mt-6">
        <Suspense fallback={<Loading />}>
          <Practice searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
