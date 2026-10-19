// Department heads and team leads (owner, 19 October 2026: "i want to add department lead person, the person in
// charge"): what they are called, the direct manager suggested when hiring, and the words for who decides a request.
import { describe, expect, it } from 'vitest';
import {
  approverLabel,
  approverPhrase,
  approverRole,
  approverSubject,
  asLeadNote,
  DECIDES_NOTE,
  firstPick,
  leadChoiceLabel,
  leadChoices,
  leadLabel,
  leadLine,
  leadRows,
  leadShortLabel,
  offerManagerHint,
  pickAfterPlace,
  suggestionHint,
  suggestManager,
  withApproverText,
  yourApprover,
  type ManagerSuggestion,
} from './department-leads';
import type { Department, EmployeeSummary, Employment } from './types';

// invented people and places: Marketing (head Hazem) with Content Team (lead Sara) and Media Team (no lead); Finance (no head)
const HAZEM = { id: 'p-hazem', fullNameEn: 'Hazem Magdy', employeeCode: 'EMP-0001' };
const SARA = { id: 'p-sara', fullNameEn: 'Sara Ali', employeeCode: 'EMP-0012' };

const place = (id: string, nameEn: string, parentId: string | null, head: typeof HAZEM | null): Department => ({
  id,
  nameEn,
  nameAr: null,
  parentId,
  parent: parentId ? { id: parentId, nameEn: 'Marketing', nameAr: null } : null,
  sortOrder: 0,
  _count: { jobTitles: 0, children: 0 },
  head,
});
const DEPARTMENTS = [
  place('marketing', 'Marketing', null, HAZEM),
  place('content', 'Content Team', 'marketing', SARA),
  place('media', 'Media Team', 'marketing', null),
  place('finance', 'Finance', null, null),
];

const person = (id: string, fullNameEn: string, standing: EmployeeSummary['standing'], employeeCode = 'EMP-0100'): EmployeeSummary => ({
  id,
  employeeCode,
  fullNameEn,
  fullNameAr: 'موظف',
  workEmail: null,
  standing,
  employment: null,
  lastEnded: null,
});

describe('what a lead is called', () => {
  it('words it by level: a team’s Team lead, a department’s Head of department', () => {
    expect(leadLabel({ parentId: 'marketing' })).toBe('Team lead');
    expect(leadLabel({ parentId: null })).toBe('Head of department');
    expect(leadShortLabel(true)).toBe('Team lead');
    expect(leadShortLabel(false)).toBe('Head');
  });

  it('puts the lead in a line for the lists and the org chart, nothing without one', () => {
    expect(leadLine(false, HAZEM)).toBe('Head: Hazem Magdy');
    expect(leadLine(true, SARA)).toBe('Team lead: Sara Ali');
    expect(leadLine(true, null)).toBeNull();
    expect(leadLine(false, undefined)).toBeNull();
  });
});

describe('choosing a lead', () => {
  it('lists the current employees by name, and keeps the lead it has even when they can no longer be chosen', () => {
    const people = [
      person('p-zeinab', 'Zeinab Omar', 'active'),
      person('p-adel', 'Adel Hassan', 'probation'),
      person('p-gone', 'Gamal Fathy', 'former'),
      person('p-new', 'Nadia Samir', 'not_employed'),
      person('p-notice', 'Mona Said', 'notice_period'),
      person('p-away', 'Karim Tarek', 'on_leave'),
    ];
    expect(leadChoices(people, null).map((c) => c.fullNameEn)).toEqual(['Adel Hassan', 'Karim Tarek', 'Mona Said', 'Zeinab Omar']);
    // the lead it has now stays listed (e.g. HR can't see them in the list), in its place by name
    const kept = leadChoices(people, { id: 'p-gone', fullNameEn: 'Gamal Fathy', employeeCode: 'EMP-0007' });
    expect(kept.map((c) => c.fullNameEn)).toEqual(['Adel Hassan', 'Gamal Fathy', 'Karim Tarek', 'Mona Said', 'Zeinab Omar']);
    // once only, when they are listed already
    expect(leadChoices(people, { id: 'p-adel', fullNameEn: 'Adel Hassan', employeeCode: 'EMP-0100' })).toHaveLength(4);
    expect(leadChoiceLabel({ id: 'x', fullNameEn: 'Sara Ali', employeeCode: 'EMP-0012' })).toBe('Sara Ali · EMP-0012');
    expect(leadChoiceLabel({ id: 'x', fullNameEn: 'Sara Ali', employeeCode: '' })).toBe('Sara Ali');
  });
});

