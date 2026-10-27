import { createHash } from 'node:crypto';
import { offerSlotKey, TEMPLATE_SLOTS, type OfferShownStatus, type TemplateSlot } from '@trendlix/shared';
import { addDays, addMonths, fromDateOnly, shownDate, todayInCairo } from '../common/date-only.js';
import { sourceTag, type MissingTag, type Where } from '../documents/values.js';

// The rules of a job offer that need no database (owner's request, 15 October 2026): its shown status, the dates its
// terms give, how the name typed to accept is compared, and where a value its template prints is filled in.

const SLOTS = new Map(TEMPLATE_SLOTS.map((s) => [s.key, s]));

/** The job offer template of an employment type: its slot in the template library (every type has one). */
export function offerSlot(employmentType: string): TemplateSlot {
  const slot = SLOTS.get(offerSlotKey(employmentType));
  if (!slot) throw new Error(`No job offer template slot for ${employmentType}`);
  return slot;
}

/** As shown: a sent offer whose last day has passed (in Cairo) is Expired; it is still stored as sent. */
export function shownStatus(o: { status: string; expiresOn: Date }, today = todayInCairo()): OfferShownStatus {
  return o.status === 'sent' && fromDateOnly(o.expiresOn) < today ? 'expired' : (o.status as OfferShownStatus);
}

/** Whether the offer's last day has passed (in Cairo). */
export const pastLastDay = (o: { expiresOn: Date }, today = todayInCairo()) => fromDateOnly(o.expiresOn) < today;

// ---------- earlier offers (owner, 25 October 2026: "allow the HR to add for now job offers with a past duedate to
// enter the previous data"; packages/shared offers.ts) ----------

export const PAST_LAST_DAY = "The offer's last day can't be in the past.";

/**
 * Why a last day can't be saved, or null. One in the past only while "Entering earlier offers" is on (`earlierOn`): for
 * a draft (which is then an earlier one), or for a sent offer that is an earlier one (`recordedEarlier`), never before
 * the day it was recorded as sent (`sentOn`). Otherwise as before the switch: never in the past.
 */
export function lastDayProblem(
  lastDay: string,
  today: string,
  { earlierOn, draft, recordedEarlier = false, sentOn = null }: { earlierOn: boolean; draft: boolean; recordedEarlier?: boolean; sentOn?: string | null },
): string | null {
  if (lastDay < today && !(earlierOn && (draft || recordedEarlier))) return PAST_LAST_DAY;
  if (!draft && recordedEarlier && sentOn && lastDay < sentOn) return `The offer's last day can't be before the day it was sent, ${shownDate(sentOn)}.`;
  return null;
}

/** Why an offer can't be recorded as sent on `sentOn`, or null: not in the future, and not after its last day. */
export function recordSentProblem(sentOn: string, lastDay: string, today: string): string | null {
  if (sentOn > today) return "The day it was sent can't be in the future.";
  if (sentOn > lastDay) return `It can't have been sent after its last day, ${shownDate(lastDay)}. Choose an earlier day, or edit the last day first.`;
  return null;
}

/**
 * Why an answer can't be dated `answeredOn`, or null. Another day than today only for an earlier offer while the switch
 * is on (`leeway`); never in the future, nor before the day the offer was sent (`sentOn`).
 */
export function answerDayProblem(answeredOn: string, today: string, { leeway, sentOn }: { leeway: boolean; sentOn: string | null }): string | null {
  if (answeredOn > today) return "The day of the answer can't be in the future.";
  if (answeredOn !== today && !leeway) return "Only an earlier offer's answer is dated another day than today, while entering earlier offers is on.";
  if (sentOn && answeredOn < sentOn) return `The answer can't be before the offer was sent, on ${shownDate(sentOn)}.`;
  return null;
}

/**
 * The moment kept for a day HR picked (an earlier offer's sending or answer): midday in Cairo (10:00 UTC, 12:00 or 13:00
 * there), so it falls on that day whatever the clock, and never later than now (today's, early in the morning).
 */
export function momentOn(ymd: string, now = new Date()): Date {
  const midday = new Date(`${ymd}T10:00:00.000Z`);
  return midday.getTime() > now.getTime() ? now : midday;
}

/**
 * The dates a contract made from the offer has, as ContractsService works them out for version 1: it starts on the
 * join date and ends after the fixed term (start + duration − 1 day); the probation ends start + probation − 1 day,
 * none without probation.
 */
export function termDates(joinDate: string, durationMonths: number, probationMonths: number) {
  return {
    endDate: addDays(addMonths(joinDate, durationMonths), -1),
    probationEnd: probationMonths > 0 ? addDays(addMonths(joinDate, probationMonths), -1) : null,
  };
}

/**
 * A name as it is compared when the candidate types it to accept: case, extra spaces and invisible marks don't count,
 * nor the Arabic letter forms people type either way (أ إ آ ٱ → ا, ى → ي, ة → ه), diacritics or the tatweel.
 */
