import {
  accountsAllowanceLine,
  bankNamed,
  CONTRACT_FORM_LABELS,
  CONTRACT_FORM_LABELS_AR,
  hourlyMinimumLine,
  insuredWageFrom,
  isPerAccount,
  LABELS,
  lawRatesFor,
  nationalityAr,
  occupationName,
  PAY_BASIS_LABELS,
  PAY_BASIS_LABELS_AR,
  payDifference,
  perAccountText,
  printedQualificationAr,
  RAISE_REASON_LABELS,
  RAISE_REASON_LABELS_AR,
  TEMPLATE_TAGS,
  WEEKS_PER_MONTH,
  WORK_ARRANGEMENT_LABELS_AR,
  WORK_NATURE_LABELS,
  WORK_NATURE_LABELS_AR,
  WORK_PATTERN_LABELS,
  WORK_PATTERN_LABELS_AR,
  workPatternOf,
  type ContractForm,
  type EmploymentType,
  type LawRates,
  type PayBasis,
  type RaiseReason,
  type TemplateLanguage,
  type WorkArrangement,
  type WorkNature,
} from '@trendlix/shared';
import { addDays, addMonths, fromDateOnly, todayInCairo } from '../common/date-only.js';
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
import { deductedTotal, printedDeductions, type SettlementSource } from './settlement-values.js';

// Every tag's value for one document (spec §8; owner's request, 15 October 2026), from the employee's profile, their
// employment, a contract version (or a job offer's terms), an ending and its final settlement, the company profile and the document's date, written as the document
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
    /** As typed, usually in English ("Egyptian"); an Arabic document prints it in Arabic, in the person's gender. */
    nationality: string | null;
    /** GENDERS: male, female; null when not recorded (always on a job offer): the masculine is printed. */
    gender: string | null;
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
    /**
     * A student (owner, 25 October 2026: "Add a Student option"): still studying, the year (STUDY_YEARS), the faculty and
     * the university, which {{qualification}} is worded from while Qualification (Arabic) is empty. Missing: not a
     * student (always on a job offer).
     */
    stillStudying?: boolean;
    studyYear?: string | null;
    faculty?: string | null;
    university?: string | null;
    insuranceNo: string | null;
    /** The occupation's code in the social insurance table (null for none set); none on a job offer. */
    occupationCode: string | null;
    /**
     * What social insurance Form 1 prints that is the employee's own (owner, 16 October 2026), null for none of their
     * own (always on a job offer): the subscription start, and the basic and comprehensive wages. The insured wage is
     * worked out from the comprehensive wage (owner's decision, 16 October 2026).
     */
    insuranceStartDate: Date | null;
    insuranceBasicWage: Decimal | null;
    insuranceComprehensiveWage: Decimal | null;
  };
  identity: { nationalId: string | null; printedNo: string | null; issueDate: Date | null } | null;
  bank: { bankName: string | null; accountNo: string | null; iban: string | null; holderName: string | null } | null;
  employment: {
    employmentType: EmploymentType;
    joinDate: Date;
    /** The role: its titles, and its duties and responsibilities as saved (HTML; null for none). */
    jobTitle: { titleEn: string; titleAr: string | null; jdDuties: string | null } | null;
    department: { nameEn: string; nameAr: string | null } | null;
    grade: { code: string; levelEn: string; levelAr: string | null } | null;
    /** The direct manager (an employee). */
    manager: { fullNameEn: string; fullNameAr: string } | null;
    /**
     * Its times as the database gives a TIME column (1970-01-01 at that time, UTC); its hours to work a day (null or
     * missing: the whole window); its days 0 = Sunday … 6 = Saturday.
     */
    shift: { startTime: Date; endTime: Date; hoursPerDay?: Decimal | null; workingDays: readonly number[] } | null;
    workArrangement: WorkArrangement;
    /** By the labour law (owner, 18 October 2026): paid by commission (missing: no), the nature of the work (missing: regular). */
    paidByCommission?: boolean;
    workNature?: string;
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
    /** By the hour: the least paid a month (27 October 2026). Missing or null: none. */
    hourlyMinimum?: Decimal | null;
    daysPerWeek: number | null;
    /** A month each, as on the contract or offer; one paid per client account (25 October 2026) with no amount (0). */
    allowances: readonly { nameEn: string; nameAr: string; amount: Decimal; basis?: string | null; perAccountAmount?: Decimal | null }[];
    /** A specific job's contract: the job (Art. 155). Missing: none. */
    jobToDo?: string | null;
  } | null;
  ending: { noticeGivenOn: Date; lastWorkingDay: Date; reason: string | null } | null;
  /**
   * The final settlement of an employment ending or ended (20 October 2026; settlement-values.ts): the advances and
   * loans still owed, deducted from it or waived, and the unused annual leave paid with it. Missing or null: no ending.
   */
  settlement?: SettlementSource | null;
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
  /** The basic wage Form 1 prints for an employee who has none of their own: the contract settings' default. */
  insuranceBasicDefault: number;
  /**
   * The contract pay (gross and allowances) the insured wage stands on today, for a signed contract: after a raise the
   * pay before it until the raise's insured-wage date (owner's decision, 16 October 2026: "From the next January unless
   * amended in Form 2"). Missing: the contract's own.
   */
  insuredContractTotal?: number | null;
  /**
   * The rates set by law, every year kept (owner's request, 16 October 2026): the insured wage Form 1 prints is within
   * this year's insurable limits in Cairo.
   */
  lawYears: readonly LawRates[];
  /**
   * A raise's (owner's decisions, 16 October 2026): the version it replaces (the pay before), why, the promotion, the
   * contract an amendment adds to, and the Form 2 date. Null or missing for a version that doesn't change the pay.
   */
  raise?: {
    reason: string | null;
    previous: { grossSalary: Decimal; basicPercent: number; allowances: readonly { nameEn: string; nameAr: string; amount: Decimal }[] } | null;
    newJobTitle: { titleEn: string; titleAr: string | null } | null;
    newGrade: { code: string } | null;
    amended: { number: string; startDate: Date } | null;
    form2From: Date | null;
  } | null;
  /** YYYY-MM-DD: {{date}}, {{contract_date}} and {{day_name}}. */
  documentDate: string;
  /** What was typed when generating. */
  inputs: Readonly<Record<string, string | undefined>>;
}

