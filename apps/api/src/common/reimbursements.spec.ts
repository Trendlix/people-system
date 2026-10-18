import {
  amountCounted,
  decisionNeedsComment,
  decisionStepKind,
  firstReimbursementStatus,
  isOpenReimbursement,
  lowerAmountProblem,
  mayClaimReimbursement,
  REIMBURSEMENT_DECISIONS,
  REIMBURSEMENT_OPEN_STATUSES,
  REIMBURSEMENT_STATUSES,
  REIMBURSEMENT_STEP_KINDS,
  reimbursementLeft,
  reimbursementMost,
  reimbursementPayMonth,
  reimbursementProblems,
  reimbursementRulesText,
  reimbursementStage,
  statusAfterApproval,
  type ReimbursementRules,
} from '@trendlix/shared';

// The rules of reimbursement claims (owner, 18 October 2026: "allow the employee to add reimbursement request … for
// specific preset up conditions", and "in the setup i need to enter for it a cap"): packages/shared reimbursements.ts.

const RULES: ReimbursementRules = {
  receiptRequired: false,
  capPerClaim: null,
  capPerMonth: null,
  capPerYear: null,
  claimWithinDays: null,
  departmentIds: [],
  gradeIds: [],
  employmentTypes: [],
};
const NONE = { usedInMonth: 0, usedInYear: 0 };
const TODAY = '2026-10-18';
const claim = (over: Partial<{ amount: number; expenseDate: string; receipts: number }> = {}) => ({ amount: 250, expenseDate: '2026-10-10', today: TODAY, receipts: 1, ...over });

describe('where a claim is', () => {
  it('goes to the direct manager, then HR, then Finance; straight to HR without a manager', () => {
    expect(REIMBURSEMENT_STATUSES).toEqual(['with_manager', 'with_hr', 'with_finance', 'approved', 'rejected', 'cancelled']);
    expect(firstReimbursementStatus(true)).toBe('with_manager');
    expect(firstReimbursementStatus(false)).toBe('with_hr');
    expect((['manager', 'hr', 'finance'] as const).map(statusAfterApproval)).toEqual(['with_hr', 'with_finance', 'approved']);
  });

  it('has a stage only while it is being decided, when its employee may cancel it', () => {
    expect(REIMBURSEMENT_STATUSES.map(reimbursementStage)).toEqual(['manager', 'hr', 'finance', null, null, null]);
    expect(REIMBURSEMENT_STATUSES.filter(isOpenReimbursement)).toEqual([...REIMBURSEMENT_OPEN_STATUSES]);
    expect(isOpenReimbursement('unknown')).toBe(false);
  });

  it('logs each stage’s decision as its own step; a lower amount and a rejection need a comment', () => {
    expect(REIMBURSEMENT_STEP_KINDS).toEqual(['submitted', 'no_manager', 'manager_decision', 'hr_decision', 'finance_decision', 'cancelled', 'added_to_payroll']);
    expect((['manager', 'hr', 'finance'] as const).map(decisionStepKind)).toEqual(['manager_decision', 'hr_decision', 'finance_decision']);
    expect(REIMBURSEMENT_DECISIONS.map(decisionNeedsComment)).toEqual([false, true, true]);
  });
});

describe('who may claim a type', () => {
  const who = { departmentId: 'd1', gradeId: 'g1', employmentType: 'full_time' };

  it('is everyone when nothing is chosen', () => {
    expect(mayClaimReimbursement(RULES, who)).toBe(true);
    expect(mayClaimReimbursement(RULES, { departmentId: null, gradeId: null, employmentType: null })).toBe(true);
  });

  it('is someone in every list chosen', () => {
    expect(mayClaimReimbursement({ ...RULES, departmentIds: ['d1', 'd2'] }, who)).toBe(true);
    expect(mayClaimReimbursement({ ...RULES, departmentIds: ['d2'] }, who)).toBe(false);
    expect(mayClaimReimbursement({ ...RULES, gradeIds: ['g1'], employmentTypes: ['full_time'] }, who)).toBe(true);
    expect(mayClaimReimbursement({ ...RULES, gradeIds: ['g1'], employmentTypes: ['part_time'] }, who)).toBe(false);
    // no grade, or no department: not in a list chosen
    expect(mayClaimReimbursement({ ...RULES, gradeIds: ['g1'] }, { ...who, gradeId: null })).toBe(false);
    expect(mayClaimReimbursement({ ...RULES, departmentIds: ['d1'] }, { ...who, departmentId: null })).toBe(false);
  });
});

