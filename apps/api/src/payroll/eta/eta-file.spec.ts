import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lawRatesFor, monthlySalaryTax, type PaidAdjustment, type PayrollResult, type PayrollTerms } from '@trendlix/shared';
import JSZip from 'jszip';
import { columnLetter, columnNumber, ETA, ETA_AMOUNT_COLUMNS, ETA_CODES, etaDate, etaPhone, etaRow, etaWorkbook, NO_DATE, type EtaPerson, type EtaRow } from './eta-file.js';
import { etaTax } from './eta-tax.js';

const TEMPLATE = fileURLToPath(new URL('../../../assets/eta/eta-salary-tax-private-sector-2026.xlsx', import.meta.url));
const law = lawRatesFor(2026);
const cents = (n: number) => Math.round(n * 100) / 100;

// A month on a 20,000 gross (80% basic), 500 overtime, a commission and an incentive, a taxable 1,000 allowance and an
// untaxed 500 one, an untaxed reimbursement, and the deductions: the medical share before tax, an advance, a penalty.
function sampleLine(): { terms: PayrollTerms; result: PayrollResult } {
  const adjustments: PaidAdjustment[] = [
    { id: 'a1', kind: 'addition', type: 'commission', taxed: true, amount: 600, reason: 'Q3 sales' },
    { id: 'a2', kind: 'addition', type: 'incentive', taxed: true, amount: 400, reason: 'Launch' },
    { id: 'a3', kind: 'addition', type: 'reimbursement', taxed: false, amount: 250, reason: 'Taxi' },
    { id: 'd1', kind: 'deduction', type: 'recurring', taxed: false, amount: 300, reason: 'Medical share', beforeTax: true },
    { id: 'd2', kind: 'deduction', type: 'advance_recovery', taxed: false, amount: 1000, reason: 'Advance' },
    { id: 'd3', kind: 'deduction', type: 'penalty', taxed: false, amount: 200, reason: 'Late report' },
  ];
  const fixed = 16_000;
  const variable = 4_000;
  const overtime = 500;
  const additionsTaxed = 1_000;
  const earned = fixed + variable + overtime + additionsTaxed;
  const taxableAllowances = 1_000;
  const allowances = 1_500;
  const insuredWage = 12_000;
  const employeeInsurance = cents(insuredWage * law.employeeInsuranceRate);
  const tax = monthlySalaryTax({ taxedPay: earned + taxableAllowances, employeeInsurance, beforeTax: 300 }, law);
  const adjustmentDeductions = 1_500;
  const deductions = cents(employeeInsurance + tax.healthInsurance + tax.monthlyTax + tax.martyrsFund + adjustmentDeductions);
  const net = cents(earned + allowances + 250 - deductions);
  const terms = {
    year: 2026,
    payBasis: 'monthly',
    gross: 20_000,
    basicPercent: 80,
    hourlyRate: null,
    allowances: [
      { amount: 1_000, taxable: true, insured: false },
      { amount: 500, taxable: false, insured: false },
    ],
    paidDays: 30,
    statutory: true,
    insured: true,
    insuredWage,
    hoursPerDay: 8,
  } as unknown as PayrollTerms;
  const result = {
    fixed,
    variable,
    parts: [],
    absentHours: 0,
    leaveHours: 0,
    expectedHours: null,
    attendanceRatio: null,
    attendanceScore: 1,
    kpiScore: 1,
    attendanceCut: 0,
    kpiCut: 0,
    noShowCut: 0,
    overtime,
    bonus: 0,
    earned,
    allowances,
    taxableAllowances,
    insuredWage,
    employeeInsurance,
    employerInsurance: cents(insuredWage * law.employerInsuranceRate),
    monthlyTaxable: tax.monthlyTaxable,
    annualNetIncome: tax.annualNetIncome,
    monthlyTax: tax.monthlyTax,
    martyrsFund: tax.martyrsFund,
    penaltyCut: 0,
    deductions,
    net,
    released: 0,
    transfer: net,
    companyCost: 0,
    additionsTaxed,
    additionsUntaxed: 250,
    adjustmentDeductions,
    beforeTaxDeductions: 300,
    taxableLowered: tax.beforeTax ?? 0,
    adjustments,
    warnings: [],
  } as PayrollResult;
  return { terms, result };
}

const person = (over: Partial<EtaPerson> = {}): EtaPerson => ({
  code: 'EMP-0142',
  nameAr: 'عمر خالد محمود',
  egyptian: true,
  nationalId: '29403140101234',
  mobile: '+20 10 1234 5678',
  jobTitle: 'مطور واجهات أمامية أول',
  employer: 'تريندليكس',
  disability: false,
  insuranceNo: '0123456',
  insuranceStart: '2023-01-03',
  comprehensiveWage: null,
  endOfService: null,
  ...over,
});

