import type { Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { seesPayrollSettings, settingsBody } from './settings';

const as = (...roles: Role[]) => ({ roles });

const form = (values: Record<string, string>) => {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
};

// invented account details
const filled = {
  dayDivisor: '30',
  attendanceGracePercent: '90',
  kpiGracePercent: '80',
  overtimeAbovePercent: '110',
  overtimeRate: '1.5',
  noShowDayMultiplier: '2',
  cibDebitAccount: '1000 2000 3000',
  cibDebitAccountName: '  Example Trading Co  ',
  achPurpose: 'cash',
};

describe('who sees the payroll settings', () => {
  it('is HR, Finance, the CEO and Admin (a Super Admin too)', () => {
    for (const role of ['hr', 'finance', 'ceo', 'admin', 'super_admin'] as const) expect(seesPayrollSettings(as(role))).toBe(true);
    expect(seesPayrollSettings(as('employee', 'manager'))).toBe(false);
  });
});

describe('the settings form', () => {
  it('is sent as numbers, the CIB account as its 12 digits and the ACH purpose in capitals', () => {
    expect(settingsBody(form(filled))).toEqual({
      body: {
        dayDivisor: 30,
        attendanceGracePercent: 90,
        kpiGracePercent: 80,
        overtimeAbovePercent: 110,
        overtimeRate: 1.5,
        noShowDayMultiplier: 2,
        cibDebitAccount: '100020003000',
        cibDebitAccountName: 'Example Trading Co',
        achPurpose: 'CASH',
      },
      errors: [],
    });
  });

  it('leaves the CIB account and its name empty until the bank files are needed', () => {
    const { body, errors } = settingsBody(form({ ...filled, cibDebitAccount: '', cibDebitAccountName: ' ' }));
    expect(errors).toEqual([]);
    expect([body.cibDebitAccount, body.cibDebitAccountName]).toEqual([null, null]);
  });

  it('reads Arabic digits', () => {
    expect(settingsBody(form({ ...filled, dayDivisor: '٣٠', overtimeRate: '١٫٥' })).body).toMatchObject({ dayDivisor: 30, overtimeRate: 1.5 });
  });

  it('says what is out of the limits the API checks', () => {
    const { errors } = settingsBody(
      form({
        ...filled,
        dayDivisor: '30.5',
        attendanceGracePercent: '120',
        overtimeAbovePercent: '90',
        overtimeRate: '6',
        noShowDayMultiplier: '',
        cibDebitAccount: '12345',
        achPurpose: 'CASH-1',
      }),
    );
    expect(errors).toEqual([
      'Enter the days a month counts as: a whole number from 20 to 31, e.g. 30.',
      'Enter the attendance grace as a percent from 0 to 100, e.g. 90.',
      'Enter the attendance overtime starts above as a percent from 100 to 200, e.g. 110.',
      'Enter the overtime rate as a number from 1 to 5, e.g. 1.5.',
      "Enter what a no-show day costs as a number of days' pay from 0 to 10, e.g. 2.",
      'Enter the CIB account as its 12 digits.',
      'Enter the ACH purpose in letters and digits, up to 20, e.g. CASH: the ACH file prints it on every line.',
    ]);
  });
});
