import { APPROVER_ROLE_LABELS, approverInCharge, isApproverRole, leadTitle, placeLeads, suggestedManager, type ApproverRole } from '@trendlix/shared';
import { HIDDEN_LABEL, isHidden, personCutOff } from './hidden';
import type { Department, EmployeeSummary, Employment, LeadPerson, RequestApprover } from './types';

// Department heads and team leads (owner, 19 October 2026: "i want to add department lead person, the person in
// charge"). Asked, the owner chose: one person in charge of each department (its head of department) and of each team
// (its team lead), any current employee, one person leading several if need be; shown on the Departments page, the org
// chart and the profile; the direct manager suggested when someone is hired into a department or team (HR can change
// it); and, for someone without a direct manager, who decides their leave and their reimbursement claims: the team lead,
// else the department's head, never the requester themself, else HR as before. The rules are @trendlix/shared's
// (department-leads.ts), which the API decides with; these helpers find the people on screen and word them. Pure code,
// tested in department-leads.test.ts.

type Place = Pick<Department, 'id' | 'nameEn' | 'parentId' | 'head'>;

// ---------- a department's or team's lead ----------

/** What its lead is called: "Team lead" for a team (a department with a parent), "Head of department" for a department. */
export const leadLabel = (d: Pick<Department, 'parentId'>) => leadTitle(d.parentId !== null);

/** Its lead's label in a list, short: "Head" on a department's card, "Team lead" on a team's (`isTeam`). */
export const leadShortLabel = (isTeam: boolean) => (isTeam ? 'Team lead' : 'Head');

/**
 * Its lead in a line, as the org chart draws it under its name: "Head: Hazem Magdy" for a department, "Team lead: Sara
 * Ali" for a team (`isTeam`); null without one.
 */
export function leadLine(isTeam: boolean, head: LeadPerson | null | undefined): string | null {
  // cut off for a developer on the company's pages (owner, 22 October 2026: "Hide per-person details")
  return head ? `${leadShortLabel(isTeam)}: ${leadHidden(head) ? HIDDEN_LABEL : head.fullNameEn}` : null;
}

/** A department's head or a team's lead the API cut off for a developer: no id, no name. */
export const leadHidden = (head: Pick<LeadPerson, 'id' | 'fullNameEn'>): boolean => personCutOff(head) || isHidden(head.fullNameEn);

/** Someone with a current employment (not a former employee, nor one not employed yet): who can lead, or be a manager. */
export const isCurrentEmployee = (p: Pick<EmployeeSummary, 'standing'>) => p.standing !== 'former' && p.standing !== 'not_employed';

/**
 * The people a department's or team's lead is chosen from (GET /employees, as the caller may see them): the current
 * employees by name, with the lead it has now kept in the list (so the picker shows them) even when they can't be
 * chosen anew.
 */
export function leadChoices(people: readonly EmployeeSummary[], head: (LeadPerson & { employeeCode?: string }) | null | undefined): LeadChoice[] {
  const choices: LeadChoice[] = people.filter(isCurrentEmployee).map(({ id, fullNameEn, employeeCode }) => ({ id, fullNameEn, employeeCode }));
  if (head && !choices.some((c) => c.id === head.id)) choices.push({ id: head.id, fullNameEn: head.fullNameEn, employeeCode: head.employeeCode ?? '' });
  return choices.sort((a, b) => a.fullNameEn.localeCompare(b.fullNameEn, 'en'));
}

/** One choice of the lead picker. */
export interface LeadChoice {
  id: string;
  fullNameEn: string;
  employeeCode: string;
}

/** A choice as the picker lists it: "Sara Ali · EMP-0012". */
export const leadChoiceLabel = (c: LeadChoice) => (c.employeeCode ? `${c.fullNameEn} · ${c.employeeCode}` : c.fullNameEn);

// ---------- where someone works ----------

/** One line of the profile's Employment details about who is in charge of where they work. */
export interface LeadRow {
  key: 'teamLead' | 'departmentHead';
  label: string;
  person: LeadPerson | null;
  /** They decide the employee's leave and claims first, as the employee has no direct manager (approverInCharge). */
  decides: boolean;
}

/**
 * The profile's "Team lead" and "Head of department" lines for the current employment (`leads`, from the API): the team
 * lead only for someone in a team, the head for anyone in a department or team; none without a place, or from an API
 * from before leads.
 */
export function leadRows(e: Pick<Employment, 'employeeId' | 'managerId' | 'department' | 'leads'>): LeadRow[] {
  if (!e.leads || !e.department) return [];
  const { teamLead, departmentHead } = e.leads;
  const inCharge = approverInCharge({
    managerId: e.managerId,
    teamLeadId: teamLead?.id ?? null,
    departmentHeadId: departmentHead?.id ?? null,
    requesterId: e.employeeId,
  });
  const rows: LeadRow[] = [];
  if (e.department.parent) rows.push({ key: 'teamLead', label: leadTitle(true), person: teamLead, decides: inCharge?.role === 'team_lead' });
  rows.push({ key: 'departmentHead', label: leadTitle(false), person: departmentHead, decides: inCharge?.role === 'department_head' });
  return rows;
}

/** The note under the lead who decides, on the profile. */
export const DECIDES_NOTE = 'Decides their leave and claims first: they have no direct manager';

// ---------- the direct manager suggested when hiring ----------

/** The direct manager suggested for someone hired into a department or team: who, and what they lead. */
export interface ManagerSuggestion {
  person: LeadPerson;
  role: Exclude<ApproverRole, 'direct_manager'>;
  /** The name of the team they lead, or of the department they are the head of. */
  place: string;
}

