import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Select } from '@/components/select';
import type { PlaceRef } from '@/lib/place-groups';
import { loadPlaces } from '@/lib/places';
import { getCurrentUser } from '@/lib/session';
import { Empty, Loading } from '../../organization/ui';
import { monthName } from '../../payroll/list';
import { StaffOnly } from '../../staff-only';
import { notLoaded } from '../not-loaded';
import { loadOdRequests } from './data';
import { emptyOdText, OD_FILTERS, OD_PATH, odListHref, readOdQuery, seesAllOd, type OdQuery } from './od';
import { OdTable } from './ui';

// Attendance → Official Duty (owner, 23 October 2026: "Official duty (OD) requests. The plan has OD as a third
// attendance mode beside Office and WFH, needing an approved request"; asked, "Manager, then HR", "Ahead or up to 3
// days after"): for HR and the CEO, every official duty request, those waiting for them first (HR's stage; a C-level
// person's for the CEO), by status (?status=), month (?month=: those with a day in it), department or team
// (?department=) and those asked after their first day (?late=1): who, the days and hours, where, a mark for one
// requested after, where it stands, each opening its page with the decision. A manager decides their team's on My
// Team; an employee asks from My Requests. Working from home has no Excel, so neither has this list.

export const metadata: Metadata = { title: 'Official Duty · People System' };

const chip = 'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold no-underline';
const ACTIVE = 'border-ink bg-ink text-white hover:text-white';
const IDLE = 'border-line bg-white text-ink hover:bg-canvas hover:text-ink';

/** The department filter's choices: each department in Organization's order, then its teams as "Department › Team". */
function placeChoices(places: readonly PlaceRef[]): { id: string; label: string }[] {
  return places
    .filter((p) => p.parentId === null)
    .flatMap((d) => [{ id: d.id, label: d.nameEn }, ...places.filter((t) => t.parentId === d.id).map((t) => ({ id: t.id, label: `${d.nameEn} › ${t.nameEn}` }))]);
}

function Filters({ q, places }: { q: OdQuery; places: readonly PlaceRef[] }) {
  return (
    <form key={`${q.month}-${q.departmentId}-${q.late}`} action={OD_PATH} className="flex flex-wrap items-end gap-3">
      {q.filter !== 'waiting' && <input type="hidden" name="status" value={q.filter} />}
      <div className="min-w-44">
        <label htmlFor="od-month" className="label">
          Month
        </label>
        <input id="od-month" name="month" type="month" defaultValue={q.month ?? ''} className="input" />
      </div>
      <div className="min-w-56">
        <label htmlFor="od-department" className="label">
          Department or team
        </label>
        <Select id="od-department" name="department" defaultValue={q.departmentId ?? ''} className="input">
          <option value="">Everyone</option>
          {placeChoices(places).map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      </div>
      <label className="inline-flex min-h-11 items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="late" value="1" defaultChecked={q.late} className="size-4 accent-accent" />
        Requested after only
      </label>
      <button type="submit" className="btn btn-secondary">
        Show
      </button>
      {(q.month || q.departmentId || q.late) && (
        <Link href={odListHref({ filter: q.filter })} className="min-h-11 content-center text-sm font-semibold">
          Clear the filters
        </Link>
      )}
    </form>
  );
}

async function List({ searchParams }: { searchParams: PageProps<'/attendance/official-duty'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!seesAllOd(user)) return <Empty>Only HR and the CEO see everyone&apos;s official duty. A manager decides their team&apos;s on My Team.</Empty>;
  const q = readOdQuery(query);
  const [loaded, places] = await Promise.all([loadOdRequests(q), loadPlaces()]);
  return (
    <div className="space-y-4">
      <nav aria-label="Which requests" className="flex flex-wrap gap-2">
        {OD_FILTERS.map((f) => (
          <Link key={f.value} href={odListHref({ ...q, filter: f.value })} aria-current={f.value === q.filter ? 'page' : undefined} className={`${chip} ${f.value === q.filter ? ACTIVE : IDLE}`}>
            {f.label}
          </Link>
        ))}
      </nav>
      <Filters q={q} places={places} />
      {loaded.kind !== 'ok' ? (
        <Empty>{notLoaded(loaded, 'official duty requests')}</Empty>
      ) : loaded.value.length === 0 ? (
        <div className="card px-6 py-8 text-center text-sm text-muted">
          {emptyOdText(q.filter)}
          {q.month && ` In ${monthName(q.month)}.`}
          {q.late && ' Requested after only.'}
        </div>
      ) : (
        <OdTable requests={loaded.value} who where note={q.month ? `with a day in ${monthName(q.month)}, the latest first day first.` : 'the latest first day first.'} />
      )}
    </div>
  );
}

export default function OdListPage({ searchParams }: PageProps<'/attendance/official-duty'>) {
  return (
    <StaffOnly>
      <div className="max-w-6xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Official Duty</h1>
          <p className="mt-1 max-w-3xl text-muted">
            Work for the company away from the office, a client&apos;s site or a shoot: a working day, not leave. Asked ahead, or up to 3 days after
            (marked requested after); decided by their direct manager (or lead), then HR, a C-level person&apos;s by the CEO. On an approved day they check
            in from where they are, without the office location or network, and the day counts as attended for its hours.
          </p>
        </div>
        <Suspense fallback={<Loading />}>
          <List searchParams={searchParams} />
        </Suspense>
      </div>
    </StaffOnly>
  );
}