/**
 * The profile tab where a value is filled in, and the field (`insurance`: the Social Insurance tab, where the social
 * insurance occupation, subscription start and wages are set); or the company profile (`company`), or a job offer's
 * field (`offer`).
 */
export interface Where {
  tab: 'basic' | 'education' | 'employment' | 'contracts' | 'insurance' | 'company' | 'offer';
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
  // the comprehensive wage Form 1 prints: the employee's own, else the contract's gross and allowances (after a raise,
  // those before it until its insured-wage date)
  const comprehensive = amount(e.insuranceComprehensiveWage) ?? (src.insuredContractTotal !== undefined ? src.insuredContractTotal : totalSalary);
  // the subscription year the contract version starts in, for the social insurance copy's term (owner, 25 October 2026:
  // "take the insurance start date make it for 1 year"; asked, "Anniversary year"): the latest anniversary of the
  // subscription start on or before the version's start plus 3 months, so a renewal on 30/07 of a subscription from
  // 01/08 takes the year from that 01/08 and a raise in March the year it falls in; never before the subscription began.
  // It runs for the contract's duration, a year when it has none (owner, 25 October 2026: "add the end date of the social
  // insurance based on the contract duration, usually 1 year")
  const insuranceYear = (): { start: string; end: string; months: number } | null => {
    const since = ymd(e.insuranceStartDate ?? job?.joinDate);
    if (!since) return null;
    const until = addMonths(ymd(c?.startDate) ?? since, 3);
    let start = since;
    for (let years = 1; addMonths(since, 12 * years) <= until; years++) start = addMonths(since, 12 * years);
    const months = c?.durationMonths && c.durationMonths > 0 ? c.durationMonths : 12;
    return { start, end: addDays(addMonths(start, months), -1), months };
  };
  // the comprehensive wage within this year's insurable limits: none without one
  const insuredWage = () => (comprehensive === null ? null : insuredWageFrom(comprehensive, lawRatesFor(Number(todayInCairo().slice(0, 4)), src.lawYears)).amount);
  // by the hour, the net of an hour: the approximate net ÷ the hours of a month (hours a week × 52 ÷ 12), to the piaster
  const netHourly = c?.payBasis === 'hourly' && net !== null && hours ? Math.round((net / (hours * WEEKS_PER_MONTH) + Number.EPSILON) * 100) / 100 : null;
  // by the hour, the least paid a month (owner, 27 October 2026: "can i add rate per hour with a minimum monthly
  // payment?"): the amount and its line, blank without one
  const hourlyMinimum = c?.payBasis === 'hourly' ? amount(c.hourlyMinimum) : null;

