import ExcelJS from 'exceljs';
import {
  confidentialExcludedNote,
  LABELS,
  SI_FORM_STATE_LABELS,
  SI_MISSING_LABELS,
  SI_PRINT_STATE_LABELS,
  SI_REGISTER_STATUS_LABELS,
  siMarksText,
  siMonthMarks,
  siPercent,
  siPlaceParts,
  STANDING_LABELS,
  type SiContributionsReport,
  type SiDepartmentFilter,
  type SiMissingItem,
  type SiMissingReport,
  type SiMissingRow,
  type SiMonthRow,
  type SiRates,
  type SiRegisterReport,
  type SiRegisterRow,
  type SiTotals,
} from '@trendlix/shared';
import { dayInCairo, shownDate } from '../../common/date-only.js';
import { excelDate, fitted } from '../../contracts/contracts-report-workbook.js';
import { departmentName } from '../../contracts/views.js';
import { addSheet, type Column } from '../../employees/missing-workbook.js';
import { monthName } from '../months.js';

// The Social Insurance report's views as Excel workbooks (owner, 27 October 2026: "is there a report for the social
// insurance? to be filled from the social insurance tab"; he chose all three, the register "download as Excel"), for HR,
// Finance and the CEO to work with outside the system, and to take to the insurance office. Each view's rows in its order
// on a sheet of their own, the dates real Excel dates shown DD/MM/YYYY and the money numbers with two decimals, under
// bold, frozen headings with an autofilter (the Missing Details workbook's sheets); the month's contributions with their
// total under the table; and a "Summary" sheet: the totals, the filters, the year's rates, who is left out and when it was
// made. The register has the national ID in full for HR and the CEO, who see it (the download is in the audit log).

const DATE = 'dd/mm/yyyy';
const MONEY = '#,##0.00';
const COUNT = '0';

/** Each view's name, with its day or month: "Social insurance register 2026-10-27.xlsx", "… contributions 2026-10.xlsx". */
export function siFileName(report: SiRegisterReport | SiContributionsReport | SiMissingReport): string {
  if (report.view === 'register') return `Social insurance register ${report.today}.xlsx`;
  if (report.view === 'contributions') return `Social insurance contributions ${report.month}.xlsx`;
  return `Social insurance missing data ${report.today}.xlsx`;
}

const labelOf = (labels: Readonly<Record<string, string>>, value: string) => labels[value] ?? value;
const yesNo = (v: boolean) => (v ? 'Yes' : 'No');

/** Who someone is and where they work, in the first columns of every sheet. */
function who<T extends { employee: SiRegisterRow['employee']; department: SiRegisterRow['department']; employmentType: string }>(): Column<T>[] {
  return [
    { header: 'Employee code', width: 13, value: (r) => r.employee.employeeCode },
    { header: 'Employee name (English)', width: 24, value: (r) => r.employee.fullNameEn },
    { header: 'Employee name (Arabic)', width: 24, value: (r) => r.employee.fullNameAr },
    { header: 'Department', width: 14, value: (r) => siPlaceParts(r.department).department },
    { header: 'Team', width: 10, value: (r) => siPlaceParts(r.department).team },
    { header: 'Employment type', width: 15, value: (r) => labelOf(LABELS.employmentType, r.employmentType) },
  ];
}

const money = <T>(header: string, value: (r: T) => number | null): Column<T> => ({ header, width: 14, value, numFmt: MONEY });

/** The shares' headings with the year's rates: "Employee share (11%)", "Company share (18.75%)". */
const shareHeads = (rates: SiRates) => ({ employee: `Employee share (${siPercent(rates.employeeInsuranceRate)})`, employer: `Company share (${siPercent(rates.employerInsuranceRate)})` });