describe('what a claim takes of the caps', () => {
  it('is nothing once rejected or cancelled; else the amount last approved, or as claimed', () => {
    expect(amountCounted({ status: 'rejected', amount: 300, approvedAmount: 200 })).toBe(0);
    expect(amountCounted({ status: 'cancelled', amount: 300, approvedAmount: null })).toBe(0);
    expect(amountCounted({ status: 'with_manager', amount: 300, approvedAmount: null })).toBe(300);
    expect(amountCounted({ status: 'with_finance', amount: 300, approvedAmount: 250.5 })).toBe(250.5);
    expect(amountCounted({ status: 'approved', amount: 300, approvedAmount: 300 })).toBe(300);
  });

  it('leaves what the caps allow, never below 0, the most being the smallest', () => {
    const caps = { capPerClaim: 500, capPerMonth: 1000, capPerYear: 5000 };
    expect(reimbursementLeft(caps, { usedInMonth: 800.25, usedInYear: 4900 })).toEqual({ claim: 500, month: 199.75, year: 100 });
    expect(reimbursementLeft(caps, { usedInMonth: 1200, usedInYear: 1200 })).toEqual({ claim: 500, month: 0, year: 3800 });
    expect(reimbursementMost(caps, { usedInMonth: 800.25, usedInYear: 4900 })).toBe(100);
    expect(reimbursementMost({ capPerClaim: null, capPerMonth: null, capPerYear: null }, NONE)).toBeNull();
    expect(reimbursementLeft({ capPerClaim: null, capPerMonth: 300, capPerYear: null }, NONE)).toEqual({ claim: null, month: 300, year: null });
  });
});

describe('why a claim can’t be sent', () => {
  it('is nothing for a claim within every condition', () => {
    const rules = { ...RULES, receiptRequired: true, capPerClaim: 500, capPerMonth: 1000, capPerYear: 5000, claimWithinDays: 30 };
    expect(reimbursementProblems(claim(), rules, NONE)).toEqual([]);
    // exactly at each limit
    expect(reimbursementProblems(claim({ amount: 500, expenseDate: '2026-09-18' }), rules, { usedInMonth: 500, usedInYear: 4500 })).toEqual([]);
  });

  it('wants an amount of more than 0, to the piaster', () => {
    const message = 'Enter the amount spent, more than 0, e.g. 250 or 250.50.';
    for (const amount of [0, -5, 250.555, Number.NaN]) expect(reimbursementProblems(claim({ amount }), RULES, NONE)).toEqual([message]);
    // the caps aren't weighed against an amount that isn't one
    expect(reimbursementProblems(claim({ amount: 0 }), { ...RULES, capPerClaim: 100 }, NONE)).toEqual([message]);
  });

  it('wants the expense’s date, not after today', () => {
    expect(reimbursementProblems(claim({ expenseDate: '18/10/2026' }), RULES, NONE)).toEqual(['Enter the date of the expense.']);
    expect(reimbursementProblems(claim({ expenseDate: '2026-10-19' }), RULES, NONE)).toEqual(["The expense's date can't be after today."]);
    expect(reimbursementProblems(claim({ expenseDate: TODAY }), RULES, NONE)).toEqual([]);
  });

  it('keeps to the claim deadline, in days after the expense', () => {
    const rules = { ...RULES, claimWithinDays: 30 };
    expect(reimbursementProblems(claim({ expenseDate: '2026-09-18' }), rules, NONE)).toEqual([]);
    expect(reimbursementProblems(claim({ expenseDate: '2026-09-17' }), rules, NONE)).toEqual(['This type must be claimed within 30 days of the expense; this one was 31 days ago.']);
    expect(reimbursementProblems(claim({ expenseDate: '2026-10-16' }), { ...RULES, claimWithinDays: 1 }, NONE)).toEqual([
      'This type must be claimed within 1 day of the expense; this one was 2 days ago.',
    ]);
  });

  it('wants a receipt when the type does', () => {
    expect(reimbursementProblems(claim({ receipts: 0 }), { ...RULES, receiptRequired: true }, NONE)).toEqual(['Attach the receipt: this type needs one.']);
    expect(reimbursementProblems(claim({ receipts: 0 }), RULES, NONE)).toEqual([]);
  });

  it('keeps within each cap: a claim, what is left of the month and of the year', () => {
    expect(reimbursementProblems(claim({ amount: 500.01 }), { ...RULES, capPerClaim: 500 }, NONE)).toEqual(['At most EGP 500.00 can be claimed at once for this type.']);
    expect(reimbursementProblems(claim({ amount: 250 }), { ...RULES, capPerMonth: 1000 }, { usedInMonth: 800, usedInYear: 800 })).toEqual([
      "Only EGP 200.00 is left of this type's EGP 1000.00 for the expense's month.",
    ]);
    expect(reimbursementProblems(claim({ amount: 250 }), { ...RULES, capPerYear: 3000 }, { usedInMonth: 0, usedInYear: 2900 })).toEqual([
      "Only EGP 100.00 is left of this type's EGP 3000.00 for the expense's year.",
    ]);
  });

  it('says every reason, in the order to fix them', () => {
    const rules = { ...RULES, receiptRequired: true, capPerClaim: 100, capPerMonth: 150, claimWithinDays: 5 };
    expect(reimbursementProblems(claim({ amount: 200, expenseDate: '2026-10-01', receipts: 0 }), rules, { usedInMonth: 0, usedInYear: 0 })).toEqual([
      'This type must be claimed within 5 days of the expense; this one was 17 days ago.',
      'Attach the receipt: this type needs one.',
      'At most EGP 100.00 can be claimed at once for this type.',
      "Only EGP 150.00 is left of this type's EGP 150.00 for the expense's month.",
    ]);
  });
});

