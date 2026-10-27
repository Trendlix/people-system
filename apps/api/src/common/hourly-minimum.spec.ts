import {
  EMPTY_PAYROLL_INPUTS,
  hourlyMinimumFor,
  hourlyMinimumLine,
  monthlyFromHourly,
  paidDaysIn,
  payEvents,
  payrollLine,
  samePay,
  type PayrollInputs,
  type PayrollTerms,
  type PayTerms,
  type PayVersion,
} from '@trendlix/shared';

// A minimum a month for pay by the hour (owner, 27 October 2026: "can i add rate per hour with a minimum monthly
// payment?"; he chose "On each contract": "The payroll pays hours × rate, or the minimum if that's higher", and "Prorated
// by days": "Joined on the 16th of a 31-day month: the minimum is 16/31 of it. This matches how monthly salaries are paid
// for a part month"). Invented figures, the owner's example first: rate 250, 20 hours a week, minimum 12,000.

const inputs = (given: Partial<PayrollInputs> = {}): PayrollInputs => ({ ...EMPTY_PAYROLL_INPUTS, ...given });

/** Rate 250 for 20 hours a week (a monthly estimate of 21,666.67), a minimum of 12,000, a whole month. */
const hourly: PayrollTerms = {
  year: 2026,
  payBasis: 'hourly',
  gross: monthlyFromHourly(250, 20),
  basicPercent: 80,
  hourlyRate: 250,
  hourlyMinimum: 12_000,
  allowances: [],
  paidDays: 30,
  statutory: true,
  insured: true,
  insuredWage: 12_000,
  hoursPerDay: null,
};

describe('payroll: by the hour with a minimum a month', () => {
  it('tops the hours up to the minimum: 32 h × 250 = 8,000, paid 12,000 (the owner’s October)', () => {
    const line = payrollLine(hourly, inputs({ workedHours: 32 }));
    expect(line).toMatchObject({ fixed: 12_000, hourlyTopUp: 4_000, variable: 0, earned: 12_000, parts: [{ contractId: null, fixed: 12_000, variable: 0, allowances: 0 }] });
    expect(line.warnings).toEqual([]);
    // taxed and insured as any pay earned: the same as a monthly salary of 12,000 with the same insured wage
    const monthly = payrollLine({ ...hourly, payBasis: 'monthly', gross: 12_000, hourlyRate: null, hourlyMinimum: null }, inputs());
    expect(line.net).toBe(monthly.net);
  });

  it('pays the hours when they come to the minimum or more: no top-up', () => {
    const more = payrollLine(hourly, inputs({ workedHours: 80 }));
    expect(more).toMatchObject({ fixed: 20_000, earned: 20_000 });
    expect(more).not.toHaveProperty('hourlyTopUp');
    // exactly the minimum: 48 h × 250
    const equal = payrollLine(hourly, inputs({ workedHours: 48 }));
    expect(equal.fixed).toBe(12_000);
    expect(equal).not.toHaveProperty('hourlyTopUp');
  });

  it('prorates the minimum by days for a part month, as a monthly salary: the minimum × the days paid ÷ 30', () => {
    // joined on 16 October (31 days): 16 days paid, as a monthly salary's are
    const paidDays = paidDaysIn('2026-10', '2026-10-16', null, 30);
    expect(paidDays).toBe(16);
    expect(hourlyMinimumFor({ ...hourly, paidDays }, 30)).toBe(6_400);
    // 10 h × 250 = 2,500, topped up to 6,400
    const line = payrollLine({ ...hourly, paidDays }, inputs({ workedHours: 10 }));
    expect(line).toMatchObject({ fixed: 6_400, hourlyTopUp: 3_900, earned: 6_400 });
    expect(line.warnings).toEqual(['Paid for 16 of 30 days: employed or under contract for part of the month']);
    // the same days of a monthly salary of 12,000 pay the same
    expect(payrollLine({ ...hourly, payBasis: 'monthly', gross: 12_000, basicPercent: 100, hourlyRate: null, hourlyMinimum: null, paidDays }, inputs()).fixed).toBe(6_400);
    // to the piaster: 7 of 30 days of 1,000.01
    expect(hourlyMinimumFor({ ...hourly, hourlyMinimum: 1_000.01, paidDays: 7 }, 30)).toBe(233.34);
  });

  it('pays the minimum without worked hours, and says so', () => {
    const line = payrollLine(hourly, inputs());
    expect(line).toMatchObject({ fixed: 12_000, hourlyTopUp: 12_000, earned: 12_000 });
    expect(line.warnings).toEqual(['Paid by the hour, but no worked hours are given: only the minimum a month is paid']);
  });

  it('without a minimum, as before: the hours alone, missing on a line saved before 27 October 2026 too', () => {
    const { hourlyMinimum: _gone, ...before } = hourly;
    for (const terms of [before, { ...hourly, hourlyMinimum: null }]) {
      const line = payrollLine(terms, inputs({ workedHours: 32 }));
      expect(line).toMatchObject({ fixed: 8_000, earned: 8_000 });
      expect(line).not.toHaveProperty('hourlyTopUp');
      expect(payrollLine(terms, inputs()).warnings).toEqual(['Paid by the hour, but no worked hours are given: nothing is paid for hours', 'The net is below 0: the cuts and deductions are more than the pay']);
    }
  });

  it('is by the hour’s alone: a monthly salary never has one', () => {
    expect(hourlyMinimumFor({ payBasis: 'monthly', hourlyMinimum: 12_000, paidDays: 30 }, 30)).toBe(0);
    expect(hourlyMinimumFor({ payBasis: 'hourly', hourlyMinimum: 0, paidDays: 30 }, 30)).toBe(0);
    expect(hourlyMinimumFor({ payBasis: 'hourly', hourlyMinimum: 12_000, paidDays: 30 }, 30)).toBe(12_000);
  });
});

