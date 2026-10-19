import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ActionButton } from '../../../employees/[id]/contracts/contract-buttons';
import { formatDateTime } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import type { YearClosingView } from '@/lib/types';
import { todayInCairo } from '../../../employees/ui';
import { loadJson, notLoadedText } from '../../../payroll/load';
import { BackLink, Empty, Loading } from '../../ui';
import { closeLeaveYear, reopenLeaveYear } from '../actions';
import { editsLeaveSetup, LEAVE_SETUP_HREF, seesYearClosing, yearClosingHref } from '../setup';
import { CLOSING_YEARS, closingDoneText, closingExcludedText, closingYear } from '../year-closing';
import { YearClosingForm } from '../year-closing-form';

// Organization → Leave → Year Closing (owner, 18 October 2026: "make it with decision with the year closing"): a year at
// a time (?year=2026), for HR, who decides, and the CEO, who views it. For each employee with unused annual days, HR
// enters the days carried into the next year and the days paid, which must add up to what is unused (Labour Law Art. 125:
// "لا يجوز للعامل النزول عن إجازته"), the days carried for three years highlighted to be paid now; the pay comes to the
// days × the day rate and is added to the January payroll (or the next one open) as Unused leave paid. Close the year
// saves it: the days carried are the next year's carried in. A closed year shows as decided; HR may open it again until
// its payouts are paid with a payroll. The C-level people are left out for anyone but the CEO and the Super Admin (owner,
// 19 October 2026: "make C level Employees details not visible to HR"): the page says so, and that HR closing the year
// settles theirs by default (the days that must be paid now paid, the rest carried).

export const metadata: Metadata = { title: 'Year Closing · People System' };

function YearNav({ year, now }: { year: number; now: number }) {
  return (
    <nav aria-label="Year" className="flex flex-wrap items-center gap-2">
      {year > CLOSING_YEARS.from && (
        <Link href={yearClosingHref(year - 1)} className="btn btn-secondary min-h-9 px-3 no-underline">
          ← {year - 1}
        </Link>
      )}
      <span aria-current="page" className="px-2 text-lg font-semibold tabular-nums">
        {year}
      </span>
      {year < now && (
        <Link href={yearClosingHref(year + 1)} className="btn btn-secondary min-h-9 px-3 no-underline">
          {year + 1} →
        </Link>
      )}
    </nav>
  );
}

async function Closing({ searchParams }: { searchParams: PageProps<'/organization/leave/year-closing'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!seesYearClosing(user)) return <Empty>Only HR and the CEO see the year closing.</Empty>;
  const today = todayInCairo();
  const year = closingYear(query, today);
  const loaded = await loadJson<YearClosingView>(`/leave/year-closing/${year}`);
  const hr = editsLeaveSetup(user);
  const done = closingDoneText(query, year);

  let body: React.ReactNode;
  if (loaded.kind === 'unavailable') body = <Empty>Not available yet: the server does not have the year closing yet.</Empty>;
  else if (loaded.kind !== 'ok') body = <Empty>{loaded.kind === 'forbidden' ? 'Only HR and the CEO see the year closing.' : notLoadedText(loaded, 'year closing')}</Empty>;
  else {
    const v = loaded.value;
    const yearRunning = year >= Number(today.slice(0, 4));
    const excluded = closingExcludedText(v.confidentialExcluded, year, v.closed);
    body = (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          {v.closed ? <span className="badge bg-ok-soft text-ok">Closed</span> : <span className="badge bg-warn-soft text-warn">Open</span>}
          <p className="text-sm text-muted">
            {v.closed
              ? `Closed${v.closedAt ? ` on ${formatDateTime(v.closedAt)}` : ''}: the days carried are ${year + 1}'s carried in, and the days paid are on the payroll.`
              : yearRunning
                ? `${year} is still running: the unused days shown are as of today, and change with the leave taken until 31 December.`
                : `What each employee had unused at the end of ${year}, with the days carried and paid proposed.`}
          </p>
        </div>
        {excluded && <p className="max-w-3xl text-sm text-muted">{excluded}</p>}
        {v.rows.length === 0 && !(hr && !v.closed && (v.confidentialExcluded ?? 0) > 0) ? (
          <Empty>No one has unused annual days in {year}.</Empty>
        ) : (
          <YearClosingForm
            action={hr && !v.closed ? closeLeaveYear.bind(null, year) : null}
            year={year}
            rows={v.rows}
            closed={v.closed}
            confidentialExcluded={v.confidentialExcluded ?? 0}
          />
        )}
        {/* until its payouts are paid with a payroll (the API's rule) */}
        {hr && v.closed && !v.rows.some((r) => r.payout?.status === 'applied') && (
          <div className="card space-y-3 p-5">
            <h2 className="font-semibold">Open {year} Again</h2>
            <p className="text-sm text-muted">
              While its payouts aren&apos;t paid with a payroll yet, the year can be opened again to change what is carried and paid: the days carried
              into {year + 1} and the payouts are taken back until it is closed again.
            </p>
            <ActionButton action={reopenLeaveYear.bind(null, year)} pendingText="Opening…" confirmText={`Open ${year} again? Its carried days and payouts are taken back until it is closed again.`}>
              Open {year} again
            </ActionButton>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Year Closing of {year}</h2>
        <YearNav year={year} now={Number(today.slice(0, 4))} />
      </div>
      {done && (
        <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
          {done}
        </p>
      )}
      <p className="max-w-3xl text-sm text-muted">
        For each employee, the days carried into {year + 1} and the days paid must add up to the days unused: leave can&apos;t be lost (Art. 125:
        <span lang="ar"> “لا يجوز للعامل النزول عن إجازته”</span>). Days carried for three years are highlighted: they are paid now. A day is paid at the
        gross ÷ the payroll&apos;s day divisor, with the payroll of January {year + 1}, or the next one open.
      </p>
      {body}
    </div>
  );
}

export default function YearClosingPage({ searchParams }: PageProps<'/organization/leave/year-closing'>) {
  return (
    <div className="space-y-4">
      <BackLink href={LEAVE_SETUP_HREF}>Leave Setup</BackLink>
      <Suspense fallback={<Loading />}>
        <Closing searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