export function comparableName(name: string): string {
  return name
    .normalize('NFC')
    .toLowerCase()
    .replace(/[​-‏‪-‮⁦-⁩﻿]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[ً-ٰٕـ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whether the typed name is the offer's name in English or in Arabic (see comparableName). */
export function nameMatches(typed: string, names: readonly string[]): boolean {
  const given = comparableName(typed);
  return given !== '' && names.some((n) => comparableName(n) === given);
}

/** The offer's field where each tag's value comes from; a tag not listed is one an offer has no value for. */
const OFFER_FIELDS: Record<string, string> = {
  full_name_ar: 'fullNameAr',
  full_name_en: 'fullNameEn',
  phone: 'mobile',
  personal_email: 'email',
  job_title: 'jobTitleId',
  job_title_ar: 'jobTitleId',
  job_title_en: 'jobTitleId',
  job_duties: 'jobTitleId', // the selected role, whose duties are written under Organization
  department: 'departmentId',
  department_ar: 'departmentId',
  department_en: 'departmentId',
  manager_name: 'managerId',
  manager_name_ar: 'managerId',
  manager_name_en: 'managerId',
  grade: 'gradeId',
  grade_level: 'gradeId',
  grade_level_ar: 'gradeId',
  grade_level_en: 'gradeId',
  employment_type: 'employmentType',
  employment_type_ar: 'employmentType',
  employment_type_en: 'employmentType',
  join_date: 'joinDate',
  insurance_start_date: 'joinDate', // an offer has no subscription start of its own: its join date
  insurance_year_start: 'joinDate',
  insurance_year_end: 'joinDate',
  insurance_year_duration: 'joinDate',
  work_arrangement: 'workArrangement',
  work_arrangement_ar: 'workArrangement',
  work_arrangement_en: 'workArrangement',
  // by the labour law (owner, 18 October 2026): remote work is the work arrangement in the law's words
  work_pattern: 'workArrangement',
  work_pattern_ar: 'workArrangement',
  work_pattern_en: 'workArrangement',
  work_nature: 'workNature',
  work_nature_ar: 'workNature',
  work_nature_en: 'workNature',
  paid_by_commission: 'paidByCommission',
  paid_by_commission_ar: 'paidByCommission',
  paid_by_commission_en: 'paidByCommission',
  contract_form: 'durationMonths', // an offer's contract is fixed-term
  shift: 'shiftId',
  shift_ar: 'shiftId',
  shift_en: 'shiftId',
  start_date: 'joinDate',
  contract_number: 'number',
  duration: 'durationMonths',
  end_date: 'durationMonths',
  probation_months: 'probationMonths',
  probation_months_ar: 'probationMonths',
  probation_months_en: 'probationMonths',
  probation_end: 'probationMonths',
  pay_basis: 'payBasis',
  pay_basis_ar: 'payBasis',
  pay_basis_en: 'payBasis',
  days_per_week: 'daysPerWeek',
  hours_per_week: 'hoursPerWeek',
  hourly_rate: 'hourlyRate',
  net_hourly_rate: 'netSalary', // by the hour; a monthly salary has none
  // the minimum a month by the hour (27 October 2026): printed blank without one, so only ever pointed to
  hourly_minimum: 'hourlyMinimum',
  hourly_minimum_line: 'hourlyMinimum',
  hourly_minimum_line_ar: 'hourlyMinimum',
  hourly_minimum_line_en: 'hourlyMinimum',
  gross_salary: 'grossSalary',
  gross_salary_words: 'grossSalary',
  gross_salary_words_en: 'grossSalary',
  basic_salary: 'grossSalary',
  basic_percent: 'basicPercent',
  variable_salary: 'grossSalary',
  insured_salary: 'grossSalary',
  insured_salary_words: 'grossSalary',
  insured_salary_words_en: 'grossSalary',
  total_salary: 'grossSalary',
  total_salary_words: 'grossSalary',
  total_salary_words_en: 'grossSalary',
  insurance_insured_salary: 'grossSalary', // the comprehensive wage below, within the year's insurable limits
  insurance_total_salary: 'grossSalary', // an offer has no comprehensive wage of its own: its gross and allowances
  insurance_insured_salary_words: 'grossSalary',
  insurance_insured_salary_words_en: 'grossSalary',
  insurance_total_salary_words: 'grossSalary',
  insurance_total_salary_words_en: 'grossSalary',
  net_salary: 'netSalary',
  net_salary_words: 'netSalary',
  net_salary_words_en: 'netSalary',
  allowances: 'allowances',
  allowances_ar: 'allowances',
  allowances_en: 'allowances',
  allowances_total: 'allowances',
  allowances_total_words: 'allowances',
  allowances_total_words_en: 'allowances',
  // the accounts allowance's line (25 October 2026): an offer's per-account allowance
  accounts_allowance: 'allowances',
  accounts_allowance_ar: 'allowances',
  accounts_allowance_en: 'allowances',
  offer_number: 'number',
  offer_expiry: 'expiresOn',
};

/**
 * Where an offer's empty value is filled in: the company's details in Company, as for an employee's documents; anything
 * else on the offer (`{ tab: 'offer', key: <the offer's field> }`), or `{ tab: 'offer', key: 'template' }` for a value an
 * offer never has (a national ID, an address, the social insurance occupation, bank details …): the template prints
 * something that belongs on a document for an employee, so it is the template that needs changing. The occupation is
 * the employee's own, set on their profile's Social Insurance tab (owner's decision, 16 October 2026), so an offer,
 * made before there is an employee, never has one.
 */
export function offerMissing(missing: readonly MissingTag[], overrides: Readonly<Record<string, string>> = {}): MissingTag[] {
  return missing.map((m) => {
    if (m.where.tab === 'company') return m;
    const where: Where = { tab: 'offer', key: OFFER_FIELDS[sourceTag(m.tag, overrides)] ?? 'template' };
    return { ...m, where };
  });
}

/** A moment as a date in Cairo: YYYY-MM-DD. */
export function cairoDate(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(at);
}

/** The SHA-256 of a link's secret, as stored: the secret itself is never kept, logged or audited. */
export const tokenHash = (secret: string) => createHash('sha256').update(secret).digest('hex');
