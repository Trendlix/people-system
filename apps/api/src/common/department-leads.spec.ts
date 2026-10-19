import {
  APPROVER_ROLE_LABELS,
  APPROVER_ROLE_LABELS_AR,
  APPROVER_ROLES,
  approverInCharge,
  isApproverRole,
  leadTitle,
  placeLeads,
  suggestedManager,
} from '@trendlix/shared';

// Department heads and team leads (owner, 19 October 2026: "i want to add department lead person, the person in
// charge"): packages/shared department-leads.ts.

describe('leadTitle', () => {
  it('a team has a Team lead, a department a Head of department, in English and Arabic', () => {
    expect(leadTitle(true)).toBe('Team lead');
    expect(leadTitle(false)).toBe('Head of department');
    expect(leadTitle(true, 'ar')).toBe('قائد الفريق');
    expect(leadTitle(false, 'ar')).toBe('مدير الإدارة');
  });

  it('every approver role has its labels', () => {
    for (const role of APPROVER_ROLES) {
      expect(APPROVER_ROLE_LABELS[role]).toBeTruthy();
      expect(APPROVER_ROLE_LABELS_AR[role]).toBeTruthy();
      expect(isApproverRole(role)).toBe(true);
    }
    expect(isApproverRole('manager')).toBe(false);
    expect(isApproverRole(null)).toBe(false);
  });
});

describe('placeLeads', () => {
  it('a team: its head is the team lead, its department’s the head of department', () => {
    expect(placeLeads({ headId: 'tia', parent: { headId: 'dan' } })).toEqual({ teamLeadId: 'tia', departmentHeadId: 'dan' });
    expect(placeLeads({ headId: null, parent: { headId: 'dan' } })).toEqual({ teamLeadId: null, departmentHeadId: 'dan' });
  });

  it('a department: its head is the head of department, with no team lead; nowhere: no one', () => {
    expect(placeLeads({ headId: 'dan', parent: null })).toEqual({ teamLeadId: null, departmentHeadId: 'dan' });
    expect(placeLeads(null)).toEqual({ teamLeadId: null, departmentHeadId: null });
    expect(placeLeads(undefined)).toEqual({ teamLeadId: null, departmentHeadId: null });
  });
});

describe('approverInCharge', () => {
  const leads = { teamLeadId: 'tia', departmentHeadId: 'dan' };

  it('the direct manager first', () => {
    expect(approverInCharge({ ...leads, managerId: 'mona', requesterId: 'ben' })).toEqual({ employeeId: 'mona', role: 'direct_manager' });
  });

  it('no direct manager: the team lead, else the head of department', () => {
    expect(approverInCharge({ ...leads, managerId: null, requesterId: 'ben' })).toEqual({ employeeId: 'tia', role: 'team_lead' });
    expect(approverInCharge({ teamLeadId: null, departmentHeadId: 'dan', managerId: null, requesterId: 'ben' })).toEqual({ employeeId: 'dan', role: 'department_head' });
  });

  it('never the requester themself: their own manager, team lead or head skips to the next', () => {
    expect(approverInCharge({ ...leads, managerId: 'ben', requesterId: 'ben' })).toEqual({ employeeId: 'tia', role: 'team_lead' });
    expect(approverInCharge({ ...leads, managerId: null, requesterId: 'tia' })).toEqual({ employeeId: 'dan', role: 'department_head' });
    expect(approverInCharge({ teamLeadId: null, departmentHeadId: 'dan', managerId: null, requesterId: 'dan' })).toBeNull();
    expect(approverInCharge({ teamLeadId: 'dan', departmentHeadId: 'dan', managerId: 'dan', requesterId: 'dan' })).toBeNull();
  });

  it('nobody in charge: null, straight to HR', () => {
    expect(approverInCharge({ teamLeadId: null, departmentHeadId: null, managerId: null, requesterId: 'ben' })).toBeNull();
  });
});

describe('suggestedManager', () => {
  it('hiring into a team: its lead, else its department’s head; never the person hired', () => {
    expect(suggestedManager({ teamLeadId: 'tia', departmentHeadId: 'dan' }, 'ben')).toEqual({ employeeId: 'tia', role: 'team_lead' });
    expect(suggestedManager({ teamLeadId: null, departmentHeadId: 'dan' }, 'ben')).toEqual({ employeeId: 'dan', role: 'department_head' });
    expect(suggestedManager({ teamLeadId: 'tia', departmentHeadId: 'dan' }, 'tia')).toEqual({ employeeId: 'dan', role: 'department_head' });
    expect(suggestedManager({ teamLeadId: null, departmentHeadId: 'dan' }, 'dan')).toBeNull();
  });

  it('a person not made yet (an offer’s candidate): the lead; no leads: none', () => {
    expect(suggestedManager({ teamLeadId: 'tia', departmentHeadId: null }, null)).toEqual({ employeeId: 'tia', role: 'team_lead' });
    expect(suggestedManager({ teamLeadId: null, departmentHeadId: null }, null)).toBeNull();
  });
});