/**
 * Who is suggested as the direct manager of someone hired into `departmentId`: its team lead, else its department's
 * head (suggestedManager in @trendlix/shared), never the person hired themself (`employeeId`). A lead who can't be
 * picked as a manager now (`canPick`: not a current employee) is passed over, as if there were none. Null: nobody.
 */
export function suggestManager(
  departments: readonly Place[],
  departmentId: string | null | undefined,
  { employeeId = null, canPick = () => true }: { employeeId?: string | null; canPick?: (id: string) => boolean } = {},
): ManagerSuggestion | null {
  const unit = departmentId ? departments.find((d) => d.id === departmentId) : undefined;
  if (!unit) return null;
  const parent = unit.parentId ? (departments.find((d) => d.id === unit.parentId) ?? null) : null;
  const headOf = (d: Place | null) => (d?.head && canPick(d.head.id) ? d.head.id : null);
  const leads = placeLeads({ headId: headOf(unit), parent: unit.parentId ? { headId: headOf(parent) } : null });
  const chosen = suggestedManager(leads, employeeId);
  if (!chosen) return null;
  if (chosen.role === 'team_lead' && unit.head) return { person: unit.head, role: 'team_lead', place: unit.nameEn };
  const department = unit.parentId ? parent : unit;
  if (chosen.role === 'department_head' && department?.head) return { person: department.head, role: 'department_head', place: department.nameEn };
  return null;
}

/** The hint under the Direct manager while it is the suggestion: "Suggested: the team lead of Content Team." */
export function suggestionHint(s: ManagerSuggestion): string {
  return s.role === 'team_lead' ? `Suggested: the team lead of ${s.place}.` : `Suggested: the head of the ${s.place} department.`;
}

/**
 * The Direct manager picked on the hire form, and whether it is the suggestion: `suggested` is the id the form filled
 * in itself (null once HR picks someone, or nobody, themself).
 */
export interface ManagerPick {
  managerId: string;
  suggested: string | null;
}

/**
 * The Direct manager once a department or team is chosen: its lead (`suggestion`) when the manager is still empty, or
 * still the earlier suggestion, which the new one replaces (or clears, when the new place has no lead); one HR picked
 * themself is never overwritten.
 */
export function pickAfterPlace(pick: ManagerPick, suggestion: ManagerSuggestion | null): ManagerPick {
  const picked = pick.managerId !== '' && pick.managerId !== pick.suggested;
  if (picked) return { managerId: pick.managerId, suggested: null };
  const id = suggestion?.person.id ?? null;
  return { managerId: id ?? '', suggested: id };
}

/**
 * The Direct manager the form starts with: as saved, or as sent before a refused save; counted as the suggestion when it
 * is the lead suggested for the place chosen, so choosing another place still replaces it.
 */
export function firstPick(managerId: string, suggestion: ManagerSuggestion | null): ManagerPick {
  return { managerId, suggested: managerId !== '' && managerId === suggestion?.person.id ? managerId : null };
}

/**
 * The hint under an offer's Direct manager while it is left empty: who becomes the manager when the offer is accepted
 * (the API defaults to the lead then). Null: there is no lead, or a manager is chosen.
 */
export function offerManagerHint(managerId: string, s: ManagerSuggestion | null): string | null {
  if (managerId || !s) return null;
  const who = s.role === 'team_lead' ? `the team lead of ${s.place}` : `the head of the ${s.place} department`;
  return `Left empty, ${s.person.fullNameEn} (${who}) becomes the direct manager when the offer is accepted.`;
}

// ---------- who decides a request's manager stage ----------

/** Its role, from the request: the direct manager for an API from before team leads. */
export const approverRole = (m: Pick<RequestApprover, 'role'> | null | undefined): ApproverRole =>
  m?.role && isApproverRole(m.role) ? m.role : 'direct_manager';

/** What they are, as a label: "Direct manager", "Team lead", "Head of department". */
export const approverLabel = (m: Pick<RequestApprover, 'role'> | null | undefined) => APPROVER_ROLE_LABELS[approverRole(m)];

/** What they are inside a sentence: "the direct manager", "the team lead", "the head of department". */
export function approverPhrase(m: Pick<RequestApprover, 'role'> | null | undefined): string {
  const label = approverLabel(m);
  return `the ${label[0].toLowerCase()}${label.slice(1)}`;
}

/** Starting a sentence: "The direct manager", "The team lead", "The head of department". */
export function approverSubject(m: Pick<RequestApprover, 'role'> | null | undefined): string {
  const phrase = approverPhrase(m);
  return `${phrase[0].toUpperCase()}${phrase.slice(1)}`;
}

/** Where a request waiting at the manager stage is: "With the team lead (Sara Ali)", "With the direct manager". */
export function withApproverText(m: RequestApprover | null | undefined): string {
  return `With ${approverPhrase(m)}${m ? ` (${m.fullNameEn})` : ''}`;
}

/** Whose a request goes to first, in "It goes to your team lead, then HR": "your direct manager", "your team lead", … */
export const yourApprover = (m: Pick<RequestApprover, 'role'> | null | undefined) => approverPhrase(m).replace(/^the /, 'your ');

/**
 * On the approver's own list (My Team): why a request waits for them when they aren't the requester's direct manager:
 * "As their team lead: they have no direct manager"; null for the direct manager.
 */
export function asLeadNote(m: Pick<RequestApprover, 'role'> | null | undefined): string | null {
  const role = approverRole(m);
  if (role === 'team_lead') return 'As their team lead: they have no direct manager';
  if (role === 'department_head') return 'As the head of their department: they have no direct manager or team lead';
  return null;
}
