import { EMPTY_PAYROLL_INPUTS, payrollLine } from '@trendlix/shared';
import { roster, type RosterEmployment } from './roster.js';

// The accounts allowance on the payroll (owner, 25 October 2026: "if an employee has an allowance per account, how can
// we deal with it?"; asked, a "Client accounts list", the rate "variable", "By days"). Everyone and every account here is
// invented.

const SUN_TO_THU = [0, 1, 2, 3, 4];
const PER_ACCOUNT = { nameEn: 'Accounts allowance', amount: 0, taxable: true, insured: false, basis: 'per_account' };
const TRANSPORT = { nameEn: 'Transport', amount: 1000, taxable: true, insured: false, basis: 'fixed' };

let n = 0;
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
    allowances: [TRANSPORT, PER_ACCOUNT],
    ...over,
  };
}

function employment(over: Partial<RosterEmployment> = {}): RosterEmployment {
  n += 1;
  return {
    id: `employment-${n}`,
    employmentType: 'full_time',
    joinDate: '2025-01-01',
    endDate: null,
    department: { nameEn: 'Accounts', parent: { nameEn: 'Sales' } },
    jobTitle: 'Account Manager',
    shift: { startTime: '09:00', endTime: '18:00', workingDays: SUN_TO_THU },
    employee: { id: `employee-${n}`, employeeCode: `EMP-${String(n).padStart(4, '0')}`, fullNameEn: `Person ${n}`, socialInsured: true, insuranceComprehensiveWage: null },
    contracts: [contract()],
    accounts: [],
    ...over,
  };
}

const rules = { dayDivisor: 30 };
const acme = { accountId: 'acme', name: 'Acme Foods', from: '2026-01-01', to: null, amount: 1500 };
const beta = { accountId: 'beta', name: 'Beta Labs', from: '2026-10-24', to: null, amount: 900 };

describe('the accounts allowance on the roster', () => {
  it('pays the sum of the month’s accounts by days held, as one allowance with the kind’s flags', () => {
    const e = employment({ accounts: [acme, beta] });
    const [line] = roster('2026-10', [e], rules).lines;
    const accounts = line.terms.allowances.find((a) => a.accounts);
    expect(accounts).toEqual({
      name: 'Accounts allowance',
      amount: 1732.26,
      taxable: true,
      insured: false,
      accounts: [
        { accountId: 'acme', name: 'Acme Foods', from: '2026-10-01', to: '2026-10-31', days: 31, monthDays: 31, monthly: 1500, amount: 1500 },
        { accountId: 'beta', name: 'Beta Labs', from: '2026-10-24', to: '2026-10-31', days: 8, monthDays: 31, monthly: 900, amount: 232.26 },
      ],
    });
    // the per-account row has no amount of its own: not an allowance of 0 beside it
    expect(line.terms.allowances.map((a) => a.name)).toEqual(['Transport', 'Accounts allowance']);
    // in the month's (one) part too, so it is paid
    expect(line.terms.segments![0].allowances.map((a) => a.name)).toEqual(['Transport', 'Accounts allowance']);
    // never changes the insured wage: the gross and the Transport only
    expect(line.terms.insuredWage).toBe(13000);
    expect(line.terms.accountsWithoutAllowance).toBeUndefined();
  });

  it('paid as it is, never for the days paid again, and taxed with the pay when taxable', () => {
    const e = employment({ joinDate: '2026-10-11', accounts: [{ ...acme, from: '2026-10-11' }] });
    const [line] = roster('2026-10', [e], rules).lines;
    // 21 of 31 days of 1,500 held
    expect(line.terms.allowances.find((a) => a.accounts)!.amount).toBe(1016.13);
    const result = payrollLine(line.terms, EMPTY_PAYROLL_INPUTS);
    // the Transport for 21 of the 30 days paid (700) and the accounts as they are
    expect(result.allowances).toBe(1716.13);
    expect(result.taxableAllowances).toBe(1716.13);
    const untaxed = roster('2026-10', [employment({ joinDate: '2026-10-11', contracts: [contract({ allowances: [TRANSPORT, { ...PER_ACCOUNT, taxable: false }] })], accounts: [{ ...acme, from: '2026-10-11' }] })], rules).lines[0];
    const r2 = payrollLine(untaxed.terms, EMPTY_PAYROLL_INPUTS);
    expect([r2.allowances, r2.taxableAllowances]).toEqual([1716.13, 700]);
    expect(r2.monthlyTax).toBeLessThan(result.monthlyTax);
  });

  it('nothing without the per-account allowance on the contract: a warning with the count', () => {
    const e = employment({ contracts: [contract({ allowances: [TRANSPORT] })], accounts: [acme, beta] });
    const [line] = roster('2026-10', [e], rules).lines;
    expect(line.terms.allowances.map((a) => a.name)).toEqual(['Transport']);
    expect(line.terms.accountsWithoutAllowance).toBe(2);
    expect(payrollLine(line.terms, EMPTY_PAYROLL_INPUTS).warnings).toContain('Holds 2 client accounts this month, but the contract has no per-account allowance: nothing is paid for them');
  });

  it('nothing, and no warning, without accounts', () => {
    const [line] = roster('2026-10', [employment()], rules).lines;
    expect(line.terms.allowances.map((a) => a.name)).toEqual(['Transport']);
    expect(line.terms.accountsWithoutAllowance).toBeUndefined();
    expect(payrollLine(line.terms, EMPTY_PAYROLL_INPUTS).warnings).toEqual([]);
  });

  it('only for the days under a contract with it: a renewal adding it mid-month', () => {
    const before = contract({ endDate: '2026-10-14', allowances: [TRANSPORT] });
    const after = contract({ startDate: '2026-10-15', endDate: '2027-10-14', allowances: [TRANSPORT, PER_ACCOUNT] });
    const e = employment({ contracts: [before, after], accounts: [acme] });
    const [line] = roster('2026-10', [e], rules).lines;
    // 17 of 31 days held under the renewal: 822.58, with the second part, and no warning
    expect(line.terms.segments!.map((s) => s.allowances.map((a) => [a.name, a.amount]))).toEqual([[['Transport', 1000]], [['Transport', 1000], ['Accounts allowance', 822.58]]]);
    expect(line.terms.accountsWithoutAllowance).toBeUndefined();
  });
  it('paid per account only (27 October 2026): a salary of 0, every account at the contract’s amount per account', () => {
    const only = contract({ grossSalary: 0, allowances: [{ ...PER_ACCOUNT, perAccountAmount: 3000 }] });
    const e = employment({ contracts: [only], accounts: [acme, beta] });
    const [line] = roster('2026-10', [e], rules).lines;
    const accounts = line.terms.allowances.find((a) => a.accounts)!;
    // acme the whole month, beta 8 of 31 days, both at 3,000 whatever their assignments say
    expect(accounts.amount).toBe(3774.19);
    expect(accounts.accounts!.map((a) => [a.name, a.monthly, a.amount])).toEqual([
      ['Acme Foods', 3000, 3000],
      ['Beta Labs', 3000, 774.19],
    ]);
    // no salary: the accounts are the pay, taxed as the kind is
    const result = payrollLine(line.terms, EMPTY_PAYROLL_INPUTS);
    expect(result.earned).toBe(0);
    expect(result.allowances).toBe(3774.19);
    expect(result.taxableAllowances).toBe(3774.19);
    expect(result.net).toBeGreaterThan(0);
    expect(result.net).toBeLessThanOrEqual(3774.19);
  });
});
