import 'server-only';
import { cache } from 'react';
import { seesRaiseRequests } from '@trendlix/shared';
import { isRestricted } from '@/lib/confidential';
import { getCurrentUser } from '@/lib/session';
import type { EmployeeCard, EmployeeProfile } from '@/lib/types';
import { getOrNull } from '../approvals/data';
import { loadEmployeeRaiseRequests, type EmployeeRaiseRequestsLoad } from '../raise-requests/data';

// A direct manager's team, for the dashboard's My Team card, the My Team page and the requests the manager asked for on
// My Requests (owner's decisions, 17 October 2026). Read as the manager may see it: each direct report's profile (the
// API lets a manager open their direct reports') for their employment, and their raise requests (the API sends a
// manager every one, without a figure). A C-level report (owner, 19 October 2026: "make C level Employees details not
// visible to HR") is their directory card for the manager: no profile, and no raise requests asked for (the API
// answers 404 for them). Nor are they asked for while the manager doesn't see raise requests (owner, 20 October 2026:
// "raises not to be visible to employee level for now", then "Hide from managers too"; seesRaiseRequests).

export interface TeamMember {
  /** As the manager's profile lists them (`reports`): their code, name, job title and status. */
  report: EmployeeProfile['reports'][number];
  /** Their profile, for the probation end; null when it can't be read, or for a C-level report's card (`restricted`). */
  profile: EmployeeProfile | null;
  /** A C-level report the manager sees only the card of. */
  restricted: boolean;
  raises: EmployeeRaiseRequestsLoad;
}

/** Raise requests the manager doesn't see (a C-level report's; anyone's while they don't see raise requests): as if not theirs to see. */
const NOT_THEIRS: EmployeeRaiseRequestsLoad = { kind: 'forbidden' };

/** The manager's direct reports, in the profile's order (by name). Read once a request: `manager` is loadOwnProfile's. */
export const loadTeam = cache(async (manager: EmployeeProfile): Promise<TeamMember[]> => {
  const seesRaises = seesRaiseRequests(await getCurrentUser());
  return Promise.all(
    manager.reports.map(async (report): Promise<TeamMember> => {
      const profile = await getOrNull<EmployeeProfile | EmployeeCard>(`/employees/${report.id}`);
      if (profile && isRestricted(profile)) return { report, profile: null, restricted: true, raises: NOT_THEIRS };
      return { report, profile, restricted: false, raises: seesRaises ? await loadEmployeeRaiseRequests(report.id) : NOT_THEIRS };
    }),
  );
});
