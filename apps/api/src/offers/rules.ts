import { createHash } from 'node:crypto';
import { offerSlotKey, TEMPLATE_SLOTS, type OfferShownStatus, type TemplateSlot } from '@trendlix/shared';
import { addDays, addMonths, fromDateOnly, todayInCairo } from '../common/date-only.js';
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
  job_title: 'jobTitleId',
  job_title_ar: 'jobTitleId',
  job_title_en: 'jobTitleId',
  department: 'departmentId',
  department_ar: 'departmentId',
  department_en: 'departmentId',
  grade: 'gradeId',
  employment_type: 'employmentType',
  employment_type_ar: 'employmentType',
  employment_type_en: 'employmentType',
  join_date: 'joinDate',
  start_date: 'joinDate',
  contract_number: 'number',
  duration: 'durationMonths',
  end_date: 'durationMonths',
  probation_end: 'probationMonths',
  pay_basis: 'payBasis',
  pay_basis_ar: 'payBasis',
  pay_basis_en: 'payBasis',
  days_per_week: 'daysPerWeek',
  hours_per_week: 'hoursPerWeek',
  hourly_rate: 'hourlyRate',
  gross_salary: 'grossSalary',
  gross_salary_words: 'grossSalary',
  basic_salary: 'grossSalary',
  variable_salary: 'grossSalary',
  insured_salary: 'grossSalary',
  insured_salary_words: 'grossSalary',
  total_salary: 'grossSalary',
  total_salary_words: 'grossSalary',
  net_salary: 'netSalary',
  net_salary_words: 'netSalary',
  allowances: 'allowances',
  allowances_ar: 'allowances',
  allowances_en: 'allowances',
  allowances_total: 'allowances',
  offer_number: 'number',
  offer_expiry: 'expiresOn',
};

/**
 * Where an offer's empty value is filled in: the company's details in Company, as for an employee's documents; anything
 * else on the offer (`{ tab: 'offer', key: <the offer's field> }`), or `{ tab: 'offer', key: 'template' }` for a value an
 * offer never has (a national ID, an address, bank details …): the template prints something that belongs on a
 * document for an employee, so it is the template that needs changing.
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