describe('the leads of where someone works', () => {
  it('gives the profile a Team lead line in a team and a Head of department line, saying who decides without a manager', () => {
    const employment = (e: Partial<Employment>) =>
      ({
        employeeId: 'p-nour',
        managerId: null,
        department: { id: 'content', nameEn: 'Content Team', nameAr: null, parent: { id: 'marketing', nameEn: 'Marketing', nameAr: null } },
        leads: { teamLead: SARA, departmentHead: HAZEM },
        ...e,
      }) as Pick<Employment, 'employeeId' | 'managerId' | 'department' | 'leads'>;
    // no direct manager: the team lead decides
    expect(leadRows(employment({}))).toEqual([
      { key: 'teamLead', label: 'Team lead', person: SARA, decides: true },
      { key: 'departmentHead', label: 'Head of department', person: HAZEM, decides: false },
    ]);
    // a direct manager decides: neither lead does
    expect(leadRows(employment({ managerId: 'p-omar' })).map((r) => r.decides)).toEqual([false, false]);
    // the team lead themself: their department's head decides
    expect(leadRows(employment({ employeeId: SARA.id })).map((r) => r.decides)).toEqual([false, true]);
    // in a department itself: its head alone
    const inDepartment = employment({
      department: { id: 'marketing', nameEn: 'Marketing', nameAr: null, parent: null },
      leads: { teamLead: null, departmentHead: HAZEM },
    });
    expect(leadRows(inDepartment)).toEqual([{ key: 'departmentHead', label: 'Head of department', person: HAZEM, decides: true }]);
    // a place without leads still says so; no place, or an API from before leads, has no lines
    expect(leadRows(employment({ leads: { teamLead: null, departmentHead: null } })).map((r) => r.person)).toEqual([null, null]);
    expect(leadRows(employment({ department: null }))).toEqual([]);
    expect(leadRows(employment({ leads: undefined }))).toEqual([]);
    expect(DECIDES_NOTE).toBe('Decides their leave and claims first: they have no direct manager');
  });
});

describe('the direct manager suggested when hiring', () => {
  it('is the team lead, else the department’s head, never the person hired', () => {
    expect(suggestManager(DEPARTMENTS, 'content')).toEqual({ person: SARA, role: 'team_lead', place: 'Content Team' });
    // a team without a lead: its department's head
    expect(suggestManager(DEPARTMENTS, 'media')).toEqual({ person: HAZEM, role: 'department_head', place: 'Marketing' });
    expect(suggestManager(DEPARTMENTS, 'marketing')).toEqual({ person: HAZEM, role: 'department_head', place: 'Marketing' });
    // the team lead hired into their own team: the head instead; the head into their department: nobody
    expect(suggestManager(DEPARTMENTS, 'content', { employeeId: SARA.id })?.person).toEqual(HAZEM);
    expect(suggestManager(DEPARTMENTS, 'marketing', { employeeId: HAZEM.id })).toBeNull();
    // nobody in charge, no place, or a place not in the list
    expect(suggestManager(DEPARTMENTS, 'finance')).toBeNull();
    expect(suggestManager(DEPARTMENTS, '')).toBeNull();
    expect(suggestManager(DEPARTMENTS, null)).toBeNull();
    expect(suggestManager(DEPARTMENTS, 'gone')).toBeNull();
  });

  it('passes over a lead who can’t be picked as a manager now', () => {
    expect(suggestManager(DEPARTMENTS, 'content', { canPick: (id) => id !== SARA.id })?.person).toEqual(HAZEM);
    expect(suggestManager(DEPARTMENTS, 'content', { canPick: () => false })).toBeNull();
  });

  it('says it is the suggestion, and whose', () => {
    expect(suggestionHint({ person: SARA, role: 'team_lead', place: 'Content Team' })).toBe('Suggested: the team lead of Content Team.');
    expect(suggestionHint({ person: HAZEM, role: 'department_head', place: 'Marketing' })).toBe('Suggested: the head of the Marketing department.');
  });

  const lead: ManagerSuggestion = { person: SARA, role: 'team_lead', place: 'Content Team' };
  const head: ManagerSuggestion = { person: HAZEM, role: 'department_head', place: 'Marketing' };

  it('fills in an empty manager, and replaces its own suggestion when another place is chosen', () => {
    expect(pickAfterPlace({ managerId: '', suggested: null }, lead)).toEqual({ managerId: SARA.id, suggested: SARA.id });
    expect(pickAfterPlace({ managerId: SARA.id, suggested: SARA.id }, head)).toEqual({ managerId: HAZEM.id, suggested: HAZEM.id });
    // a place without a lead clears its own suggestion
    expect(pickAfterPlace({ managerId: SARA.id, suggested: SARA.id }, null)).toEqual({ managerId: '', suggested: null });
    expect(pickAfterPlace({ managerId: '', suggested: null }, null)).toEqual({ managerId: '', suggested: null });
  });

  it('never overwrites a manager HR picked', () => {
    expect(pickAfterPlace({ managerId: 'p-omar', suggested: null }, lead)).toEqual({ managerId: 'p-omar', suggested: null });
    // HR picked someone after a suggestion
    expect(pickAfterPlace({ managerId: 'p-omar', suggested: SARA.id }, head)).toEqual({ managerId: 'p-omar', suggested: null });
  });

  it('starts as saved, or as sent before a refused save, counting the lead of the place chosen as the suggestion', () => {
    expect(firstPick('', lead)).toEqual({ managerId: '', suggested: null });
    expect(firstPick(SARA.id, lead)).toEqual({ managerId: SARA.id, suggested: SARA.id });
    expect(firstPick('p-omar', lead)).toEqual({ managerId: 'p-omar', suggested: null });
    expect(firstPick('p-omar', null)).toEqual({ managerId: 'p-omar', suggested: null });
  });

  it('tells an offer left without a manager who becomes it on acceptance', () => {
    expect(offerManagerHint('', lead)).toBe('Left empty, Sara Ali (the team lead of Content Team) becomes the direct manager when the offer is accepted.');
    expect(offerManagerHint('', head)).toBe(
      'Left empty, Hazem Magdy (the head of the Marketing department) becomes the direct manager when the offer is accepted.',
    );
    expect(offerManagerHint('p-omar', lead)).toBeNull();
    expect(offerManagerHint('', null)).toBeNull();
  });
});

