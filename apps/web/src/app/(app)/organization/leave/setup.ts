import {
  isLeaveKind,
  LEAVE_BALANCE_LABELS,
  LEAVE_BALANCES,
  LEAVE_PAY_LABELS,
  LEAVE_PAYS,
  LEAVE_RULE_DEFAULTS,
  type LeaveBalanceKind,
  type LeaveKind,
  type LeavePay,
  type LeaveRules,
  type Role,
} from '@trendlix/shared';
import { hasRole } from '../../../../lib/roles';
import type { LeaveSettingsView, LeaveTypeBody, LeaveTypeView } from '../../../../lib/types';

// Organization → Leave (owner, 18 October 2026: "can you apply the leaves according to the law?", "make it with decision
// with the year closing"): the Leave Setup, the annual leave's days by Labour Law 14/2025 Art. 124 (15 in the first year,
// 21 from the second, 30 after 10 years' service with any employer or over 50, 45 with a disability, 7 more for hazardous
// work), each editable; the leave types, seeded with the law's (annual, casual, a child's birth, exams, Hajj, sick,
// maternity, childcare, unpaid), which HR changes, turns off or adds to, a Super Admin deleting one no request uses; and
// the Year Closing, where HR decides what of each employee's unused days is carried and what is paid. HR changes them;
// the other staff read them (the API checks every request again). Pure code, tested: who sees and changes what, the
// forms read into what the API takes (with the API's checks), and the words the cards show. Relative imports: the tests
// run without the "@/" alias.

type WithRoles = { roles: readonly Role[] };

/** HR changes the Leave Setup and the types, and closes a year. */
export const editsLeaveSetup = (user: WithRoles) => hasRole(user, 'hr');

/** HR and the CEO see a year's closing (GET /leave/year-closing/:year); HR closes it. */
export const seesYearClosing = (user: WithRoles) => hasRole(user, 'hr', 'ceo');

export const LEAVE_SETUP_HREF = '/organization/leave';
export const LEAVE_TYPES_ID = 'leave-types';
export const LEAVE_TYPES_HREF = `${LEAVE_SETUP_HREF}#${LEAVE_TYPES_ID}`;
export const NEW_LEAVE_TYPE_HREF = `${LEAVE_SETUP_HREF}/types/new`;
export const leaveTypeHref = (id: string) => `${LEAVE_SETUP_HREF}/types/${encodeURIComponent(id)}`;
export const yearClosingHref = (year: number) => `${LEAVE_SETUP_HREF}/year-closing?year=${year}`;

const latin = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/٫/g, '.');
const text = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();

/** A whole number as typed within limits; null when empty; NaN when it isn't one. */
export function wholeFrom(raw: string, min: number, max: number): number | null {
  const s = latin(raw).trim();
  if (s === '') return null;
  if (!/^\d+$/.test(s)) return NaN;
  const n = Number(s);
  return n >= min && n <= max ? n : NaN;
}

// ---------- the annual leave's days (Art. 124) ----------

/** Each setting of the Leave Setup: its label, the law's words it comes from, its unit and its limits. */
export const SETTING_FIELDS: readonly { key: keyof LeaveRules; label: string; law: string; unit: 'days' | 'years' | 'months'; min: number; max: number }[] = [
  { key: 'firstYearDays', label: 'First year of service', law: 'خمسة عشر يوما فى السنة الأولى', unit: 'days', min: 0, max: 366 },
  { key: 'standardDays', label: 'From the second year', law: 'واحد وعشرون يوما اعتبارا من السنة الثانية', unit: 'days', min: 0, max: 366 },
  { key: 'longServiceDays', label: 'After long service or over the age', law: 'ثلاثون يوما لمن أمضى عشر سنوات كاملة لدى صاحب عمل أو أكثر، أو لمن تجاوزت سنه خمسين عاما', unit: 'days', min: 0, max: 366 },
  { key: 'longServiceYears', label: 'Long service: full years with any employer', law: 'عشر سنوات كاملة لدى صاحب عمل أو أكثر', unit: 'years', min: 1, max: 60 },
  { key: 'longServiceAge', label: 'Over the age of', law: 'لمن تجاوزت سنه خمسين عاما', unit: 'years', min: 18, max: 100 },
  { key: 'disabilityDays', label: 'A person with a disability', law: 'خمسة وأربعون يوما للأشخاص ذوى الإعاقة والأقزام', unit: 'days', min: 0, max: 366 },
  { key: 'hazardousExtraDays', label: 'Added for hazardous, unhealthy or remote work', law: 'تزاد مدة الإجازة السنوية بمقدار سبعة أيام', unit: 'days', min: 0, max: 366 },
  { key: 'firstYearMinMonths', label: 'Months served before a first year’s leave is used', law: 'بشرط أن يكون قد أمضى ستة أشهر على الأقل فى خدمة صاحب العمل', unit: 'months', min: 0, max: 12 },
  { key: 'settleWithinYears', label: 'Days carried are settled within', law: 'بتسوية رصيد الإجازات، أو الأجر المقابل له كل ثلاث سنوات على الأكثر (Art. 125)', unit: 'years', min: 1, max: 10 },
];

