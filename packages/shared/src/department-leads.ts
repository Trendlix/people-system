// Department heads and team leads (owner, 19 October 2026: "i want to add department lead person, the person in
// charge"). Asked, the owner chose: one person in charge of each department (its Head of department) and of each team
// (its Team lead), any current employee (a director may lead several); shown on the org chart, the Departments page
// and the profile; the default direct manager when someone is hired into the department or team (HR can change it);
// and the approver of leave and reimbursements for someone with no direct manager: the team lead, else the head of
// the department, never the requester themself, else HR as before. Not chosen: a lead seeing the whole department.
// Pure: the web shows these and the API decides with the same.

/** Who decides the manager stage of a request: its direct manager, or the person in charge when there is none. */
export const APPROVER_ROLES = ['direct_manager', 'team_lead', 'department_head'] as const;
export type ApproverRole = (typeof APPROVER_ROLES)[number];
export const isApproverRole = (role: unknown): role is ApproverRole => (APPROVER_ROLES as readonly unknown[]).includes(role);

export const APPROVER_ROLE_LABELS: Record<ApproverRole, string> = {
  direct_manager: 'Direct manager',
  team_lead: 'Team lead',
  department_head: 'Head of department',
};

export const APPROVER_ROLE_LABELS_AR: Record<ApproverRole, string> = {
  direct_manager: 'المدير المباشر',
  team_lead: 'قائد الفريق',
  department_head: 'مدير الإدارة',
};

/**
 * What the person in charge is called, by level: a team's (a department with a parent) is its Team lead, a
 * department's its Head of department. In Arabic with `language` 'ar': قائد الفريق, مدير الإدارة.
 */
export function leadTitle(isTeam: boolean, language: 'en' | 'ar' = 'en'): string {
  const role: ApproverRole = isTeam ? 'team_lead' : 'department_head';
  return language === 'ar' ? APPROVER_ROLE_LABELS_AR[role] : APPROVER_ROLE_LABELS[role];
}

/** The people in charge of where someone works, by employee id: their team's lead and their department's head. */
export interface PlaceLeads {
  /** The lead of the team they work in; none for someone in a department itself, or a team without a lead. */
  teamLeadId: string | null;
  /** The head of their department: the team's department for someone in a team. */
  departmentHeadId: string | null;
}

/**
 * The leads of a department or team, from its own head and its parent's: a team (with a parent) has its head as the
 * team lead and its department's as the head of department; a department has its head as the head of department and
 * no team lead. Teams go one level deep (DepartmentsService), so there is nothing above the parent.
 */
export function placeLeads(unit: { headId: string | null; parent: { headId: string | null } | null } | null | undefined): PlaceLeads {
  if (!unit) return { teamLeadId: null, departmentHeadId: null };
  return unit.parent ? { teamLeadId: unit.headId, departmentHeadId: unit.parent.headId } : { teamLeadId: null, departmentHeadId: unit.headId };
}

/** Who is in charge of a request, and as what. */
export interface ApproverInCharge {
  employeeId: string;
  role: ApproverRole;
}

/**
 * Who decides the manager stage of a leave request or reimbursement claim: the requester's direct manager, unless it is
 * empty or the requester themself; else their team's lead; else their department's head; never the requester (their
 * own lead skips to the next). Null when nobody is: the request goes straight to HR, as before.
 */
export function approverInCharge(who: PlaceLeads & { managerId: string | null; requesterId: string }): ApproverInCharge | null {
  const candidates: [string | null, ApproverRole][] = [
    [who.managerId, 'direct_manager'],
    [who.teamLeadId, 'team_lead'],
    [who.departmentHeadId, 'department_head'],
  ];
  for (const [employeeId, role] of candidates) if (employeeId && employeeId !== who.requesterId) return { employeeId, role };
  return null;
}

/**
 * The direct manager suggested when someone is hired into a department or team, or made an employee from an accepted
 * job offer without one: its team lead, else its department's head, never the person hired themself. Null: none.
 */
export function suggestedManager(leads: PlaceLeads, employeeId: string | null): ApproverInCharge | null {
  return approverInCharge({ ...leads, managerId: null, requesterId: employeeId ?? '' });
}
