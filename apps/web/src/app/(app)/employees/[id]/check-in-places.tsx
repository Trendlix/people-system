import { checkInPlacesText } from '@trendlix/shared';
import type { CheckInPlacesView } from '@/lib/attendance-types';
import { hasRole } from '@/lib/roles';
import type { EmployeeProfile, SessionUser } from '@/lib/types';
import { loadJson } from '../../payroll/load';

// A person's check-in places on their profile (owner, 20 October 2026: "main office location is the hero and other
// locations are like sub locations. shown with their name and linked users"; "own sublocation shows the sub location
// name"), where their attendance details are (the Current Employment's "Checks in from"): "Check-in places: Studio,
// Client X", the sub-locations they are linked to on Attendance → Check-in Setup, for HR, Admin, the CEO and the person
// themself (a C-level person's only for the CEO and the Super Admin: the API answers 404 to HR). Nothing for someone
// linked nowhere, nor for anyone else (not even read).

/** Who reads a person's check-in places: HR, Admin (a Super Admin as an Admin), the CEO, and the person themself. */
export const seesCheckInPlaces = (user: Pick<SessionUser, 'roles' | 'employeeId'>, employeeId: string): boolean =>
  hasRole(user, 'hr', 'admin', 'ceo') || user.employeeId === employeeId;

export async function CheckInPlacesLine({ employee, user }: { employee: Pick<EmployeeProfile, 'id'>; user: SessionUser }) {
  if (!seesCheckInPlaces(user, employee.id)) return null;
  const loaded = await loadJson<CheckInPlacesView>(`/employees/${encodeURIComponent(employee.id)}/check-in-places`);
  if (loaded.kind !== 'ok') return null;
  const text = checkInPlacesText(loaded.value.places.map((p) => p.name));
  if (!text) return null;
  return (
    <p className="text-sm">
      <span className="font-medium">{text}</span>
      <span className="text-muted"> · their own places: check-ins there show as Remote with the place&apos;s name, not flagged</span>
    </p>
  );
}