function registerColumns(report: SiRegisterReport): Column<SiRegisterRow>[] {
  const heads = shareHeads(report.rates);
  return [
    ...who<SiRegisterRow>(),
    { header: 'Status', width: 13, value: (r) => STANDING_LABELS[r.standing] ?? r.standing },
    { header: 'Join date', width: 11, value: (r) => excelDate(r.joinDate), numFmt: DATE },
    { header: 'Left on', width: 11, value: (r) => excelDate(r.leftOn), numFmt: DATE },
    { header: 'Insurance number', width: 16, value: (r) => r.insuranceNo },
    // the national ID only for those who see it (HR and the CEO), as text so no digit is lost
    ...(report.seesIdentity ? [{ header: 'National ID', width: 16, value: (r: SiRegisterRow) => r.nationalId }] : []),
    { header: 'Occupation code', width: 12, value: (r) => r.occupationCode },
    { header: 'Occupation', width: 24, value: (r) => r.occupationName },
    // what Form 1 prints: the employee's own, else the join date
    { header: 'Subscription start', width: 12, value: (r) => excelDate(r.insuranceStartDate ?? r.joinDate), numFmt: DATE },
    { header: 'Subscription start from', width: 14, value: (r) => (r.insuranceStartDate ? 'Social Insurance tab' : 'Join date') },
    money('Basic wage', (r) => r.insuranceBasicWage),
    { header: 'Basic wage from', width: 12, value: (r) => (r.basicFrom === 'own' ? 'Social Insurance tab' : 'Default') },
    money('Comprehensive wage', (r) => r.insuranceComprehensiveWage),
    { header: 'Comprehensive wage from', width: 14, value: (r) => comprehensiveFromText(r.comprehensiveFrom) },
    money('Insured wage', (r) => r.insuredWage),
    money(heads.employee, (r) => r.employeeInsurance),
    money(heads.employer, (r) => r.employerInsurance),
    // the employee file's, for those who see it (HR and the CEO)
    ...(report.seesFile
      ? [
          { header: 'Form 1', width: 12, value: (r: SiRegisterRow) => (r.form1 ? SI_FORM_STATE_LABELS[r.form1] : null) },
          { header: 'Form 6', width: 12, value: (r: SiRegisterRow) => (r.form6 ? SI_FORM_STATE_LABELS[r.form6] : null) },
          { header: 'Insurance print', width: 12, value: (r: SiRegisterRow) => (r.print ? SI_PRINT_STATE_LABELS[r.print] : null) },
          { header: 'Print received on', width: 12, value: (r: SiRegisterRow) => excelDate(r.printReceivedOn), numFmt: DATE },
        ]
      : []),
  ];
}

const comprehensiveFromText = (from: SiRegisterRow['comprehensiveFrom']) => (from === 'own' ? 'Social Insurance tab' : from === 'contract' ? 'Contract' : null);

function contributionColumns(report: SiContributionsReport): Column<SiMonthRow>[] {
  const heads = shareHeads(report.rates);
  const marks = (r: SiMonthRow) => siMonthMarks(r, report.month);
  return [
    ...who<SiMonthRow>(),
    { header: 'Insurance number', width: 16, value: (r) => r.insuranceNo },
    { header: 'Joined or left', width: 12, value: (r) => siMarksText(marks(r)) },
    { header: 'Join date', width: 11, value: (r) => excelDate(r.joinDate), numFmt: DATE },
    { header: 'Left on', width: 11, value: (r) => excelDate(r.leftOn), numFmt: DATE },
    money('Comprehensive wage', (r) => r.insuranceComprehensiveWage),
    { header: 'Comprehensive wage from', width: 14, value: (r) => comprehensiveFromText(r.comprehensiveFrom) },
    money('Insured wage', (r) => r.insuredWage),
    money(heads.employee, (r) => r.employeeInsurance),
    money(heads.employer, (r) => r.employerInsurance),
    money('Both shares', (r) => (r.employeeInsurance === null || r.employerInsurance === null ? null : Math.round((r.employeeInsurance + r.employerInsurance) * 100) / 100)),
  ];
}

/** The missing items in words: "Insurance number, Occupation". */
export const missingText = (items: readonly SiMissingItem[]) => items.map((i) => SI_MISSING_LABELS[i]).join(', ');