/** "21 days", "10 years", "6 months", with the unit's singular for 1. */
export function unitText(n: number, unit: 'days' | 'years' | 'months'): string {
  const one = { days: 'day', years: 'year', months: 'month' }[unit];
  return `${n} ${n === 1 ? one : unit}`;
}

/** The law's figure, for "The law: 21 days" beside a setting changed from it. */
export const lawDefault = (key: keyof LeaveRules) => LEAVE_RULE_DEFAULTS[key];

/**
 * The Leave Setup form as PATCH /leave/settings takes it, all of it, and what is wrong: each a whole number within its
 * limits; the days from the second year no fewer than the first year's, and those after long service no fewer than them.
 */
export function settingsBody(fd: FormData): { body: LeaveSettingsView; errors: string[] } {
  const errors: string[] = [];
  const body = {} as LeaveSettingsView;
  for (const f of SETTING_FIELDS) {
    const n = wholeFrom(text(fd, f.key), f.min, f.max);
    if (n === null || Number.isNaN(n)) errors.push(`Enter “${f.label}” as a whole number of ${f.unit} from ${f.min} to ${f.max}.`);
    body[f.key] = n ?? NaN;
  }
  if (!errors.length) {
    if (body.standardDays < body.firstYearDays) errors.push('The days from the second year can’t be fewer than the first year’s.');
    if (body.longServiceDays < body.standardDays) errors.push('The days after long service can’t be fewer than those from the second year.');
  }
  return { body, errors };
}

// ---------- the leave types ----------

/** The law's article each of its types comes from, for the cards. */
export const LAW_ARTICLES: Record<Exclude<LeaveKind, 'custom'>, string> = {
  annual: 'Labour Law Arts. 124–125',
  casual: 'Labour Law Art. 128',
  birth: 'Labour Law Art. 128',
  exam: 'Labour Law Art. 126',
  hajj: 'Labour Law Art. 130',
  sick: 'Labour Law Art. 131; Social Insurance Law 148/2019',
  maternity: 'Labour Law Art. 54',
  childcare: 'Labour Law Art. 57',
  unpaid: 'By agreement',
};

/** Where a type comes from: the law's article, or HR's own type. */
export const typeSource = (t: Pick<LeaveTypeView, 'kind'>) => (isLeaveKind(t.kind) && t.kind !== 'custom' ? LAW_ARTICLES[t.kind] : 'Added by HR');

/** Paid, Unpaid or "Paid at 75%". */
export function payText(t: Pick<LeaveTypeView, 'paid' | 'payPercent'>): string {
  return t.paid === 'partly' ? `Paid at ${t.payPercent ?? 100}%` : LEAVE_PAY_LABELS[t.paid];
}

/** What its days come out of, with its days: "From the annual balance, at most 7 days a year", "10 days a year", "30 days a request". */
export function balanceText(t: Pick<LeaveTypeView, 'balance' | 'daysPerYear' | 'maxPerRequest'>): string {
  const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
  if (t.balance === 'from_annual') return t.daysPerYear !== null ? `From the annual balance, at most ${days(t.daysPerYear)} a year` : 'From the annual balance';
  if (t.balance === 'yearly') return t.daysPerYear !== null ? `${days(t.daysPerYear)} a year of its own` : 'Its own days a year';
  if (t.balance === 'per_request') return t.maxPerRequest !== null ? `${days(t.maxPerRequest)} a request` : 'Days a request';
  return LEAVE_BALANCE_LABELS[t.balance];
}

/** "3 requests", "1 request", "No requests yet". */
export const requestsCountText = (n: number) => (n === 0 ? 'No requests yet' : `${n} ${n === 1 ? 'request' : 'requests'}`);

