import { bankNamed, LABELS, TEMPLATE_TAGS, type EmploymentType, type TemplateLanguage } from '@trendlix/shared';
import { fromDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import { arabicAmountInWords, arabicDuration, arabicWeekday } from './engine/index.js';
import { EMPLOYMENT_TYPES_AR, hasArabic, inLanguage, printedAddress, printedDate, printedMoney, printedMonth, printedPhone } from './format.js';
import { TYPED_TAGS } from './offer.js';

// Every tag's value for one document (spec §8; owner's request, 15 October 2026), from the employee's profile, their
// employment, a contract version, an ending, the company profile and the document's date, written as the document
// prints it (format.ts). A slot's overrides are applied last: on the social insurance copy, {{gross_salary}} prints the
// insured salary. Only the tags asked for are worked out, so a template that doesn't print an amount in words never
// needs it.

type Decimal = Prisma.Decimal;

/** What a document's values come from. Dates as the database gives them (midnight UTC). */
export interface ValueSources {
  /** The template version's language: the job title, department and employment type are written in it. */
  language: TemplateLanguage;
  employee: {
    employeeCode: string;
    fullNameEn: string;
    fullNameAr: string;
    displayName: string | null;
    nationality: string | null;
    dateOfBirth: Date | null;
    addressAr: string | null;
    city: string | null;
    governorate: string | null;
    mobile: string | null;
    workEmail: string | null;
    qualificationAr: string | null;
    insuranceNo: string | null;
  };
  identity: { nationalId: string | null; printedNo: string | null; issueDate: Date | null } | null;
  bank: { bankName: string | null; accountNo: string | null; iban: string | null; holderName: string | null } | null;
  employment: {
    employmentType: EmploymentType;
    joinDate: Date;
    jobTitle: { titleEn: string; titleAr: string | null } | null;
    department: { nameEn: string; nameAr: string | null } | null;
    grade: { code: string } | null;
  } | null;
  contract: {
    number: string;
    form: string;
    status: string;
    startDate: Date;
    endDate: Date | null;
    durationMonths: number | null;
    probationEnd: Date | null;
    grossSalary: Decimal;
    basicPercent: number;
    netSalary: Decimal | null;
    insuredSalary: Decimal;
    jobTitleEn: string | null;
    jobTitleAr: string | null;
    gradeCode: string | null;
  } | null;
  ending: { noticeGivenOn: Date; lastWorkingDay: Date; reason: string | null } | null;
  company: {
    nameEn: string;
    nameAr: string | null;
    addressAr: string | null;
    commercialRegNo: string | null;
    taxRegNo: string | null;
    insuranceEmployerNo: string | null;
    repName: string | null;
    repTitle: string | null;
    repNationalId: string | null;
  } | null;
  /** YYYY-MM-DD: {{date}}, {{contract_date}} and {{day_name}}. */
  documentDate: string;
  /** What was typed when generating. */
  inputs: Readonly<Record<string, string | undefined>>;
}

/** The profile tab where a value is filled in, and the field. */
export interface Where {
  tab: 'basic' | 'education' | 'employment' | 'contracts' | 'company';
  key: string;
}

/** A used tag with no value, and where to fill it in. */
export interface MissingTag {
  tag: string;
  label: string;
  where: Where;
}

/** The ending's reason when none is recorded in Arabic (the owner's resignation template). */
export const DEFAULT_REASON_AR = 'لأسباب شخصية';

const ymd = (d: Date | null | undefined) => (d ? fromDateOnly(d) : null);
const text = (s: string | null | undefined) => s?.trim() ?? '';
const amount = (d: Decimal | null | undefined): number | null => (d === null || d === undefined ? null : d.toNumber());
const words = (n: number | null) => (n === null ? '' : arabicAmountInWords(n));

/** The gross split into basic and variable salary by the contract's basic share, to the piastre (as contractView). */
function split(c: NonNullable<ValueSources['contract']>) {
  const grossCents = Math.round(c.grossSalary.toNumber() * 100);
  const basicCents = Math.round((grossCents * c.basicPercent) / 100);
  return { basic: basicCents / 100, variable: (grossCents - basicCents) / 100 };
}

/** How each tag's value is worked out, from the sources. */
function resolvers(src: ValueSources): Record<string, () => string> {
  const { employee: e, identity: id, bank, employment: job, contract: c, ending, company: co, language } = src;
  // a signed contract keeps the job title and grade agreed; a draft has none yet, so the employment's are printed
  const signed = c !== null && c.status !== 'draft';
  const net = amount(c?.netSalary);
  return {
    employee_code: () => e.employeeCode,
    full_name_ar: () => text(e.fullNameAr),
    full_name_en: () => text(e.fullNameEn),
    display_name: () => text(e.displayName),
    nationality: () => text(e.nationality),
    date_of_birth: () => printedDate(ymd(e.dateOfBirth)),
    address: () => printedAddress(e.addressAr, e.city, e.governorate),
    phone: () => printedPhone(e.mobile),
    work_email: () => text(e.workEmail),
    qualification: () => text(e.qualificationAr),
    insurance_no: () => text(e.insuranceNo),

    national_id: () => text(id?.nationalId),
    id_printed_no: () => text(id?.printedNo),
    id_issue_date: () => printedMonth(ymd(id?.issueDate)),

    job_title: () =>
      signed && (c.jobTitleEn || c.jobTitleAr) ? inLanguage(language, c.jobTitleEn, c.jobTitleAr) : inLanguage(language, job?.jobTitle?.titleEn, job?.jobTitle?.titleAr),
    department: () => inLanguage(language, job?.department?.nameEn, job?.department?.nameAr),
    grade: () => text(signed && c.gradeCode ? c.gradeCode : job?.grade?.code),
    employment_type: () => (job ? (language === 'ar' ? EMPLOYMENT_TYPES_AR[job.employmentType] : LABELS.employmentType[job.employmentType]) : ''),
    join_date: () => printedDate(ymd(job?.joinDate)),
    contract_number: () => text(c?.number),
    duration: () => (!c ? '' : c.form === 'open_ended' ? 'غير محدد المدة' : c.durationMonths ? arabicDuration(c.durationMonths) : ''),
    start_date: () => printedDate(ymd(c?.startDate)),
    end_date: () => printedDate(ymd(c?.endDate)),
    probation_end: () => printedDate(ymd(c?.probationEnd)),

    gross_salary: () => printedMoney(amount(c?.grossSalary)),
    gross_salary_words: () => words(amount(c?.grossSalary)),
    basic_salary: () => (c ? printedMoney(split(c).basic) : ''),
    variable_salary: () => (c ? printedMoney(split(c).variable) : ''),
    net_salary: () => printedMoney(net),
    net_salary_words: () => words(net),
    insured_salary: () => printedMoney(amount(c?.insuredSalary)),
    insured_salary_words: () => words(amount(c?.insuredSalary)),

    bank_name: () => text(bank?.bankName),
    bank_bic: () => bankNamed(bank?.bankName)?.bic ?? '',
    account_no: () => text(bank?.accountNo),
    iban: () => text(bank?.iban),
    holder_name: () => text(bank?.holderName),

    resignation_date: () => printedDate(ymd(ending?.noticeGivenOn)),
    request_date: () => printedDate(ymd(ending?.noticeGivenOn)),
    last_working_day: () => printedDate(ymd(ending?.lastWorkingDay)),
    // the reason as recorded when it is written in Arabic; a reason typed in English isn't printed on an Arabic form
    reason_ar: () => (ending ? (hasArabic(ending.reason) ? text(ending.reason) : DEFAULT_REASON_AR) : ''),

    letter_to: () => text(src.inputs.letter_to),
    letter_purpose: () => text(src.inputs.letter_purpose),

    // payslips come from payroll, which isn't built yet
    pay_month: () => '',
    allowances: () => '',
    deductions: () => '',

    company_name_ar: () => text(co?.nameAr),
    company_name_en: () => text(co?.nameEn),
    company_address_ar: () => text(co?.addressAr),
    commercial_reg_no: () => text(co?.commercialRegNo),
    tax_reg_no: () => text(co?.taxRegNo),
    insurance_employer_no: () => text(co?.insuranceEmployerNo),
    company_rep_name: () => text(co?.repName),
    company_rep_title: () => text(co?.repTitle),
    company_rep_national_id: () => text(co?.repNationalId),

    day_name: () => arabicWeekday(src.documentDate),
    date: () => printedDate(src.documentDate),
    contract_date: () => printedDate(src.documentDate),
  };
}

/**
 * The values of `tags` (those a template uses), each read through the slot's overrides: { tag: value }, an empty
 * string where there is none.
 */
export function resolveValues(src: ValueSources, tags: readonly string[], overrides: Readonly<Record<string, string>> = {}): Record<string, string> {
  const all = resolvers(src);
  const out: Record<string, string> = {};
  for (const tag of tags) {
    const read = all[overrides[tag] ?? tag];
    out[tag] = read ? read() : '';
  }
  return out;
}

/** The tag the value of `tag` is read from on this slot: its override, or itself. */
export const sourceTag = (tag: string, overrides: Readonly<Record<string, string>> = {}) => overrides[tag] ?? tag;

const BASIC = (key: string): Where => ({ tab: 'basic', key });
const EMPLOYMENT = (key: string): Where => ({ tab: 'employment', key });
const CONTRACTS = (key: string): Where => ({ tab: 'contracts', key });
const COMPANY = (key: string): Where => ({ tab: 'company', key });

/**
 * Where each tag's value is filled in: the profile's tab and field, with the keys the profile's completeness uses
 * (nationalId, idIssueDate, team …); a contract's terms on the Contracts tab (`contract` when there is no contract
 * version at all); the ending on the Employment tab; the company's details in Company.
 */
const WHERE: Record<string, Where> = {
  employee_code: BASIC('employeeCode'),
  full_name_ar: BASIC('fullNameAr'),
  full_name_en: BASIC('fullNameEn'),
  display_name: BASIC('displayName'),
  nationality: BASIC('nationality'),
  date_of_birth: BASIC('dateOfBirth'),
  address: BASIC('addressAr'),
  phone: BASIC('mobile'),
  work_email: BASIC('workEmail'),
  qualification: { tab: 'education', key: 'qualificationAr' },
  insurance_no: BASIC('insuranceNo'),
  national_id: BASIC('nationalId'),
  id_printed_no: BASIC('printedNo'),
  id_issue_date: BASIC('idIssueDate'),
  job_title: EMPLOYMENT('jobTitle'),
  department: EMPLOYMENT('team'),
  grade: EMPLOYMENT('grade'),
  employment_type: EMPLOYMENT('employmentType'),
  join_date: EMPLOYMENT('joinDate'),
  contract_number: CONTRACTS('contract'),
  duration: CONTRACTS('durationMonths'),
  start_date: CONTRACTS('startDate'),
  end_date: CONTRACTS('endDate'),
  probation_end: CONTRACTS('probationEnd'),
  gross_salary: CONTRACTS('grossSalary'),
  gross_salary_words: CONTRACTS('grossSalary'),
  basic_salary: CONTRACTS('grossSalary'),
  variable_salary: CONTRACTS('grossSalary'),
  net_salary: CONTRACTS('netSalary'),
  net_salary_words: CONTRACTS('netSalary'),
  insured_salary: CONTRACTS('insuredSalary'),
  insured_salary_words: CONTRACTS('insuredSalary'),
  bank_name: BASIC('bankName'),
  bank_bic: BASIC('bankName'), // a bank not on the EG-ACH list has no BIC: choose it from the list
  account_no: BASIC('accountNo'),
  iban: BASIC('iban'),
  holder_name: BASIC('holderName'),
  resignation_date: EMPLOYMENT('ending'),
  request_date: EMPLOYMENT('ending'),
  last_working_day: EMPLOYMENT('ending'),
  reason_ar: EMPLOYMENT('ending'),
  pay_month: EMPLOYMENT('payroll'),
  allowances: EMPLOYMENT('payroll'),
  deductions: EMPLOYMENT('payroll'),
  company_name_ar: COMPANY('nameAr'),
  company_name_en: COMPANY('nameEn'),
  company_address_ar: COMPANY('addressAr'),
  commercial_reg_no: COMPANY('commercialRegNo'),
  tax_reg_no: COMPANY('taxRegNo'),
  insurance_employer_no: COMPANY('insuranceEmployerNo'),
  company_rep_name: COMPANY('repName'),
  company_rep_title: COMPANY('repTitle'),
  company_rep_national_id: COMPANY('repNationalId'),
};

const TAGS = new Map(TEMPLATE_TAGS.map((t) => [t.tag, t]));

/**
 * The tags of `tags` whose value is empty, with where to fill each in (read through the slot's overrides, so the
 * insurance copy's empty {{gross_salary}} points to the insured salary). The tags typed when generating are not listed:
 * they are asked for when generating.
 */
export function missingTags(
  values: Readonly<Record<string, string>>,
  tags: readonly string[],
  overrides: Readonly<Record<string, string>> = {},
  hasContract = true,
): MissingTag[] {
  return tags
    .filter((tag) => !TYPED_TAGS.includes(tag) && !values[tag]?.trim())
    .map((tag) => {
      const source = sourceTag(tag, overrides);
      const where = WHERE[source] ?? BASIC(source);
      return { tag, label: TAGS.get(tag)?.labelEn ?? tag, where: where.tab === 'contracts' && !hasContract ? CONTRACTS('contract') : where };
    });
}

/** Restricted tags (national ID, salary, bank account): which of the caller's rights each needs. */
export type RestrictedRight = 'identity' | 'salary' | 'bank';

/** The right a restricted tag needs to be printed, or null for a tag anyone who generates may print. */
export function rightFor(tag: string): RestrictedRight | null {
  const t = TAGS.get(tag);
  if (!t?.restricted) return null;
  if (t.group === 'bank') return 'bank';
  if (t.group === 'pay' || t.group === 'payslip') return 'salary';
  return 'identity'; // the national ID, and the company representative's
}

/** The restricted tags a template prints, read through the slot's overrides (both the tag and what it reads). */
export function restrictedTags(tags: readonly string[], overrides: Readonly<Record<string, string>> = {}): string[] {
  return tags.filter((tag) => rightFor(tag) !== null || rightFor(sourceTag(tag, overrides)) !== null);
}
