import {
  bankNamed,
  LABELS,
  occupationName,
  PAY_BASIS_LABELS,
  PAY_BASIS_LABELS_AR,
  TEMPLATE_TAGS,
  WEEKS_PER_MONTH,
  WORK_ARRANGEMENT_LABELS_AR,
  type EmploymentType,
  type PayBasis,
  type TemplateLanguage,
  type WorkArrangement,
} from '@trendlix/shared';
import { fromDateOnly } from '../common/date-only.js';
import { fromTimeOfDay } from '../common/time-of-day.js';
import type { Prisma } from '../generated/prisma/client.js';
import { arabicAmountInWords, arabicDuration, arabicWeekday, englishAmountInWords, isBlankValue, type TagValue } from './engine/index.js';
import {
  arabicDigits,
  EMPLOYMENT_TYPES_AR,
  hasArabic,
  inLanguage,
  printedAddress,
  printedAddressLine,
  printedDate,
  printedGovernorate,
  printedMoney,
  printedMonth,
  printedPhone,
  printedProbation,
  printedShift,
  type PrintedLanguage,
} from './format.js';
import { TYPED_TAGS } from './offer.js';

// Every tag's value for one document (spec §8; owner's request, 15 October 2026), from the employee's profile, their
// employment, a contract version (or a job offer's terms), an ending, the company profile and the document's date, written as the document
// prints it (format.ts). A slot's overrides are applied last: on the social insurance copy, {{gross_salary}} prints the
// insured salary. Only the tags asked for are worked out, so a template that doesn't print an amount in words never
// needs it. A value is plain text, but for the role's duties, which keep their formatting (engine/rich.ts).

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
    /** The address's building number (social insurance Forms 1 and 6); none on a job offer. */
    buildingNo: string | null;
    mobile: string | null;
    workEmail: string | null;
    /** The profile's; on a job offer, the email it is sent to. */
    personalEmail: string | null;
    qualificationAr: string | null;
    insuranceNo: string | null;
  };
  identity: { nationalId: string | null; printedNo: string | null; issueDate: Date | null } | null;
  bank: { bankName: string | null; accountNo: string | null; iban: string | null; holderName: string | null } | null;
  employment: {
    employmentType: EmploymentType;
    joinDate: Date;
    /**
     * The role: its titles, its duties and responsibilities as saved (HTML; null for none), and its occupation's code in
     * the social insurance table (null for none set).
     */
    jobTitle: { titleEn: string; titleAr: string | null; jdDuties: string | null; occupationCode: string | null } | null;
    department: { nameEn: string; nameAr: string | null } | null;
    grade: { code: string; levelEn: string; levelAr: string | null } | null;
    /** The direct manager (an employee). */
    manager: { fullNameEn: string; fullNameAr: string } | null;
    /** Its times as the database gives a TIME column (1970-01-01 at that time, UTC); its days 0 = Sunday … 6 = Saturday. */
    shift: { startTime: Date; endTime: Date; workingDays: readonly number[] } | null;
    workArrangement: WorkArrangement;
  } | null;
  contract: {
    number: string;
    form: string;
    status: string;
    startDate: Date;
    endDate: Date | null;
    durationMonths: number | null;
    /** 0 without probation. */
    probationMonths: number;
    probationEnd: Date | null;
    grossSalary: Decimal;
    basicPercent: number;
    netSalary: Decimal | null;
    insuredSalary: Decimal;
    jobTitleEn: string | null;
    jobTitleAr: string | null;
    gradeCode: string | null;
    /** PAY_BASES: monthly, hourly (the gross is then the monthly estimate). */
    payBasis: string;
    hourlyRate: Decimal | null;
    hoursPerWeek: Decimal | null;
    daysPerWeek: number | null;
    /** A month each, as on the contract or offer. */
    allowances: readonly { nameEn: string; nameAr: string; amount: Decimal }[];
  } | null;
  ending: { noticeGivenOn: Date; lastWorkingDay: Date; reason: string | null } | null;
  /** The job offer: the one being sent, or for an employee the offer they accepted. */
  offer?: { number: string; expiresOn: Date } | null;
  company: {
    nameEn: string;
    nameAr: string | null;
    addressAr: string | null;
    addressEn: string | null;
    commercialRegNo: string | null;
    taxRegNo: string | null;
    insuranceEmployerNo: string | null;
    insuranceOffice: string | null;
    insuranceSectorCode: string | null;
    repName: string | null;
    repTitle: string | null;
    repNameEn: string | null;
    repTitleEn: string | null;
    repNationalId: string | null;
  } | null;
  /** YYYY-MM-DD: {{date}}, {{contract_date}} and {{day_name}}. */
  documentDate: string;
  /** What was typed when generating. */
  inputs: Readonly<Record<string, string | undefined>>;
}

