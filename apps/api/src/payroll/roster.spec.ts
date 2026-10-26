import { payrollLine, EMPTY_PAYROLL_INPUTS } from '@trendlix/shared';
import { contractParts, EARLIER_EMPLOYMENT, NO_CONTRACT, roster, type RosterEmployment } from './roster.js';

// Who is on a month's payroll and on what terms (owner's decisions, 16 October 2026). Everyone here is invented.

const SUN_TO_THU = [0, 1, 2, 3, 4];

let n = 0;
function employment(over: Partial<RosterEmployment> = {}, employee: Partial<RosterEmployment['employee']> = {}): RosterEmployment {
  n += 1;
  return {
    id: `employment-${n}`,
    employmentType: 'full_time',
    joinDate: '2025-01-01',
    endDate: null,
    department: { nameEn: 'Accounts', parent: { nameEn: 'Sales' } },
    jobTitle: 'Account Manager',
    // Sunday to Thursday, as the seeded shifts
    shift: { startTime: '09:00', endTime: '18:00', workingDays: SUN_TO_THU },
    employee: { id: `employee-${n}`, employeeCode: `EMP-${String(n).padStart(4, '0')}`, fullNameEn: `Person ${n}`, socialInsured: true, insuranceComprehensiveWage: null, ...employee },
    contracts: [contract()],
    ...over,
  };
}

function contract(over: Partial<RosterEmployment['contracts'][number]> = {}): RosterEmployment['contracts'][number] {
  n += 1;
  return {
    id: `contract-${n}`,
    number: `CON-2025-${String(n).padStart(4, '0')}`,
    version: 1,
    startDate: '2025-01-01',
    endDate: '2026-12-31',
    payBasis: 'monthly',
    grossSalary: 12000,
    basicPercent: 80,
    hourlyRate: null,
    allowances: [{ nameEn: 'Transport', amount: 1000, taxable: true, insured: false }],
    ...over,
  };
}

const rules = { dayDivisor: 30 };

