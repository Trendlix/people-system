import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { paidAdjustments, type LawRates, type PaidAdjustment, type PayrollResult, type PayrollTerms } from '@trendlix/shared';
import JSZip from 'jszip';
import { etaExemption, etaTax, type EtaPeriod, type EtaTaxFigures } from './eta-tax.js';

// The Egyptian Tax Authority's monthly salary-tax upload, "نموذج القطاع الخاص" (owner, 27 October 2026: "this is the
// upload template of the ETA Payroll System ... i need it exported with the same format to be readable with the
// system", "not all fields needs to be filled"). The file is ETA's own template, kept unchanged in
// apps/api/assets/eta, with one row per employee written into it from row 3. Nothing else of it is touched: its two
// header rows (the Arabic names and ETA's field codes EI…/DTE…/DAE…/TC…/NAD…/CLD…), column widths, right-to-left view,
// styles and its 62 input checks stay byte for byte as ETA made them.
//
// What goes in each column follows ETA's own export of TrendLIX's filings (the owner's "extracted file with the
// prefilled data"): codes as two digits, dates as YYYYMMDD and 00000000 for none, every amount written (0.00 when
// there is nothing), the text columns that don't apply left empty, and the tax by ETA's cumulative method (eta-tax.ts).
// Every row is a full month of 30 days (owner, 27 October 2026: ETA "doesn't read part of the month").

const TEMPLATE = fileURLToPath(new URL('../../../assets/eta/eta-salary-tax-private-sector-2026.xlsx', import.meta.url));
const SHEET = 'xl/worksheets/sheet1.xml';
const STRINGS = 'xl/sharedStrings.xml';
/** The first row of data: row 1 holds the names, row 2 ETA's field codes. */
export const ETA_FIRST_ROW = 3;
/** ETA's "no date". */
export const NO_DATE = '00000000';
/** Every filing is a full month. */
export const FULL_MONTH_DAYS = 30;

/** The columns filled, by what they hold (the template's row 1 in Arabic, its row 2 code). */
export const ETA = {
  code: 'B', // كود الموظف EI010
  name: 'C', // اسم الموظف EI015
  nationality: 'D', // الجنسية EI020: code
  nationalId: 'E', // الرقم القومي EI025
  phone: 'H', // رقم التليفون EI030
  jobTitle: 'K', // الوظيفة EI045
  employer: 'L', // اسم الجهة/الفرع EI055
  taxTreatment: 'M', // المعاملة الضريبية EI060: code
  daysWorked: 'O', // مدة العمل EI130: always 30, a full month
  insuranceStatus: 'P', // الحالة التأمينية EI070: code
  insuranceNo: 'Q', // الرقم التأمينى EI075
  insuranceStart: 'R', // تاريخ الالتحاق بالتأمينات EI080: YYYYMMDD
  earlierInstalment: 'S', // قسط مدة سابقة EI085
  endOfService: 'T', // تاريخ نهاية الخدمة EI090: YYYYMMDD
  insuranceEnd: 'U', // تاريخ انتهاء الاشتراك من التأمينات الاجتماعية EI095: YYYYMMDD
  comprehensiveWage: 'V', // الأجر الشامل EI100
  uninsuredAllowances: 'W', // بدلات غير خاضعة تأمينيأ EI105
  insuredWage: 'X', // الأجر التأميني EI110
  healthInsuranceStatus: 'Y', // حالة التأمين الصحي الشامل EI115: code
  wives: 'Z', // عدد الزوجات الغير عاملات EI120
  dependants: 'AA', // عدد المعالين EI125
  basic: 'AB', // المرتب الأساسي DTE160
  bonuses: 'AC', // مكافات وحوافز/أجر إضافي/منح DTE170
  commissions: 'AF', // عمولات DTE190
  leavePayout: 'AK', // المقابل النقدى لرصيد الاجازات أثناء الخدمة DTE245
  taxableAllowances: 'AN', // إضافات وبدلات اخرى خاضعة DTE265
  totalEarnings: 'AZ', // اجمالى الاستحقاقات DTE295
  employeeInsurance: 'BA', // حصة العامل فى التأمينات الإجتماعية والمعاشات DAE405
  healthInsurance: 'BB', // حصة العامل المستقطعة في التأمين الصحي الشامل DAE410
  personalExemption: 'BF', // الاعفاء الشخصى DAE430
  healthPremiums: 'BL', // أقساط التأمين الصحي DAE460
  totalDeductions: 'BO', // اجمالى الاستقطاعات DAE475
  periodBase: 'BP', // صافى الدخل (وعاء الفتره) TC505
  annualBase: 'BQ', // الوعاء السنوى TC510
  cumulativeTax: 'BR', // الضريبة المستحقة من بداية الفترة للعمالة الاصلية TC515
  cumulativeTaxTotal: 'BU', // اجمالى الضريبة المستحقة عن جميع انواع العمالة TC530
  periodTax: 'BV', // الضريبة المحتسبة عن الفترة END705
  earlierTax: 'BW', // الضريبة المحتسبة عن الفترات السابقة للمعاملات الضريبية 1 و4 و5 و6 و7 TC535
  periodTaxTreatments: 'BX', // الضريبة المحتسبة عن الفترة للمعاملات الضريبية 1 و4 و5 و6 و7 TC540
  netPay: 'CC', // صافي الأجر النهائي TC565
  martyrsFund: 'CD', // مشاركه اجتماعيه استقطاع لصندوق الشهداء NAD610
  leavePayoutUntaxed: 'CH', // اضافات: قيمة رصيد الأجازات الغير خاضعة NAD625
  otherAdditions: 'CI', // اضافات أخرى NAD630
  advanceInstallments: 'CK', // استقطاعات: قيمة قسط السلفة/القرض NAD640
  penalties: 'CM', // استقطاعات: جزاءات NAD650
  otherDeductions: 'CO', // استقطاعات أخرى NAD660
  companyInsurance: 'CP', // حصة الشركة في التأمينات الاجتماعية CLD805
  martyrsContribution: 'CR', // المساهمة فى صندوق الشهداء CLD815: the same amount as NAD610 in ETA's export
  transferred: 'CT', // المبالغ المحولة فعلياً NAD665
} as const;
export type EtaColumn = (typeof ETA)[keyof typeof ETA];

