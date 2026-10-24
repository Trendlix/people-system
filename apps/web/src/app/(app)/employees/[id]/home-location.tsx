import Link from 'next/link';
import type { EmployeeProfile, SessionUser } from '@/lib/types';
import { loadEmployeePlaces } from '../../home-locations/data';
import { HOME_TYPE_LINES, homeLocationHref, homeTypeOf, homeValidityText, homeWhatText, placeStandingText, profilePlaces, seesHomes } from '../../home-locations/home-locations';
import { HomeMap } from '../../home-locations/ui';

// A person's home location on their profile (owner, 20 October 2026: "allow other users to request to add their home
// locations when working from home"), where their attendance details are (the Current Employment's "Checks in from"):
// "Home location: approved 20/10/2026 · 100 m", with a small map, for HR, the CEO and the Super Admin; a C-level person's
// only for the CEO and the Super Admin (the API answers 404 to HR), never for managers or Finance (not even read). The
// employee's own is on their My Requests. Since 24 October 2026 (owner: "allow the employee to request adding this
// location to his profile ... (Home Location - Remote Site - Client Location)"): every place of theirs being decided or
// approved, each with its type, name, how long it lasts and where it stands (being decided, in force, ended), the ones
// in force on a small map. (The name keeps HomeLocationLine for the Employment tab that shows it.)

const STANDING_BADGE = { 'Being decided': 'bg-warn-soft text-warn', 'In force': 'bg-ok-soft text-ok', Ended: 'bg-line-soft text-muted' } as const;

export async function HomeLocationLine({ employee, user }: { employee: Pick<EmployeeProfile, 'id' | 'fullNameEn'>; user: SessionUser }) {
  if (!seesHomes(user) || user.employeeId === employee.id) return null;
  const loaded = await loadEmployeePlaces(employee.id);
  if (loaded.kind !== 'ok') return null;
  const places = profilePlaces(loaded.value);
  if (!places.length) return <p className="text-sm text-muted">Check-in locations: none asked for or approved.</p>;
  const mapped = places.filter((p) => placeStandingText(p) === 'In force');
  return (
    <div className="space-y-3">
      <ul className="space-y-2" aria-label={`${employee.fullNameEn}’s check-in locations`}>
        {places.map((p) => {
          const standing = placeStandingText(p)!;
          const validity = homeValidityText(p);
          return (
            <li key={p.id} className="text-sm">
              <span className="font-medium">{HOME_TYPE_LINES[homeTypeOf(p)]}</span>
              <span> · {homeWhatText({ ...p, type: 'home' })}</span>
              {validity && standing !== 'Being decided' && <span className="text-muted"> · {validity}</span>}{' '}
              <span className={`badge ${STANDING_BADGE[standing]}`}>{standing}</span>{' '}
              <Link href={homeLocationHref(p.id)} className="text-sm">
                Open<span className="sr-only"> {employee.fullNameEn}’s {HOME_TYPE_LINES[homeTypeOf(p)].toLowerCase()}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      {mapped.length > 0 && (
        <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
          {mapped.map((p) => (
            <HomeMap key={p.id} request={p} height="h-[180px]" />
          ))}
        </div>
      )}
    </div>
  );
}
