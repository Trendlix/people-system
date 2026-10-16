import { insuredSalary, lawRatesFor } from '@trendlix/shared';
import { roster, type RosterEmployment } from './roster.js';

// A month's pay after a raise (owner's decisions, 16 October 2026): the version in force in the month (a raise takes
// effect on the 1st, so one salary a month, the latest start winning), and the insured wage on the pay before the raise
// until the next 1 January, or the Form 2 date ("From the next January unless amended in Form 2"). Invented people.

type Version = RosterEmployment['contracts'][number];

const before: Version = {
  id: 'v1',
  version: 1,
  insuredWageFrom: null,
  startDate: '2026-03-01',
  endDate: '2027-02-28',
  payBasis: 'monthly',
  grossSalary: 10000,
  basicPercent: 80,
  hourlyRate: null,
  allowances: [{ nameEn: 'Transport', amount: 500, taxable: true, insured: false }],
};

/** An amendment from 1 November 2026: the new pay to the contract's end. */
const amendment: Version = { ...before, id: 'v2', version: 2, startDate: '2026-11-01', grossSalary: 13000, insuredWageFrom: '2027-01-01' };

function employment(contracts: Version[], comprehensive: number | null = null): RosterEmployment {
  return {
    id: 'employment',
    employmentType: 'full_time',
    joinDate: '2026-03-01',
    endDate: null,
    department: null,
    jobTitle: 'Accountant',
    shift: null,
    employee: { id: 'employee', employeeCode: 'EMP-0001', fullNameEn: 'Nour Adel', socialInsured: true, insuranceComprehensiveWage: comprehensive },
    contracts,
  };
}

const rules = { dayDivisor: 30 };
const lineOf = (month: string, e: RosterEmployment) => roster(month, [e], rules, [], lawRatesFor(Number(month.slice(0, 4)))).lines[0];
const insured = (total: number, month: string) => insuredSalary(total, lawRatesFor(Number(month.slice(0, 4))));

describe('a month after a raise', () => {
  const e = employment([before, amendment]);

  it('is paid on the version in force: the one before until the raise’s 1st, the raise from then', () => {
    expect(lineOf('2026-10', e)).toMatchObject({ contractId: 'v1', terms: { gross: 10000 } });
    expect(lineOf('2026-11', e)).toMatchObject({ contractId: 'v2', terms: { gross: 13000 } });
    expect(lineOf('2027-02', e)).toMatchObject({ contractId: 'v2', terms: { gross: 13000 } });
  });

  it('insures the pay before the raise until the next January, and says so; the new pay from January', () => {
    const october = lineOf('2026-10', e).terms;
    expect(october.insuredWage).toBe(insured(10500, '2026-10'));
    expect(october.insuredWageAsBefore).toBeUndefined();

    const november = lineOf('2026-11', e).terms;
    expect(november.insuredWage).toBe(insured(10500, '2026-11'));
    expect(november.insuredWageAsBefore).toBe('2027-01-01');
    expect(lineOf('2026-12', e).terms).toMatchObject({ insuredWage: insured(10500, '2026-12'), insuredWageAsBefore: '2027-01-01' });

    const january = lineOf('2027-01', e).terms;
    expect(january.insuredWage).toBe(insured(13500, '2027-01'));
    expect(january.insuredWageAsBefore).toBeUndefined();
  });

  it('with Form 2 filed, the new pay from its date', () => {
    const filed = employment([before, { ...amendment, insuredWageFrom: '2026-12-01' }]);
    expect(lineOf('2026-11', filed).terms).toMatchObject({ insuredWage: insured(10500, '2026-11'), insuredWageAsBefore: '2026-12-01' });
    expect(lineOf('2026-12', filed).terms.insuredWage).toBe(insured(13500, '2026-12'));
    expect(lineOf('2026-12', filed).terms.insuredWageAsBefore).toBeUndefined();
  });

  it('a new contract replacing the one before mid-term is paid from its 1st, insured as before until January', () => {
    const renewed: Version = { ...before, id: 'v2', version: 2, startDate: '2026-11-01', endDate: '2027-10-31', grossSalary: 14000, insuredWageFrom: '2027-01-01' };
    const n = employment([before, renewed]);
    expect(lineOf('2026-11', n)).toMatchObject({ contractId: 'v2', terms: { gross: 14000, insuredWage: insured(10500, '2026-11'), insuredWageAsBefore: '2027-01-01' } });
    // the version before ended in February, and is still what the insured wage stood on until January
    expect(lineOf('2027-01', n).terms.insuredWage).toBe(insured(14500, '2027-01'));
  });

  it('the employee’s own comprehensive wage (Social Insurance tab) stands, raise or not', () => {
    const own = employment([before, amendment], 11000);
    expect(lineOf('2026-11', own).terms).toMatchObject({ insuredWage: insured(11000, '2026-11') });
    expect(lineOf('2026-11', own).terms.insuredWageAsBefore).toBeUndefined();
  });

  it('a raise from 1 January is insured at once', () => {
    const january: Version = { ...before, id: 'v2', version: 2, startDate: '2027-01-01', grossSalary: 13000, insuredWageFrom: '2027-01-01' };
    expect(lineOf('2027-01', employment([before, january])).terms).toMatchObject({ gross: 13000, insuredWage: insured(13500, '2027-01') });
  });
});
