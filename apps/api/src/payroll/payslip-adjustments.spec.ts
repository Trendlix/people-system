import type { PayrollAdjustmentItem } from '@trendlix/shared';
import { BONUS_DAY, payslipSource } from '../../test/fixtures/payslip.js';
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

describe('the register: the grid’s days, commission and settlements on Additions / Deductions (owner, 17 October 2026)', () => {
  const col = (header: string) => REGISTER_COLUMNS.find((c) => c.header === header)!;
  const lineOf = (source: ReturnType<typeof payslipSource>) => ({ ...source.line, name: source.line.nameEn, bankFile: null, onHold: false, comments: null });

  it('takes the bonus and penalty days from the Bonus (days) and Penalty (days), and lists each by type with its reason', () => {
    const penalty: PayrollAdjustmentItem = { id: 'p1', kind: 'deduction', type: 'penalty_days', taxed: false, amount: null, days: 1.5, reason: 'Late twice' };
    const line = lineOf(payslipSource('monthly', { terms: { adjustments: [BONUS_DAY, ...ADJUSTMENTS, penalty] } }));
    expect([col('Bonus days').value(line, 1), col('Bonus').value(line, 1), col('Penalty days').value(line, 1)]).toEqual([1, 640, 1.5]);
    expect(col('Penalties').value(line, 1)).toBe(line.result.penaltyCut);
    // the grid's commission and settlements: none since
    expect([col('Commission').value(line, 1), col('Settlements').value(line, 1)]).toEqual([null, null]);
    expect(col('Additions and deductions').value(line, 1)).toBe(
      `Bonus (days): 1 day, 640.00 (Campaign launch); Incentive: 1,500.00 (Campaign launch); Reimbursement: 320.75, not taxed (Taxi to the client); Loan installment: −1,000.00 (Car loan, 2 of 6); Penalty (days): 1.5 days, −${line.result.penaltyCut.toLocaleString('en-US', { minimumFractionDigits: 2 })} (Late twice)`,
    );
    expect(col('Additions and deductions').value(lineOf(payslipSource('monthly', { terms: { adjustments: [] } })), 1)).toBeNull();
  });

  it('a line saved before then: its days, commission and settlements as typed', () => {
    const line = lineOf(payslipSource('monthly', { terms: { adjustments: [] }, inputs: { bonusDays: 2, penaltyDays: null, commission: 1250, settlements: -300 } }));
    expect(['Bonus days', 'Bonus', 'Penalty days', 'Commission', 'Settlements'].map((h) => col(h).value(line, 1))).toEqual([2, 1280, null, 1250, -300]);
  });

  it('has the attendance cut the CEO waived after the cut (17 October 2026)', () => {
    const headers = REGISTER_COLUMNS.map((c) => c.header);
    expect(headers.slice(headers.indexOf('Attendance cut'), headers.indexOf('Attendance cut') + 2)).toEqual(['Attendance cut', 'Attendance waived']);
    const line = lineOf(payslipSource('monthly', { inputs: { workedHours: 149.6, attendanceWaived: true } }));
    expect([col('Attendance cut').value(line, 1), col('Attendance waived').value(line, 1)]).toEqual([0, 2880]);
  });
});
