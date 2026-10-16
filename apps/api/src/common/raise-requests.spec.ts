import {
  hrDecisionOf,
  MAX_RAISE_PERCENT,
  RAISE_DECISION_DONE_LABELS,
  RAISE_DECISION_LABELS,
  RAISE_DECISIONS,
  RAISE_REASON_CHOICES,
  RAISE_REASON_LABELS,
  RAISE_REASON_LABELS_AR,
  RAISE_REASONS,
  RAISE_REQUEST_STEP_KINDS,
  RAISE_REQUEST_STEP_LABELS,
  raisedGross,
  raisedHourlyRate,
  raisedPay,
  raiseFigureProblem,
  raiseFiguresOf,
  raiseReasonOptions,
  suggestionKindsFor,
} from '@trendlix/shared';

// The rules of raise requests reworked (owner, 17 October 2026: "requesting a raise should have a drop list reason
// first ( Annual Raise - Performance Raise - Counter Offer Raise - etc..) then add requester comment, suggest raise amount
// or percentage, then the approver to Approve - Approve with another raise amount or percentge - Reject, and add a
// comment, all the request steps to be logged in the request"): packages/shared raises.ts.

describe('why the pay changes', () => {
  it('is picked from the list, in its order; adjustment stays for the versions from before, not offered', () => {
    expect(RAISE_REASON_CHOICES).toEqual(['annual', 'performance', 'counter_offer', 'promotion', 'market_adjustment', 'cost_of_living', 'other']);
    expect(RAISE_REASONS).toEqual([...RAISE_REASON_CHOICES.slice(0, 6), 'adjustment', 'other']);
    expect(RAISE_REASON_CHOICES.map((r) => RAISE_REASON_LABELS[r])).toEqual([
      'Annual raise',
      'Performance raise',
      'Counter-offer raise',
      'Promotion',
      'Market adjustment',
      'Cost of living',
      'Other',
    ]);
    expect(RAISE_REASON_LABELS.adjustment).toBe('Adjustment');
  });

  it('has an Arabic label for each, as the salary amendment letter prints it', () => {
    for (const r of RAISE_REASONS) expect(RAISE_REASON_LABELS_AR[r]).toMatch(/[؀-ۿ]/);
    expect(RAISE_REASON_LABELS_AR).toMatchObject({ annual: 'زيادة سنوية', promotion: 'ترقية', adjustment: 'تعديل الأجر', other: 'أخرى' });
    expect(new Set(Object.values(RAISE_REASON_LABELS_AR)).size).toBe(RAISE_REASONS.length);
  });

  it('a form offers the choices, and a version’s adjustment from before, kept before Other', () => {
    expect(raiseReasonOptions()).toEqual([...RAISE_REASON_CHOICES]);
    expect(raiseReasonOptions('annual')).toEqual([...RAISE_REASON_CHOICES]);
    expect(raiseReasonOptions('adjustment')).toEqual([...RAISE_REASON_CHOICES.slice(0, 6), 'adjustment', 'other']);
    expect(raiseReasonOptions('bonus')).toEqual([...RAISE_REASON_CHOICES]);
  });
});

describe('the suggested raise', () => {
  it('the employee and HR suggest an amount or a percent; a manager, who doesn’t see salaries, a percent only', () => {
    expect(suggestionKindsFor('self')).toEqual(['amount', 'percent']);
    expect(suggestionKindsFor('hr')).toEqual(['amount', 'percent']);
    expect(suggestionKindsFor('manager')).toEqual(['percent']);
  });

  it('is more than 0, to the piaster, and a percent up to 100', () => {
    expect(raiseFigureProblem({ kind: 'amount', value: 1500.5 })).toBeNull();
    expect(raiseFigureProblem({ kind: 'percent', value: 7.25 })).toBeNull();
    expect(raiseFigureProblem({ kind: 'percent', value: MAX_RAISE_PERCENT })).toBeNull();
    expect(raiseFigureProblem({ kind: 'amount', value: 0 })).toMatch(/more than 0/);
    expect(raiseFigureProblem({ kind: 'percent', value: -5 })).toMatch(/more than 0/);
    expect(raiseFigureProblem({ kind: 'amount', value: Number.NaN })).toMatch(/more than 0/);
    expect(raiseFigureProblem({ kind: 'amount', value: 10.005 })).toMatch(/to the piaster/);
    expect(raiseFigureProblem({ kind: 'percent', value: 7.125 })).toMatch(/two decimals/);
    expect(raiseFigureProblem({ kind: 'percent', value: 100.01 })).toBe('A raise is 100% of the gross at most.');
  });
});

