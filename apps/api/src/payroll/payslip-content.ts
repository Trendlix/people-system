import {
  formatHours,
  LABELS,
  SALARY_RULES,
  toArabicDigits,
  type EmploymentType,
  type PayBasis,
  type PayrollInputs,
  type PayrollResult,
  type PayrollRules,
  type PayrollTerms,
} from '@trendlix/shared';
import { shownDate } from '../common/date-only.js';
import { arabicAmountInWords } from '../documents/engine/arabic.js';
import { englishAmountInWords } from '../documents/engine/english.js';
import { EMPLOYMENT_TYPES_AR, GOVERNORATES_AR } from '../documents/format.js';
import { monthArabic, monthName } from './months.js';

// What a payslip says (owner's decisions, 16 October 2026, on the payslip proposal): the facts, the month's hours and
// KPI scores (they explain the cuts), the earnings and the deductions row by row, the net with the amount in words,
// what was already paid and what the bank transfers, the company's insurance share, and the year to date. Every figure
// is the approved line's (packages/shared payrollLine): nothing is worked out again but the allowances for the days
// paid, as payrollLine prorates them, and the KPI average, as it averages them. The hours are those attendance counted:
// the expected hours less the no-show days' hours, so a no-show day reads as charged once (owner's decisions,
// 16 October 2026); a line worked out before then has none taken out. A row that is 0 is left out, and so is
// a section with nothing in it. Left off on purpose: the company cost, the tax working, HR's comments, the warnings,
// the full account number, the IBAN and the national ID. In English for everyone; in Arabic on request, right to left,
// every number in ٠-٩ but the codes with Latin letters (EMP-0007, PAY-2026-10) and the banks' short names (CIB, QNB).
// Pure: the drawing is payslip-pdf.ts.

export const PAYSLIP_LANGUAGES = ['en', 'ar'] as const;
export type PayslipLanguage = (typeof PAYSLIP_LANGUAGES)[number];

export const isPayslipLanguage = (value: string): value is PayslipLanguage => (PAYSLIP_LANGUAGES as readonly string[]).includes(value);

/** A year's figures summed over the months paid: the earnings (earned and allowances), salary tax, insurance and net. */
export interface YearToDate {
  /** The first month counted and the payslip's own, YYYY-MM. */
  from: string;
  to: string;
  earnings: number;
  tax: number;
  insurance: number;
  net: number;
}

/** What a payslip is drawn from: the line as the CEO approved it, and what the profile and the company add. */
export interface PayslipSource {
  run: {
    month: string;
    /** YYYY-MM-DD: the day HR marked it paid, and the day (in Cairo) the CEO approved it. */
    paidOn: string | null;
    approvedOn: string | null;
    rules: PayrollRules;
  };
  line: {
    employeeCode: string;
    nameEn: string;
    /** As it was on the run: a team as "Department › Team". */
    department: string | null;
    jobTitle: string | null;
    employmentType: EmploymentType;
    payBasis: PayBasis;
    terms: PayrollTerms;
    inputs: PayrollInputs;
    result: PayrollResult;
    /** The bank details as copied at the approval: only the bank and the last 4 digits are printed. */
    bankShort: string | null;
    accountNo: string | null;
    iban: string | null;
  };
  /** What the profile adds. The Arabic job title and department only when they are still the line's. */
  employee: {
    nameAr: string | null;
    insuranceNo: string | null;
    /** The employment's join date, YYYY-MM-DD. */
    joinDate: string | null;
    jobTitleAr: string | null;
    departmentAr: string | null;
  };
  /** The allowances' Arabic names (the contract's), by their English names on the line. */
  allowancesAr: Readonly<Record<string, string>>;
  company: { nameEn: string; city: string | null; taxRegNo: string | null };
  yearToDate: YearToDate | null;
  /** The day it is drawn, YYYY-MM-DD. */
  issuedOn: string;
}

/** A row of the earnings, the deductions or what follows the net: the amount as printed and as a number. */
export interface PayslipRow {
  label: string;
  note: string | null;
  amount: string;
  value: number;
}