describe('a lower amount approved', () => {
  it('is more than 0, to the piaster, and less than the amount it is decided on', () => {
    expect(lowerAmountProblem(200, 250)).toBeNull();
    expect(lowerAmountProblem(249.99, 250)).toBeNull();
    for (const amount of [0, -1, 100.005]) expect(lowerAmountProblem(amount, 250)).toBe('Enter the amount approved, more than 0, e.g. 250 or 250.50.');
    expect(lowerAmountProblem(250, 250)).toBe('The amount approved must be less than 250.00. To approve the whole amount, choose Approve.');
    expect(lowerAmountProblem(300, 250.5)).toBe('The amount approved must be less than 250.50. To approve the whole amount, choose Approve.');
  });
});

describe('the payroll a claim is paid with', () => {
  it('is the month it is approved in, or the first after it whose run isn’t approved or paid', () => {
    expect(reimbursementPayMonth('2026-10-18', [])).toBe('2026-10-01');
    expect(reimbursementPayMonth('2026-10-18', ['2026-09-01'])).toBe('2026-10-01');
    expect(reimbursementPayMonth('2026-10-18', ['2026-10-01'])).toBe('2026-11-01');
    expect(reimbursementPayMonth('2026-10-18', ['2026-10-01', '2026-11-01', '2026-12-01'])).toBe('2027-01-01');
    expect(reimbursementPayMonth('2026-12-31', ['2026-12-01'])).toBe('2027-01-01');
  });
});

describe('a type’s conditions, in short', () => {
  it('says the receipt, the caps and the deadline', () => {
    expect(reimbursementRulesText({ receiptRequired: true, capPerClaim: 500, capPerMonth: 1000, capPerYear: null, claimWithinDays: 30 })).toBe(
      'Receipt needed · Up to EGP 500.00 a claim, 1,000.00 a month · Within 30 days of the expense',
    );
    expect(reimbursementRulesText({ receiptRequired: false, capPerClaim: null, capPerMonth: null, capPerYear: null, claimWithinDays: null })).toBe('No receipt needed · No cap');
  });
});