/**
 * The profile tab where a value is filled in, and the field; or the company profile (`company`), a job offer's field
 * (`offer`), or a job title's under Organization › Departments & Job Titles (`departments`: its social insurance
 * occupation).
 */
export interface Where {
  tab: 'basic' | 'education' | 'employment' | 'contracts' | 'company' | 'offer' | 'departments';
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
/** The same in English (owner, 15 October 2026): "Fifteen thousand Egyptian pounds only". */
const wordsEn = (n: number | null) => (n === null ? '' : englishAmountInWords(n));

/** The gross split into basic and variable salary by the contract's basic share, to the piastre (as contractView). */
function split(c: NonNullable<ValueSources['contract']>) {
  const grossCents = Math.round(c.grossSalary.toNumber() * 100);
  const basicCents = Math.round((grossCents * c.basicPercent) / 100);
  return { basic: basicCents / 100, variable: (grossCents - basicCents) / 100 };
}

/** The language a value is written in. */
type Lang = PrintedLanguage;

/** How each tag's value is worked out, from the sources. */
function resolvers(src: ValueSources): Record<string, () => TagValue> {
  const { employee: e, identity: id, bank, employment: job, contract: c, ending, company: co } = src;
  // a bilingual template's tags that depend on the language print in Arabic; their _ar and _en forms in that language
  const language: Lang = src.language === 'en' ? 'en' : 'ar';
  // a signed contract keeps the job title and grade agreed; a draft has none yet, so the employment's are printed
  const signed = c !== null && c.status !== 'draft';
  const net = amount(c?.netSalary);
  const allowancesTotal = c ? Math.round(c.allowances.reduce((sum, a) => sum + a.amount.toNumber(), 0) * 100) / 100 : null;
  const totalSalary = c && allowancesTotal !== null ? Math.round((c.grossSalary.toNumber() + allowancesTotal) * 100) / 100 : null;
  const hours = amount(c?.hoursPerWeek);
  // by the hour, the net of an hour: the approximate net ÷ the hours of a month (hours a week × 52 ÷ 12), to the piaster
  const netHourly = c?.payBasis === 'hourly' && net !== null && hours ? Math.round((net / (hours * WEEKS_PER_MONTH) + Number.EPSILON) * 100) / 100 : null;

  // the values that depend on the language, in either
  const jobTitle = (lang: Lang) =>
    signed && (c.jobTitleEn || c.jobTitleAr) ? inLanguage(lang, c.jobTitleEn, c.jobTitleAr) : inLanguage(lang, job?.jobTitle?.titleEn, job?.jobTitle?.titleAr);
  const department = (lang: Lang) => inLanguage(lang, job?.department?.nameEn, job?.department?.nameAr);
  const employmentType = (lang: Lang) => (job ? (lang === 'ar' ? EMPLOYMENT_TYPES_AR[job.employmentType] : LABELS.employmentType[job.employmentType]) : '');
  const payBasis = (lang: Lang) => (c ? ((lang === 'ar' ? PAY_BASIS_LABELS_AR : PAY_BASIS_LABELS)[c.payBasis as PayBasis] ?? '') : '');
  const managerName = (lang: Lang) => inLanguage(lang, job?.manager?.fullNameEn, job?.manager?.fullNameAr);
  // a signed contract keeps only its grade's code, not the level: the level is always the employment's grade's (the
  // grade {{grade}} prints when there is no signed contract), the level it has now
  const gradeLevel = (lang: Lang) => inLanguage(lang, job?.grade?.levelEn, job?.grade?.levelAr);
  const workArrangement = (lang: Lang) => (job ? ((lang === 'ar' ? WORK_ARRANGEMENT_LABELS_AR : LABELS.workArrangement)[job.workArrangement] ?? '') : '');
  // the employment's shift (a signed contract keeps only its code), with its times and working days
  const shift = (lang: Lang) =>
    job?.shift ? printedShift({ startTime: fromTimeOfDay(job.shift.startTime), endTime: fromTimeOfDay(job.shift.endTime), workingDays: job.shift.workingDays }, lang) : '';
  // none is a value too: "No probation" / "لا توجد فترة اختبار"
  const probation = (lang: Lang) => (c ? printedProbation(c.probationMonths, lang) : '');
  // the role's duties as written, with their formatting (owner's request, 15 October 2026), in whatever language HR
  // wrote them; none when there is nothing to read
  const duties = (): TagValue => {
    const html = job?.jobTitle?.jdDuties ?? '';
    return isBlankValue({ html }) ? '' : { html };
  };
  // none is a value too: "لا يوجد" / "None"
  const allowances = (lang: Lang) =>
    !c
      ? ''
      : c.allowances.length === 0
        ? lang === 'ar'
          ? 'لا يوجد'
          : 'None'
        : c.allowances.map((a) => `${inLanguage(lang, a.nameEn, a.nameAr)}: ${printedMoney(a.amount.toNumber())}`).join(lang === 'ar' ? '، ' : ', ');

  return {
    employee_code: () => e.employeeCode,
    full_name_ar: () => text(e.fullNameAr),
    full_name_en: () => text(e.fullNameEn),
    display_name: () => text(e.displayName),
    nationality: () => text(e.nationality),
    date_of_birth: () => printedDate(ymd(e.dateOfBirth)),
    address: () => printedAddress(e.addressAr, e.city, e.governorate),
    // the address in its parts, as social insurance Forms 1 and 6 print it (owner, 15 October 2026)
    address_line: () => printedAddressLine(e.addressAr),
    city: () => text(e.city),
    governorate: () => printedGovernorate(e.governorate),
    building_no: () => text(e.buildingNo),
    phone: () => printedPhone(e.mobile),
    work_email: () => text(e.workEmail),
    personal_email: () => text(e.personalEmail),
    qualification: () => text(e.qualificationAr),
    insurance_no: () => text(e.insuranceNo),

    national_id: () => text(id?.nationalId),
    national_id_ar: () => arabicDigits(text(id?.nationalId)),
    id_printed_no: () => text(id?.printedNo),
    id_issue_date: () => printedMonth(ymd(id?.issueDate)),

    job_title: () => jobTitle(language),
    job_title_ar: () => jobTitle('ar'),
    job_title_en: () => jobTitle('en'),
    job_duties: duties,
    // the job title's occupation in the social insurance table (owner, 15 October 2026): the code as stored, the name
    // the table's
    occupation_code: () => text(job?.jobTitle?.occupationCode),
    occupation_name: () => occupationName(job?.jobTitle?.occupationCode) ?? '',
    department: () => department(language),
    department_ar: () => department('ar'),
    department_en: () => department('en'),
    manager_name: () => managerName(language),
    manager_name_ar: () => managerName('ar'),
    manager_name_en: () => managerName('en'),
    grade: () => text(signed && c.gradeCode ? c.gradeCode : job?.grade?.code),
    grade_level: () => gradeLevel(language),
    grade_level_ar: () => gradeLevel('ar'),
    grade_level_en: () => gradeLevel('en'),
    employment_type: () => employmentType(language),
    employment_type_ar: () => employmentType('ar'),
    employment_type_en: () => employmentType('en'),
    join_date: () => printedDate(ymd(job?.joinDate)),
    work_arrangement: () => workArrangement(language),
    work_arrangement_ar: () => workArrangement('ar'),
    work_arrangement_en: () => workArrangement('en'),
    shift: () => shift(language),
    shift_ar: () => shift('ar'),
    shift_en: () => shift('en'),
    contract_number: () => text(c?.number),
    duration: () => (c?.durationMonths ? arabicDuration(c.durationMonths) : ''),
    start_date: () => printedDate(ymd(c?.startDate)),
    end_date: () => printedDate(ymd(c?.endDate)),
    probation_months: () => probation(language),
    probation_months_ar: () => probation('ar'),
    probation_months_en: () => probation('en'),
    probation_end: () => printedDate(ymd(c?.probationEnd)),
    pay_basis: () => payBasis(language),
    pay_basis_ar: () => payBasis('ar'),
    pay_basis_en: () => payBasis('en'),
    days_per_week: () => (c?.daysPerWeek ? String(c.daysPerWeek) : ''),
    hours_per_week: () => (hours === null ? '' : String(hours)),

    gross_salary: () => printedMoney(amount(c?.grossSalary)),
    gross_salary_words: () => words(amount(c?.grossSalary)),
    gross_salary_words_en: () => wordsEn(amount(c?.grossSalary)),
    basic_salary: () => (c ? printedMoney(split(c).basic) : ''),
    basic_percent: () => (c ? `${c.basicPercent}%` : ''),
    variable_salary: () => (c ? printedMoney(split(c).variable) : ''),
    net_salary: () => printedMoney(net),
    net_salary_words: () => words(net),
    net_salary_words_en: () => wordsEn(net),
    insured_salary: () => printedMoney(amount(c?.insuredSalary)),
    insured_salary_words: () => words(amount(c?.insuredSalary)),
    insured_salary_words_en: () => wordsEn(amount(c?.insuredSalary)),
    hourly_rate: () => printedMoney(amount(c?.hourlyRate)),
    net_hourly_rate: () => printedMoney(netHourly),
    allowances: () => allowances(language),
    allowances_ar: () => allowances('ar'),
    allowances_en: () => allowances('en'),
    allowances_total: () => printedMoney(allowancesTotal),
    total_salary: () => printedMoney(totalSalary),
    total_salary_words: () => words(totalSalary),
    total_salary_words_en: () => wordsEn(totalSalary),
    offer_number: () => text(src.offer?.number),
    offer_expiry: () => printedDate(ymd(src.offer?.expiresOn)),

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
    deductions: () => '',

    company_name_ar: () => text(co?.nameAr),
    company_name_en: () => text(co?.nameEn),
    company_address_ar: () => text(co?.addressAr),
    company_address_en: () => text(co?.addressEn),
    commercial_reg_no: () => text(co?.commercialRegNo),
    tax_reg_no: () => text(co?.taxRegNo),
    insurance_employer_no: () => text(co?.insuranceEmployerNo),
    insurance_office: () => text(co?.insuranceOffice),
    insurance_sector_code: () => text(co?.insuranceSectorCode),
    company_rep_name: () => text(co?.repName),
    company_rep_title: () => text(co?.repTitle),
    company_rep_name_en: () => text(co?.repNameEn),
    company_rep_title_en: () => text(co?.repTitleEn),
    company_rep_national_id: () => text(co?.repNationalId),
    company_rep_national_id_ar: () => arabicDigits(text(co?.repNationalId)),

    day_name: () => arabicWeekday(src.documentDate),
    date: () => printedDate(src.documentDate),
    contract_date: () => printedDate(src.documentDate),
  };
}

/**
 * The values of `tags` (those a template uses), each read through the slot's overrides: { tag: value }, an empty
 * string where there is none.
 */
export function resolveValues(src: ValueSources, tags: readonly string[], overrides: Readonly<Record<string, string>> = {}): Record<string, TagValue> {
  const all = resolvers(src);
  const out: Record<string, TagValue> = {};
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
const DEPARTMENTS = (key: string): Where => ({ tab: 'departments', key });

/**
 * Where each tag's value is filled in: the profile's tab and field, with the keys the profile's completeness uses
 * (nationalId, idIssueDate, team …); a contract's terms on the Contracts tab (`contract` when there is no contract
 * version at all); the ending on the Employment tab; the company's details in Company; the job title's occupation
 * under Departments & Job Titles.
 */
const WHERE: Record<string, Where> = {
  employee_code: BASIC('employeeCode'),
  full_name_ar: BASIC('fullNameAr'),
  full_name_en: BASIC('fullNameEn'),
  display_name: BASIC('displayName'),
  nationality: BASIC('nationality'),
  date_of_birth: BASIC('dateOfBirth'),
  address: BASIC('addressAr'),
  address_line: BASIC('addressAr'),
  city: BASIC('city'),
  governorate: BASIC('governorate'),
  building_no: BASIC('buildingNo'),
  phone: BASIC('mobile'),
  work_email: BASIC('workEmail'),
  personal_email: BASIC('personalEmail'),
  qualification: { tab: 'education', key: 'qualificationAr' },
  insurance_no: BASIC('insuranceNo'),
  national_id: BASIC('nationalId'),
  national_id_ar: BASIC('nationalId'),
  id_printed_no: BASIC('printedNo'),
  id_issue_date: BASIC('idIssueDate'),
  job_title: EMPLOYMENT('jobTitle'),
  job_title_ar: EMPLOYMENT('jobTitle'),
  job_title_en: EMPLOYMENT('jobTitle'),
  job_duties: EMPLOYMENT('jobTitle'), // the employment's job title, whose duties are written under Organization
  // set on the job title itself, under Organization › Departments & Job Titles
  occupation_code: DEPARTMENTS('occupationCode'),
  occupation_name: DEPARTMENTS('occupationCode'),
  department: EMPLOYMENT('team'),
  department_ar: EMPLOYMENT('team'),
  department_en: EMPLOYMENT('team'),
  manager_name: EMPLOYMENT('manager'),
  manager_name_ar: EMPLOYMENT('manager'),
  manager_name_en: EMPLOYMENT('manager'),
  grade: EMPLOYMENT('grade'),
  grade_level: EMPLOYMENT('grade'),
  grade_level_ar: EMPLOYMENT('grade'),
  grade_level_en: EMPLOYMENT('grade'),
  employment_type: EMPLOYMENT('employmentType'),
  employment_type_ar: EMPLOYMENT('employmentType'),
  employment_type_en: EMPLOYMENT('employmentType'),
  join_date: EMPLOYMENT('joinDate'),
  work_arrangement: EMPLOYMENT('workArrangement'),
  work_arrangement_ar: EMPLOYMENT('workArrangement'),
  work_arrangement_en: EMPLOYMENT('workArrangement'),
  shift: EMPLOYMENT('shift'),
  shift_ar: EMPLOYMENT('shift'),
  shift_en: EMPLOYMENT('shift'),
  contract_number: CONTRACTS('contract'),
  duration: CONTRACTS('durationMonths'),
  start_date: CONTRACTS('startDate'),
  end_date: CONTRACTS('endDate'),
  probation_months: CONTRACTS('probationMonths'),
  probation_months_ar: CONTRACTS('probationMonths'),
  probation_months_en: CONTRACTS('probationMonths'),
  probation_end: CONTRACTS('probationEnd'),
  pay_basis: CONTRACTS('payBasis'),
  pay_basis_ar: CONTRACTS('payBasis'),
  pay_basis_en: CONTRACTS('payBasis'),
  days_per_week: CONTRACTS('daysPerWeek'),
  hours_per_week: CONTRACTS('hoursPerWeek'),
  hourly_rate: CONTRACTS('hourlyRate'),
  net_hourly_rate: CONTRACTS('netSalary'), // by the hour; a monthly salary has none
  allowances: CONTRACTS('allowances'),
  allowances_ar: CONTRACTS('allowances'),
  allowances_en: CONTRACTS('allowances'),
  allowances_total: CONTRACTS('allowances'),
  total_salary: CONTRACTS('grossSalary'),
  total_salary_words: CONTRACTS('grossSalary'),
  total_salary_words_en: CONTRACTS('grossSalary'),
  offer_number: { tab: 'offer', key: 'number' },
  offer_expiry: { tab: 'offer', key: 'expiresOn' },
  gross_salary: CONTRACTS('grossSalary'),
  gross_salary_words: CONTRACTS('grossSalary'),
  gross_salary_words_en: CONTRACTS('grossSalary'),
  basic_salary: CONTRACTS('grossSalary'),
  basic_percent: CONTRACTS('basicPercent'),
  variable_salary: CONTRACTS('grossSalary'),
  net_salary: CONTRACTS('netSalary'),
  net_salary_words: CONTRACTS('netSalary'),
  net_salary_words_en: CONTRACTS('netSalary'),
  insured_salary: CONTRACTS('insuredSalary'),
  insured_salary_words: CONTRACTS('insuredSalary'),
  insured_salary_words_en: CONTRACTS('insuredSalary'),
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
  deductions: EMPLOYMENT('payroll'),
  company_name_ar: COMPANY('nameAr'),
  company_name_en: COMPANY('nameEn'),
  company_address_ar: COMPANY('addressAr'),
  company_address_en: COMPANY('addressEn'),
  commercial_reg_no: COMPANY('commercialRegNo'),
  tax_reg_no: COMPANY('taxRegNo'),
  insurance_employer_no: COMPANY('insuranceEmployerNo'),
  insurance_office: COMPANY('insuranceOffice'),
  insurance_sector_code: COMPANY('insuranceSectorCode'),
  company_rep_name: COMPANY('repName'),
  company_rep_title: COMPANY('repTitle'),
  company_rep_name_en: COMPANY('repNameEn'),
  company_rep_title_en: COMPANY('repTitleEn'),
  company_rep_national_id: COMPANY('repNationalId'),
  company_rep_national_id_ar: COMPANY('repNationalId'),
};

const TAGS = new Map(TEMPLATE_TAGS.map((t) => [t.tag, t]));

/**
 * The tags of `tags` whose value is empty, with where to fill each in (read through the slot's overrides, so the
 * insurance copy's empty {{gross_salary}} points to the insured salary). The tags typed when generating are not listed:
 * they are asked for when generating.
 */
export function missingTags(
  values: Readonly<Record<string, TagValue>>,
  tags: readonly string[],
  overrides: Readonly<Record<string, string>> = {},
  hasContract = true,
): MissingTag[] {
  return tags
    .filter((tag) => !TYPED_TAGS.includes(tag) && isBlankValue(values[tag]))
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