export interface PayslipSection {
  heading: string;
  rows: PayslipRow[];
  total: PayslipRow;
}

export interface PayslipCell {
  label: string;
  value: string;
  note: string | null;
}

export interface PayslipContent {
  language: PayslipLanguage;
  /** Arabic: right to left, the page mirrored. */
  rtl: boolean;
  /** The company: its name (when there is no logo) and the line under it (city, tax registration number). */
  company: { name: string; line: string | null };
  title: { kind: string; month: string; paid: string | null };
  facts: { label: string; value: string }[];
  thisMonth: { heading: string; cells: PayslipCell[]; line: string | null } | null;
  earnings: PayslipSection | null;
  deductions: PayslipSection | null;
  net: { label: string; amount: string; currency: string; words: string | null };
  afterNet: PayslipRow[];
  companyShare: string | null;
  yearToDate: { heading: string; period: string; cells: { label: string; value: string }[] } | null;
  footer: { issued: string; note: string };
}

// ---------- the words, in both languages (the proposal's) ----------

type Words = { en: string; ar: string };

const L = {
  payslip: { en: 'Payslip', ar: 'قسيمة الراتب' },
  paidOn: { en: 'Paid on', ar: 'تاريخ الصرف' },
  taxReg: { en: 'Tax registration no.', ar: 'رقم التسجيل الضريبي' },
  name: { en: 'Name', ar: 'الاسم' },
  code: { en: 'Employee code', ar: 'كود الموظف' },
  jobTitle: { en: 'Job title', ar: 'المسمى الوظيفي' },
  department: { en: 'Department', ar: 'الإدارة' },
  employment: { en: 'Employment', ar: 'نوع التعاقد' },
  insuranceNo: { en: 'Social insurance no.', ar: 'الرقم التأميني' },
  paidTo: { en: 'Paid to', ar: 'يُحوَّل إلى' },
  daysPaid: { en: 'Days paid', ar: 'الأيام المدفوعة' },
  thisMonth: { en: 'This Month', ar: 'هذا الشهر' },
  hoursWorked: { en: 'Hours worked', ar: 'ساعات العمل' },
  kpiAverage: { en: 'KPI average', ar: 'متوسط مؤشرات الأداء' },
  bonusDays: { en: 'Bonus days', ar: 'أيام المكافأة' },
  noShowDays: { en: 'No-show days', ar: 'أيام الغياب دون إذن' },
  penaltyDays: { en: 'Penalty days', ar: 'أيام الجزاء' },
  softSkills: { en: 'Soft skills', ar: 'المهارات الشخصية' },
  performance: { en: 'Performance', ar: 'الأداء' },
  clientSatisfaction: { en: 'Client satisfaction', ar: 'رضا العملاء' },
  attendance: { en: 'Attendance', ar: 'الحضور' },
  earnings: { en: 'Earnings', ar: 'الاستحقاقات' },
  fixed: { en: 'Fixed salary', ar: 'الراتب الثابت' },
  variable: { en: 'Variable salary', ar: 'الراتب المتغير' },
  hours: { en: 'Hours worked', ar: 'أجر الساعات' },
  attendanceCut: { en: 'Attendance adjustment', ar: 'تسوية الحضور' },
  kpiCut: { en: 'Performance adjustment', ar: 'تسوية المتغير' },
  noShowCut: { en: 'No-show', ar: 'الغياب دون إذن' },
  overtime: { en: 'Overtime', ar: 'العمل الإضافي' },
  bonus: { en: 'Bonus', ar: 'مكافأة' },
  commission: { en: 'Commission', ar: 'عمولة' },
  settlement: { en: 'Settlement', ar: 'تسوية' },
  oneOff: { en: 'One-off amount this month', ar: 'مبلغ لمرة واحدة هذا الشهر' },
  notTaxed: { en: 'Not taxed', ar: 'غير خاضع للضريبة' },
  earningsTotal: { en: 'Total earnings', ar: 'إجمالي الاستحقاقات' },
  deductions: { en: 'Deductions', ar: 'الاستقطاعات' },
  insurance: { en: 'Social insurance', ar: 'التأمينات الاجتماعية' },
  tax: { en: 'Salary tax', ar: 'ضريبة كسب العمل' },
  martyrs: { en: 'Martyrs’ Fund', ar: 'صندوق تكريم الشهداء' },
  healthInsurance: { en: 'Health insurance', ar: 'التأمين الصحي الشامل' },
  penalty: { en: 'Penalty', ar: 'جزاء' },
  medical: { en: 'Medical insurance', ar: 'التأمين الطبي' },
  monthlySubscription: { en: 'Monthly subscription', ar: 'الاشتراك الشهري' },
  deductionsTotal: { en: 'Total deductions', ar: 'إجمالي الاستقطاعات' },
  net: { en: 'Net pay', ar: 'صافي الراتب' },
  egp: { en: 'EGP', ar: 'جنيه' },
  released: { en: 'Already paid this month', ar: 'صُرف مقدماً هذا الشهر' },
  transfer: { en: 'Transferred to', ar: 'المحوَّل إلى' },
  paid: { en: 'Paid', ar: 'المبلغ المصروف' },
  ytd: { en: 'Year to Date', ar: 'منذ بداية العام' },
  ytdEarnings: { en: 'Earnings', ar: 'الاستحقاقات' },
  ytdTax: { en: 'Salary tax', ar: 'ضريبة كسب العمل' },
  ytdInsurance: { en: 'Social insurance', ar: 'التأمينات' },
  ytdNet: { en: 'Net pay', ar: 'صافي الراتب' },
  approved: { en: 'Approved by the CEO on', ar: 'اعتمده الرئيس التنفيذي في' },
  issued: { en: 'Issued on', ar: 'صدر في' },
  noSignature: {
    en: 'Issued by the system; it needs no signature. Confidential to the employee.',
    ar: 'صادرة من النظام ولا تحتاج إلى توقيع. سرية وخاصة بالموظف.',
  },
} as const satisfies Record<string, Words>;

