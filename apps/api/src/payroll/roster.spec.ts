import { EARLIER_EMPLOYMENT, NO_CONTRACT, roster, type RosterEmployment } from './roster.js';

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
  return {
    id: `contract-${++n}`,
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

  it('leaves out someone with no signed contract in force; with two (a renewal mid-month), the later one', () => {
    const none = employment({ contracts: [] });
    const expired = employment({ contracts: [contract({ endDate: '2026-08-31' })] });
    const notYet = employment({ contracts: [contract({ startDate: '2026-10-01' })] });
    // the leaver's contract started after their last day
    const leftFirst = employment({ endDate: '2026-09-05', contracts: [contract({ startDate: '2026-09-06' })] });
    const renewed = employment({ contracts: [contract({ endDate: '2026-09-14' }), contract({ id: 'renewal', startDate: '2026-09-15', endDate: '2027-09-14', grossSalary: 15000 })] });
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

    it('are not worked out without a shift, nor for pay by the hour', () => {
      const none = employment({ shift: null });
      const hourly = employment({ contracts: [contract({ payBasis: 'hourly', hourlyRate: 150, grossSalary: 15600 })] });
      const { lines } = roster('2026-09', [none, hourly], rules);
      expect(terms(lines, none)).toMatchObject({ hoursPerDay: null, expectedHours: null, expectedDays: null });
      expect(terms(lines, hourly)).toMatchObject({ hoursPerDay: 9, expectedHours: null, expectedDays: null });
    });
  });
});
