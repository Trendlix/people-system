import Link from 'next/link';
import { formatDate } from '@/lib/format';
import type { HomeLocationView } from '@/lib/home-location-types';
import { SetupSection } from '../payroll/section';
import { profileHref } from '../../employees/ui';
import { removeHome } from '../../home-locations/actions';
import { loadApprovedHomes } from '../../home-locations/data';
import { RemoveHomeForm } from '../../home-locations/forms';
import { homeLocationHref, radiusText } from '../../home-locations/home-locations';
import { HomeMap } from '../../home-locations/ui';
import { HOMES_ID } from './setup';
import { shownCode } from '@/lib/hidden';

// Attendance → Check-in Setup → Home Locations (owner, 20 October 2026: "allow other users to request to add their home
// locations when working from home"; then "Label Home, flag elsewhere"): the homes HR and the CEO approved, each its
// person, label, radius and approved date with a small map, and Remove, which deletes its point. A home is personal
// data: shown only to HR (not a C-level person's) and the Super Admin here (the CEO decides them on Approvals), never to
// an Admin without them, managers or Finance; the API sends each only what they may see.

const INTRO =
  'Homes HR and the CEO approved: a check-in within one’s radius shows as Home for its person, and a remote one elsewhere is flagged for HR. Only HR, the CEO and the Super Admin see them (a C-level person’s only the CEO and the Super Admin). Removing one deletes its point.';

function HomeCard({ home: h }: { home: HomeLocationView }) {
  const place = [h.employee.department, h.employee.team].filter(Boolean).join(' › ');
  return (
    <li className="space-y-3 rounded-lg border border-line bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold">
            <Link href={profileHref(h.employee.id, 'employment')}>{h.employee.fullNameEn}</Link>
            {shownCode(h.employee.employeeCode) && <span className="font-normal text-muted"> · {h.employee.employeeCode}</span>}
          </h3>
          {place && <p className="text-sm text-muted">{place}</p>}
          <p className="text-sm">{h.label ?? <span className="text-muted">No label</span>}</p>
          <p className="text-sm text-muted tabular-nums">
            Within {radiusText(h.radiusMetres)} · approved {formatDate(h.approvedAt)}
          </p>
          <p className="text-sm">
            <Link href={homeLocationHref(h.id)}>
              Open the request<span className="sr-only"> of {h.employee.fullNameEn}</span>
            </Link>
          </p>
        </div>
      </div>
      <HomeMap request={h} height="h-[180px]" />
      {h.canRemove && <RemoveHomeForm action={removeHome.bind(null, h.id, false)} own={false} name={h.employee.fullNameEn} />}
    </li>
  );
}

export async function HomeLocationsSection() {
  const loaded = await loadApprovedHomes();
  return (
    <SetupSection id={HOMES_ID} title="Home Locations" intro={INTRO}>
      {loaded.kind === 'unavailable' ? (
        <p className="rounded-lg bg-line-soft px-4 py-3 text-sm text-muted">Not available yet: the server does not have home locations yet.</p>
      ) : loaded.kind === 'forbidden' ? (
        <p className="rounded-lg bg-line-soft px-4 py-3 text-sm text-muted">Only HR, the CEO and the Super Admin see home locations.</p>
      ) : loaded.kind === 'failed' ? (
        <p className="rounded-lg bg-line-soft px-4 py-3 text-sm text-muted">The home locations could not be loaded. {loaded.messages.join(' ')}</p>
      ) : loaded.value.length === 0 ? (
        <p className="text-sm text-muted">No home location is approved yet. Employees ask from My Requests; HR, then the CEO, decide each on Approvals.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {loaded.value.map((h) => (
            <HomeCard key={h.id} home={h} />
          ))}
        </ul>
      )}
    </SetupSection>
  );
}