  // the values that depend on the language, in either
  const jobTitle = (lang: Lang) =>
    signed && (c.jobTitleEn || c.jobTitleAr) ? inLanguage(lang, c.jobTitleEn, c.jobTitleAr) : inLanguage(lang, job?.jobTitle?.titleEn, job?.jobTitle?.titleAr);
  const department = (lang: Lang) => inLanguage(lang, job?.department?.nameEn, job?.department?.nameAr);
  // in Arabic in the person's gender ("Egyptian" → مصري / مصرية), else as typed (owner, 16 October 2026)
  const nationality = (lang: Lang) => (lang === 'ar' ? nationalityAr(e.nationality, e.gender) : text(e.nationality));
  const employmentType = (lang: Lang) => (job ? (lang === 'ar' ? EMPLOYMENT_TYPES_AR[job.employmentType] : LABELS.employmentType[job.employmentType]) : '');
  const payBasis = (lang: Lang) => (c ? ((lang === 'ar' ? PAY_BASIS_LABELS_AR : PAY_BASIS_LABELS)[c.payBasis as PayBasis] ?? '') : '');
  const managerName = (lang: Lang) => inLanguage(lang, job?.manager?.fullNameEn, job?.manager?.fullNameAr);
  // a signed contract keeps only its grade's code, not the level: the level is always the employment's grade's (the
  // grade {{grade}} prints when there is no signed contract), the level it has now
  const gradeLevel = (lang: Lang) => inLanguage(lang, job?.grade?.levelEn, job?.grade?.levelAr);
  const workArrangement = (lang: Lang) => (job ? ((lang === 'ar' ? WORK_ARRANGEMENT_LABELS_AR : LABELS.workArrangement)[job.workArrangement] ?? '') : '');
  // the employment's shift (a signed contract keeps only its code), with its times and working days
  const shift = (lang: Lang) =>
    job?.shift
      ? printedShift(
          {
            startTime: fromTimeOfDay(job.shift.startTime),
            endTime: fromTimeOfDay(job.shift.endTime),
            hoursPerDay: amount(job.shift.hoursPerDay),
            workingDays: job.shift.workingDays,
          },
          lang,
        )
      : '';
  // none is a value too: "No probation" / "لا توجد فترة اختبار"
  const probation = (lang: Lang) => (c ? printedProbation(c.probationMonths, lang) : '');
  // by the labour law (owner, 18 October 2026): the contract's length (Arts. 87, 88, 155), the nature of the work (Art.
  // 1(6–8)), remote work (Art. 96(1)), and paid by commission (yes or no)
  const contractForm = (lang: Lang) => (c ? ((lang === 'ar' ? CONTRACT_FORM_LABELS_AR : CONTRACT_FORM_LABELS)[c.form as ContractForm] ?? '') : '');
  const workNature = (lang: Lang) => (job ? ((lang === 'ar' ? WORK_NATURE_LABELS_AR : WORK_NATURE_LABELS)[(job.workNature ?? 'regular') as WorkNature] ?? '') : '');
  const workPattern = (lang: Lang) => (job ? (lang === 'ar' ? WORK_PATTERN_LABELS_AR : WORK_PATTERN_LABELS)[workPatternOf(job.workArrangement)] : '');
  const commission = (lang: Lang) => (job ? (job.paidByCommission ? (lang === 'ar' ? 'نعم' : 'Yes') : lang === 'ar' ? 'لا' : 'No') : '');
  // the role's duties as written, with their formatting (owner's request, 15 October 2026), in whatever language HR
  // wrote them; none when there is nothing to read
  const duties = (): TagValue => {
    const html = job?.jobTitle?.jdDuties ?? '';
    return isBlankValue({ html }) ? '' : { html };
  };
  // none is a value too: "لا يوجد" / "None"; one paid per client account (owner, 25 October 2026) has no amount: "Accounts
  // allowance: Per client account assigned", or with the amount per account set (27 October 2026) "Accounts allowance:
  // 3,000.00 per client account assigned"
  const allowancesOf = (rows: readonly { nameEn: string; nameAr: string; amount: Decimal; basis?: string | null; perAccountAmount?: Decimal | null }[] | undefined, lang: Lang) =>
    !rows
      ? ''
      : rows.length === 0
        ? lang === 'ar'
          ? 'لا يوجد'
          : 'None'
        : rows
            .map((a) => `${inLanguage(lang, a.nameEn, a.nameAr)}: ${isPerAccount(a) ? perAccountText(a.perAccountAmount?.toNumber() ?? null, printedMoney, lang) : printedMoney(a.amount.toNumber())}`)
            .join(lang === 'ar' ? '، ' : ', ');
  const allowances = (lang: Lang) => allowancesOf(c?.allowances, lang);
  // the accounts allowance's line (25 October 2026), with a per-account allowance on the contract or offer; blank without
  const perAccountRow = c?.allowances.find((a) => isPerAccount(a));
  const accountsLine = (lang: Lang) => (perAccountRow ? accountsAllowanceLine(perAccountRow.perAccountAmount?.toNumber() ?? null, printedMoney, lang) : '');