export const TYPE_NAME_EN_ERROR = 'Enter the name in English (up to 100 characters), e.g. Compassionate leave.';
export const TYPE_NAME_AR_ERROR = 'Enter the name in Arabic (up to 100 characters), e.g. إجازة وفاة.';

/**
 * A type's form as POST and PATCH /leave/types take it, all of it (a limit left empty is null: none), and what is wrong,
 * as the API would say it. The checkboxes are sent only when ticked. The pay percent is a partly paid type's only, the
 * days a year a yearly type's (needed) or a from_annual one's (its most a year).
 */
export function typeBody(fd: FormData): { body: LeaveTypeBody; errors: string[] } {
  const errors: string[] = [];
  const nameEn = text(fd, 'nameEn');
  const nameAr = text(fd, 'nameAr');
  if (!nameEn || nameEn.length > 100) errors.push(TYPE_NAME_EN_ERROR);
  if (!nameAr || nameAr.length > 100) errors.push(TYPE_NAME_AR_ERROR);

  const paidRaw = text(fd, 'paid');
  const paid: LeavePay = (LEAVE_PAYS as readonly string[]).includes(paidRaw) ? (paidRaw as LeavePay) : 'paid';
  let payPercent: number | null = null;
  if (paid === 'partly') {
    payPercent = wholeFrom(text(fd, 'payPercent'), 0, 100);
    if (payPercent === null || Number.isNaN(payPercent)) {
      errors.push('Enter the share of the pay a partly paid day pays, a whole percent from 0 to 100, e.g. 75.');
      payPercent = null;
    }
  }
  const balanceRaw = text(fd, 'balance');
  const balance: LeaveBalanceKind = (LEAVE_BALANCES as readonly string[]).includes(balanceRaw) ? (balanceRaw as LeaveBalanceKind) : 'none';

  // the API's limits, each a whole number or none
  const limit = (key: string, min: number, max: number, error: string) => {
    const n = wholeFrom(text(fd, key), min, max);
    if (n !== null && Number.isNaN(n)) {
      errors.push(error);
      return null;
    }
    return n;
  };
  let daysPerYear: number | null = null;
  if (balance === 'yearly' || balance === 'from_annual') {
    daysPerYear = limit('daysPerYear', 1, 366, 'Enter the days a year as a whole number from 1 to 366, e.g. 7.');
    if (balance === 'yearly' && daysPerYear === null && !errors.some((e) => e.startsWith('Enter the days a year'))) errors.push('Enter the days a year this type gives.');
  }
  const maxPerRequest = limit('maxPerRequest', 1, 1000, 'Enter the most days a request as a whole number from 1 to 1000, or leave it empty for no limit.');
  const maxTimesInService = limit('maxTimesInService', 1, 100, 'Enter the most times in service as a whole number from 1 to 100, or leave it empty for no limit.');
  const minServiceMonths = limit('minServiceMonths', 0, 600, 'Enter the months of service needed first as a whole number from 0 to 600, or leave it empty.');
  const noticeDays = limit('noticeDays', 0, 365, 'Enter the days of notice as a whole number from 0 to 365, or leave it empty for none.');
  if (balance === 'per_request' && maxPerRequest === null && !errors.some((e) => e.startsWith('Enter the most days a request'))) {
    errors.push('Enter the days a request this type gives.');
  }
  const genderRaw = text(fd, 'gender');
  const gender = genderRaw === 'male' || genderRaw === 'female' ? genderRaw : null;
  const sortOrder = wholeFrom(text(fd, 'sortOrder'), 1, 999);
  if (sortOrder !== null && Number.isNaN(sortOrder)) errors.push('Enter the place in the list as a whole number from 1 to 999.');

  const body: LeaveTypeBody = {
    nameEn,
    nameAr,
    paid,
    payPercent,
    balance,
    daysPerYear,
    maxPerRequest,
    maxTimesInService,
    minServiceMonths,
    noticeDays,
    documentRequired: fd.has('documentRequired'),
    gender,
    calendarDays: fd.has('calendarDays'),
    halfDays: fd.has('halfDays'),
    active: fd.has('active'),
    sortOrder: sortOrder !== null && !Number.isNaN(sortOrder) ? sortOrder : 1,
  };
  return { body, errors };
}

/** A limit's field as the form starts with it: its number, or empty for none. */
export const limitField = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