const MISSING_COLUMNS: readonly Column<SiMissingRow>[] = [
  ...who<SiMissingRow>(),
  { header: 'Status', width: 13, value: (r) => STANDING_LABELS[r.standing] ?? r.standing },
  { header: 'Join date', width: 11, value: (r) => excelDate(r.joinDate), numFmt: DATE },
  { header: 'Missing', width: 40, value: (r) => missingText(r.missing), wrap: true },
];

/** A missing item with its person, for the second sheet, so HR can filter by the item. */
interface ItemRow {
  person: SiMissingRow;
  item: SiMissingItem;
}

const ITEM_COLUMNS: readonly Column<ItemRow>[] = [
  { header: 'Employee code', width: 13, value: (r) => r.person.employee.employeeCode },
  { header: 'Employee name (English)', width: 24, value: (r) => r.person.employee.fullNameEn },
  { header: 'Department', width: 14, value: (r) => siPlaceParts(r.person.department).department },
  { header: 'Team', width: 10, value: (r) => siPlaceParts(r.person.department).team },
  { header: 'Missing', width: 30, value: (r) => SI_MISSING_LABELS[r.item] },
];

// ---------- the Summary sheet ----------

/** A line of the Summary: what it is, and its value (an amount, a count, or words); a line with neither is a gap. */
interface SummaryLine {
  item: string | null;
  value: string | number | null;
  numFmt?: string;
}

const SUMMARY_COLUMNS: readonly Column<SummaryLine>[] = [
  { header: 'Summary', width: 30, value: (l) => l.item },
  { header: 'Value', width: 16, value: (l) => l.value, numFmt: 'General' },
];

const GAP: SummaryLine = { item: null, value: null };