// ---------- numbers as printed ----------

/** Bidi marks the drawing keeps a piece of text the right way round with, then drops (text.ts never prints them). */
export const LEFT_TO_RIGHT_ISOLATE = '⁦';
export const LEFT_TO_RIGHT_OVERRIDE = '‭';
const POP_ISOLATE = '⁩';
const POP_OVERRIDE = '‬';
const BIDI_MARKS = /[‪-‮⁦-⁩]/g;

/** Text without the bidi marks: as it reads. */
export const withoutMarks = (text: string) => text.replace(BIDI_MARKS, '');

/**
 * A number as the Arabic payslip writes it (the proposal, approved): ٠-٩ (toArabicDigits), the Arabic thousands and
 * decimal separators (٬ ٫) and percent sign (٪).
 */
export function arabicNumerals(text: string): string {
  return toArabicDigits(
    text
      .replace(/(\d),(?=\d)/g, '$1٬')
      .replace(/(\d)\.(?=\d)/g, '$1٫')
      .replace(/(\d)%/g, '$1٪'),
  );
}

/** Half-up to the piaster, as payrollLine rounds. */
const piasters = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100 + 0;

/** An amount as printed: two decimals, thousands separated, a minus sign (−) when below 0. */
export const formatAmount = (v: number): string =>
  `${v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A number without the noise of the arithmetic: 87.5 as 87.5, 90 as 90, to two decimals at most. */
const plainNumber = (v: number) => String(Number(v.toFixed(2)));

/** A fraction as a percent to two decimals: 0.9403 → 94.03%. */
const percent2 = (fraction: number) => `${(Math.round(fraction * 10_000) / 100).toFixed(2)}%`;

/** A percent as it was set: 90 → 90%, 87.5 → 87.5%. */
const percentOf = (value: number) => `${plainNumber(value)}%`;

/** The last 4 digits of an account number or IBAN. */
function lastFour(...numbers: (string | null)[]): string | null {
  for (const n of numbers) {
    const digits = (n ?? '').replace(/\D/g, '');
    if (digits.length >= 4) return digits.slice(-4);
  }
  return null;
}

/** Text starting with a capital letter (Arabic as it is). */
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "1 day", "2.5 days". */
const englishDays = (n: number) => (n === 1 ? '1 day' : `${plainNumber(n)} days`);

/** As counted things are in Arabic: يوم واحد، يومان، ٣ أيام، ١١ يومًا; a part of a day as ٠٫٥ يوم. */
function arabicDays(n: number): string {
  if (n === 1) return 'يوم واحد';
  if (n === 2) return 'يومان';
  const shown = arabicNumerals(plainNumber(n));
  if (!Number.isInteger(n)) return `${shown} يوم`;
  return n >= 3 && n <= 10 ? `${shown} أيام` : `${shown} يومًا`;
}

/** The pay of so many days: أجر يوم، أجر يومين، أجر ٣ أيام. */
function arabicDaysPay(n: number): string {
  if (n === 1) return 'أجر يوم';
  if (n === 2) return 'أجر يومين';
  return `أجر ${arabicDays(n)}`;
}

// ---------- the year to date ----------

/** A line as the year to date counts it. */
export interface YearToDateLine {
  month: string;
  status: string;
  onHold: boolean;
  earned: number;
  allowances: number;
  monthlyTax: number;
  employeeInsurance: number;
  net: number;
}

/**
 * The year to date up to `month` (owner's decisions, 16 October 2026): the employee's lines not on hold in the runs of
 * the same calendar year the CEO approved (approved or paid), of that month or before; summed to the piaster. Null
 * when there is none.
 */
export function yearToDate(lines: readonly YearToDateLine[], month: string): YearToDate | null {
  const year = month.slice(0, 4);
  const counted = lines.filter((l) => !l.onHold && (l.status === 'approved' || l.status === 'paid') && l.month.slice(0, 4) === year && l.month <= month);
  if (!counted.length) return null;
  const sum = (pick: (l: YearToDateLine) => number) => counted.reduce((cents, l) => cents + Math.round(pick(l) * 100), 0) / 100;
  return {
    from: counted.map((l) => l.month).sort()[0],
    to: month,
    earnings: sum((l) => l.earned + l.allowances),
    tax: sum((l) => l.monthlyTax),
    insurance: sum((l) => l.employeeInsurance),
    net: sum((l) => l.net),
  };
}

// ---------- the payslip ----------

/** The figures a payslip prints: a line missing any of them is never drawn (it would print "NaN"). */
const PRINTED: readonly (keyof PayrollResult)[] = [
  'fixed',
  'variable',
  'attendanceScore',
  'kpiScore',
  'attendanceCut',
  'kpiCut',
  'noShowCut',
  'overtime',
  'bonus',
  'commission',
  'settlements',
  'earned',
  'allowances',
  'insuredWage',
  'employeeInsurance',
  'employerInsurance',
  'monthlyTax',
  'martyrsFund',
  'penaltyCut',
  'deductions',
  'net',
  'released',
  'transfer',
];

function assertReadable(result: PayrollResult): void {
  const missing = PRINTED.filter((key) => !Number.isFinite(result?.[key]));
  if (missing.length) throw new Error(`The line's pay can't be read (${missing.join(', ')}), so its payslip can't be drawn`);
}

