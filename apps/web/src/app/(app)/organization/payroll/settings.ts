import { INSTALLMENT_LIMIT_MIN, LAW_INSTALLMENT_PERCENT, SALARY_REVIEW_MONTHS_MAX, SALARY_REVIEW_MONTHS_MIN, type PayrollRules, type Role } from '@trendlix/shared';
import { hasRole } from '../../../../lib/roles';
import { parseAmount } from '../../employees/[id]/contracts/salary';

// Organization → Payroll Setup (owner's request, 16 October 2026: "creating a setup page for payroll to enter the
// variables that might affect the sheet"): one page, each section saved on its own. 1 Your Rules: the rules runs are
// worked out with, after the owner's payroll sheet (PATCH /payroll/settings), and the company defaults that change the
// sheet, kept with the contract settings (PATCH /contract-settings): the basic share of the gross new contracts start
// with and the basic wage social insurance Form 1 prints by default; and when a salary review is due, after how many
// months without a raise (owner's decision, 16 October 2026: the Salary Raises report), and the most a month's
// installments of advances and loans may take of the wage: a warning until the owner read the Labour Law with us, the
// law's limit since (owner, 18 October 2026, after reading the law: "Block above 10%"; Art. 113: 10% at most, lower if
// set so). 2 Rates Set by Law (law-rates-section.tsx). The
// holidays and working days were the third section until they got a tab of their own (owner, 16 October 2026: "make
// holiday a separate tab"; organization/holidays). 4 Paying Salaries: the company's CIB account, the ACH purpose and
// the payday. Pure code, tested: who sees it, each form read into what the API takes and the payday's date. Relative
// imports: the tests run without the "@/" alias.

type WithRoles = { roles: readonly Role[] };

/** HR, Finance, the CEO and Admin see the payroll setup (GET /payroll/settings); HR and Admin change it. */
export function seesPayrollSettings(user: WithRoles): boolean {
  return hasRole(user, 'hr', 'finance', 'ceo', 'admin');
}

const latin = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/٫/g, '.');
const text = (fd: FormData, key: string) => String(fd.get(key) ?? '');

/** A number as typed, or NaN when it isn't one within its limits (whole, or up to two decimals). */
function numberFrom(raw: string, limits: { min: number; max: number; whole?: boolean }): number {
  const s = latin(raw).trim();
  if (!(limits.whole ? /^\d+$/ : /^\d+(\.\d{1,2})?$/).test(s)) return NaN;
  const n = Number(s);
  return n >= limits.min && n <= limits.max ? n : NaN;
}

// ---------- 1 Your Rules ----------

/** The rules typed as numbers; Pay overtime is a switch. */
type RuleField = Exclude<keyof PayrollRules, 'payOvertime'>;

/** The overtime's percent and rate: left off the form (disabled, so not sent) while overtime isn't paid. */
const OVERTIME_FIELDS: readonly RuleField[] = ['overtimeAbovePercent', 'overtimeRate'];

/** Each rule's limits (the API's), and how to say it is out of them. */
const RULES: Record<RuleField, { min: number; max: number; whole?: boolean; error: string }> = {
  dayDivisor: { min: 20, max: 31, whole: true, error: 'Enter the days a month counts as: a whole number from 20 to 31, e.g. 30.' },
  attendanceGracePercent: { min: 0, max: 100, error: 'Enter the attendance grace as a percent from 0 to 100, e.g. 90.' },
  kpiGracePercent: { min: 0, max: 100, error: 'Enter the KPI grace as a percent from 0 to 100, e.g. 80.' },
  overtimeAbovePercent: { min: 100, max: 200, error: 'Enter the attendance overtime starts above as a percent from 100 to 200, e.g. 110.' },
  overtimeRate: { min: 1, max: 5, error: 'Enter the overtime rate as a number from 1 to 5, e.g. 1.5.' },
  noShowDayMultiplier: { min: 0, max: 10, error: "Enter what a no-show day costs as a number of days' pay from 0 to 10, e.g. 2." },
};