  // a raise (owner's decisions, 16 October 2026): the pay before it, why, the promotion and the wage change for Form 2
  const raise = c ? (src.raise ?? null) : null;
  const before = raise?.previous ?? null;
  const beforeGross = amount(before?.grossSalary);
  const beforeTotal = before ? Math.round((before.grossSalary.toNumber() + before.allowances.reduce((sum, a) => sum + a.amount.toNumber(), 0)) * 100) / 100 : null;
  const difference = c && beforeGross !== null ? payDifference(beforeGross, c.grossSalary.toNumber()) : null;
  const raiseReason = (lang: Lang) => (raise?.reason ? ((lang === 'ar' ? RAISE_REASON_LABELS_AR : RAISE_REASON_LABELS)[raise.reason as RaiseReason] ?? '') : '');
  // the promotion's job title, else the job title as it is
  const newJobTitle = (lang: Lang) => (raise ? (raise.newJobTitle ? inLanguage(lang, raise.newJobTitle.titleEn, raise.newJobTitle.titleAr) : jobTitle(lang)) : '');
  // the insured wage changes from the Form 2 date recorded, else the raise's effective date; within that year's limits
  const wageFrom = raise && c ? ymd(raise.form2From ?? c.startDate) : null;
  const wageRates = wageFrom ? lawRatesFor(Number(wageFrom.slice(0, 4)), src.lawYears) : null;
  const insuredOf = (comprehensiveWage: number | null) => (comprehensiveWage === null || !wageRates ? null : insuredWageFrom(comprehensiveWage, wageRates).amount);