describe('who decides a request’s manager stage, in words', () => {
  const teamLead = { id: SARA.id, fullNameEn: 'Sara Ali', role: 'team_lead' as const };
  const departmentHead = { id: HAZEM.id, fullNameEn: 'Hazem Magdy', role: 'department_head' as const };
  const manager = { id: 'p-omar', fullNameEn: 'Omar Said', role: 'direct_manager' as const };

  it('names who has it: “With the team lead (Sara Ali)”', () => {
    expect(withApproverText(teamLead)).toBe('With the team lead (Sara Ali)');
    expect(withApproverText(departmentHead)).toBe('With the head of department (Hazem Magdy)');
    expect(withApproverText(manager)).toBe('With the direct manager (Omar Said)');
    expect(withApproverText(null)).toBe('With the direct manager');
  });

  it('reads an API from before team leads, and an unknown role, as the direct manager', () => {
    expect(approverRole({ fullNameEn: 'Omar Said', id: 'p-omar' } as { role?: null })).toBe('direct_manager');
    expect(approverRole({ role: null })).toBe('direct_manager');
    expect(approverRole({ role: 'ceo' as never })).toBe('direct_manager');
    expect(approverRole(undefined)).toBe('direct_manager');
  });

  it('words the role as a label, inside a sentence, starting one, and as the requester’s', () => {
    expect([teamLead, departmentHead, manager].map(approverLabel)).toEqual(['Team lead', 'Head of department', 'Direct manager']);
    expect([teamLead, departmentHead, manager].map(approverPhrase)).toEqual(['the team lead', 'the head of department', 'the direct manager']);
    expect([teamLead, departmentHead, manager].map(approverSubject)).toEqual(['The team lead', 'The head of department', 'The direct manager']);
    expect([teamLead, departmentHead, manager].map(yourApprover)).toEqual(['your team lead', 'your head of department', 'your direct manager']);
  });

  it('tells the lead why a request waits for them, and nothing to a direct manager', () => {
    expect(asLeadNote(teamLead)).toBe('As their team lead: they have no direct manager');
    expect(asLeadNote(departmentHead)).toBe('As the head of their department: they have no direct manager or team lead');
    expect(asLeadNote(manager)).toBeNull();
    expect(asLeadNote(null)).toBeNull();
  });
});
