import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { WFH_SOURCES } from '@trendlix/shared';
import { Select } from '@/components/select';
import type { PlaceRef } from '@/lib/place-groups';
import { loadPlaces } from '@/lib/places';
import { getCurrentUser } from '@/lib/session';
import { Empty, Loading } from '../../organization/ui';
import { monthName } from '../../payroll/list';
import { StaffOnly } from '../../staff-only';
import { notLoaded } from '../not-loaded';
import { loadWfhRequests } from './data';
import { WfhTable } from './ui';
import { emptyWfhText, readWfhQuery, RECORD_WFH_PATH, recordsWfh, seesAllWfh, WFH_FILTERS, WFH_PATH, WFH_SOURCE_LABELS, wfhListHref, type WfhQuery } from './wfh';

// Attendance → Work From Home (owner, 21 October 2026: "think about how should we handle the working from home in out
// erp"; asked, "Manager, then HR", "its 2 days per month with a gap of 1 week between each record (Biweekly)", "A day
// before"): for HR and the CEO, every work from home request and day, those waiting for them first (HR's stage; a
// C-level person's for the CEO), by status (?status=), month (?month=), department or team (?department=) and where it
// came from (?source=: on the system, or imported from Zoho People): who, the day, how it came (asked, recorded by HR,
// imported) with a mark for a day recorded past the notice or the limits, where it stands, each opening its page with
// the decision. HR records a day for someone with Record a WFH day. A manager decides their team's on My Team; an
// employee asks from My Requests.

export const metadata: Metadata = { title: 'Work From Home · People System' };

const chip = 'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold no-underline';
const ACTIVE = 'border-ink bg-ink text-white hover:text-white';
const IDLE = 'border-line bg-white text-ink hover:bg-canvas hover:text-ink';

/** The department filter's choices: each department in Organization's order, then its teams as "Department › Team". */
function placeChoices(places: readonly PlaceRef[]): { id: string; label: string }[] {
  return places
    .filter((p) => p.parentId === null)
    .flatMap((d) => [{ id: d.id, label: d.nameEn }, ...places.filter((t) => t.parentId === d.id).map((t) => ({ id: t.id, label: `${d.nameEn} › ${t.nameEn}` }))]);
}

function Filters({ q, places }: { q: WfhQuery; places: readonly PlaceRef[] }) {
  return (
    <form key={`${q.month}-${q.departmentId}-${q.source}`} action={WFH_PATH} className="flex flex-wrap items-end gap-3">
      {q.filter !== 'waiting' && <input type="hidden" name="status" value={q.filter} />}
      <div className="min-w-44">
        <label htmlFor="wfh-month" className="label">
          Month
        </label>
        <input id="wfh-month" name="month" type="month" defaultValue={q.month ?? ''} className="input" />
      </div>
      <div className="min-w-56">
        <label htmlFor="wfh-department" className="label">
          Department or team
        </label>
        <Select id="wfh-department" name="department" defaultValue={q.departmentId ?? ''} className="input">
          <option value="">Everyone</option>
          {placeChoices(places).map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="min-w-56">
        <label htmlFor="wfh-source" className="label">
          From
        </label>
        <Select id="wfh-source" name="source" defaultValue={q.source ?? ''} className="input">
          <option value="">Anywhere</option>
          {WFH_SOURCES.map((s) => (
            <option key={s} value={s}>
              {WFH_SOURCE_LABELS[s]}
            </option>
          ))}
        </Select>
      </div>
      <button type="submit" className="btn btn-secondary">
        Show
      </button>
      {(q.month || q.departmentId || q.source) && (
        <Link href={wfhListHref({ filter: q.filter })} className="min-h-11 content-center text-sm font-semibold">
          Clear the filters
        </Link>
      )}
    </form>
  );
}

async function List({ searchParams }: { searchParams: PageProps<'/attendance/wfh'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!seesAllWfh(user)) return <Empty>Only HR and the CEO see everyone&apos;s work from home days. A manager decides their team&apos;s on My Team.</Empty>;
  const q = readWfhQuery(query);
  const [loaded, places] = await Promise.all([loadWfhRequests(q), loadPlaces()]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <nav aria-label="Which requests" className="flex flex-wrap gap-2">
          {WFH_FILTERS.map((f) => (
            <Link key={f.value} href={wfhListHref({ ...q, filter: f.value })} aria-current={f.value === q.filter ? 'page' : undefined} className={`${chip} ${f.value === q.filter ? ACTIVE : IDLE}`}>
              {f.label}
            </Link>
          ))}
        </nav>
        {recordsWfh(user) && (
          <Link href={RECORD_WFH_PATH} className="btn btn-primary no-underline">
            Record a WFH day
          </Link>
        )}
      </div>
      <Filters q={q} places={places} />
      {loaded.kind !== 'ok' ? (
        <Empty>{notLoaded(loaded, 'work from home requests')}</Empty>
      ) : loaded.value.length === 0 ? (
        <div className="card px-6 py-8 text-center text-sm text-muted">
          {emptyWfhText(q.filter)}
          {q.month && ` In ${monthName(q.month)}.`}
        </div>
      ) : (
        <WfhTable requests={loaded.value} who how note={q.month ? `in ${monthName(q.month)}, the latest day first.` : 'the latest day first.'} />
      )}
    </div>
  );
}

export default function WfhListPage({ searchParams }: PageProps<'/attendance/wfh'>) {
  return (
    <StaffOnly>
      <div className="max-w-6xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Work From Home</h1>
          <p className="mt-1 max-w-3xl text-muted">
            Days employees work from home instead of the office: a working day, not leave. Asked a day before at the latest, at most the days a month
            Leave Setup gives, a week apart; decided by their direct manager (or lead), then HR, a C-level person&apos;s by the CEO. That day they check
            in from home, without the office network. HR records a day for someone, past the limits too, with a reason.
          </p>
        </div>
        <Suspense fallback={<Loading />}>
          <List searchParams={searchParams} />
        </Suspense>
      </div>
    </StaffOnly>
  );
}
