import { PAYROLL_RULE_DEFAULTS, type Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  addMonths,
  canSeePayroll,
  employeesLabel,
  hiddenTotalsText,
  isMonth,
  monthName,
  payrollSteps,
  rulesSummary,
  runActions,
  runMonths,
  runTitle,
  suggestedMonth,
} from './list';

const as = (...roles: Role[]) => ({ roles });

describe('who sees payroll', () => {
  it('is HR, Finance and the CEO: salary data', () => {
    expect(canSeePayroll(as('employee', 'hr'))).toBe(true);
    expect(canSeePayroll(as('finance'))).toBe(true);
    expect(canSeePayroll(as('ceo'))).toBe(true);
    // an Admin or a Super Admin only with one of those roles too
    expect(canSeePayroll(as('employee', 'admin'))).toBe(false);
    expect(canSeePayroll(as('employee', 'super_admin'))).toBe(false);
    expect(canSeePayroll(as('employee', 'manager'))).toBe(false);
  });
});

describe('months', () => {
  it('names a month and a run', () => {
    expect(monthName('2026-09')).toBe('September 2026');
    expect(monthName('2027-01')).toBe('January 2027');
    expect(runTitle('2026-09')).toBe('September 2026 Payroll');
    expect(monthName('not a month')).toBe('not a month');
  });

  it('counts months across years', () => {
    expect(addMonths('2026-01', -2)).toBe('2025-11');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-10', -12)).toBe('2025-10');
    expect(addMonths('2026-10', 0)).toBe('2026-10');
  });

  it('tells a payroll month from anything else', () => {
    expect(isMonth('2026-09')).toBe(true);
    expect(isMonth('2026-13')).toBe(false);
    expect(isMonth('2026-9')).toBe(false);
    expect(isMonth('2026-09-01')).toBe(false);
  });

  it('offers next month back to 12 months ago, newest first, as the API takes them', () => {
    const months = runMonths('2026-10-16');
    expect(months).toHaveLength(14);
    expect(months[0]).toBe('2026-11');
    expect(months[1]).toBe('2026-10');
    expect(months.at(-1)).toBe('2025-10');
    // across the turn of the year
    expect(runMonths('2026-01-05').slice(0, 3)).toEqual(['2026-02', '2026-01', '2025-12']);
  });

  it('suggests last month, else this month, else the newest month without a run', () => {
    const months = runMonths('2026-10-16');
    expect(suggestedMonth(months, [], '2026-10-16')).toBe('2026-09');
    expect(suggestedMonth(months, ['2026-09'], '2026-10-16')).toBe('2026-10');
    expect(suggestedMonth(months, ['2026-09', '2026-10'], '2026-10-16')).toBe('2026-11');
    expect(suggestedMonth(months, ['2026-11', '2026-10', '2026-09'], '2026-10-16')).toBe('2026-08');
    expect(suggestedMonth(months, months, '2026-10-16')).toBeNull();
  });
});

describe('where a run stands', () => {
  const states = (status: Parameters<typeof payrollSteps>[0]) => payrollSteps(status).map((s) => `${s.label}: ${s.state}`);

  it('steps from Draft to With the CEO, Approved and Paid', () => {
    expect(states('draft')).toEqual(['Draft: current', 'With the CEO: upcoming', 'Approved: upcoming', 'Paid: upcoming']);
    expect(states('pending_ceo')).toEqual(['Draft: done', 'With the CEO: current', 'Approved: upcoming', 'Paid: upcoming']);
    expect(states('approved')).toEqual(['Draft: done', 'With the CEO: done', 'Approved: current', 'Paid: upcoming']);
    // a paid run is done throughout
    expect(states('paid')).toEqual(['Draft: done', 'With the CEO: done', 'Approved: done', 'Paid: done']);
  });
});

describe('what each role may do on a run', () => {
  const allowed = (roles: Role[], status: Parameters<typeof runActions>[1]) =>
    Object.entries(runActions(as(...roles), status))
      .filter(([, yes]) => yes)
      .map(([action]) => action);

  it('lets HR prepare a draft, and mark an approved run paid', () => {
    expect(allowed(['hr'], 'draft')).toEqual(['editInputs', 'refresh', 'submit']);
    expect(allowed(['hr'], 'pending_ceo')).toEqual([]);
    expect(allowed(['hr'], 'approved')).toEqual(['markPaid', 'bankFiles']);
    expect(allowed(['hr'], 'paid')).toEqual(['bankFiles']);
  });

  it('lets only the CEO approve or return a run with the CEO, and waive an attendance deduction on it', () => {
    // the waiver (owner, 17 October 2026: "allow the CEO to wave the deduction by ticking a box")
    expect(allowed(['ceo'], 'pending_ceo')).toEqual(['approve', 'returnToHr', 'waiveAttendance']);
    expect(allowed(['ceo'], 'approved')).toEqual(['bankFiles']);
    expect(allowed(['ceo'], 'draft')).toEqual([]);
    expect(allowed(['hr', 'finance'], 'pending_ceo')).toEqual([]);
  });

  it('gives Finance the files only', () => {
    expect(allowed(['finance'], 'draft')).toEqual([]);
    expect(allowed(['finance'], 'approved')).toEqual(['bankFiles']);
  });

  it('lets a Super Admin delete a draft, and nothing after', () => {
    expect(runActions(as('hr', 'super_admin'), 'draft').delete).toBe(true);
    expect(runActions(as('hr', 'super_admin'), 'pending_ceo').delete).toBe(false);
    expect(runActions(as('hr', 'admin'), 'draft').delete).toBe(false);
  });
});

describe('the rules in words', () => {
  it('says each rule the run was worked out with', () => {
    expect(rulesSummary({ ...PAYROLL_RULE_DEFAULTS, payOvertime: true })).toEqual([
      'A month counts as 30 days, for day rates and part months.',
      'Attendance counts in full from 90%; below it, the fixed part follows it.',
      "The KPI (last month's final scorecard) counts in full from 80%; below it, the variable part follows it. With none, it isn't cut.",
      'Overtime is paid for attendance above 110%, at 1.5×.',
      "A no-show day costs 2 days' pay; its hours come out of the expected hours, so attendance doesn't count it again.",
    ]);
    // off from 16 October 2026 ("No overtime for now"); a run's rules from before the switch paid it
    expect(rulesSummary(PAYROLL_RULE_DEFAULTS)[3]).toBe('Overtime: not paid.');
    // as copied before the switch existed: none
    const older = { ...PAYROLL_RULE_DEFAULTS, payOvertime: undefined };
    expect(rulesSummary(older)[3]).toBe('Overtime is paid for attendance above 110%, at 1.5×.');
    expect(rulesSummary({ ...PAYROLL_RULE_DEFAULTS, noShowDayMultiplier: 1 }).at(-1)).toBe(
      "A no-show day costs 1 day's pay; its hours come out of the expected hours, so attendance doesn't count it again.",
    );
  });

  it('counts employees', () => {
    expect(employeesLabel(1)).toBe('1 employee');
    expect(employeesLabel(0)).toBe('0 employees');
    expect(employeesLabel(12)).toBe('12 employees');
  });
});

describe('a run’s totals in the lists, without the C-level people hidden from the caller (owner, 19 October 2026)', () => {
  it('say how many they leave out, and nothing when none', () => {
    expect(hiddenTotalsText(2)).toBe('Totals leave out C-level (2 people)');
    expect(hiddenTotalsText(1)).toBe('Totals leave out C-level (1 person)');
    expect(hiddenTotalsText(0)).toBeNull();
    // an API from before it
    expect(hiddenTotalsText(undefined)).toBeNull();
  });
});