describe('a minimum a month is pay', () => {
  const pay: PayTerms = { payBasis: 'hourly', grossSalary: 21_666.67, hourlyRate: 250, hoursPerWeek: 20, hourlyMinimum: 12_000, basicPercent: 80, allowances: [] };

  it('samePay notices a new minimum, a minimum added or taken off; left out reads as none', () => {
    expect(samePay(pay, { ...pay })).toBe(true);
    expect(samePay(pay, { ...pay, hourlyMinimum: 12_000.0 })).toBe(true);
    expect(samePay(pay, { ...pay, hourlyMinimum: 14_000 })).toBe(false);
    expect(samePay(pay, { ...pay, hourlyMinimum: null })).toBe(false);
    const { hourlyMinimum: _gone, ...none } = pay;
    expect(samePay(none, { ...pay, hourlyMinimum: null })).toBe(true);
    expect(samePay(none, pay)).toBe(false);
  });

  it('the salary history counts a new minimum as new pay, and shows it', () => {
    const version = (over: Partial<PayVersion>): PayVersion => ({
      id: 'c1',
      number: 'CON-2026-0001',
      version: 1,
      kind: 'contract',
      status: 'active',
      approval: null,
      returnedReason: null,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      payBasis: 'hourly',
      grossSalary: 21_666.67,
      hourlyRate: 250,
      hourlyMinimum: 12_000,
      allowances: [],
      raiseReason: null,
      newJobTitle: null,
      newGrade: null,
      approvedBy: null,
      approvedAt: null,
      signedOn: '2026-01-01',
      insuredWageFrom: null,
      ...over,
    });
    const [hire, raise] = payEvents([
      version({}),
      version({ id: 'c2', number: 'CON-2026-0001-A1', version: 2, kind: 'amendment', startDate: '2026-06-01', hourlyMinimum: 14_000, approval: 'approved', raiseReason: 'annual' }),
    ]);
    expect(hire.hourlyMinimum).toBe(12_000);
    expect(raise).toMatchObject({ hourlyMinimum: 14_000, samePay: false, raise: true });
    const [, same] = payEvents([version({}), version({ id: 'c2', version: 2, startDate: '2027-01-01' })]);
    expect(same.samePay).toBe(true);
    // none on a monthly salary
    expect(payEvents([version({ payBasis: 'monthly', hourlyRate: null, hourlyMinimum: null })])[0]).not.toHaveProperty('hourlyMinimum');
  });
});

describe('the printed line', () => {
  const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  it('says the minimum in English and Arabic; blank without one', () => {
    expect(hourlyMinimumLine(12_000, money)).toBe('A minimum of 12,000.00 a month: paid when the hours worked come to less, prorated by days for a part month');
    expect(hourlyMinimumLine(12_000, money, 'ar')).toBe('حد أدنى شهري قدره 12,000.00، يُصرف إذا قلّ أجر ساعات العمل الفعلية عنه، ويُحتسب بنسبة الأيام عن الشهر غير الكامل');
    expect(hourlyMinimumLine(null, money)).toBe('');
    expect(hourlyMinimumLine(0, money, 'ar')).toBe('');
  });
});