/**
 * The codes written, from the template's own notes and ETA's export. Egyptians on a contract and permanent staff are
 * what TrendLIX has; insured / not insured are the first two of ETA's insurance statuses (03 to 28 are in ETA's guide);
 * comprehensive health insurance doesn't apply in Cairo yet, so everyone is "not subject", as the export has them.
 */
export const ETA_CODES = {
  egyptianWithContract: 1, // 01- مصري - بعقد
  foreignWithContract: 2, // 02- اجنبي - بعقد
  permanentStaff: 1, // 01- العمالة الدائمة
  specialNeeds: 4, // 04- ذوى الاحتياجات الخاصة
  insured: 1, // 01
  notInsured: 2, // 02
  healthNotSubject: 2, // 02- غير خاضعة
} as const;

/** Columns holding a code, shown with two digits (01) as the template's own code cells are. */
const CODE_COLUMNS: ReadonlySet<string> = new Set([ETA.nationality, ETA.taxTreatment, ETA.insuranceStatus, ETA.healthInsuranceStatus]);

/** "A" → 1, "CT" → 98. */
export function columnNumber(col: string): number {
  let n = 0;
  for (let i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64);
  return n;
}

/** 1 → "A", 98 → "CT". */
export function columnLetter(n: number): string {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

const range = (from: string, to: string) => Array.from({ length: columnNumber(to) - columnNumber(from) + 1 }, (_, i) => columnLetter(columnNumber(from) + i));

/**
 * The columns ETA's export writes an amount or a count in for everyone, 0 when there is nothing: the earlier-period
 * instalment, the wages, the two counts of the comprehensive health insurance, and every column from المرتب الأساسي to
 * المبالغ المحولة فعلياً.
 */
export const ETA_AMOUNT_COLUMNS: readonly string[] = [ETA.earlierInstalment, ...range('V', 'X'), ...range('Z', 'CT')];

/** The template's styles (xl/styles.xml cellXfs): text (@) and two-digit codes (00), both unlocked; General for amounts. */
const STYLE = { text: 5, code: 6, amount: 4 } as const;

/** One employee's row: column → value. Text is written as text (IDs keep their leading zeros), numbers as numbers. */
export type EtaRow = Record<string, string | number>;

/** What a row takes from the profile, as it is now. */
export interface EtaPerson {
  code: string;
  nameAr: string;
  egyptian: boolean;
  nationalId: string | null;
  mobile: string | null;
  jobTitle: string | null;
  /** The company's name, for اسم الجهة/الفرع. */
  employer: string | null;
  disability: boolean;
  insuranceNo: string | null;
  /** YYYY-MM-DD */
  insuranceStart: string | null;
  /** The comprehensive wage on the Social Insurance tab (الأجر الشامل); null: the contract's gross and allowances. */
  comprehensiveWage: number | null;
  /** The last working day when the person leaves in this month, YYYY-MM-DD. */
  endOfService: string | null;
}

/** What a row takes from a month's payroll line. */
export interface EtaPay {
  terms: PayrollTerms;
  result: PayrollResult;
}

const cents = (n: number) => Math.round(n * 100) / 100;
const sumOf = (items: readonly PaidAdjustment[], pick: (a: PaidAdjustment) => boolean) => cents(items.filter(pick).reduce((s, a) => s + a.amount, 0));

/** A date as ETA writes it: 2000-01-01 → "20000101". */
export const etaDate = (ymd: string) => ymd.slice(0, 10).replaceAll('-', '');

/** A mobile number as ETA takes it, digits only and with the leading 0: "+20 10 1234 5678" → "01012345678". */
export function etaPhone(mobile: string | null): string | null {
  if (!mobile) return null;
  let d = mobile.replace(/\D/g, '');
  if (d.startsWith('0020')) d = d.slice(4);
  else if (d.startsWith('20') && d.length === 12) d = d.slice(2);
  if (d.length === 10 && d.startsWith('1')) d = `0${d}`;
  return d || null;
}

/** The line's figures the method and the row are built on. */
export interface EtaLineFigures {
  totalEarnings: number;
  employeeInsurance: number;
  healthInsurance: number;
  exemption: number;
  /** The deductions before tax that lowered the taxable pay (the medical share), in أقساط التأمين الصحي. */
  premiums: number;
  totalDeductions: number;
  base: number;
}

/** A month's line as ETA's method takes it. */
export function etaLineFigures({ result: r }: EtaPay, law: Pick<LawRates, 'personalExemption'>): EtaLineFigures {
  const totalEarnings = cents(r.earned + r.taxableAllowances);
  const adjustmentDeductions = r.adjustmentDeductions ?? 0;
  const healthInsurance = Math.max(0, cents(r.deductions - r.employeeInsurance - r.monthlyTax - r.martyrsFund - r.penaltyCut - adjustmentDeductions));
  const exemption = etaExemption(law);
  const premiums = r.taxableLowered ?? 0;
  const totalDeductions = cents(r.employeeInsurance + healthInsurance + exemption + premiums);
  return { totalEarnings, employeeInsurance: r.employeeInsurance, healthInsurance, exemption, premiums, totalDeductions, base: cents(totalEarnings - totalDeductions) };
}

/** A line as a period of the year's filings. */
export const etaPeriodOf = (pay: EtaPay, law: Pick<LawRates, 'personalExemption'>): EtaPeriod => ({ base: etaLineFigures(pay, law).base });

export interface EtaRowResult {
  row: EtaRow;
  figures: EtaTaxFigures;
  /** The salary tax the payroll deducted this month, beside ETA's periodTax. */
  payrollTax: number;
}

/**
 * One employee's row. The earnings are the payroll line's own, split into ETA's columns so that they add up as the
 * payroll does; the base and the tax are ETA's method on this month after the year's earlier months (`earlier`,
 * oldest first); the net is the payslip's with ETA's tax in place of the payroll's; the amount transferred is what the
 * bank paid.
 */
export function etaRow(person: EtaPerson, pay: EtaPay, earlier: readonly EtaPeriod[], law: Pick<LawRates, 'personalExemption' | 'taxTiers'>): EtaRowResult {
  const { terms: t, result: r } = pay;
  const items = paidAdjustments({ terms: t, result: r });
  const f = etaLineFigures(pay, law);
  const figures = etaTax(earlier, { base: f.base }, law);
  const row: EtaRow = {};
  const text = (col: EtaColumn, value: string | null | undefined) => {
    const v = value?.trim();
    if (v) row[col] = v;
  };
  const amount = (col: EtaColumn, value: number) => {
    row[col] = cents(value);
  };

  // the employee
  text(ETA.code, person.code);
  text(ETA.name, person.nameAr);
  row[ETA.nationality] = person.egyptian ? ETA_CODES.egyptianWithContract : ETA_CODES.foreignWithContract;
  if (person.egyptian) text(ETA.nationalId, person.nationalId);
  text(ETA.phone, etaPhone(person.mobile));
  text(ETA.jobTitle, person.jobTitle);
  text(ETA.employer, person.employer);
  row[ETA.taxTreatment] = person.disability ? ETA_CODES.specialNeeds : ETA_CODES.permanentStaff;
  row[ETA.daysWorked] = FULL_MONTH_DAYS;

  // social insurance, as the line deducted it
  const insured = t.statutory && t.insured && r.insuredWage > 0;
  row[ETA.insuranceStatus] = insured ? ETA_CODES.insured : ETA_CODES.notInsured;
  if (insured) {
    text(ETA.insuranceNo, person.insuranceNo);
    if (person.insuranceStart) text(ETA.insuranceStart, etaDate(person.insuranceStart));
  }
  row[ETA.endOfService] = person.endOfService ? etaDate(person.endOfService) : NO_DATE;
  row[ETA.insuranceEnd] = person.endOfService && insured ? etaDate(person.endOfService) : NO_DATE;
  const allowancesFull = t.allowances.reduce((s, a) => s + Math.max(0, a.amount), 0);
  amount(ETA.comprehensiveWage, person.comprehensiveWage ?? t.gross + allowancesFull);
  amount(ETA.uninsuredAllowances, t.allowances.reduce((s, a) => s + (a.insured ? 0 : Math.max(0, a.amount)), 0));
  amount(ETA.insuredWage, insured ? r.insuredWage : 0);
  row[ETA.healthInsuranceStatus] = ETA_CODES.healthNotSubject;

  // what is taxed: the basic salary less the cuts, commissions, leave paid in cash, the taxable allowances, and the rest
  // of the pay earned (the variable part after the KPI cut, overtime, bonuses, incentives, other taxed additions)
  const cutsFromBasic = r.attendanceCut + r.noShowCut + (r.unpaidLeaveCut ?? 0);
  const basic = cents(Math.max(0, r.fixed - cutsFromBasic));
  const commissions = cents((r.commission ?? 0) + sumOf(items, (a) => a.kind === 'addition' && a.taxed && a.type === 'commission'));
  const leavePayout = sumOf(items, (a) => a.kind === 'addition' && a.taxed && a.type === 'leave_payout');
  amount(ETA.basic, basic);
  amount(ETA.bonuses, f.totalEarnings - basic - commissions - leavePayout - r.taxableAllowances);
  amount(ETA.commissions, commissions);
  amount(ETA.leavePayout, leavePayout);
  amount(ETA.taxableAllowances, r.taxableAllowances);
  amount(ETA.totalEarnings, f.totalEarnings);

  // the deductions before tax, the base and the tax, ETA's way
  amount(ETA.employeeInsurance, f.employeeInsurance);
  amount(ETA.healthInsurance, f.healthInsurance);
  amount(ETA.personalExemption, f.exemption);
  amount(ETA.healthPremiums, f.premiums);
  amount(ETA.totalDeductions, f.totalDeductions);
  amount(ETA.periodBase, f.base);
  amount(ETA.annualBase, figures.annualBase);
  amount(ETA.cumulativeTax, figures.cumulativeTax);
  amount(ETA.cumulativeTaxTotal, figures.cumulativeTax);
  amount(ETA.periodTax, figures.periodTax);
  amount(ETA.earlierTax, figures.earlierTax);
  amount(ETA.periodTaxTreatments, figures.periodTax);
  amount(ETA.netPay, r.net + r.monthlyTax - figures.periodTax);

  // after tax: the Martyrs' Fund, what is added untaxed, and the month's deductions by kind
  const adjustmentDeductions = r.adjustmentDeductions ?? 0;
  const leaveUntaxed = sumOf(items, (a) => a.kind === 'addition' && !a.taxed && a.type === 'leave_payout');
  const advances = sumOf(items, (a) => a.kind === 'deduction' && (a.type === 'advance_recovery' || a.type === 'loan_installment'));
  const penalties = sumOf(items, (a) => a.kind === 'deduction' && a.type === 'penalty');
  amount(ETA.martyrsFund, r.martyrsFund);
  amount(ETA.leavePayoutUntaxed, leaveUntaxed);
  amount(ETA.otherAdditions, r.allowances - r.taxableAllowances + (r.additionsUntaxed ?? 0) - leaveUntaxed);
  amount(ETA.advanceInstallments, advances);
  amount(ETA.penalties, r.penaltyCut + penalties);
  amount(ETA.otherDeductions, adjustmentDeductions - f.premiums - advances - penalties);
  amount(ETA.companyInsurance, r.employerInsurance);
  amount(ETA.martyrsContribution, r.martyrsFund);
  amount(ETA.transferred, r.transfer);
  // every other amount ETA's export writes: 0
  for (const col of ETA_AMOUNT_COLUMNS) if (!(col in row)) row[col] = 0;
  return { row, figures, payrollTax: r.monthlyTax };
}

// ---------- the workbook ----------

const escapeXml = (s: string) =>
  s
    // control characters XML can't hold, all but tab and line breaks
    .replace(/\p{Cc}/gu, (c) => (c === '\t' || c === '\n' || c === '\r' ? c : ''))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** A number as a cell holds it: no exponent, at most two decimals. */
const numberText = (n: number) => (Number.isInteger(n) ? String(n) : cents(n).toFixed(2).replace(/0$/, ''));

/** ETA's template with the rows written in, as an .xlsx file. */
export async function etaWorkbook(rows: readonly EtaRow[]): Promise<Buffer> {
  const zip = await JSZip.loadAsync(readFileSync(TEMPLATE));
  let sheet = await zip.file(SHEET)!.async('string');
  let strings = await zip.file(STRINGS)!.async('string');

  // the shared strings: the template's own, then the new ones once each
  const unique = Number(/uniqueCount="(\d+)"/.exec(strings)?.[1] ?? 0);
  const count = Number(/ count="(\d+)"/.exec(strings)?.[1] ?? 0);
  const added: string[] = [];
  const index = new Map<string, number>();
  let references = 0;
  const stringIndex = (s: string) => {
    references += 1;
    let i = index.get(s);
    if (i === undefined) {
      i = unique + added.length;
      added.push(s);
      index.set(s, i);
    }
    return i;
  };

  const rowsXml = rows
    .map((row, i) => {
      const r = ETA_FIRST_ROW + i;
      const cells = Object.entries(row)
        .filter(([, v]) => v !== '' && v !== undefined && v !== null)
        .sort(([a], [b]) => columnNumber(a) - columnNumber(b))
        .map(([col, v]) => {
          const ref = `${col}${r}`;
          if (typeof v === 'string') return `<c r="${ref}" s="${STYLE.text}" t="s"><v>${stringIndex(v)}</v></c>`;
          return `<c r="${ref}" s="${CODE_COLUMNS.has(col) ? STYLE.code : STYLE.amount}"><v>${numberText(v)}</v></c>`;
        })
        .join('');
      return `<row r="${r}" spans="1:98" x14ac:dyDescent="0.3">${cells}</row>`;
    })
    .join('');

  // the template's empty rows (3 to 35, a few formatted cells each) make way for the employees'
  sheet = sheet.replace(/<row r="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g, (m, n: string) => (Number(n) >= ETA_FIRST_ROW ? '' : m));
  sheet = sheet.replace('</sheetData>', `${rowsXml}</sheetData>`);
  sheet = sheet.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:CT${Math.max(2, ETA_FIRST_ROW - 1 + rows.length)}"/>`);

  if (added.length) {
    const si = added.map((s) => `<si><t xml:space="preserve">${escapeXml(s)}</t></si>`).join('');
    strings = strings
      .replace(/ count="\d+"/, ` count="${count + references}"`)
      .replace(/uniqueCount="\d+"/, `uniqueCount="${unique + added.length}"`)
      .replace('</sst>', `${si}</sst>`);
  }
  zip.file(SHEET, sheet);
  zip.file(STRINGS, strings);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