/** The time in Cairo, 24-hour: "14:05". */
const cairoTime = (moment: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(moment);

const placeText = (d: SiDepartmentFilter | null) => (d ? departmentName(d) : 'Everyone');

function totalsLines(t: SiTotals, rates: SiRates): SummaryLine[] {
  return [
    { item: 'People', value: t.people, numFmt: COUNT },
    { item: 'With an insured wage', value: t.insured, numFmt: COUNT },
    { item: 'Insured wages', value: t.insuredWage, numFmt: MONEY },
    { item: `Employee shares (${siPercent(rates.employeeInsuranceRate)})`, value: t.employeeInsurance, numFmt: MONEY },
    { item: `Company shares (${siPercent(rates.employerInsuranceRate)})`, value: t.employerInsurance, numFmt: MONEY },
    { item: 'Both shares (to pay the insurance office)', value: t.toPay, numFmt: MONEY },
  ];
}

const ratesLines = (rates: SiRates): SummaryLine[] => [
  { item: 'Rates', value: `${rates.year}: employee ${siPercent(rates.employeeInsuranceRate)}, company ${siPercent(rates.employerInsuranceRate)}` },
  { item: 'Insurable wage', value: `${rates.insurableWageMin.toFixed(2)} to ${rates.insurableWageMax.toFixed(2)} a month` },
];

function endLines(report: { generatedAt: string; confidentialExcluded: number }): SummaryLine[] {
  const made = new Date(report.generatedAt);
  const excluded = confidentialExcludedNote(report.confidentialExcluded, 'details');
  return [
    ...(excluded ? [{ item: 'C-level people left out', value: report.confidentialExcluded, numFmt: COUNT }, { item: excluded, value: null }] : []),
    { item: 'From', value: "Each employee's Social Insurance tab (and the insurance number on Basic Data), not a payroll run" },
    { item: 'Made on', value: `${shownDate(dayInCairo(made))} ${cairoTime(made)} (Cairo)` },
  ];
}

/** The Summary sheet: a list of figures, not a table to filter; each value in its own format. */
function addSummary(wb: ExcelJS.Workbook, lines: readonly SummaryLine[]) {
  const ws = addSheet(wb, 'Summary', fitted(SUMMARY_COLUMNS, lines), lines);
  ws.autoFilter = undefined;
  lines.forEach((l, i) => {
    if (l.numFmt) ws.getRow(i + 2).getCell(2).numFmt = l.numFmt;
  });
}

/** A total row under a sheet's table, a row apart from it (outside the autofilter), bold: the label, then each money column's sum. */
function addTotalRow<T>(ws: ExcelJS.Worksheet, columns: readonly Column<T>[], rows: number, label: string, sums: Readonly<Record<string, number>>) {
  const row = ws.getRow(rows + 3);
  row.getCell(1).value = label;
  columns.forEach((c, i) => {
    if (c.header in sums) {
      row.getCell(i + 1).value = sums[c.header];
      row.getCell(i + 1).numFmt = MONEY;
    }
  });
  row.eachCell((cell) => (cell.font = { name: 'Calibri', size: 11, bold: true }));
}

// ---------- the workbooks ----------

/** A view as an .xlsx: its rows (and the missing items one by one), then the Summary; with the name it is saved under. */
export async function siWorkbook(report: SiRegisterReport | SiContributionsReport | SiMissingReport): Promise<{ fileName: string; data: Buffer }> {
  const wb = new ExcelJS.Workbook();
  const department = { item: 'Department or team', value: placeText(report.filters.department) };

  if (report.view === 'register') {
    const columns = registerColumns(report);
    addSheet(wb, 'Register', fitted(columns, report.rows), report.rows);
    addSummary(wb, [
      ...totalsLines(report.totals, report.rates),
      ...(report.notRegistered > 0 ? [{ item: 'Not registered (not listed)', value: report.notRegistered, numFmt: COUNT }] : []),
      GAP,
      { item: 'Status', value: SI_REGISTER_STATUS_LABELS[report.filters.status] },
      department,
      { item: 'As of', value: shownDate(report.today) },
      ...ratesLines(report.rates),
      GAP,
      ...endLines(report),
    ]);
  } else if (report.view === 'contributions') {
    const columns = contributionColumns(report);
    const heads = shareHeads(report.rates);
    const ws = addSheet(wb, 'Contributions', fitted(columns, report.rows), report.rows);
    const t = report.totals;
    addTotalRow(ws, columns, report.rows.length, 'Total', { 'Insured wage': t.insuredWage, [heads.employee]: t.employeeInsurance, [heads.employer]: t.employerInsurance, 'Both shares': t.toPay });
    addSummary(wb, [
      { item: 'Month', value: monthName(report.month) },
      ...totalsLines(t, report.rates),
      { item: 'Joined in the month', value: t.joined, numFmt: COUNT },
      { item: 'Left in the month', value: t.left, numFmt: COUNT },
      ...(report.notRegistered > 0 ? [{ item: 'Not registered (not listed)', value: report.notRegistered, numFmt: COUNT }] : []),
      GAP,
      department,
      ...ratesLines(report.rates),
      { item: 'Shares', value: 'The whole month’s, joiners and leavers too, as payroll counts them' },
      { item: 'Payroll counts everyone as insured', value: yesNo(report.insureEveryone) },
      GAP,
      ...endLines(report),
    ]);
  } else {
    addSheet(wb, 'Missing data', fitted(MISSING_COLUMNS, report.rows), report.rows);
    const items = report.rows.flatMap((person) => person.missing.map((item) => ({ person, item })));
    addSheet(wb, 'Each missing item', fitted(ITEM_COLUMNS, items), items);
    addSummary(wb, [
      { item: 'Checked', value: report.checked, numFmt: COUNT },
      { item: 'Missing something', value: report.rows.length, numFmt: COUNT },
      ...Object.entries(report.byItem).map(([item, count]) => ({ item: SI_MISSING_LABELS[item as SiMissingItem], value: count, numFmt: COUNT })),
      GAP,
      department,
      { item: 'As of', value: shownDate(report.today) },
      { item: 'Checked who', value: 'Current full-time employees, and part-timers registered with social insurance' },
      GAP,
      ...endLines(report),
    ]);
  }
  return { fileName: siFileName(report), data: Buffer.from(await wb.xlsx.writeBuffer()) };
}
