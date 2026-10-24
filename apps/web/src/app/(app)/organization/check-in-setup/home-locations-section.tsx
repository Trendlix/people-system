import Link from 'next/link';
import type { HomeLocationView } from '@/lib/home-location-types';
import { shownCode } from '@/lib/hidden';
import { SetupSection } from '../payroll/section';
import { profileHref } from '../../employees/ui';
import { homeLocationHref, radiusText } from '../../home-locations/home-locations';
import { loadRequests } from './data';
import {
  HOMES_ID,
  readRequestFilters,
  REQUEST_STATUS_FILTERS,
  REQUEST_TYPE_FILTERS,
  requestFilterHref,
  requestFilterLabel,
  requestRowText,
  requestsApi,
  type RequestStatusFilter,
  type RequestTypeFilter,
} from './setup';

// Organization → Check-in Setup → Check-in Location Requests (owner, 20 October 2026: "allow other users to request to add
// their home locations when working from home"; since 24 October 2026: "allow the employee to request adding this location
// to his profile ... (Home Location - Remote Site - Client Location)"): HR's list of the requests and the approved places,
// filtered by type and by status (the approved ones to start with; being decided; waiting for you; rejected, withdrawn,
// replaced, removed; all), through the page's address. Each row: its person, its type, its name, where it stands, how long
// it lasts and whether it still counts, and a link to its request, where HR decides it, changes how long it lasts or
// removes it. A home and a remote site are personal data: shown only to HR (not a C-level person's), the CEO and the
// Super Admin here, never to an Admin without them, managers or Finance; the API sends each only what they may see.

const INTRO =
  'Places employees asked to check in from, decided by HR, then the CEO. An approved home or remote site counts only for its person: a check-in within it shows as Home or “Remote site · name”. An approved client location counts for everyone and is listed with the check-in locations above. Only HR, the CEO and the Super Admin see them (a C-level person’s only the CEO and the Super Admin).';

type Query = Record<string, string | string[] | undefined>;

/** A row of filters: each a link, the chosen one marked. */
function Filters<F extends string>({ label, options, chosen, href }: { label: string; options: readonly F[]; chosen: F; href: (f: F) => string }) {
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-1.5 text-sm">
      <span className="me-1 text-xs font-semibold tracking-wide text-muted uppercase">{label}</span>
      {options.map((f) => (
        <Link
          key={f}
          href={href(f)}
          scroll={false}
          aria-current={f === chosen ? 'true' : undefined}
          className={`rounded-full border px-3 py-1 no-underline ${f === chosen ? 'border-accent bg-accent-soft font-semibold text-accent' : 'border-line text-ink hover:bg-line-soft'}`}
        >
          {requestFilterLabel(f)}
        </Link>
      ))}
    </nav>
  );
}

function RequestRow({ request: r }: { request: HomeLocationView }) {
  const row = requestRowText(r);
  const place = [r.employee.department, r.employee.team].filter(Boolean).join(' › ');
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 space-y-0.5">
        <p className="font-semibold">
          <Link href={profileHref(r.employee.id, 'employment')}>{r.employee.fullNameEn}</Link>
          {shownCode(r.employee.employeeCode) && <span className="font-normal text-muted"> · {r.employee.employeeCode}</span>}
        </p>
        {place && <p className="text-xs text-muted">{place}</p>}
        <p className="text-sm">
          <span className="badge me-1.5">{row.type}</span>
          {row.name}
          <span className="text-muted tabular-nums"> · {radiusText(r.radiusMetres)}</span>
        </p>
      </div>
      <div className="flex flex-col items-end gap-1 text-sm">
        <span className={`badge ${row.ended ? 'bg-line-soft text-muted' : r.status === 'approved' ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn'}`}>
          {row.ended ? 'Ended' : row.status}
        </span>
        {row.lasts && <span className="text-xs text-muted tabular-nums">{row.lasts}</span>}
        <Link href={homeLocationHref(r.id)}>
          Open<span className="sr-only"> the request of {r.employee.fullNameEn}</span>
        </Link>
      </div>
    </li>
  );
}

export async function HomeLocationsSection({ searchParams }: { searchParams: Promise<Query> }) {
  const filters = readRequestFilters(await searchParams);
  const loaded = await loadRequests(requestsApi(filters));
  const typeHref = (type: RequestTypeFilter) => requestFilterHref(filters, { type });
  const statusHref = (status: RequestStatusFilter) => requestFilterHref(filters, { status });
  return (
    <SetupSection id={HOMES_ID} title="Check-in Location Requests" intro={INTRO}>
      <div className="space-y-4">
        <div className="space-y-2">
          <Filters label="Type" options={REQUEST_TYPE_FILTERS} chosen={filters.type} href={typeHref} />
          <Filters label="Status" options={REQUEST_STATUS_FILTERS as readonly RequestStatusFilter[]} chosen={filters.status} href={statusHref} />
        </div>
        {loaded.kind === 'unavailable' ? (
          <p className="rounded-lg bg-line-soft px-4 py-3 text-sm text-muted">Not available yet: the server does not have check-in location requests yet.</p>
        ) : loaded.kind === 'forbidden' ? (
          <p className="rounded-lg bg-line-soft px-4 py-3 text-sm text-muted">Only HR, the CEO and the Super Admin see check-in location requests.</p>
        ) : loaded.kind === 'failed' ? (
          <p className="rounded-lg bg-line-soft px-4 py-3 text-sm text-muted">The requests could not be loaded. {loaded.messages.join(' ')}</p>
        ) : loaded.value.length === 0 ? (
          <p className="text-sm text-muted">
            None here. Employees ask from My Requests, or from a check-in refused for its location; HR, then the CEO, decide each on Approvals.
          </p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {loaded.value.map((r) => (
              <RequestRow key={r.id} request={r} />
            ))}
          </ul>
        )}
      </div>
    </SetupSection>
  );
}