  return {
    employee_code: () => e.employeeCode,
    full_name_ar: () => text(e.fullNameAr),
    full_name_en: () => text(e.fullNameEn),
    display_name: () => text(e.displayName),
    // السيد or السيدة by the profile's gender, blank without one (owner, 22 October 2026)
    title_ar: () => arabicTitle(e.gender),
    nationality: () => nationality(language),
    nationality_ar: () => nationality('ar'),
    nationality_en: () => nationality('en'),
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
    // Qualification (Arabic) as typed; else, still studying, "طالب بالفرقة الثالثة – كلية … – جامعة …" (25 October 2026)
    qualification: () => printedQualificationAr(e),
    insurance_no: () => text(e.insuranceNo),
    // the employee's occupation in the social insurance table (owner's decision, 16 October 2026: no longer the job
    // title's): the code as stored, the name the table's
    occupation_code: () => text(e.occupationCode),
    occupation_name: () => occupationName(e.occupationCode) ?? '',

    national_id: () => text(id?.nationalId),
    national_id_ar: () => arabicDigits(text(id?.nationalId)),
    id_printed_no: () => text(id?.printedNo),
    id_issue_date: () => printedMonth(ymd(id?.issueDate)),

    job_title: () => jobTitle(language),
    job_title_ar: () => jobTitle('ar'),
    job_title_en: () => jobTitle('en'),
    job_duties: duties,
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
    // the subscription start Form 1 prints (owner, 16 October 2026): the employee's own, else the join date
    insurance_start_date: () => printedDate(ymd(e.insuranceStartDate ?? job?.joinDate)),
    insurance_year_start: () => printedDate(insuranceYear()?.start ?? null),
    insurance_year_end: () => printedDate(insuranceYear()?.end ?? null),
    insurance_year_duration: () => {
      const year = insuranceYear();
      return year ? arabicDuration(year.months) : '';
    },
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
    contract_form: () => contractForm(language),
    contract_form_ar: () => contractForm('ar'),
    contract_form_en: () => contractForm('en'),
    job_to_do: () => text(c?.jobToDo),
    work_nature: () => workNature(language),
    work_nature_ar: () => workNature('ar'),
    work_nature_en: () => workNature('en'),
    work_pattern: () => workPattern(language),
    work_pattern_ar: () => workPattern('ar'),
    work_pattern_en: () => workPattern('en'),
    paid_by_commission: () => commission(language),
    paid_by_commission_ar: () => commission('ar'),
    paid_by_commission_en: () => commission('en'),

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
    hourly_minimum: () => printedMoney(hourlyMinimum),
    hourly_minimum_line: () => hourlyMinimumLine(hourlyMinimum, printedMoney, language),
    hourly_minimum_line_ar: () => hourlyMinimumLine(hourlyMinimum, printedMoney, 'ar'),
    hourly_minimum_line_en: () => hourlyMinimumLine(hourlyMinimum, printedMoney, 'en'),
    allowances: () => allowances(language),
    allowances_ar: () => allowances('ar'),
    allowances_en: () => allowances('en'),
    allowances_total: () => printedMoney(allowancesTotal),
    allowances_total_words: () => words(allowancesTotal),
    allowances_total_words_en: () => wordsEn(allowancesTotal),
    accounts_allowance: () => accountsLine(language),
    accounts_allowance_ar: () => accountsLine('ar'),
    accounts_allowance_en: () => accountsLine('en'),
    total_salary: () => printedMoney(totalSalary),
    total_salary_words: () => words(totalSalary),
    total_salary_words_en: () => wordsEn(totalSalary),
    // the wages Form 1 prints (owner, 16 October 2026): the basic wage, the employee's own, else the contract settings'
    // default (not the contract's basic salary); the comprehensive wage, the employee's own, else the gross and
    // allowances. The insured wage is the comprehensive wage kept within this year's insurable limits in Cairo (owner's
    // decision, 16 October 2026: "Apply the insurance wage cap rule from the comprehensive wage"), so none without
    // one; the contract's own insured salary ({{insured_salary}}, the social insurance copy's) is unchanged
    insurance_basic_salary: () => printedMoney(amount(e.insuranceBasicWage) ?? src.insuranceBasicDefault),
    insurance_insured_salary: () => printedMoney(insuredWage()),
    insurance_total_salary: () => printedMoney(comprehensive),
    // in words too (owner, 25 October 2026: "i need arabic wordings for both of these to add them in the contract")
    insurance_insured_salary_words: () => words(insuredWage()),
    insurance_insured_salary_words_en: () => wordsEn(insuredWage()),
    insurance_total_salary_words: () => words(comprehensive),
    insurance_total_salary_words_en: () => wordsEn(comprehensive),
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

    // a payslip is drawn by the payroll itself (owner's decision, 16 October 2026: a system-drawn PDF), not filled in
    // from a template: no pay month here
    pay_month: () => '',
    // the final settlement's, on the clearance and dues (20 October 2026: the owner unsure, Claude recommended listing
    // them): what it deducts, one per line, with the unused leave it pays and the total deducted; none is a value too
    deductions: () => printedDeductions(src.settlement, language),
    deductions_ar: () => printedDeductions(src.settlement, 'ar'),
    deductions_en: () => printedDeductions(src.settlement, 'en'),
    deductions_total: () => (src.settlement ? printedMoney(deductedTotal(src.settlement)) : ''),

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

    raise_effective_date: () => (raise && c ? printedDate(ymd(c.startDate)) : ''),
    raise_reason: () => raiseReason(language),
    raise_reason_ar: () => raiseReason('ar'),
    raise_reason_en: () => raiseReason('en'),
    previous_gross_salary: () => printedMoney(beforeGross),
    previous_gross_salary_words: () => words(beforeGross),
    previous_gross_salary_words_en: () => wordsEn(beforeGross),
    previous_basic_salary: () => (before ? printedMoney(Math.round(before.grossSalary.toNumber() * before.basicPercent) / 100) : ''),
    previous_allowances: () => allowancesOf(before?.allowances, language),
    previous_allowances_ar: () => allowancesOf(before?.allowances, 'ar'),
    previous_allowances_en: () => allowancesOf(before?.allowances, 'en'),
    previous_total_salary: () => printedMoney(beforeTotal),
    raise_amount: () => printedMoney(difference?.amount ?? null),
    raise_amount_words: () => words(difference ? Math.abs(difference.amount) : null),
    raise_percent: () => (difference?.percent === null || difference === null ? '' : `${difference.percent}%`),
    new_job_title: () => newJobTitle(language),
    new_job_title_ar: () => newJobTitle('ar'),
    new_job_title_en: () => newJobTitle('en'),
    new_grade: () => (raise ? text(raise.newGrade?.code ?? (signed && c.gradeCode ? c.gradeCode : job?.grade?.code)) : ''),
    amended_contract_number: () => text(raise?.amended?.number),
    amended_contract_date: () => printedDate(ymd(raise?.amended?.startDate)),
    insured_wage_from: () => printedDate(wageFrom),
    // the employee's own comprehensive wage is the one registered before the raise; else the version before's pay
    previous_insured_wage: () => printedMoney(raise ? insuredOf(amount(e.insuranceComprehensiveWage) ?? beforeTotal) : null),
    new_insured_wage: () => printedMoney(raise ? insuredOf(totalSalary) : null),
    new_comprehensive_wage: () => printedMoney(raise ? totalSalary : null),

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

/**
 * Where each tag's value is filled in: the profile's tab and field, with the keys the profile's completeness uses
 * (nationalId, idIssueDate, team …); a contract's terms with the contract, on the Employment tab (`contract` when
 * there is no contract version at all); the ending on the Employment tab; the social insurance occupation,
 * subscription start and wages on the Social Insurance tab; the company's details in Company.
 */
const WHERE: Record<string, Where> = {
  employee_code: BASIC('employeeCode'),
  full_name_ar: BASIC('fullNameAr'),
  full_name_en: BASIC('fullNameEn'),
  display_name: BASIC('displayName'),
  title_ar: BASIC('gender'),
  nationality: BASIC('nationality'),
  nationality_ar: BASIC('nationality'),
  nationality_en: BASIC('nationality'),
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
  // the employee's own, set on the profile's Social Insurance tab (owner's decision, 16 October 2026)
  occupation_code: { tab: 'insurance', key: 'occupationCode' },
  occupation_name: { tab: 'insurance', key: 'occupationCode' },
  national_id: BASIC('nationalId'),
  national_id_ar: BASIC('nationalId'),
  id_printed_no: BASIC('printedNo'),
  id_issue_date: BASIC('idIssueDate'),
  job_title: EMPLOYMENT('jobTitle'),
  job_title_ar: EMPLOYMENT('jobTitle'),
  job_title_en: EMPLOYMENT('jobTitle'),
  job_duties: EMPLOYMENT('jobTitle'), // the employment's job title, whose duties are written under Organization
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
  // the employee's own, or the join date; both empty: set it on the Social Insurance tab
  insurance_start_date: { tab: 'insurance', key: 'insuranceStartDate' },
  insurance_year_start: { tab: 'insurance', key: 'insuranceStartDate' },
  insurance_year_end: { tab: 'insurance', key: 'insuranceStartDate' },
  insurance_year_duration: { tab: 'insurance', key: 'insuranceStartDate' },
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
  // by the labour law (owner, 18 October 2026)
  contract_form: CONTRACTS('form'),
  contract_form_ar: CONTRACTS('form'),
  contract_form_en: CONTRACTS('form'),
  job_to_do: CONTRACTS('jobToDo'),
  work_nature: EMPLOYMENT('workNature'),
  work_nature_ar: EMPLOYMENT('workNature'),
  work_nature_en: EMPLOYMENT('workNature'),
  work_pattern: EMPLOYMENT('workArrangement'),
  work_pattern_ar: EMPLOYMENT('workArrangement'),
  work_pattern_en: EMPLOYMENT('workArrangement'),
  paid_by_commission: EMPLOYMENT('paidByCommission'),
  paid_by_commission_ar: EMPLOYMENT('paidByCommission'),
  paid_by_commission_en: EMPLOYMENT('paidByCommission'),
  hourly_rate: CONTRACTS('hourlyRate'),
  net_hourly_rate: CONTRACTS('netSalary'), // by the hour; a monthly salary has none
  // printed blank without one (MAY_BE_BLANK), so only ever pointed to
  hourly_minimum: CONTRACTS('hourlyMinimum'),
  hourly_minimum_line: CONTRACTS('hourlyMinimum'),
  hourly_minimum_line_ar: CONTRACTS('hourlyMinimum'),
  hourly_minimum_line_en: CONTRACTS('hourlyMinimum'),
  allowances: CONTRACTS('allowances'),
  allowances_ar: CONTRACTS('allowances'),
  allowances_en: CONTRACTS('allowances'),
  allowances_total: CONTRACTS('allowances'),
  allowances_total_words: CONTRACTS('allowances'),
  allowances_total_words_en: CONTRACTS('allowances'),
  accounts_allowance: CONTRACTS('allowances'),
  accounts_allowance_ar: CONTRACTS('allowances'),
  accounts_allowance_en: CONTRACTS('allowances'),
  total_salary: CONTRACTS('grossSalary'),
  total_salary_words: CONTRACTS('grossSalary'),
  total_salary_words_en: CONTRACTS('grossSalary'),
  // set on the Social Insurance tab; the basic wage is never missing (the contract settings' default), and the insured
  // wage is missing only without a comprehensive wage, which is where it is filled in (owner's decision, 16 October 2026)
  insurance_basic_salary: { tab: 'insurance', key: 'insuranceBasicWage' },
  insurance_insured_salary: { tab: 'insurance', key: 'insuranceComprehensiveWage' },
  insurance_total_salary: { tab: 'insurance', key: 'insuranceComprehensiveWage' },
  insurance_insured_salary_words: { tab: 'insurance', key: 'insuranceComprehensiveWage' },
  insurance_insured_salary_words_en: { tab: 'insurance', key: 'insuranceComprehensiveWage' },
  insurance_total_salary_words: { tab: 'insurance', key: 'insuranceComprehensiveWage' },
  insurance_total_salary_words_en: { tab: 'insurance', key: 'insuranceComprehensiveWage' },
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
  // the final settlement's: there is one once an ending is recorded (20 October 2026)
  deductions: EMPLOYMENT('ending'),
  deductions_ar: EMPLOYMENT('ending'),
  deductions_en: EMPLOYMENT('ending'),
  deductions_total: EMPLOYMENT('ending'),
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
  // a raise's, on the contract version (owner's decisions, 16 October 2026)
  ...Object.fromEntries(
    [
      'raise_effective_date',
      'raise_reason',
      'raise_reason_ar',
      'raise_reason_en',
      'previous_gross_salary',
      'previous_gross_salary_words',
      'previous_gross_salary_words_en',
      'previous_basic_salary',
      'previous_allowances',
      'previous_allowances_ar',
      'previous_allowances_en',
      'previous_total_salary',
      'raise_amount',
      'raise_amount_words',
      'raise_percent',
      'new_job_title',
      'new_job_title_ar',
      'new_job_title_en',
      'new_grade',
      'amended_contract_number',
      'amended_contract_date',
      'insured_wage_from',
      'previous_insured_wage',
      'new_insured_wage',
      'new_comprehensive_wage',
    ].map((tag) => [tag, CONTRACTS('raise')]),
  ),
};

const TAGS = new Map(TEMPLATE_TAGS.map((t) => [t.tag, t]));

/**
 * Tags printed blank when they have no value, never stopping a document: {{title_ar}} without a gender (owner, 22
 * October 2026: "if no gender leave blank").
 */
// and the accounts allowance's line without a per-account allowance (25 October 2026): the line is for those who have one;
// the same for the minimum a month by the hour (27 October 2026)
const MAY_BE_BLANK: ReadonlySet<string> = new Set([
  'title_ar',
  'accounts_allowance',
  'accounts_allowance_ar',
  'accounts_allowance_en',
  'hourly_minimum',
  'hourly_minimum_line',
  'hourly_minimum_line_ar',
  'hourly_minimum_line_en',
]);

/** How an Arabic document addresses the person by their gender: السيد, السيدة, or nothing without one. */
export const arabicTitle = (gender: string | null | undefined): string => (gender === 'male' ? 'السيد' : gender === 'female' ? 'السيدة' : '');

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
    .filter((tag) => !TYPED_TAGS.includes(tag) && !MAY_BE_BLANK.has(tag) && isBlankValue(values[tag]))
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
  // the ending's are the final settlement's amounts (20 October 2026)
  if (t.group === 'pay' || t.group === 'payslip' || t.group === 'raise' || t.group === 'ending') return 'salary';
  return 'identity'; // the national ID, and the company representative's
}

/** The restricted tags a template prints, read through the slot's overrides (both the tag and what it reads). */
export function restrictedTags(tags: readonly string[], overrides: Readonly<Record<string, string>> = {}): string[] {
  return tags.filter((tag) => rightFor(tag) !== null || rightFor(sourceTag(tag, overrides)) !== null);
}