describe('roster', () => {
  it('takes the contract in force, its terms, and the profile’s social insurance for the run’s year', () => {
    const e = employment();
    const { lines, exclusions } = roster('2026-09', [e], rules);
    expect(exclusions).toEqual([]);
    expect(lines).toEqual([
      {
        employeeId: e.employee.id,
        employmentId: e.id,
        contractId: e.contracts[0].id,
        employeeCode: e.employee.employeeCode,
        nameEn: e.employee.fullNameEn,
        department: 'Sales › Accounts',
        jobTitle: 'Account Manager',
        employmentType: 'full_time',
        payBasis: 'monthly',
        terms: {
          year: 2026,
          payBasis: 'monthly',
          gross: 12000,
          basicPercent: 80,
          hourlyRate: null,
          allowances: [{ name: 'Transport', amount: 1000, taxable: true, insured: false }],
          paidDays: 30,
          statutory: true,
          insured: true,
          // the comprehensive wage (gross and allowances) within 2026's limits
          insuredWage: 13000,
          // the shift's 09:00 to 18:00
          hoursPerDay: 9,
          // September 2026 has 22 Sundays to Thursdays, no holidays given: 22 days of 9 hours
          expectedHours: 198,
          expectedDays: { workingDays: 22, holidays: 0 },
          // the whole month under the one contract (17 October 2026)
          segments: [
            {
              contractId: e.contracts[0].id,
              number: e.contracts[0].number,
              version: 1,
              from: '2026-09-01',
              to: '2026-09-30',
              days: 30,
              payBasis: 'monthly',
              gross: 12000,
              basicPercent: 80,
              hourlyRate: null,
              allowances: [{ name: 'Transport', amount: 1000, taxable: true, insured: false }],
            },
          ],
        },
      },
    ]);
  });

  it('uses the employee’s own comprehensive wage, capped at the year’s maximum; freelancers are not statutory', () => {
    const own = employment({}, { insuranceComprehensiveWage: 30000, socialInsured: false });
    const freelance = employment({ employmentType: 'freelance' });
    const { lines } = roster('2026-09', [own, freelance], rules);
    const terms = (id: string) => lines.find((l) => l.employeeId === id)!.terms;
    expect(terms(own.employee.id)).toMatchObject({ insuredWage: 16700, insured: false, statutory: true });
    expect(terms(freelance.employee.id)).toMatchObject({ statutory: false });
  });

  it('takes a working day’s hours from the employment’s shift, past midnight too; none without a shift', () => {
    const half = employment({ shift: { startTime: '09:00', endTime: '17:30', workingDays: SUN_TO_THU } });
    const night = employment({ shift: { startTime: '22:00', endTime: '06:00', workingDays: SUN_TO_THU } });
    const none = employment({ shift: null });
    const { lines } = roster('2026-09', [half, night, none], rules);
    const hours = (e: RosterEmployment) => lines.find((l) => l.employeeId === e.employee.id)!.terms.hoursPerDay;
    expect([hours(half), hours(night), hours(none)]).toEqual([8.5, 8, null]);
  });

  it('pays a joiner or a leaver for the days employed in the month', () => {
    const joiner = employment({ joinDate: '2026-09-12', contracts: [contract({ startDate: '2026-09-12', endDate: '2027-09-11' })] });
    const leaver = employment({ endDate: '2026-09-10' });
    const { lines } = roster('2026-09', [joiner, leaver], rules);
    expect(lines.find((l) => l.employeeId === joiner.employee.id)!.terms.paidDays).toBe(19);
    expect(lines.find((l) => l.employeeId === leaver.employee.id)!.terms.paidDays).toBe(10);
  });

  // owner's report, 27 October 2026: a leaver with an approved ending (last working day the 20th), not yet completed, was
  // paid 30/30 days with expected hours for the whole month and no-shows after they left
  it('ends the month on an approved ending’s last working day, the line saying so; the end date wins when earlier', () => {
    const leaving = employment({ leavingOn: '2026-09-20' });
    const endedFirst = employment({ endDate: '2026-09-10', leavingOn: '2026-09-20' });
    const leavingLater = employment({ leavingOn: '2026-10-05' });
    const left = employment({ leavingOn: '2026-08-31' });
    const { lines, exclusions } = roster('2026-09', [leaving, endedFirst, leavingLater, left], rules);
    const terms = (e: RosterEmployment) => lines.find((l) => l.employeeId === e.employee.id)!.terms;
    // 1 to 20 September: 14 Sundays to Thursdays of 9 hours
    expect(terms(leaving)).toMatchObject({ paidDays: 20, leavingOn: '2026-09-20', expectedHours: 126, expectedDays: { workingDays: 14, holidays: 0 } });
    expect(terms(leaving).segments!.map((s) => [s.from, s.to, s.days])).toEqual([['2026-09-01', '2026-09-20', 20]]);
    expect(terms(endedFirst)).toMatchObject({ paidDays: 10 });
    expect(terms(endedFirst).leavingOn).toBeUndefined();
    expect(terms(leavingLater)).toMatchObject({ paidDays: 30 });
    expect(terms(leavingLater).leavingOn).toBeUndefined();
    // left before the month: not on it
    expect(lines.some((l) => l.employeeId === left.employee.id)).toBe(false);
    expect(exclusions).toEqual([]);
  });

  it('leaves out someone with no signed contract in force; with two (a renewal mid-month), the line is the later one’s', () => {
    const none = employment({ contracts: [] });
    const expired = employment({ contracts: [contract({ endDate: '2026-08-31' })] });
    const notYet = employment({ contracts: [contract({ startDate: '2026-10-01' })] });
    // the leaver's contract started after their last day
    const leftFirst = employment({ endDate: '2026-09-05', contracts: [contract({ startDate: '2026-09-06' })] });
    const renewed = employment({ contracts: [contract({ endDate: '2026-09-14' }), contract({ id: 'renewal', version: 2, startDate: '2026-09-15', endDate: '2027-09-14', grossSalary: 15000 })] });
    const { lines, exclusions } = roster('2026-09', [none, expired, notYet, leftFirst, renewed], rules);
    expect(exclusions.map((x) => [x.employeeId, x.reason])).toEqual(
      [none, expired, notYet, leftFirst].map((e) => [e.employee.id, NO_CONTRACT]).sort((a, b) => a[0].localeCompare(b[0])),
    );
    expect(lines.map((l) => [l.contractId, l.terms.gross])).toEqual([['renewal', 15000]]);
  });

  it('ignores employments outside the month, and pays someone hired again on the later employment', () => {
    const past = employment({ endDate: '2026-08-31' });
    const future = employment({ joinDate: '2026-10-01' });
    const again = employment({ endDate: '2026-09-09' });
    const later = employment({ joinDate: '2026-09-20', contracts: [contract({ startDate: '2026-09-20' })] }, { ...again.employee });
    const { lines, exclusions } = roster('2026-09', [past, future, again, later], rules);
    expect(lines.map((l) => [l.employmentId, l.terms.paidDays])).toEqual([[later.id, 11]]);
    expect(exclusions).toEqual([{ employeeId: again.employee.id, employeeCode: again.employee.employeeCode, name: again.employee.fullNameEn, reason: EARLIER_EMPLOYMENT }]);
  });

  it('pays by the hour with the contract’s rate, and lists people by department, none last, then by name', () => {
    const hourly = employment({ contracts: [contract({ payBasis: 'hourly', hourlyRate: 150, grossSalary: 15600 })] }, { fullNameEn: 'B Person' });
    const noDepartment = employment({ department: null }, { fullNameEn: 'A Person' });
    const marketing = employment({ department: { nameEn: 'Marketing', parent: null } }, { fullNameEn: 'C Person' });
    const { lines } = roster('2026-09', [noDepartment, hourly, marketing], rules);
    expect(lines.map((l) => l.nameEn)).toEqual(['C Person', 'B Person', 'A Person']);
    expect(lines[1].terms).toMatchObject({ payBasis: 'hourly', hourlyRate: 150, gross: 15600 });
  });

  // owner, 17 October 2026: "take into consideration the start and end date of the contract if it is in the middle of
  // the billing period"; September 2026 starts on a Tuesday, its Sundays to Thursdays 22
  describe('the contracts’ dates', () => {
    const lineOf = (lines: ReturnType<typeof roster>['lines'], e: RosterEmployment) => lines.find((l) => l.employeeId === e.employee.id)!;
    const parts = (lines: ReturnType<typeof roster>['lines'], e: RosterEmployment) => lineOf(lines, e).terms.segments!.map((s) => [s.contractId, s.from, s.to, s.days]);

    it('a renewal mid-month with new pay splits the month by days; the line, its pay and its insured wage are the month-end contract’s', () => {
      const v1 = contract({ endDate: '2026-09-14' });
      const v2 = contract({ version: 2, startDate: '2026-09-15', endDate: '2027-09-14', grossSalary: 15000, insuredWageFrom: '2027-01-01' });
      const e = employment({ contracts: [v1, v2] });
      const { lines } = roster('2026-09', [e], rules);
      // 14 days on the contract before, 30 − 14 = 16 on the renewal
      expect(parts(lines, e)).toEqual([
        [v1.id, '2026-09-01', '2026-09-14', 14],
        [v2.id, '2026-09-15', '2026-09-30', 16],
      ]);
      expect(lineOf(lines, e).contractId).toBe(v2.id);
      expect(lineOf(lines, e).terms).toMatchObject({
        gross: 15000,
        paidDays: 30,
        // the whole month's, on the pay before the renewal until January (12,000 and the 1,000 transport)
        insuredWage: 13000,
        insuredWageAsBefore: '2027-01-01',
        // all the shift's 22 days: 10 to the 14th, 12 from the 15th
        expectedHours: 198,
        expectedDays: { workingDays: 22, holidays: 0 },
      });
      expect(lineOf(lines, e).terms.segments!.map((s) => [s.number, s.version, s.gross])).toEqual([
        [v1.number, 1, 12000],
        [v2.number, 2, 15000],
      ]);
      // worked out: fixed 9,600 × 14 ÷ 30 = 4,480 and 12,000 × 16 ÷ 30 = 6,400; transport 1,000 × 14 ÷ 30 = 466.67
      // and 1,000 × 16 ÷ 30 = 533.33
      const line = payrollLine(lineOf(lines, e).terms, EMPTY_PAYROLL_INPUTS);
      expect(line).toMatchObject({ fixed: 10880, variable: 2720, allowances: 1000, earned: 13600 });
      expect(line.parts.map((p) => p.allowances)).toEqual([466.67, 533.33]);
    });

    it('days between two contracts are not paid, and their working days are not expected', () => {
      // ended on Thursday the 10th, renewed from Sunday the 20th: 10 + 11 days; the shift's days 8 + 9, and the holiday
      // on Tuesday the 15th falls between them, the one on the 3rd doesn't
      const e = employment({ contracts: [contract({ endDate: '2026-09-10' }), contract({ version: 2, startDate: '2026-09-20', endDate: '2027-09-19' })] });
      const { lines } = roster('2026-09', [e], rules, ['2026-09-03', '2026-09-15']);
      expect(parts(lines, e).map(([, from, to, days]) => [from, to, days])).toEqual([
        ['2026-09-01', '2026-09-10', 10],
        ['2026-09-20', '2026-09-30', 11],
      ]);
      expect(lineOf(lines, e).terms).toMatchObject({ paidDays: 21, expectedHours: 16 * 9, expectedDays: { workingDays: 17, holidays: 1 } });
    });

    it('a contract ending mid-month with no renewal: paid to its end, the employment on the run still', () => {
      const ending = contract({ endDate: '2026-09-10' });
      const e = employment({ contracts: [ending] });
      const { lines, exclusions } = roster('2026-09', [e], rules);
      expect(exclusions).toEqual([]);
      expect(parts(lines, e)).toEqual([[ending.id, '2026-09-01', '2026-09-10', 10]]);
      // the shift's 8 days to the 10th
      expect(lineOf(lines, e).terms).toMatchObject({ paidDays: 10, expectedHours: 72, expectedDays: { workingDays: 8, holidays: 0 } });
      expect(payrollLine(lineOf(lines, e).terms, EMPTY_PAYROLL_INPUTS).warnings).toEqual(['Paid for 10 of 30 days: employed or under contract for part of the month']);
    });

    it('a joiner whose contract starts after their join date is paid from the contract’s start', () => {
      // joined on Saturday the 12th, under contract from Tuesday the 15th: 16 days, the shift's 12 from the 15th
      const e = employment({ joinDate: '2026-09-12', contracts: [contract({ startDate: '2026-09-15', endDate: '2027-09-14' })] });
      const { lines } = roster('2026-09', [e], rules);
      expect(parts(lines, e).map(([, from, to, days]) => [from, to, days])).toEqual([['2026-09-15', '2026-09-30', 16]]);
      expect(lineOf(lines, e).terms).toMatchObject({ paidDays: 16, expectedHours: 108, expectedDays: { workingDays: 12, holidays: 0 } });
    });

    it('by the hour, then a monthly salary: both parts kept, the month paid on the latest alone', () => {
      const hourly = contract({ endDate: '2026-09-14', payBasis: 'hourly', hourlyRate: 100, grossSalary: 8666.67, allowances: [] });
      const monthly = contract({ version: 2, startDate: '2026-09-15', endDate: '2027-09-14' });
      const e = employment({ contracts: [hourly, monthly] });
      const { lines } = roster('2026-09', [e], rules);
      const terms = lineOf(lines, e).terms;
      expect(terms.segments!.map((s) => [s.payBasis, s.hourlyRate, s.days])).toEqual([
        ['hourly', 100, 14],
        ['monthly', null, 16],
      ]);
      // the month-end contract's: monthly, so the shift's hours for all 22 days
      expect(terms).toMatchObject({ payBasis: 'monthly', hourlyRate: null, gross: 12000, expectedHours: 198 });
      const line = payrollLine(terms, EMPTY_PAYROLL_INPUTS);
      expect(line).toMatchObject({ fixed: 9600, variable: 2400, allowances: 1000 });
      expect(line.warnings).toEqual([
        `2 contracts this month, one paid by the hour: the whole month is paid on the latest, ${monthly.number} v2, as hours can't be split between contracts without attendance`,
      ]);
    });

    it('takes the contract in force each day, the latest start winning, the days under none in no part', () => {
      const a = contract({ startDate: '2026-01-01', endDate: '2026-12-31' });
      // an amendment from the 1st runs beside the version it changes
      const b = contract({ version: 2, startDate: '2026-09-01', endDate: '2026-12-31' });
      expect(contractParts('2026-08-30', '2026-09-02', [a, b]).map((p) => [p.contract.id, p.from, p.to])).toEqual([
        [a.id, '2026-08-30', '2026-08-31'],
        [b.id, '2026-09-01', '2026-09-02'],
      ]);
      expect(contractParts('2026-09-01', '2026-09-30', [contract({ startDate: '2026-09-05', endDate: '2026-09-06' })]).map((p) => [p.from, p.to])).toEqual([['2026-09-05', '2026-09-06']]);
      expect(contractParts('2026-09-01', '2026-09-30', [])).toEqual([]);
    });
  });

  // the expected hours from the shift (owner's request, 16 October 2026, Payroll Setup)
  describe('expected hours', () => {
    const terms = (lines: ReturnType<typeof roster>['lines'], e: RosterEmployment) => lines.find((l) => l.employeeId === e.employee.id)!.terms;

    it('are the shift’s working days less the holidays on them, × its hours a day; a holiday on a day off takes none', () => {
      const e = employment();
      // Thursday 3 September is a working day; Saturday 5 September is not
      const { lines } = roster('2026-09', [e], rules, ['2026-09-03', '2026-09-05']);
      expect(terms(lines, e)).toMatchObject({ hoursPerDay: 9, expectedHours: 189, expectedDays: { workingDays: 22, holidays: 1 } });
    });

    it('count only the days employed in the month, for a joiner or a leaver', () => {
      const joiner = employment({ joinDate: '2026-09-12', contracts: [contract({ startDate: '2026-09-12', endDate: '2027-09-11' })] });
      const leaver = employment({ endDate: '2026-09-10' });
      // the 3rd is before the joiner's first day; the 15th after the leaver's last
      const { lines } = roster('2026-09', [joiner, leaver], rules, ['2026-09-03', '2026-09-15']);
      expect(terms(lines, joiner)).toMatchObject({ expectedHours: 13 * 9, expectedDays: { workingDays: 14, holidays: 1 } });
      expect(terms(lines, leaver)).toMatchObject({ expectedHours: 7 * 9, expectedDays: { workingDays: 8, holidays: 1 } });
    });

    it('follow the shift’s own days and hours, past midnight too', () => {
      const weekend = employment({ shift: { startTime: '22:00', endTime: '06:00', workingDays: [5, 6] } });
      const { lines } = roster('2026-09', [weekend], rules, ['2026-09-05']);
      // September 2026 has 4 Fridays and 4 Saturdays, the 5th a holiday: 7 nights of 8 hours
      expect(terms(lines, weekend)).toMatchObject({ hoursPerDay: 8, expectedHours: 56, expectedDays: { workingDays: 8, holidays: 1 } });
    });

    it('are at a flexible shift’s hours to work a day, not its window (owner, 16 October 2026)', () => {
      // the MORNING shift: 9:00 AM to 7:00 PM, 9 hours to work within it; and the same window with none set
      const flexible = employment({ shift: { startTime: '09:00', endTime: '19:00', hoursPerDay: 9, workingDays: SUN_TO_THU } });
      const window = employment({ shift: { startTime: '09:00', endTime: '19:00', hoursPerDay: null, workingDays: SUN_TO_THU } });
      const { lines } = roster('2026-09', [flexible, window], rules, ['2026-09-03']);
      expect(terms(lines, flexible)).toMatchObject({ hoursPerDay: 9, expectedHours: 189, expectedDays: { workingDays: 22, holidays: 1 } });
      expect(terms(lines, window)).toMatchObject({ hoursPerDay: 10, expectedHours: 210 });
    });

    it('are not worked out without a shift, nor for pay by the hour', () => {
      const none = employment({ shift: null });
      const hourly = employment({ contracts: [contract({ payBasis: 'hourly', hourlyRate: 150, grossSalary: 15600 })] });
      const { lines } = roster('2026-09', [none, hourly], rules);
      expect(terms(lines, none)).toMatchObject({ hoursPerDay: null, expectedHours: null, expectedDays: null });
      expect(terms(lines, hourly)).toMatchObject({ hoursPerDay: 9, expectedHours: null, expectedDays: null });
    });
  });
});