const num = (row: EtaRow, col: string) => row[col] as number;
const first = (p = person(), line = sampleLine()) => etaRow(p, line, [], law);

describe('etaRow', () => {
  it('fills the employee columns with ETA codes, text IDs, YYYYMMDD dates and a full month', () => {
    const { row } = first();
    expect(row[ETA.code]).toBe('EMP-0142');
    expect(row[ETA.name]).toBe('عمر خالد محمود');
    expect(row[ETA.nationality]).toBe(ETA_CODES.egyptianWithContract);
    expect(row[ETA.nationalId]).toBe('29403140101234');
    expect(row[ETA.phone]).toBe('01012345678');
    expect(row[ETA.taxTreatment]).toBe(ETA_CODES.permanentStaff);
    expect(row[ETA.daysWorked]).toBe(30);
    expect(row[ETA.insuranceStatus]).toBe(ETA_CODES.insured);
    expect(row[ETA.insuranceNo]).toBe('0123456');
    expect(row[ETA.insuranceStart]).toBe('20230103');
    expect(row[ETA.endOfService]).toBe(NO_DATE);
    expect(row[ETA.insuranceEnd]).toBe(NO_DATE);
    expect(row[ETA.healthInsuranceStatus]).toBe(ETA_CODES.healthNotSubject);
    expect(row[ETA.comprehensiveWage]).toBe(21_500); // the gross and the allowances
    expect(row[ETA.uninsuredAllowances]).toBe(1_500);
    expect(row[ETA.insuredWage]).toBe(12_000);
  });

  it("files 30 days whatever the days paid: ETA doesn't read part of a month", () => {
    const line = sampleLine();
    line.terms.paidDays = 6;
    const { row } = first(person(), line);
    expect(row[ETA.daysWorked]).toBe(30);
    expect(num(row, ETA.personalExemption)).toBe(1_666.67);
  });

  it('writes every amount ETA’s export writes, 0 when there is nothing, and leaves the text columns that do not apply empty', () => {
    const { row } = first();
    for (const col of ETA_AMOUNT_COLUMNS) expect(typeof row[col], `column ${col}`).toBe('number');
    expect(ETA_AMOUNT_COLUMNS).toContain('AG'); // profit share
    expect(row.AG).toBe(0);
    expect(row.CS).toBe(0); // stamps
    expect(row.Z).toBe(0); // wives, for the comprehensive health insurance
    for (const col of ['A', 'F', 'G', 'I', 'J', 'N']) expect(row, `column ${col}`).not.toHaveProperty(col);
  });

  it('splits the pay taxed into ETA columns that add up to the total', () => {
    const { result } = sampleLine();
    const { row } = first();
    expect(num(row, ETA.basic)).toBe(16_000);
    expect(num(row, ETA.commissions)).toBe(600);
    expect(num(row, ETA.bonuses)).toBe(4_900); // variable 4,000 + overtime 500 + the incentive 400
    expect(num(row, ETA.taxableAllowances)).toBe(1_000);
    expect(num(row, ETA.totalEarnings)).toBe(cents(result.earned + result.taxableAllowances));
    const parts = num(row, ETA.basic) + num(row, ETA.bonuses) + num(row, ETA.commissions) + num(row, ETA.leavePayout) + num(row, ETA.taxableAllowances);
    expect(cents(parts)).toBe(num(row, ETA.totalEarnings));
  });

  it("the base and the tax ETA's way: the exemption and the medical share before tax, the year's cumulative tax", () => {
    const { result } = sampleLine();
    const { row, figures, payrollTax } = first();
    expect(num(row, ETA.personalExemption)).toBe(1_666.67);
    expect(num(row, ETA.healthPremiums)).toBe(300); // the medical share, before tax
    expect(num(row, ETA.totalDeductions)).toBe(cents(result.employeeInsurance + 1_666.67 + 300));
    expect(num(row, ETA.periodBase)).toBe(cents(num(row, ETA.totalEarnings) - num(row, ETA.totalDeductions)));
    const expected = etaTax([], { base: num(row, ETA.periodBase) }, law);
    expect(figures).toEqual(expected);
    expect(num(row, ETA.annualBase)).toBe(expected.annualBase);
    expect(num(row, ETA.cumulativeTax)).toBe(expected.cumulativeTax);
    expect(num(row, ETA.cumulativeTaxTotal)).toBe(expected.cumulativeTax);
    expect(num(row, ETA.periodTax)).toBe(expected.periodTax);
    expect(num(row, ETA.periodTaxTreatments)).toBe(expected.periodTax);
    expect(num(row, ETA.earlierTax)).toBe(0);
    // on a steady month, within piasters of what the payroll deducted
    expect(payrollTax).toBe(result.monthlyTax);
    expect(Math.abs(payrollTax - expected.periodTax)).toBeLessThan(1);
  });

  it('after earlier months of the year, the cumulative tax and the earlier periods’ share', () => {
    const { row, figures } = etaRow(person(), sampleLine(), [{ base: 10_000 }, { base: 10_000 }], law);
    expect(figures.months).toBe(3);
    expect(num(row, ETA.earlierTax)).toBe(figures.earlierTax);
    expect(num(row, ETA.cumulativeTax)).toBe(cents(figures.earlierTax + figures.periodTax));
    expect(figures.earlierTax).toBe(etaTax([{ base: 10_000 }], { base: 10_000 }, law).cumulativeTax);
  });

  it("comes to the payslip's net with ETA's tax in it: earnings and untaxed additions less every deduction", () => {
    const { result } = sampleLine();
    const { row, figures } = first();
    expect(num(row, ETA.martyrsFund)).toBe(result.martyrsFund);
    expect(num(row, ETA.martyrsContribution)).toBe(result.martyrsFund); // the same amount in both, as ETA's export has it
    expect(num(row, ETA.otherAdditions)).toBe(750); // the untaxed allowance 500 and the reimbursement 250
    expect(num(row, ETA.advanceInstallments)).toBe(1_000);
    expect(num(row, ETA.penalties)).toBe(200);
    expect(num(row, ETA.otherDeductions)).toBe(0); // the medical share is all in BL
    const net =
      num(row, ETA.totalEarnings) +
      num(row, ETA.leavePayoutUntaxed) +
      num(row, ETA.otherAdditions) -
      num(row, ETA.employeeInsurance) -
      num(row, ETA.healthInsurance) -
      num(row, ETA.healthPremiums) -
      num(row, ETA.periodTax) -
      num(row, ETA.martyrsFund) -
      num(row, ETA.advanceInstallments) -
      num(row, ETA.penalties) -
      num(row, ETA.otherDeductions);
    expect(cents(net)).toBe(num(row, ETA.netPay));
    expect(num(row, ETA.netPay)).toBe(cents(result.net + result.monthlyTax - figures.periodTax));
    expect(num(row, ETA.transferred)).toBe(result.transfer); // what the bank paid
    expect(num(row, ETA.companyInsurance)).toBe(result.employerInsurance);
  });

  it('marks someone not insured, a leaver, someone with a disability, and a foreigner', () => {
    const line = sampleLine();
    line.terms.insured = false;
    line.result.insuredWage = 0;
    const { row } = etaRow(person({ disability: true, egyptian: false, endOfService: '2026-10-16' }), line, [], law);
    expect(row[ETA.insuranceStatus]).toBe(ETA_CODES.notInsured);
    expect(row).not.toHaveProperty(ETA.insuranceNo);
    expect(row).not.toHaveProperty(ETA.insuranceStart);
    expect(row[ETA.insuredWage]).toBe(0);
    expect(row[ETA.endOfService]).toBe('20261016');
    expect(row[ETA.insuranceEnd]).toBe(NO_DATE); // not insured: no insurance to end
    expect(row[ETA.taxTreatment]).toBe(ETA_CODES.specialNeeds);
    expect(row[ETA.nationality]).toBe(ETA_CODES.foreignWithContract);
    expect(row).not.toHaveProperty(ETA.nationalId);
  });
});

