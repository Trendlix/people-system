import { developerRolesProblem, HIDDEN, hiddenDigits, isDeveloperRole, maskForDeveloper } from '@trendlix/shared';

// The Developer role (owner, 22 October 2026: "i want to create a role for develoeprs, not showing the real numbers";
// hidden: "Money and personal IDs"): the masking every answer a developer receives goes through (packages/shared
// developer.ts), and the roles a developer may hold.

describe('what a developer receives', () => {
  it('a payroll line: every amount 0, the days, hours, scores and percents as they are, warnings without their digits', () => {
    const line = {
      id: '7f6d1c3e-1111-4222-8333-444455556666',
      name: 'Omar Khaled',
      terms: { year: 2026, gross: 20000, basicPercent: 80, paidDays: 30, hoursPerDay: 9, insuredWage: 16700, allowances: [{ name: 'Transport', amount: 500, taxable: true }] },
      inputs: { workedHours: 170, expectedHours: 180, released: 1000, leaveDays: 2 },
      result: { gross: 20000, net: 17250.5, earned: 19000, attendanceScore: 0.95, kpiScore: 0.9, absentHours: 3, monthlyTax: 1200, warnings: ['Installments take EGP 3,000 (12%) of the pay on 2026-10-01.'] },
    };
    expect(maskForDeveloper(line, '/api/payroll/runs/1')).toEqual({
      id: '7f6d1c3e-1111-4222-8333-444455556666',
      name: 'Omar Khaled',
      terms: { year: 2026, gross: 0, basicPercent: 80, paidDays: 30, hoursPerDay: 9, insuredWage: 0, allowances: [{ name: 'Transport', amount: 0, taxable: true }] },
      inputs: { workedHours: 170, expectedHours: 180, released: 0, leaveDays: 2 },
      result: { gross: 0, net: 0, earned: 0, attendanceScore: 0.95, kpiScore: 0.9, absentHours: 3, monthlyTax: 0, warnings: ['Installments take EGP •,••• (••%) of the pay on ••••-••-••.'] },
    });
    // the answer itself is never changed
    expect(line.result.gross).toBe(20000);
  });

  it('personal IDs as ••••, wherever they are; names, emails and dates as they are', () => {
    expect(
      maskForDeveloper(
        { nationalId: '29503121234567', printedNo: 'KX1234567', mobile: '+201012345678', email: 'omar@mail.test', bank: { accountNo: '1234567890', iban: 'EG3800190005000000001234', bankName: 'CIB' }, joinDate: '2024-01-01' },
        '/api/employees/1',
      ),
    ).toEqual({ nationalId: HIDDEN, printedNo: HIDDEN, mobile: HIDDEN, email: 'omar@mail.test', bank: { accountNo: HIDDEN, iban: HIDDEN, bankName: 'CIB' }, joinDate: '2024-01-01' });
  });

  it('an audit change of money or an ID: from and to hidden; of anything else as it is', () => {
    const changes = [
      { field: 'grossSalary', label: 'Gross salary', from: '10,000', to: '12,000' },
      { field: 'bank.accountNo', label: 'Bank · Account number', from: '111', to: '222' },
      { field: 'values.purchasePrice', label: 'Purchase price', from: 30000, to: 32000 },
      { field: 'jobTitle', label: 'Job title', from: 'Editor', to: 'Senior Editor' },
    ];
    expect(maskForDeveloper({ changes }, '/api/audit')).toEqual({
      changes: [
        { field: 'grossSalary', label: 'Gross salary', from: '0', to: '0' },
        { field: 'bank.accountNo', label: 'Bank · Account number', from: HIDDEN, to: HIDDEN },
        { field: 'values.purchasePrice', label: 'Purchase price', from: 0, to: 0 },
        { field: 'jobTitle', label: 'Job title', from: 'Editor', to: 'Senior Editor' },
      ],
    });
  });

  it('names that are money on some pages only: by the API path', () => {
    // an asset list's total is a count; a pay version's total is money
    expect(maskForDeveloper({ total: 12 }, '/api/assets')).toEqual({ total: 12 });
    expect(maskForDeveloper({ total: 25000 }, '/api/employees/1/salary-history')).toEqual({ total: 0 });
    // a leave type's days used, a claim type's amounts used
    expect(maskForDeveloper({ usedInYear: 5 }, '/api/leave/balances')).toEqual({ usedInYear: 5 });
    expect(maskForDeveloper({ usedInYear: 5000 }, '/api/reimbursements/types')).toEqual({ usedInYear: 0 });
  });

  it('a document’s tag values: pay and IDs hidden, the rest as they are', () => {
    expect(maskForDeveloper({ values: { national_id: '29503121234567', gross_salary: '20,000', phone: '+201012345678', full_name_ar: 'عمر' } }, '/api/documents/check')).toEqual({
      values: { national_id: HIDDEN, gross_salary: '0', phone: HIDDEN, full_name_ar: 'عمر' },
    });
  });

  it('a decimal or a date under a money field', () => {
    const decimal = { toNumber: () => 12, toFixed: () => '12.00', toJSON: () => '12' };
    const at = new Date('2026-10-22T10:00:00Z');
    expect(maskForDeveloper({ amount: decimal, paidOn: at, cost: null }, '/api/x')).toEqual({ amount: 0, paidOn: at, cost: null });
  });

  it('digits hidden in a text, a date, a moment and an id kept', () => {
    expect(hiddenDigits('EGP 3,000')).toBe('EGP •,•••');
    expect(hiddenDigits('3,000')).toBe('0');
    expect(hiddenDigits('2026-10-22')).toBe('2026-10-22');
    expect(hiddenDigits('2026-10-22T10:00:00.000Z')).toBe('2026-10-22T10:00:00.000Z');
    expect(hiddenDigits('7f6d1c3e-1111-4222-8333-444455556666')).toBe('7f6d1c3e-1111-4222-8333-444455556666');
    expect(hiddenDigits('٣٬٠٠٠ جنيه')).toBe('•٬••• جنيه');
  });
});

describe('the Developer role', () => {
  it('held with nothing but Employee beside it', () => {
    expect(isDeveloperRole(['developer'])).toBe(true);
    expect(developerRolesProblem(['developer'])).toBeNull();
    expect(developerRolesProblem(['employee', 'developer'])).toBeNull();
    expect(developerRolesProblem(['hr', 'developer'])).toBe('A developer holds no other role but Employee: they look at everything and change nothing.');
    expect(developerRolesProblem(['hr', 'super_admin'])).toBeNull();
  });
});
