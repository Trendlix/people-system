import type { Role } from '@trendlix/shared';
import { hasRole } from '../../../../lib/roles';
import type { PayrollSettingsView } from '../../../../lib/types';

// Organization → Payroll (owner's decisions, 16 October 2026): the rules payroll runs are worked out with, after the
// owner's payroll sheet, and what the bank files need: the company's CIB account the salaries are paid from, its name
// as CIB has it, and the ACH file's transaction purpose. Pure code, tested: who sees them, and the form read into the
// body PATCH /payroll/settings takes. Relative imports: the tests run without the "@/" alias.

type WithRoles = { roles: readonly Role[] };

/** HR, Finance, the CEO and Admin see the payroll settings (GET /payroll/settings); HR and Admin change them. */
export function seesPayrollSettings(user: WithRoles): boolean {
  return hasRole(user, 'hr', 'finance', 'ceo', 'admin');
}

/** What PATCH /payroll/settings takes: every setting. */
export type SettingsBody = PayrollSettingsView;

type NumberField = 'dayDivisor' | 'attendanceGracePercent' | 'kpiGracePercent' | 'overtimeAbovePercent' | 'overtimeRate' | 'noShowDayMultiplier';

/** Each rule's limits, and how to say it is out of them. */
const RULES: Record<NumberField, { min: number; max: number; whole?: boolean; error: string }> = {
  dayDivisor: { min: 20, max: 31, whole: true, error: 'Enter the days a month counts as: a whole number from 20 to 31, e.g. 30.' },
  attendanceGracePercent: { min: 0, max: 100, error: 'Enter the attendance grace as a percent from 0 to 100, e.g. 90.' },
  kpiGracePercent: { min: 0, max: 100, error: 'Enter the KPI grace as a percent from 0 to 100, e.g. 80.' },
  overtimeAbovePercent: { min: 100, max: 200, error: 'Enter the attendance overtime starts above as a percent from 100 to 200, e.g. 110.' },
  overtimeRate: { min: 1, max: 5, error: 'Enter the overtime rate as a number from 1 to 5, e.g. 1.5.' },
  noShowDayMultiplier: { min: 0, max: 10, error: "Enter what a no-show day costs as a number of days' pay from 0 to 10, e.g. 2." },
};

export const NUMBER_FIELDS = Object.keys(RULES) as NumberField[];

const latin = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/٫/g, '.');
const text = (fd: FormData, key: string) => String(fd.get(key) ?? '');

/** A rule as typed, or NaN when it isn't a number within its limits (up to two decimals). */
function ruleFrom(raw: string, rule: (typeof RULES)[NumberField]): number {
  const s = latin(raw).trim();
  if (!(rule.whole ? /^\d+$/ : /^\d+(\.\d{1,2})?$/).test(s)) return NaN;
  const n = Number(s);
  return n >= rule.min && n <= rule.max ? n : NaN;
}

/**
 * The form as PATCH /payroll/settings takes it, and what is wrong with it, within the limits the API checks. The CIB
 * account is 12 digits (spaces and dashes as typed are dropped); it and its name may be left empty until the bank
 * files are needed. The ACH purpose is needed, in capitals and digits: the ACH file prints it on every line.
 */
export function settingsBody(fd: FormData): { body: SettingsBody; errors: string[] } {
  const errors: string[] = [];
  const numbers = {} as Record<NumberField, number>;
  for (const field of NUMBER_FIELDS) {
    const value = ruleFrom(text(fd, field), RULES[field]);
    if (Number.isNaN(value)) errors.push(RULES[field].error);
    numbers[field] = value;
  }
  const account = latin(text(fd, 'cibDebitAccount')).replace(/[\s-]/g, '');
  if (account && !/^\d{12}$/.test(account)) errors.push('Enter the CIB account as its 12 digits.');
  const accountName = text(fd, 'cibDebitAccountName').trim();
  if (accountName.length > 100) errors.push('Keep the account name to 100 characters or fewer.');
  // in capitals, as the bank takes it ("cash" is sent as CASH)
  const achPurpose = text(fd, 'achPurpose').trim().toUpperCase();
  if (!/^[A-Z0-9]{1,20}$/.test(achPurpose)) errors.push('Enter the ACH purpose in letters and digits, up to 20, e.g. CASH: the ACH file prints it on every line.');
  return {
    body: {
      ...numbers,
      cibDebitAccount: account || null,
      cibDebitAccountName: accountName || null,
      achPurpose,
    },
    errors,
  };
}