export const RULE_FIELDS = Object.keys(RULES) as RuleField[];

export const BASIC_PERCENT_ERROR = 'Enter the basic share of the gross as a whole percent from 1 to 100, e.g. 80.';
export const INSURANCE_BASIC_ERROR = 'Enter the default basic wage as an amount in EGP of more than 0 and up to 99,999.99, e.g. 410.';
export const SALARY_REVIEW_ERROR = `Enter after how many months without a raise a salary review is due: a whole number from ${SALARY_REVIEW_MONTHS_MIN} to ${SALARY_REVIEW_MONTHS_MAX}, e.g. 12.`;
export const INSTALLMENT_LIMIT_ERROR = `Enter the most a month's installments may take as a percent of the wage from ${INSTALLMENT_LIMIT_MIN} to ${LAW_INSTALLMENT_PERCENT}, e.g. 10: the law allows at most ${LAW_INSTALLMENT_PERCENT}%.`;

/** The company defaults Your Rules edits, which PATCH /contract-settings takes: only those the form had. */
export interface ContractDefaultsBody {
  basicPercentDefault?: number;
  insuranceBasicDefault?: number;
}

/**
 * The rules Your Rules sends: the overtime's percent and rate only while overtime is paid (else the API keeps them), and
 * the months after which a salary review is due when the form has them (an API from before it leaves it off the form).
 */
export type RulesBody = Omit<PayrollRules, 'overtimeAbovePercent' | 'overtimeRate'> &
  Partial<Pick<PayrollRules, 'overtimeAbovePercent' | 'overtimeRate'>> & { salaryReviewMonths?: number; installmentLimitPercent?: number };

/**
 * The Your Rules form: the rules as PATCH /payroll/settings takes them, the company defaults as PATCH
 * /contract-settings takes them (each only when the form has it: an API from before one leaves it off the form), and
 * what is wrong, within the limits the API checks. Pay overtime (owner, 16 October 2026: "No overtime for now") is a
 * switch: a hidden "false" and the checkbox's "true", sent only when the form has it; while it is off, the overtime's
 * percent and rate are disabled, so not sent, and the API keeps them for when it is turned on.
 */
export function rulesBody(fd: FormData): { rules: RulesBody; defaults: ContractDefaultsBody; errors: string[] } {
  const errors: string[] = [];
  const rules = {} as RulesBody;
  const switchSent = fd.has('payOvertime');
  if (switchSent) rules.payOvertime = fd.getAll('payOvertime').includes('true');
  for (const field of RULE_FIELDS) {
    if (switchSent && !rules.payOvertime && OVERTIME_FIELDS.includes(field) && !fd.has(field)) continue;
    const value = numberFrom(text(fd, field), RULES[field]);
    if (Number.isNaN(value)) errors.push(RULES[field].error);
    rules[field] = value;
  }
  // when a salary review is due (owner's decision, 16 October 2026: the Salary Raises report), not a rule a run copies
  if (fd.has('salaryReviewMonths')) {
    const months = numberFrom(text(fd, 'salaryReviewMonths'), { min: SALARY_REVIEW_MONTHS_MIN, max: SALARY_REVIEW_MONTHS_MAX, whole: true });
    if (Number.isNaN(months)) errors.push(SALARY_REVIEW_ERROR);
    rules.salaryReviewMonths = months;
  }
  // the most a month's installments may take of the wage (owner, 18 October 2026, after reading the law: "Block above
  // 10%"): 1 to 10, needed (the law's limit applies either way)
  if (fd.has('installmentLimitPercent')) {
    const percent = numberFrom(text(fd, 'installmentLimitPercent'), { min: INSTALLMENT_LIMIT_MIN, max: LAW_INSTALLMENT_PERCENT });
    if (Number.isNaN(percent)) errors.push(INSTALLMENT_LIMIT_ERROR);
    rules.installmentLimitPercent = percent;
  }
  const defaults: ContractDefaultsBody = {};
  if (fd.has('basicPercentDefault')) {
    const share = numberFrom(text(fd, 'basicPercentDefault'), { min: 1, max: 100, whole: true });
    if (Number.isNaN(share)) errors.push(BASIC_PERCENT_ERROR);
    defaults.basicPercentDefault = share;
  }
  if (fd.has('insuranceBasicDefault')) {
    const wage = parseAmount(text(fd, 'insuranceBasicDefault'));
    if (wage === null || Number.isNaN(wage) || wage <= 0 || wage > 99_999.99) errors.push(INSURANCE_BASIC_ERROR);
    defaults.insuranceBasicDefault = wage ?? NaN;
  }
  return { rules, defaults, errors };
}

