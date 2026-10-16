import type { PayrollAdjustmentItem } from '@trendlix/shared';
import { payslipSource } from '../../test/fixtures/payslip.js';
import { payslipContent, withoutMarks, type PayslipRow } from './payslip-content.js';
import { REGISTER_COLUMNS } from './register.js';

// The month's additions and deductions on the payslip and the register (owner, 17 October 2026: Additions /
// Deductions): each a row of its own by its type, with its reason, the additions with the earnings (an untaxed one says
// so) and the deductions with the deductions; in Arabic by their Arabic names; and columns of their own on the register.
// Every figure is invented.

const ADJUSTMENTS: PayrollAdjustmentItem[] = [
  { id: 'a1', kind: 'addition', type: 'incentive', taxed: true, amount: 1500, reason: 'Campaign launch' },
  { id: 'a2', kind: 'addition', type: 'reimbursement', taxed: false, amount: 320.75, reason: 'Taxi to the client' },
  { id: 'a3', kind: 'deduction', type: 'loan_installment', taxed: false, amount: 1000, reason: 'Car loan, 2 of 6' },
];

const sum = (rows: readonly PayslipRow[]) => rows.reduce((cents, r) => cents + Math.round(r.value * 100), 0) / 100;

describe('payslipContent: the month’s additions and deductions', () => {
  const source = payslipSource('monthly', { terms: { adjustments: ADJUSTMENTS } });
  const r = source.line.result;

  it('lists each addition with the earnings and each deduction with the deductions, by type, with its reason', () => {
    const c = payslipContent(source, 'en');
    expect(c.earnings!.rows.slice(-2)).toEqual([
      { label: 'Incentive', note: 'Campaign launch', amount: '1,500.00', value: 1500 },
      { label: 'Reimbursement', note: 'Taxi to the client · Not taxed', amount: '320.75', value: 320.75 },
    ]);
    expect(c.deductions!.rows.at(-1)).toEqual({ label: 'Loan installment', note: 'Car loan, 2 of 6', amount: '1,000.00', value: 1000 });
    // the rows still add up: the earnings with the untaxed addition, the deductions with the loan's installment
    expect(sum(c.earnings!.rows)).toBe(c.earnings!.total.value);
    expect(c.earnings!.total.value).toBe(Math.round((r.earned + r.allowances + 320.75) * 100) / 100);
    expect(sum(c.deductions!.rows)).toBe(r.deductions);
    expect(c.deductions!.rows.map((x) => x.label)).not.toContain('Health insurance');
    expect(Math.round((c.earnings!.total.value - c.deductions!.total.value) * 100) / 100).toBe(r.net);
  });

  it('in Arabic, by their Arabic names, the reason typed in English kept left to right', () => {
    const c = payslipContent(source, 'ar');
    const earnings = c.earnings!.rows.slice(-2);
    expect(earnings.map((x) => x.label)).toEqual(['حافز', 'استرداد مصروفات']);
    expect(withoutMarks(earnings[1].note!)).toBe('Taxi to the client، غير خاضع للضريبة');
    expect(earnings[0].note).not.toBe('Campaign launch'); // isolated left to right
    expect(withoutMarks(earnings[0].note!)).toBe('Campaign launch');
    expect(c.deductions!.rows.at(-1)!.label).toBe('قسط قرض');
  });

  it('a payslip without any is as before', () => {
    const c = payslipContent(payslipSource('monthly'), 'en');
    expect(c.earnings!.rows.map((x) => x.label)).not.toContain('Incentive');
  });
});

describe('the register’s columns for them', () => {
  it('has the taxed additions after the settlements, the deductions after the penalties, the untaxed additions before the net', () => {
    const headers = REGISTER_COLUMNS.map((c) => c.header);
    expect(headers.slice(headers.indexOf('Settlements'), headers.indexOf('Settlements') + 2)).toEqual(['Settlements', 'Additions (taxed)']);
    expect(headers.slice(headers.indexOf('Penalties'), headers.indexOf('Net') + 1)).toEqual(['Penalties', 'Deductions (after tax)', 'Additions (not taxed)', 'Net']);
    const source = payslipSource('monthly', { terms: { adjustments: ADJUSTMENTS } });
    const line = { ...source.line, name: source.line.nameEn, bankFile: null, onHold: false, comments: null };
    const value = (header: string) => REGISTER_COLUMNS.find((c) => c.header === header)!.value(line, 1);
    expect([value('Additions (taxed)'), value('Deductions (after tax)'), value('Additions (not taxed)')]).toEqual([1500, 1000, 320.75]);
    // a line worked out before 17 October 2026: none
    const older = { ...line, result: { ...line.result, additionsTaxed: undefined, additionsUntaxed: undefined, adjustmentDeductions: undefined } };
    expect(REGISTER_COLUMNS.find((c) => c.header === 'Additions (taxed)')!.value(older, 1)).toBe(0);
  });
});
