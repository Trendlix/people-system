import 'server-only';
import { cache } from 'react';
import { seesRaiseRequests } from '@trendlix/shared';
import { hasRole } from '@/lib/roles';
import type { Session } from '@/lib/view-as';
import type { EmployeeProfile } from '@/lib/types';
import { loadCompensatoryForm, loadMyCompensatory } from '../attendance/compensatory/data';
import { loadMyCorrections } from '../attendance/corrections/data';
import { loadMyOd, loadOdForm } from '../attendance/official-duty/data';
import { loadMyWfh, loadWfhAllowance } from '../attendance/wfh/data';
import { loadMyHomes } from '../home-locations/data';
import { loadLeaveTypes, loadMyBalances, loadMyLeave, loadMyPermissionMonth, loadMyPermissions } from '../leave/data';
import { loadTeam } from '../my-team/data';
import { loadEmployeeRaiseRequests } from '../raise-requests/data';
import { loadMyClaims } from '../reimbursements/data';
import { loadMyResignation } from '../resignations/data';
import { askedByManager, myRequests } from './requests';

// What My Requests reads, once a request (owner's design, 30 October 2026): its overview at the top (the figures, Recent
// requests, Other leave and the requests to start) takes every kind together, and each kind's section below takes its
// own, from the same reads: every loader here is React's cache, so nothing is asked of the API twice.

/** GET /employees/:id/raise-requests for the signed-in person's own, read once a request (the overview and its section). */
export const loadOwnRaises = cache((employeeId: string) => loadEmployeeRaiseRequests(employeeId));

/** The changes to their details and the raises (their own, and a manager's for their direct reports), as the section lists them. */
export const loadChangesAndRaises = cache(async (user: Session, profile: EmployeeProfile) => {
  // raise requests, their own and their team's, only for those who see them (20 October 2026); not even read otherwise
  const seesRaises = seesRaiseRequests(user);
  const manager = seesRaises && hasRole(user, 'manager');
  const [raises, team] = await Promise.all([seesRaises ? loadOwnRaises(profile.id) : null, manager ? loadTeam(profile) : []]);
  const own = raises?.kind === 'ok' ? raises.value : null;
  const forTeam = team.flatMap((m) => (m.raises.kind === 'ok' ? askedByManager(m.raises.value.requests, user.email) : []));
  return {
    seesRaises,
    own,
    forTeam,
    all: myRequests({
      changes: profile.changeRequests ?? [],
      raises: own?.requests ?? [],
      team: forTeam,
    }),
    unloaded: raises?.kind === 'failed' || team.some((m) => m.raises.kind === 'failed'),
  };
});

/** Everything the overview reads, side by side. `year` and `month`: today's in Cairo ("2026", "2026-10"). */
export async function loadOverview(user: Session, profile: EmployeeProfile, year: number, month: string) {
  const [
    changes,
    leave,
    permissions,
    balances,
    types,
    permissionMonth,
    corrections,
    wfh,
    wfhAllowance,
    od,
    odForm,
    compensatory,
    compensatoryForm,
    homes,
    claims,
    resignation,
  ] = await Promise.all([
    loadChangesAndRaises(user, profile),
    loadMyLeave(),
    loadMyPermissions(),
    loadMyBalances(year),
    loadLeaveTypes(),
    loadMyPermissionMonth(month),
    loadMyCorrections(),
    loadMyWfh(),
    loadWfhAllowance(),
    loadMyOd(),
    loadOdForm(),
    loadMyCompensatory(),
    loadCompensatoryForm(),
    loadMyHomes(),
    loadMyClaims(),
    user.employeeId ? loadMyResignation() : null,
  ]);
  return {
    changes,
    leave,
    permissions,
    balances,
    types,
    permissionMonth,
    corrections,
    wfh,
    wfhAllowance,
    od,
    odForm,
    compensatory,
    compensatoryForm,
    homes,
    claims,
    resignation,
  };
}

export type Overview = Awaited<ReturnType<typeof loadOverview>>;
