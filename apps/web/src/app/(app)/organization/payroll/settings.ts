import { shiftDaysIn, shiftExpectedHours, shiftHours, type PayrollRules, type Role } from '@trendlix/shared';
import { parseDate } from '../../../../lib/format';
import { hasRole } from '../../../../lib/roles';
import type { Holiday } from '../../../../lib/types';
import { parseAmount } from '../../employees/[id]/contracts/salary';

// Organization → Payroll Setup (owner's request, 16 October 2026: "creating a setup page for payroll to enter the
// variables that might affect the sheet"): one page, four sections, each saved on its own. 1 Your Rules: the rules runs
// are worked out with, after the owner's payroll sheet (PATCH /payroll/settings), and the company defaults that change
// the sheet, kept with the contract settings (PATCH /contract-settings): the basic share of the gross new contracts
// start with and the basic wage social insurance Form 1 prints by default. 2 Rates Set by Law (law-rates-section.tsx).
// 3 Holidays and Working Days: the year's official holidays, which come out of each shift's working days for the
// expected hours. 4 Paying Salaries: the company's CIB account, the ACH purpose and the payday. Pure code, tested: who
// sees it, each form read into what the API takes, the payday's date and the working days. Relative imports: the tests
// run without the "@/" alias.

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

type RuleField = keyof PayrollRules;

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

/** The company defaults Your Rules edits, which PATCH /contract-settings takes: only those the form had. */
export interface ContractDefaultsBody {
  basicPercentDefault?: number;
  insuranceBasicDefault?: number;
}

/**
 * The Your Rules form: the rules as PATCH /payroll/settings takes them, the company defaults as PATCH
 * /contract-settings takes them (each only when the form has it: an API from before one leaves it off the form), and
 * what is wrong, within the limits the API checks.
 */
export function rulesBody(fd: FormData): { rules: PayrollRules; defaults: ContractDefaultsBody; errors: string[] } {
  const errors: string[] = [];
  const rules = {} as PayrollRules;
  for (const field of RULE_FIELDS) {
    const value = numberFrom(text(fd, field), RULES[field]);
    if (Number.isNaN(value)) errors.push(RULES[field].error);
    rules[field] = value;
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

// ---------- 3 Holidays and Working Days ----------

/** The years a holiday can be in (the API's). */
export const HOLIDAY_YEARS = { from: 2000, to: 2100 } as const;

/** The year the holidays are shown for: the address's (?year=2027) when it is one, else this year. */
export function holidaysYear(asked: string | string[] | undefined, today: string): number {
  const typed = Array.isArray(asked) ? asked[0] : asked;
  const year = /^\d{4}$/.test(typed ?? '') ? Number(typed) : NaN;
  return year >= HOLIDAY_YEARS.from && year <= HOLIDAY_YEARS.to ? year : Number(today.slice(0, 4));
}

/** What POST and PATCH /payroll/holidays take. */
export interface HolidayBody {
  date: string;
  nameEn: string;
  nameAr: string | null;
}

/**
 * A holiday's form as the API takes it, and what is wrong with it: the day typed DD/MM/YYYY, its name in English, its
 * name in Arabic if any (empty: none).
 */
export function holidayBody(fd: FormData): { body: HolidayBody; errors: string[] } {
  const errors: string[] = [];
  const typedDate = text(fd, 'date');
  const date = parseDate(typedDate);
  if (!date) errors.push('Enter the date as DD/MM/YYYY, e.g. 25/04/2027.');
  else if (Number(date.slice(0, 4)) < HOLIDAY_YEARS.from || Number(date.slice(0, 4)) > HOLIDAY_YEARS.to) {
    errors.push(`Enter a date from ${HOLIDAY_YEARS.from} to ${HOLIDAY_YEARS.to}.`);
  }
  const nameEn = text(fd, 'nameEn').trim();
  if (!nameEn) errors.push("Enter the holiday's name in English.");
  const nameAr = text(fd, 'nameAr').trim();
  if (nameEn.length > 100 || nameAr.length > 100) errors.push('Keep each name to 100 characters or fewer.');
  return { body: { date: date || typedDate, nameEn, nameAr: nameAr || null }, errors };
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** A day's weekday: "2027-04-25" → "Sunday". */
export const weekdayOf = (date: string) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? '';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A shift as the Working Days table reads it. */
export interface WorkingShift {
  code: string;
  startTime: string;
  endTime: string;
  workingDays: readonly number[];
}

/** One month of the Working Days table: each shift's working days, the holidays on them, and the hours they come to. */
export interface WorkingMonth {
  month: string;
  name: string;
  /** In the shifts' order; `hours` null when the shift's hours can't be told. */
  shifts: { code: string; workingDays: number; holidays: number; hours: number | null }[];
}

/**
 * Each month of a year with each shift's working days in it, the holidays on them and the expected hours they come to:
 * what a run expects of someone on that shift employed all month (owner's request, 16 October 2026), worked out as the
 * API works it out (packages/shared payroll.ts).
 */
export function workingMonths(year: number, shifts: readonly WorkingShift[], holidays: readonly Pick<Holiday, 'date'>[]): WorkingMonth[] {
  const days = holidays.map((h) => h.date);
  return MONTHS.map((name, i) => {
    const month = `${year}-${pad(i + 1)}`;
    return {
      month,
      name,
      shifts: shifts.map((s) => {
        // as if employed the whole month
        const counted = shiftDaysIn(month, `${month}-01`, null, s.workingDays, days);
        const perDay = shiftHours(s.startTime, s.endTime);
        return { code: s.code, ...counted, hours: perDay === null ? null : shiftExpectedHours(counted, perDay) };
      }),
    };
  });
}
