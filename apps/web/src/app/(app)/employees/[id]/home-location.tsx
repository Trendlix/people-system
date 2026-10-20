import Link from 'next/link';
import type { EmployeeProfile, SessionUser } from '@/lib/types';
import { loadEmployeeHome } from '../../home-locations/data';
import { homeLocationHref, profileHomeText, seesHomes } from '../../home-locations/home-locations';
import { HomeMap } from '../../home-locations/ui';

// A person's home location on their profile (owner, 20 October 2026: "allow other users to request to add their home
// locations when working from home"), where their attendance details are (the Current Employment's "Checks in from"):
// "Home location: approved 20/10/2026 · 100 m", with a small map, for HR, the CEO and the Super Admin; a C-level person's
// only for the CEO and the Super Admin (the API answers 404 to HR), never for managers or Finance (not even read). The
// employee's own is on their My Requests.

export async function HomeLocationLine({ employee, user }: { employee: Pick<EmployeeProfile, 'id' | 'fullNameEn'>; user: SessionUser }) {
  if (!seesHomes(user) || user.employeeId === employee.id) return null;
  const loaded = await loadEmployeeHome(employee.id);
  if (loaded.kind !== 'ok') return null;
  const home = loaded.value[0];
  if (!home) return <p className="text-sm text-muted">Home location: none approved.</p>;
  return (
    <div className="space-y-2">
      <p className="text-sm">
        <span className="font-medium">{profileHomeText(home)}</span>
        {home.label && <span className="text-muted"> · {home.label}</span>}{' '}
        <Link href={homeLocationHref(home.id)} className="text-sm">
          Open<span className="sr-only"> {employee.fullNameEn}’s home location</span>
        </Link>
      </p>
      <div className="max-w-xl">
        <HomeMap request={home} height="h-[180px]" />
      </div>
    </div>
  );
}
