import {
  changesPayrollLine,
  CONFIDENTIAL_NOTE,
  confidentialExcludedNote,
  confidentialPeople,
  decidesConfidentialStage,
  hiddenLinesLabel,
  isConfidentialGrade,
  marksConfidentialGrade,
  seesConfidential,
  setsConfidentialGrade,
  type Role,
} from '@trendlix/shared';

// C-level people kept from HR (owner, 19 October 2026: "make C level Employees details not visible to HR"): the CEO and
// the Super Admin see and manage them; HR, Finance, Admin and managers see their directory card; the CEO fills their
// payroll lines and takes their requests' HR stages.

const as = (...roles: Role[]) => ({ roles });

describe('who sees C-level people', () => {
  it('is the CEO and a Super Admin, not HR, Finance, Admin nor a manager', () => {
    expect(seesConfidential(as('ceo'))).toBe(true);
    expect(seesConfidential(as('super_admin'))).toBe(true);
    expect(seesConfidential(as('hr', 'super_admin'))).toBe(true);
    for (const role of ['hr', 'finance', 'admin', 'manager', 'employee'] as const) expect(seesConfidential(as(role))).toBe(false);
    expect(seesConfidential(as('hr', 'finance', 'admin'))).toBe(false);
  });

  it('follows the grade’s flag', () => {
    expect(isConfidentialGrade({ confidential: true })).toBe(true);
    expect(isConfidentialGrade({ confidential: false })).toBe(false);
    expect(isConfidentialGrade(null)).toBe(false);
    expect(isConfidentialGrade(undefined)).toBe(false);
  });
});

describe('who gives and marks a C-level grade', () => {
  it('gives one: those who see C-level people', () => {
    expect(setsConfidentialGrade(as('hr'))).toBe(false);
    expect(setsConfidentialGrade(as('hr', 'super_admin'))).toBe(true);
    expect(setsConfidentialGrade(as('ceo'))).toBe(true);
  });

  it('marks a grade C-level: a Super Admin only, not the CEO nor HR', () => {
    expect(marksConfidentialGrade(as('super_admin'))).toBe(true);
    expect(marksConfidentialGrade(as('ceo'))).toBe(false);
    expect(marksConfidentialGrade(as('hr', 'admin'))).toBe(false);
  });
});

describe('who decides a C-level person’s HR and Finance stages', () => {
  it('is the CEO, or someone holding the stage’s role with Super Admin', () => {
    expect(decidesConfidentialStage(as('ceo'), ['hr'])).toBe(true);
    expect(decidesConfidentialStage(as('ceo'), ['finance'])).toBe(true);
    expect(decidesConfidentialStage(as('hr'), ['hr'])).toBe(false);
    expect(decidesConfidentialStage(as('finance'), ['finance'])).toBe(false);
    expect(decidesConfidentialStage(as('hr', 'super_admin'), ['hr'])).toBe(true);
    expect(decidesConfidentialStage(as('hr', 'super_admin'), ['finance'])).toBe(false);
    expect(decidesConfidentialStage(as('finance', 'super_admin'), ['finance'])).toBe(true);
    // a Super Admin without HR doesn't take HR's stage
    expect(decidesConfidentialStage(as('super_admin'), ['hr'])).toBe(false);
  });

  it('for a change of details (HR or Admin): the CEO or a Super Admin, who counts as an Admin', () => {
    expect(decidesConfidentialStage(as('super_admin'), ['hr', 'admin'])).toBe(true);
    expect(decidesConfidentialStage(as('ceo'), ['hr', 'admin'])).toBe(true);
    expect(decidesConfidentialStage(as('admin'), ['hr', 'admin'])).toBe(false);
    expect(decidesConfidentialStage(as('hr'), ['hr', 'admin'])).toBe(false);
  });
});

describe('who fills a payroll line', () => {
  it('is HR for anyone else, the CEO or HR with Super Admin for a C-level person', () => {
    expect(changesPayrollLine(as('hr'), false)).toBe(true);
    expect(changesPayrollLine(as('hr'), true)).toBe(false);
    expect(changesPayrollLine(as('ceo'), true)).toBe(true);
    expect(changesPayrollLine(as('ceo'), false)).toBe(false);
    expect(changesPayrollLine(as('hr', 'super_admin'), true)).toBe(true);
    expect(changesPayrollLine(as('super_admin'), true)).toBe(false);
    expect(changesPayrollLine(as('finance'), false)).toBe(false);
    expect(changesPayrollLine(as('ceo', 'hr'), false)).toBe(true);
  });
});

describe('what the screens say', () => {
  it('counts the people', () => {
    expect(confidentialPeople(1)).toBe('C-level (1 person)');
    expect(confidentialPeople(3)).toBe('C-level (3 people)');
    expect(hiddenLinesLabel(2)).toBe('C-level (2 people) — hidden');
  });

  it('notes who is left out, nothing when no one is', () => {
    expect(confidentialExcludedNote(0)).toBeNull();
    expect(confidentialExcludedNote(1)).toBe('C-level (1 person) is left out: only the CEO and the Super Admin see their amounts.');
    expect(confidentialExcludedNote(2)).toBe('C-level (2 people) are left out: only the CEO and the Super Admin see their amounts.');
    // the Contracts report has no amounts (25 October 2026)
    expect(confidentialExcludedNote(1, 'contracts')).toBe('C-level (1 person) is left out: only the CEO and the Super Admin see their contracts.');
    expect(CONFIDENTIAL_NOTE).toBe('C-level: only the CEO and the Super Admin see the rest.');
  });
});