describe('the gross a raise comes to', () => {
  it('an amount is added to the gross, to the piaster', () => {
    expect(raisedGross(10000, { kind: 'amount', value: 1500 })).toBe(11500);
    expect(raisedGross(12345.67, { kind: 'amount', value: 0.33 })).toBe(12346);
    expect(raisedGross(0.1, { kind: 'amount', value: 0.2 })).toBe(0.3);
  });

  it('a percent of the gross is added, rounded half up to the piaster', () => {
    expect(raisedGross(10000, { kind: 'percent', value: 10 })).toBe(11000);
    // 12,345.67 × 1.075 = 13,271.59525
    expect(raisedGross(12345.67, { kind: 'percent', value: 7.5 })).toBe(13271.6);
    // 9,999.99 × 1.0333 = 10,332.989667; 1,000.01 × 1.005 = 1,005.01005
    expect(raisedGross(9999.99, { kind: 'percent', value: 3.33 })).toBe(10332.99);
    expect(raisedGross(1000.01, { kind: 'percent', value: 0.5 })).toBe(1005.01);
    // exactly half a piaster rounds up: 0.30 × 1.05 = 0.315
    expect(raisedGross(0.3, { kind: 'percent', value: 5 })).toBe(0.32);
    expect(raisedGross(15000, { kind: 'percent', value: 100 })).toBe(30000);
  });

  it('by the hour, the rate: a percent of it, or an amount a month spread over the month’s hours', () => {
    expect(raisedHourlyRate(150, 20, { kind: 'percent', value: 10 })).toBe(165);
    // 1,000 a month over 20 hours × 52 ÷ 12 = 86.67 hours: 11.538… an hour
    expect(raisedHourlyRate(150, 20, { kind: 'amount', value: 1000 })).toBe(161.54);
    expect(raisedPay({ payBasis: 'hourly', grossSalary: 13000, hourlyRate: 150, hoursPerWeek: 20 }, { kind: 'percent', value: 10 })).toEqual({
      grossSalary: 14300,
      hourlyRate: 165,
      hoursPerWeek: 20,
    });
    // the raise's own hours
    expect(raisedPay({ payBasis: 'hourly', grossSalary: 13000, hourlyRate: 150, hoursPerWeek: 20 }, { kind: 'percent', value: 10 }, 24).grossSalary).toBe(17160);
    expect(raisedPay({ payBasis: 'monthly', grossSalary: 13000, hourlyRate: null, hoursPerWeek: null }, { kind: 'amount', value: 700 })).toEqual({
      grossSalary: 13700,
      hourlyRate: null,
      hoursPerWeek: null,
    });
  });

  it('a change of gross in both figures: the amount, and the percent to two decimals', () => {
    expect(raiseFiguresOf(10000, 11500)).toEqual({ amount: 1500, percent: 15 });
    expect(raiseFiguresOf(12345.67, 13271.6)).toEqual({ amount: 925.93, percent: 7.5 });
    expect(raiseFiguresOf(9000, 9999)).toEqual({ amount: 999, percent: 11.1 });
    expect(raiseFiguresOf(0, 5000)).toEqual({ amount: 5000, percent: null });
  });
});

describe('the decisions', () => {
  it('approve, approve with another raise or reject, worded for the buttons and the log', () => {
    expect(RAISE_DECISIONS).toEqual(['approve', 'approve_other', 'reject']);
    expect(RAISE_DECISIONS.map((d) => RAISE_DECISION_LABELS[d])).toEqual(['Approve', 'Approve with another raise', 'Reject']);
    expect(RAISE_DECISIONS.map((d) => RAISE_DECISION_DONE_LABELS[d])).toEqual(['Approved', 'Approved with another raise', 'Rejected']);
  });

  it('HR’s, in the whole raise form: as suggested when the gross is the suggestion’s, else with another raise', () => {
    expect(hrDecisionOf(11000, 11000)).toBe('approve');
    expect(hrDecisionOf(11000, 11000.004)).toBe('approve');
    expect(hrDecisionOf(11000, 11500)).toBe('approve_other');
    expect(hrDecisionOf(null, 11500)).toBe('approve_other');
  });
});

describe('the log', () => {
  it('names every step, in the order a request goes through them', () => {
    expect(RAISE_REQUEST_STEP_KINDS).toEqual(['submitted', 'hr_decision', 'prepared', 'sent', 'ceo_decision', 'returned', 'changed', 'signed', 'unsigned', 'raise_deleted']);
    expect(RAISE_REQUEST_STEP_KINDS.map((k) => RAISE_REQUEST_STEP_LABELS[k])).toEqual([
      'Submitted',
      "HR's decision",
      'Raise prepared',
      'Sent to the CEO',
      "The CEO's decision",
      'Returned to HR',
      'Raise changed',
      'Signed',
      'Signing undone',
      'Raise deleted',
    ]);
  });
});
