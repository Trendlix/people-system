import { additionReason, ADDITION_REASON_MAX, capsProblem, mayClaimType, useOf } from './rules.js';

// A reimbursement type's conditions as the API applies them (owner, 18 October 2026: "for specific preset up
// conditions", "in the setup i need to enter for it a cap").

describe('who may claim a type', () => {
  const place = { departmentId: 'team-a', parentDepartmentId: 'sales', gradeId: 'g3', employmentType: 'full_time' };
  const rules = (over: { departmentIds?: string[]; gradeIds?: string[]; employmentTypes?: string[] } = {}) => ({ departmentIds: [], gradeIds: [], employmentTypes: [], ...over });

  it('takes a department chosen with its teams', () => {
    expect(mayClaimType(rules({ departmentIds: ['team-a'] }), place)).toBe(true);
    expect(mayClaimType(rules({ departmentIds: ['sales'] }), place)).toBe(true);
    expect(mayClaimType(rules({ departmentIds: ['team-b'] }), place)).toBe(false);
    expect(mayClaimType(rules({ departmentIds: ['sales'] }), { ...place, departmentId: 'sales', parentDepartmentId: null })).toBe(true);
    expect(mayClaimType(rules({ departmentIds: ['team-a'] }), { ...place, departmentId: 'sales', parentDepartmentId: null })).toBe(false);
  });

  it('still needs the grade and the employment type chosen', () => {
    expect(mayClaimType(rules({ departmentIds: ['sales'], gradeIds: ['g4'] }), place)).toBe(false);
    expect(mayClaimType(rules({ departmentIds: ['sales'], employmentTypes: ['full_time'] }), place)).toBe(true);
    expect(mayClaimType(rules({ employmentTypes: ['part_time'] }), place)).toBe(false);
    expect(mayClaimType(rules(), { departmentId: null, parentDepartmentId: null, gradeId: null, employmentType: null })).toBe(true);
  });
});

describe('what the claims of a type take of its caps', () => {
  const claims = [
    { status: 'approved', amount: 300, approvedAmount: 250, expenseDate: '2026-10-02' },
    { status: 'with_hr', amount: 100.1, approvedAmount: null, expenseDate: '2026-10-15' },
    { status: 'rejected', amount: 900, approvedAmount: null, expenseDate: '2026-10-20' },
    { status: 'cancelled', amount: 50, approvedAmount: null, expenseDate: '2026-10-21' },
    { status: 'with_manager', amount: 70.2, approvedAmount: null, expenseDate: '2026-03-01' },
    { status: 'approved', amount: 1000, approvedAmount: 1000, expenseDate: '2025-10-05' },
  ];

  it('counts the expense’s month and calendar year, open and approved claims only', () => {
    expect(useOf(claims, '2026-10-31')).toEqual({ usedInMonth: 350.1, usedInYear: 420.3 });
    expect(useOf(claims, '2026-03-15')).toEqual({ usedInMonth: 70.2, usedInYear: 420.3 });
    expect(useOf(claims, '2025-10-01')).toEqual({ usedInMonth: 1000, usedInYear: 1000 });
    expect(useOf([], '2026-10-01')).toEqual({ usedInMonth: 0, usedInYear: 0 });
  });
});

describe('a type’s caps', () => {
  it('fit together: a claim’s no more than a month’s or a year’s, a month’s no more than a year’s', () => {
    expect(capsProblem({ capPerClaim: 500, capPerMonth: 500, capPerYear: 6000 })).toBeNull();
    expect(capsProblem({ capPerClaim: null, capPerMonth: null, capPerYear: null })).toBeNull();
    expect(capsProblem({ capPerClaim: 600, capPerMonth: 500, capPerYear: null })).toBe("The cap a claim (EGP 600.00) can't be more than the cap a month (EGP 500.00).");
    expect(capsProblem({ capPerClaim: null, capPerMonth: 1000, capPerYear: 999.99 })).toBe("The cap a month (EGP 1000.00) can't be more than the cap a year (EGP 999.99).");
    expect(capsProblem({ capPerClaim: 700, capPerMonth: null, capPerYear: 600 })).toBe("The cap a claim (EGP 700.00) can't be more than the cap a year (EGP 600.00).");
  });
});

describe('the reason the payroll addition is entered with', () => {
  it('is the type and what the expense was for, within what an addition takes', () => {
    expect(additionReason('Mobile bill', 'October  bill\nfor the client line')).toBe('Mobile bill: October bill for the client line');
    const long = additionReason('Travel', 'x'.repeat(600));
    expect(Array.from(long)).toHaveLength(ADDITION_REASON_MAX);
    expect(long.startsWith('Travel: xxx')).toBe(true);
    expect(long.endsWith('…')).toBe(true);
  });
});