/** The payslip's reference: the run's month (PAY-2026-10). */
export const payslipReference = (month: string) => `PAY-${month}`;

/**
 * The payslip of a line in a language: every row, cell and label it prints, as printed. The figures are the line's
 * result; a row that is 0 is left out, and so is a section with nothing in it.
 */
export function payslipContent(source: PayslipSource, language: PayslipLanguage): PayslipContent {
  assertReadable(source.line.result);
  const ar = language === 'ar';
  const t = (words: Words) => words[language];
  /** A number in the payslip's digits. */
  const num = (text: string) => (ar ? arabicNumerals(text) : text);
  const money = (v: number) => num(formatAmount(v));
  const date = (ymd: string) => num(shownDate(ymd));
  const { run, line, employee, company } = source;
  const { terms, inputs, result } = line;
  const rules = run.rules;
  const days = rules.dayDivisor;
  const hourly = line.payBasis === 'hourly';
  const partMonth = terms.paidDays < days;
  const row = (label: string, value: number, note: string | null = null): PayslipRow => ({ label, note, amount: money(value), value });
  // the no-show days' hours taken out of the expected hours: none on a line worked out before 16 October 2026
  const absentHours = Number.isFinite(result.absentHours) && result.absentHours > 0 ? result.absentHours : 0;

  // the company, under its logo or name
  const city = company.city?.trim() ? (ar ? (GOVERNORATES_AR[company.city.trim() as keyof typeof GOVERNORATES_AR] ?? company.city.trim()) : company.city.trim()) : null;
  // a number with hyphens in Arabic digits reads backwards unless kept left to right
  const taxNo = company.taxRegNo?.trim() ? (ar ? `${LEFT_TO_RIGHT_OVERRIDE}${num(company.taxRegNo.trim())}${POP_OVERRIDE}` : company.taxRegNo.trim()) : null;
  const companyLine = [city, taxNo && `${t(L.taxReg)} ${taxNo}`].filter(Boolean).join(' · ') || null;

  // ---------- the facts ----------
  const facts: { label: string; value: string }[] = [];
  const fact = (label: Words, value: string | null | undefined) => {
    if (value?.trim()) facts.push({ label: t(label), value: value.trim() });
  };
  fact(L.name, ar ? employee.nameAr?.trim() || line.nameEn : line.nameEn);
  fact(L.code, line.employeeCode);
  fact(L.jobTitle, ar ? employee.jobTitleAr?.trim() || line.jobTitle : line.jobTitle);
  fact(L.department, ar ? employee.departmentAr?.trim() || line.department : line.department);
  const type = ar ? EMPLOYMENT_TYPES_AR[line.employmentType] : LABELS.employmentType[line.employmentType];
  const basis = hourly ? (ar ? ' بالساعة' : ', by the hour') : '';
  const since = employee.joinDate ? ` · ${ar ? 'منذ' : 'since'} ${date(employee.joinDate)}` : '';
  fact(L.employment, `${type}${basis}${since}`);
  if (terms.statutory && terms.insured) fact(L.insuranceNo, employee.insuranceNo && num(employee.insuranceNo));
  const ending = lastFour(line.accountNo, line.iban);
  const bank = line.bankShort?.trim() || null;
  const account = ending && (ar ? `حساب ينتهي بـ ${num(ending)}` : `account ending ${ending}`);
  fact(L.paidTo, bank && account ? `${bank} · ${account}` : bank || (account && sentence(account)));
  fact(L.daysPaid, num(`${plainNumber(terms.paidDays)} ${ar ? 'من' : 'of'} ${days}`));

  // ---------- this month: what explains the cuts ----------
  const cells: PayslipCell[] = [];
  if (hourly) {
    if (inputs.workedHours !== null) {
      const rate = terms.hourlyRate ?? 0;
      cells.push({
        label: t(L.hoursWorked),
        value: num(formatHours(inputs.workedHours)),
        note: rate > 0 ? (ar ? `بسعر ${money(rate)} للساعة` : `At ${money(rate)} an hour`) : null,
      });
    }
  } else if (result.attendanceRatio !== null && inputs.workedHours !== null && inputs.expectedHours !== null) {
    const ratio = result.attendanceRatio;
    const grace = percentOf(rules.attendanceGracePercent);
    let note: string;
    if (ratio > rules.overtimeAbovePercent / 100) {
      note = ar ? `${percent2(ratio)}: يُصرف إضافي عمّا فوق ${percentOf(rules.overtimeAbovePercent)}` : `${percent2(ratio)}: overtime paid above ${percentOf(rules.overtimeAbovePercent)}`;
    } else if (ratio >= rules.attendanceGracePercent / 100) {
      note = ar ? `${percent2(ratio)}: تُحتسب كاملة (${grace} فأكثر)` : `${percent2(ratio)}: counts as full (${grace} or more)`;
    } else {
      const paid = percent2(result.attendanceScore);
      note = ar ? `${percent2(ratio)}: أقل من ${grace}، يُصرف الراتب الثابت بنسبة ${paid}` : `${percent2(ratio)}: below ${grace}, fixed salary paid at ${paid}`;
    }
    cells.push({
      label: t(L.hoursWorked),
      value: num(`${formatHours(inputs.workedHours)} ${ar ? 'من' : 'of'} ${formatHours(inputs.expectedHours - absentHours)}`),
      note: num(note),
    });
  } else if (inputs.workedHours !== null) {
    cells.push({ label: t(L.hoursWorked), value: num(formatHours(inputs.workedHours)), note: null });
  }

  // the KPI average, as payrollLine takes it: the attendance score and the KPIs given
  const typed: [Words, number | null][] = [
    [L.softSkills, inputs.softSkills],
    [L.performance, inputs.performance],
    [L.clientSatisfaction, inputs.clientSatisfaction],
  ];
  const kpis = typed.filter((k): k is [Words, number] => k[1] !== null);
  let kpiLine: string | null = null;
  if (!hourly && kpis.length) {
    const scores = [result.attendanceScore, ...kpis.map(([, v]) => v / 100)];
    const average = Math.round((scores.reduce((sum, v) => sum + v, 0) / scores.length) * 1e10) / 1e10;
    const grace = percentOf(rules.kpiGracePercent);
    const note =
      result.kpiScore < 1
        ? ar
          ? `أقل من ${grace}: يُصرف المتغير بنسبة ${percent2(result.kpiScore)}`
          : `Below ${grace}: variable paid at ${percent2(result.kpiScore)}`
        : ar
          ? `تُحتسب كاملة (${grace} فأكثر)`
          : `Counts as full (${grace} or more)`;
    cells.push({ label: t(L.kpiAverage), value: num(percent2(average)), note: num(note) });
    kpiLine = num(
      [...kpis.map(([label, v]) => `${t(label)} ${percentOf(v)}`), `${t(L.attendance)} ${percentOf(result.attendanceScore * 100)}`].join(' · '),
    );
  }
  const given = (v: number | null) => (v !== null && v > 0 ? v : null);
  const bonusDays = given(inputs.bonusDays);
  if (bonusDays !== null) cells.push({ label: t(L.bonusDays), value: num(plainNumber(bonusDays)), note: ar ? 'أيام من الراتب الثابت' : 'Days of the fixed salary' });
  const noShowDays = hourly ? null : given(inputs.noShowDays);
  const multiplier = rules.noShowDayMultiplier;
  if (noShowDays !== null) {
    const pay = ar ? `يُخصم عن كل يوم ${arabicDaysPay(multiplier)}` : `Each costs ${multiplier === 1 ? 'a day’s' : `${plainNumber(multiplier)} days’`} pay`;
    // their hours, out of the expected hours, aren't counted again in the attendance
    const hours = absentHours > 0 ? num(ar ? `، ولا تُحتسب ساعاتها (${formatHours(absentHours)}) مرة أخرى في الحضور` : `; their ${formatHours(absentHours)} hours aren’t counted again in attendance`) : '';
    cells.push({ label: t(L.noShowDays), value: num(plainNumber(noShowDays)), note: `${pay}${hours}` });
  }
  const penaltyDays = given(inputs.penaltyDays);
  if (penaltyDays !== null) {
    const of = terms.statutory ? (ar ? 'أجر يوم صافٍ عن كل يوم' : 'A day’s net salary each') : ar ? 'أجر يوم عن كل يوم' : 'A day’s pay each';
    cells.push({ label: t(L.penaltyDays), value: num(plainNumber(penaltyDays)), note: of });
  }

  // ---------- earnings ----------
  const forDays = ar ? `عن ${num(plainNumber(terms.paidDays))} من ${num(String(days))} يومًا` : `for ${plainNumber(terms.paidDays)} of ${days} days`;
  const earnings: PayslipRow[] = [];
  const earn = (label: Words, value: number, note: string | null = null) => {
    if (value !== 0) earnings.push(row(t(label), value, note));
  };
  if (hourly) {
    const rate = terms.hourlyRate ?? 0;
    const worked = inputs.workedHours ?? 0;
    earn(L.hours, result.fixed, num(ar ? `${formatHours(worked)} × ${formatAmount(rate)} للساعة` : `${formatHours(worked)} × ${formatAmount(rate)} an hour`));
  } else {
    const basic = terms.basicPercent;
    const fixedNote = ar ? `${basic}% من الراتب الشامل ${formatAmount(terms.gross)}` : `${basic}% of the ${formatAmount(terms.gross)} gross`;
    const variableNote = ar ? `${plainNumber(100 - basic)}% من الراتب الشامل` : `${plainNumber(100 - basic)}% of the gross`;
    const part = (note: string) => (partMonth ? `${num(note)}${ar ? '، ' : ', '}${forDays}` : num(note));
    earn(L.fixed, result.fixed, part(fixedNote));
    earn(L.variable, result.variable, part(variableNote));
    earn(L.attendanceCut, -result.attendanceCut, num(ar ? `صُرف الثابت بنسبة ${percent2(result.attendanceScore)}` : `Fixed salary paid at ${percent2(result.attendanceScore)}`));
    earn(L.kpiCut, -result.kpiCut, num(ar ? `صُرف المتغير بنسبة ${percent2(result.kpiScore)}` : `Variable paid at ${percent2(result.kpiScore)}`));
    const noShows = inputs.noShowDays ?? 0;
    earn(
      L.noShowCut,
      -result.noShowCut,
      ar ? `${arabicDays(noShows)}، ب${arabicDaysPay(multiplier)} عن كل يوم` : `${englishDays(noShows)}, ${multiplier === 1 ? 'a day’s' : `${plainNumber(multiplier)} days’`} pay each`,
    );
    earn(
      L.overtime,
      result.overtime,
      num(ar ? `الحضور فوق ${percentOf(rules.overtimeAbovePercent)}، بمعدل ${plainNumber(rules.overtimeRate)}` : `Attendance above ${percentOf(rules.overtimeAbovePercent)}, at ${plainNumber(rules.overtimeRate)}`),
    );
  }
  const bonusOf = inputs.bonusDays ?? 0;
  earn(L.bonus, result.bonus, ar ? `${arabicDays(bonusOf)} من الراتب الثابت` : `${englishDays(bonusOf)} of the fixed salary`);
  earn(L.commission, result.commission);
  earn(L.settlement, result.settlements, t(L.oneOff));
  // each allowance for the days paid, as payrollLine prorates it (so they add up to its allowances)
  for (const a of terms.allowances) {
    const amount = piasters((Math.max(0, a.amount) * terms.paidDays) / days);
    if (amount === 0) continue;
    // "For 19 of 30 days, not taxed"
    const notes = [partMonth ? forDays : null, a.taxable ? null : t(L.notTaxed)].filter((n): n is string => n !== null);
    const note = notes.length ? sentence(notes.map((n, i) => (i && !ar ? n[0].toLowerCase() + n.slice(1) : n)).join(ar ? '، ' : ', ')) : null;
    earnings.push(row((ar ? source.allowancesAr[a.name]?.trim() : null) || a.name, amount, note));
  }
  const earningsTotal = piasters(result.earned + result.allowances);

  // ---------- deductions ----------
  const deductions: PayslipRow[] = [];
  const deduct = (label: Words, value: number, note: string | null = null) => {
    if (value !== 0) deductions.push(row(t(label), value, note));
  };
  const employeeRate = percentOf(SALARY_RULES.employeeInsuranceRate * 100);
  deduct(L.insurance, result.employeeInsurance, num(ar ? `${employeeRate} من أجر الاشتراك ${formatAmount(result.insuredWage)}` : `${employeeRate} of the insured wage, ${formatAmount(result.insuredWage)}`));
  deduct(L.tax, result.monthlyTax);
  deduct(L.martyrs, result.martyrsFund, num(ar ? `${percentOf(SALARY_RULES.martyrsRate * 100)} من الأجر` : `${percentOf(SALARY_RULES.martyrsRate * 100)} of the pay`));
  // a line approved before the medical subscription was taken off the payroll (owner's decision, 16 October 2026)
  // keeps it in its result and its deductions: still its own row, so the rows add up and it isn't health insurance
  const medical = (result as PayrollResult & { medical?: number }).medical;
  const oldMedical = typeof medical === 'number' && Number.isFinite(medical) ? medical : 0;
  // what else is in the deductions: comprehensive health insurance, 0 while it doesn't apply in Cairo
  const named = result.employeeInsurance + result.monthlyTax + result.martyrsFund + result.penaltyCut + oldMedical;
  deduct(L.healthInsurance, piasters(result.deductions - named));
  deduct(L.penalty, result.penaltyCut, ar ? arabicDays(inputs.penaltyDays ?? 0) : englishDays(inputs.penaltyDays ?? 0));
  deduct(L.medical, oldMedical, t(L.monthlySubscription));

  // ---------- the net, and what the bank pays ----------
  const afterNet: PayslipRow[] = [];
  if (result.released > 0) afterNet.push(row(t(L.released), -result.released));
  if (result.transfer !== 0) {
    const to = [bank, ending && `···${num(ending)}`].filter(Boolean).join(' ');
    // kept left to right inside the Arabic, as the bank and the account's end read
    afterNet.push(row(to ? `${t(L.transfer)} ${ar ? `${LEFT_TO_RIGHT_ISOLATE}${to}${POP_ISOLATE}` : to}` : t(L.paid), result.transfer));
  }

  const share = result.employerInsurance > 0 ? money(result.employerInsurance) : null;
  const shareRate = percentOf(SALARY_RULES.employerInsuranceRate * 100);
  const companyShare = share
    ? ar
      ? `إلى جانب راتبك، تدفع الشركة ${share} حصتها في التأمينات الاجتماعية عنك: ${num(shareRate)} من أجر الاشتراك.`
      : `On top of your pay, the company pays ${share} social insurance for you: ${shareRate} of the insured wage.`
    : null;

  // ---------- the year to date ----------
  let ytd: PayslipContent['yearToDate'] = null;
  const y = source.yearToDate;
  if (y) {
    const monthOnly = (m: string) => (ar ? monthArabic(m) : monthName(m)).replace(/ \d{4}$/, '');
    const whole = (m: string) => num(ar ? monthArabic(m) : monthName(m));
    const period = y.from === y.to ? whole(y.to) : `${monthOnly(y.from)} ${ar ? 'إلى' : 'to'} ${whole(y.to)}`;
    const cellsYtd = (
      [
        [L.ytdEarnings, y.earnings],
        [L.ytdTax, y.tax],
        [L.ytdInsurance, y.insurance],
        [L.ytdNet, y.net],
      ] as const
    )
      .filter(([, v]) => v !== 0)
      .map(([label, v]) => ({ label: t(label), value: money(v) }));
    if (cellsYtd.length) ytd = { heading: t(L.ytd), period, cells: cellsYtd };
  }

  const reference = `${payslipReference(run.month)} · ${line.employeeCode}`;
  const issued = [run.approvedOn && `${t(L.approved)} ${date(run.approvedOn)}`, `${t(L.issued)} ${date(source.issuedOn)}`, reference].filter(Boolean).join(' · ');

  return {
    language,
    rtl: ar,
    company: { name: company.nameEn, line: companyLine },
    title: { kind: t(L.payslip), month: num(ar ? monthArabic(run.month) : monthName(run.month)), paid: run.paidOn ? `${t(L.paidOn)} ${date(run.paidOn)}` : null },
    facts,
    thisMonth: cells.length ? { heading: t(L.thisMonth), cells, line: kpiLine } : null,
    earnings: earnings.length ? { heading: t(L.earnings), rows: earnings, total: row(t(L.earningsTotal), earningsTotal) } : null,
    deductions: deductions.length ? { heading: t(L.deductions), rows: deductions, total: row(t(L.deductionsTotal), result.deductions) } : null,
    net: {
      label: t(L.net),
      amount: money(result.net),
      currency: t(L.egp),
      words: result.net >= 0 ? (ar ? arabicAmountInWords(result.net) : englishAmountInWords(result.net)) : null,
    },
    afterNet,
    companyShare,
    yearToDate: ytd,
    footer: { issued, note: t(L.noSignature) },
  };
}
