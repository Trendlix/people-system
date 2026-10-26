import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { actionablePeople } from '@/lib/confidential';
import { withCode } from '@/lib/hidden';
import type { PlaceRef } from '@/lib/place-groups';
import { loadPlaces } from '@/lib/places';
import { getCurrentUser } from '@/lib/session';
import type { EmployeeSummary } from '@/lib/types';
import { getOrNull } from '../../approvals/data';
import { Empty, Loading } from '../../organization/ui';
import { StaffOnly } from '../../staff-only';
import { notLoaded } from '../not-loaded';
import { loadCompensatoryRequests } from './data';
import { CompensatoryTable } from './ui';
import { COMPENSATORY_FILTERS, compensatoryDaysText, compensatoryListHref, emptyCompensatoryText, hasCompensatoryFilters, readCompensatoryQuery, RECORD_COMPENSATORY_PATH, recordsCompensatory, seesAllCompensatory } from './compensatory';
import { CompensatoryFiltersForm } from './compensatory-filters-form';

// Attendance → Compensatory Days (owner, 26 October 2026: "my compensatory is a compensation with another day in the same
// month. and rarely to be compensated in cash"): for HR and the CEO, every compensatory day request, those waiting for them
// first (HR's stage; a C-level person's for the CEO), by status chip (?status=), Employee (?employee=), From and To
// (?from=&to=, the day worked's: "add the filter here too, like we made on the other page") and department or team
// (?department=): who, the days, how it came and HR's decision (a day off, or cash instead), where it stands, each
// opening its page with the decision. HR records one for someone with Record a compensatory day. A manager decides their
// team's on My Team; an employee asks from My Requests.

export const metadata: Metadata = { title: 'Compensatory Days · People System' };

const chip = 'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold no-underline';
const ACTIVE = 'border-ink bg-ink text-white hover:text-white';
const IDLE = 'border-line bg-white text-ink hover:bg-canvas hover:text-ink';

/** The department filter's choices: each department in Organization's order, then its teams as "Department › Team". */
function placeChoices(places: readonly PlaceRef[]): { id: string; label: string }[] {
  return places
    .filter((p) => p.parentId === null)
    .flatMap((d) => [{ id: d.id, label: d.nameEn }, ...places.filter((t) => t.parentId === d.id).map((t) => ({ id: t.id, label: `${d.nameEn} › ${t.nameEn}` }))]);
}

async function List({ searchParams }: { searchParams: PageProps<'/attendance/compensatory'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!seesAllCompensatory(user)) return <Empty>Only HR and the CEO see everyone&apos;s compensatory days. A manager decides their team&apos;s on My Team.</Empty>;
  const q = readCompensatoryQuery(query);
  const [loaded, places, directory] = await Promise.all([loadCompensatoryRequests(q), loadPlaces(), getOrNull<EmployeeSummary[]>('/employees')]);
  // the people the user sees (the directory without the C-level cards they can't open), as Leave Requests lists them
  const people = directory
    ? actionablePeople(directory)
        .sort((a, b) => a.fullNameEn.localeCompare(b.fullNameEn, 'en'))
        .map((p) => ({ id: p.id, label: withCode(p.fullNameEn, p.employeeCode) }))
    : null;
  const days = compensatoryDaysText(q);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <nav aria-label="Which requests" className="flex flex-wrap gap-2">
          {COMPENSATORY_FILTERS.map((f) => (
            <Link key={f.value} href={compensatoryListHref({ ...q, filter: f.value })} aria-current={f.value === q.filter ? 'page' : undefined} className={`${chip} ${f.value === q.filter ? ACTIVE : IDLE}`}>
              {f.label}
            </Link>
          ))}
        </nav>
        {recordsCompensatory(user) && (
          <Link href={RECORD_COMPENSATORY_PATH} className="btn btn-primary no-underline">
            Record a compensatory day
          </Link>
        )}
      </div>
      <CompensatoryFiltersForm q={q} people={people} places={placeChoices(places)} filtered={hasCompensatoryFilters(q)} />
      {loaded.kind !== 'ok' ? (
        <Empty>{notLoaded(loaded, 'compensatory day requests')}</Empty>
      ) : loaded.value.length === 0 ? (
        <div className="card px-6 py-8 text-center text-sm text-muted">
          {emptyCompensatoryText(q.filter)}
          {days && ` ${days.charAt(0).toUpperCase()}${days.slice(1)}.`}
        </div>
      ) : (
        <CompensatoryTable requests={loaded.value} who how note={days ? `${days}, the latest day first.` : 'the latest day first.'} />
      )}
    </div>
  );
}

export default function CompensatoryListPage({ searchParams }: PageProps<'/attendance/compensatory'>) {
  return (
    <StaffOnly>
      <div className="max-w-6xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Compensatory Days</h1>
          <p className="mt-1 max-w-3xl text-muted">
            Days off in exchange for a rest day or an official holiday worked, in the same month: asked a day before the day off at the latest,
            decided by the direct manager (or lead), then HR, a C-level person&apos;s by the CEO. HR approves it as a day off, a full paid day, or,
            rarely, as cash instead. HR records one for someone, with a reason.
          </p>
        </div>
        <Suspense fallback={<Loading />}>
          <List searchParams={searchParams} />
        </Suspense>
      </div>
    </StaffOnly>
  );
}
