import { crc32, deflateSync } from 'node:zlib';
import {
  EMPTY_PAYROLL_INPUTS,
  lawRatesFor,
  PAYROLL_RULE_DEFAULTS,
  payrollLine,
  type PayrollAdjustmentItem,
  type PayrollRules,
  type PayrollTerms,
  type SavedPayrollInputs,
} from '@trendlix/shared';
import type { PayslipSource } from '../../src/payroll/payslip-content.js';

// Payslips for the tests (owner's decisions, 16 October 2026): the payslip proposal's two people, a monthly salary and
// pay by the hour, their figures worked out by payrollLine itself so every row adds up. Everyone is invented.

/** Mariam's bonus day (owner, 17 October 2026: entered on Additions / Deductions as a Bonus (days)). */
export const BONUS_DAY: PayrollAdjustmentItem = { id: 'adj-bonus-day', kind: 'addition', type: 'bonus_days', taxed: true, amount: null, days: 1, reason: 'Campaign launch' };

/** Youssef's correction (a settlement until 17 October 2026). */
export const CORRECTION: PayrollAdjustmentItem = { id: 'adj-correction', kind: 'addition', type: 'correction', taxed: true, amount: 450, reason: 'September’s hours' };

/** Mariam: a monthly salary all October, insured, two allowances (one not taxed), KPIs below 80%, a bonus day; 8-hour days. */
export const MONTHLY_TERMS: PayrollTerms = {
  year: 2026,
  payBasis: 'monthly',
  gross: 24000,
  basicPercent: 80,
  hourlyRate: null,
  allowances: [
    { name: 'Transportation allowance', amount: 1500, taxable: false, insured: false },
    { name: 'Mobile allowance', amount: 500, taxable: true, insured: false },
  ],
  paidDays: 30,
  statutory: true,
  insured: true,
  insuredWage: 16700,
  hoursPerDay: 8,
  adjustments: [BONUS_DAY],
};

export const MONTHLY_INPUTS: SavedPayrollInputs = {
  ...EMPTY_PAYROLL_INPUTS,
  workedHours: 165.5,
  expectedHours: 176,
  softSkills: 70,
  performance: 65,
  clientSatisfaction: 72,
  released: 2000,
};

/** Youssef: part-time by the hour, not registered with social insurance, a correction, paid to QNB by IBAN. */
export const HOURLY_TERMS: PayrollTerms = {
  year: 2026,
  payBasis: 'hourly',
  gross: 13000,
  basicPercent: 80,
  hourlyRate: 150,
  allowances: [],
  paidDays: 30,
  statutory: true,
  insured: false,
  insuredWage: 0,
  hoursPerDay: null,
  adjustments: [CORRECTION],
};

export const HOURLY_INPUTS: SavedPayrollInputs = { ...EMPTY_PAYROLL_INPUTS, workedHours: 92.5 };

/** A payslip source: Mariam's (monthly) or Youssef's (hourly), with the terms, inputs or rules changed as given. */
export function payslipSource(
  kind: 'monthly' | 'hourly',
  change: { terms?: Partial<PayrollTerms>; inputs?: Partial<SavedPayrollInputs>; rules?: Partial<PayrollRules>; source?: Partial<PayslipSource> } = {},
): PayslipSource {
  const monthly = kind === 'monthly';
  const rules = { ...PAYROLL_RULE_DEFAULTS, ...change.rules };
  const terms = { ...(monthly ? MONTHLY_TERMS : HOURLY_TERMS), ...change.terms };
  const inputs = { ...(monthly ? MONTHLY_INPUTS : HOURLY_INPUTS), ...change.inputs };
  const lawRates = lawRatesFor(terms.year);
  const result = payrollLine(terms, inputs, rules, lawRates);
  return {
    run: { month: '2026-10', paidOn: '2026-10-29', approvedOn: '2026-10-27', rules, lawRates },
    line: monthly
      ? {
          employeeCode: 'EMP-0142',
          nameEn: 'Mariam Adel Hassan',
          department: 'Marketing › Content Team',
          jobTitle: 'Senior Content Writer',
          employmentType: 'full_time',
          payBasis: 'monthly',
          terms,
          inputs,
          result,
          bankShort: 'CIB',
          accountNo: '100045214821',
          iban: null,
        }
      : {
          employeeCode: 'EMP-0187',
          nameEn: 'Youssef Tarek Fahmy',
          department: 'Marketing › Video Team',
          jobTitle: 'Video Editor',
          employmentType: 'part_time',
          payBasis: 'hourly',
          terms,
          inputs,
          result,
          bankShort: 'QNB',
          accountNo: null,
          iban: 'EG380019000500000000263180937',
        },
    employee: monthly
      ? { nameAr: 'مريم عادل حسن', insuranceNo: '28461937', joinDate: '2025-03-01', jobTitleAr: 'كاتبة محتوى أولى', departmentAr: 'التسويق › فريق المحتوى' }
      : { nameAr: 'يوسف طارق فهمي', insuranceNo: null, joinDate: '2026-02-15', jobTitleAr: 'محرر فيديو', departmentAr: 'التسويق › فريق الفيديو' },
    allowancesAr: { 'Transportation allowance': 'بدل انتقال', 'Mobile allowance': 'بدل هاتف محمول' },
    company: { nameEn: 'TrendLIX', city: 'Cairo', taxRegNo: '512-384-907' },
    yearToDate: monthly
      ? { from: '2026-01', to: '2026-10', earnings: 252876, tax: 33180.45, insurance: 18370, net: 197699.59 }
      : { from: '2026-02', to: '2026-10', earnings: 118240, tax: 12905.3, insurance: 0, net: 105275.53 },
    issuedOn: '2026-10-29',
    ...change.source,
  };
}

/** A PNG of `width` × `height` (RGB, 8 bits), each pixel as `pixel` paints it: a company logo for the tests. */
export function pngImage(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits a channel
  header[9] = 2; // RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set(pixel(x, y), y * (width * 3 + 1) + 1 + x * 3);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
