import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { CLevelBadge } from '@/components/c-level-badge';
import { formatDateTime } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { LeaveStatusBadge } from '../../leave/ui';
import { Empty, Loading } from '../../organization/ui';
import { monthName } from '../../payroll/list';
import { notLoaded } from '../not-loaded';
import { StaffOnly } from '../../staff-only';
import {
  CORRECTION_FILTERS,
  correctionDayText,
  correctionHref,
  correctionKindName,
  correctionsLabel,
  correctionsListHref,
  dayBeforeText,
  emptyCorrectionsText,
  readCorrectionQuery,
  rightTimesText,
  seesCorrections,
} from './corrections';
import { loadCorrections } from './data';
import { joinShown } from '@/lib/hidden';

// Attendance → Corrections (owner, 19 October 2026: "Attendance corrections with approval ("I forgot to check out")"):
// for HR and the CEO, every attendance correction, those waiting for them first (HR's stage; a C-level person's for the
// CEO), by status (?status=) and month (?month=): who, the day, what was wrong, what was on record and the right times,
// where it stands, each opening its page with the decision. A manager decides their team's on My Team; an employee asks
// from My Attendance; HR corrects a day directly from the person's month.

export const metadata: Metadata = { title: 'Corrections · People System' };

const chip = 'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold no-underline';
const ACTIVE = 'border-ink bg-ink text-white hover:text-white';
const IDLE = 'border-line bg-white text-ink hover:bg-canvas hover:text-ink';

async function List({ searchParams }: { searchParams: PageProps<'/attendance/corrections'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!seesCorrections(user)) return <Empty>Only HR and the CEO see everyone&apos;s corrections. A manager decides their team&apos;s on My Team.</Empty>;
  const { filter, month } = readCorrectionQuery(query);
  const loaded = await loadCorrections(filter, month);
  return (
    <div className="space-y-4">
      <nav aria-label="Which corrections" className="flex flex-wrap gap-2">
        {CORRECTION_FILTERS.map((f) => (
          <Link
            key={f.value}
            href={correctionsListHref(f.value, month)}
            aria-current={f.value === filter ? 'page' : undefined}
            className={`${chip} ${f.value === filter ? ACTIVE : IDLE}`}
          >
            {f.label}
          </Link>
        ))}
        {month && (
          <Link href={correctionsListHref(filter)} className={`${chip} ${IDLE}`}>
            {monthName(month)} · every month
          </Link>
        )}
      </nav>
      {loaded.kind !== 'ok' ? (
        <Empty>{notLoaded(loaded, 'corrections')}</Empty>
      ) : loaded.value.length === 0 ? (
        <div className="card px-6 py-8 text-center text-sm text-muted">{emptyCorrectionsText(filter)}</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col">Day</th>
                <th scope="col">What Was Wrong</th>
                <th scope="col">On Record</th>
                <th scope="col">Right Times</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {loaded.value.map((c) => (
                <tr key={c.id} className="align-top">
                  <td className="min-w-44">
                    <span className="font-semibold">{c.employee.fullNameEn}</span>
                    {c.confidential && <CLevelBadge title="A C-level person: the CEO decides HR’s stage." className="ml-2" />}
                    <div className="text-xs text-muted">{joinShown([c.employee.employeeCode, c.employee.department])}</div>
                  </td>
                  <td className="whitespace-nowrap tabular-nums">{correctionDayText(c)}</td>
                  <td>{correctionKindName(c.correctionKind)}</td>
                  <td className="whitespace-nowrap tabular-nums text-muted">{dayBeforeText(c.dayBefore)}</td>
                  <td className="whitespace-nowrap tabular-nums">{rightTimesText(c)}</td>
                  <td>
                    <LeaveStatusBadge status={c.status} confidential={c.confidential} />
                    <div className="mt-1 text-xs text-muted">{c.recordedByHr ? 'Corrected by HR' : `Sent ${formatDateTime(c.createdAt)}`}</div>
                  </td>
                  <td className="text-right">
                    <Link href={correctionHref(c.id)} className={`btn min-h-9 px-3 no-underline ${c.waitingForYou ? 'btn-primary' : 'btn-secondary'}`}>
                      {c.waitingForYou ? 'Decide' : 'Open'}
                      <span className="sr-only">
                        {' '}
                        the correction of {correctionDayText(c)} by {c.employee.fullNameEn}
                      </span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-4 py-3 text-sm text-muted">{correctionsLabel(loaded.value.length)}</p>
        </div>
      )}
    </div>
  );
}

export default function CorrectionsPage({ searchParams }: PageProps<'/attendance/corrections'>) {
  return (
    <StaffOnly>
      <div className="max-w-6xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Corrections</h1>
          <p className="mt-1 max-w-3xl text-muted">
            Days employees asked to correct (I forgot to check in or out, a time is wrong, I worked remotely or at a client), decided by their direct
            manager (or lead), then HR; a C-level person&apos;s by the CEO. Approved, the day is corrected, keeping what it was, and the month&apos;s draft
            payroll takes it. HR corrects a day directly from the person&apos;s month.
          </p>
        </div>
        <Suspense fallback={<Loading />}>
          <List searchParams={searchParams} />
        </Suspense>
      </div>
    </StaffOnly>
  );
}