// ---------- 4 Paying Salaries ----------

/** What PATCH /payroll/settings takes from Paying Salaries. */
export interface PayingBody {
  cibDebitAccount: string | null;
  cibDebitAccountName: string | null;
  achPurpose: string;
  payday: number | null;
}

export const PAYDAY_ERROR = 'Enter the payday as a day of the month, a whole number from 1 to 31, or leave it empty.';

/**
 * The Paying Salaries form as PATCH /payroll/settings takes it, and what is wrong with it. The CIB account is 12 digits
 * (spaces and dashes as typed are dropped); it and its name may be left empty until the bank files are needed. The ACH
 * purpose is needed, in capitals and digits: the ACH file prints it on every line. The payday is optional.
 */
export function payingBody(fd: FormData): { body: PayingBody; errors: string[] } {
  const errors: string[] = [];
  const account = latin(text(fd, 'cibDebitAccount')).replace(/[\s-]/g, '');
  if (account && !/^\d{12}$/.test(account)) errors.push('Enter the CIB account as its 12 digits.');
  const accountName = text(fd, 'cibDebitAccountName').trim();
  if (accountName.length > 100) errors.push('Keep the account name to 100 characters or fewer.');
  // in capitals, as the bank takes it ("cash" is sent as CASH)
  const achPurpose = text(fd, 'achPurpose').trim().toUpperCase();
  if (!/^[A-Z0-9]{1,20}$/.test(achPurpose)) errors.push('Enter the ACH purpose in letters and digits, up to 20, e.g. CASH: the ACH file prints it on every line.');
  const typedPayday = latin(text(fd, 'payday')).trim();
  const payday = typedPayday === '' ? null : numberFrom(typedPayday, { min: 1, max: 31, whole: true });
  if (payday !== null && Number.isNaN(payday)) errors.push(PAYDAY_ERROR);
  return { body: { cibDebitAccount: account || null, cibDebitAccountName: accountName || null, achPurpose, payday }, errors };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The month after a month ('YYYY-MM'): "2026-12" → "2027-01". */
function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
}

/**
 * The day a run's salaries are paid on (owner's request, 16 October 2026): the payday of the month after the run's,
 * as a month's salaries are paid once it is over (the owner's March file was made on 6 April, and a run can't be marked
 * paid before its month begins); a payday past that month's end is its last day. "2026-09" with 5 → "2026-10-05";
 * "2027-01" with 31 → "2027-02-28".
 */
export function paydayDate(month: string, payday: number): string {
  const [y, m] = nextMonth(month).split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${pad(m)}-${pad(Math.min(payday, last))}`;
}

/**
 * The date Mark as paid starts with (YYYY-MM-DD): the run's payday date, unless it is still to come (a payment can't
 * be recorded in the future: the bank paid early), then today; today without a payday.
 */
export function paidOnDefault(month: string, payday: number | null | undefined, today: string): string {
  if (!payday) return today;
  const date = paydayDate(month, payday);
  return date > today ? today : date;
}

/** "the 25th", "the 1st", "the 22nd": a payday as the page says it. */
export function dayOfMonth(day: number): string {
  const teen = day % 100 >= 11 && day % 100 <= 13;
  const suffix = teen ? 'th' : (['th', 'st', 'nd', 'rd'][day % 10] ?? 'th');
  return `the ${day}${suffix}`;
}