describe('formats', () => {
  it('writes dates as YYYYMMDD and phones with the leading 0, digits only', () => {
    expect(etaDate('2000-01-01')).toBe('20000101');
    expect(etaPhone('+20 10 1234 5678')).toBe('01012345678');
    expect(etaPhone('0020 111 222 3333')).toBe('01112223333');
    expect(etaPhone('010-1234-5678')).toBe('01012345678');
    expect(etaPhone(null)).toBeNull();
    expect(columnNumber('A')).toBe(1);
    expect(columnNumber('AZ')).toBe(52);
    expect(columnNumber('CT')).toBe(98);
    for (const c of ['A', 'Z', 'AA', 'AZ', 'BA', 'CT']) expect(columnLetter(columnNumber(c))).toBe(c);
  });
});

describe('etaWorkbook', () => {
  const part = (xml: string, tag: string) => {
    const start = xml.indexOf(`<${tag}`);
    const end = xml.indexOf(`</${tag}>`, start);
    return end > start ? xml.slice(start, end) : xml.slice(start, xml.indexOf('/>', start) + 2);
  };
  const rowXml = (xml: string, n: number) => new RegExp(`<row r="${n}"[\\s\\S]*?</row>`).exec(xml)?.[0];
  const rows = () => [first().row, etaRow(person({ code: 'EMP-0007', nameAr: 'سارة & <علي>' }), sampleLine(), [], law).row];

  it("keeps ETA's template as it is and writes one row per employee from row 3", async () => {
    const out = await JSZip.loadAsync(await etaWorkbook(rows()));
    const tpl = await JSZip.loadAsync(readFileSync(TEMPLATE));
    const sheet = await out.file('xl/worksheets/sheet1.xml')!.async('string');
    const original = await tpl.file('xl/worksheets/sheet1.xml')!.async('string');

    // the two header rows, the view, the columns, the input checks and the page set-up, byte for byte
    expect(rowXml(sheet, 1)).toBe(rowXml(original, 1));
    expect(rowXml(sheet, 2)).toBe(rowXml(original, 2));
    for (const tag of ['sheetViews', 'cols', 'dataValidations']) expect(part(sheet, tag)).toBe(part(original, tag));
    expect(part(sheet, 'pageMargins')).toBe(part(original, 'pageMargins'));
    expect(sheet).toContain('rightToLeft="1"');
    expect((sheet.match(/<dataValidation /g) ?? []).length).toBe(62);
    // every other part of the file untouched
    for (const name of Object.keys(tpl.files).filter((n) => !n.endsWith('/') && n !== 'xl/worksheets/sheet1.xml' && n !== 'xl/sharedStrings.xml')) {
      expect(await out.file(name)!.async('uint8array'), name).toEqual(await tpl.file(name)!.async('uint8array'));
    }
    // the rows
    expect(sheet).toContain('<dimension ref="A1:CT4"/>');
    expect(rowXml(sheet, 3)).toBeDefined();
    expect(rowXml(sheet, 4)).toBeDefined();
    expect(rowXml(sheet, 5)).toBeUndefined();
    expect(sheet).toMatch(/<c r="E3" s="5" t="s"><v>\d+<\/v><\/c>/); // the national ID as text
    expect(sheet).toContain('<c r="D3" s="6"><v>1</v></c>'); // a code, shown as 01
    expect(sheet).toContain('<c r="O3" s="4"><v>30</v></c>');
    expect(sheet).toContain('<c r="AG3" s="4"><v>0</v></c>'); // an amount with nothing in it
  });

  it('reads back: the sheet name, the headers and every value written, text resolved through the shared strings', async () => {
    // ExcelJS can't open ETA's template at all (its input checks span whole columns): read the cells from the XML
    const written = rows();
    const zip = await JSZip.loadAsync(await etaWorkbook(written));
    const workbook = await zip.file('xl/workbook.xml')!.async('string');
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    const sst = await zip.file('xl/sharedStrings.xml')!.async('string');
    const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    const strings = [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unescape([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('')));
    expect(Number(/uniqueCount="(\d+)"/.exec(sst)?.[1])).toBe(strings.length);
    const cell = (ref: string): string | number | null => {
      const m = new RegExp(`<c r="${ref}"([^>]*)>(?:<v>([^<]*)</v>)?</c>`).exec(sheet);
      if (!m?.[2]) return null;
      return /t="s"/.test(m[1]) ? strings[Number(m[2])] : Number(m[2]);
    };
    expect(workbook).toContain('name="نموذج القطاع الخاص"');
    expect(cell('C1')).toBe('اسم الموظف');
    expect(cell('AZ2')).toBe('DTE295');
    expect(cell('B3')).toBe('EMP-0142');
    expect(cell('E3')).toBe('29403140101234');
    expect(cell('H3')).toBe('01012345678');
    expect(cell('Q3')).toBe('0123456');
    expect(cell('R3')).toBe('20230103');
    expect(cell('T3')).toBe(NO_DATE);
    expect(cell('C4')).toBe('سارة & <علي>');
    expect(cell('AZ3')).toBe(written[0][ETA.totalEarnings]);
    expect(cell('CC4')).toBe(written[1][ETA.netPay]);
    expect(cell('BF3')).toBe(1_666.67);
    expect(cell('AG3')).toBe(0);
  });
});
