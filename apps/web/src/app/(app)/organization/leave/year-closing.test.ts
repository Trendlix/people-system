import { describe, expect, it } from 'vitest';
import type { YearClosingRow } from '../../../../lib/types';
import {
  balanceSplit,
  carriedText,
  carryRest,
  cellName,
  checkRow,
  closingBody,
  CLOSES_CONFIDENTIAL,
  closingConfirmText,
  closingDays,
  closingDoneText,
  closingExcludedText,
  closingTotals,
  closingYear,
  payAll,
  payoutText,
  startingSplit,
} from './year-closing';

// The Year Closing (owner, 18 October 2026: "make it with decision with the year closing"; Labour Law Art. 125): invented
// employees and figures.
const row = (r: Partial<YearClosingRow>): YearClosingRow => ({
  employee: { id: 'e1', fullNameEn: 'Nour Adel', department: 'Marketing', team: null },
  unused: 10,
  carriedByYear: { '2024': 3, '2025': 2 },
  mustSettle: 3,
  carry: 7,
  pay: 3,
  dayRate: 500,
  payAmount: 1500,
  ...r,
});

const form = (entries: [string, string][]) => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};

describe('the year of the closing', () => {
  it('is the address’s up to this year, else the year just ended until March, then this year', () => {
    expect(closingYear({ year: '2025' }, '2026-10-18')).toBe(2025);
    expect(closingYear({ year: '2027' }, '2026-10-18')).toBe(2026);
    expect(closingYear({}, '2027-02-10')).toBe(2026);
    expect(closingYear({}, '2026-10-18')).toBe(2026);
  });
});

describe('each employee’s row', () => {
  it('reads days in whole or half days, a balance overdrawn below 0', () => {
    expect(closingDays('2.5')).toBe(2.5);
    expect(closingDays('')).toBe(0);
    expect(closingDays('-1')).toBe(-1);
    expect(closingDays('٣')).toBe(3);
    expect(closingDays('2.25')).toBeNaN();
    expect(closingDays('a')).toBeNaN();
  });

  it('fills the other cell in, so the two add up to the days unused', () => {
    const r = row({});
    expect(balanceSplit(r, { carry: '7', pay: '4' }, 'pay')).toEqual({ carry: '6', pay: '4' });
    expect(balanceSplit(r, { carry: '2.5', pay: '3' }, 'carry')).toEqual({ carry: '2.5', pay: '7.5' });
    // more than unused, or not days: the other stays
    expect(balanceSplit(r, { carry: '7', pay: '12' }, 'pay')).toEqual({ carry: '7', pay: '12' });
    expect(balanceSplit(r, { carry: '7', pay: 'x' }, 'pay')).toEqual({ carry: '7', pay: 'x' });
  });

  it('can’t lose leave, and pays the days carried for three years (Art. 125)', () => {
    const r = row({});
    expect(checkRow(r, startingSplit(r))).toEqual({ carry: 7, pay: 3, problems: [], amount: 1500 });
    expect(checkRow(r, { carry: '5', pay: '3' }).problems).toEqual(["The days carried and paid must add up to the 10 days unused: leave can't be lost (Art. 125)."]);
    expect(checkRow(r, { carry: '9', pay: '1' }).problems).toEqual(['3 days have been carried for three years and must be paid now (Art. 125): pay at least 3 days.']);
    expect(checkRow(r, { carry: '9', pay: '1' }).amount).toBe(500);
  });

  it('carries a balance overdrawn as it is, nothing paid', () => {
    const over = row({ unused: -2, mustSettle: 0, carry: -2, pay: 0 });
    expect(checkRow(over, startingSplit(over)).problems).toEqual([]);
    expect(payAll(over)).toEqual({ carry: '-2', pay: '0' });
    expect(carryRest(over)).toEqual({ carry: '-2', pay: '0' });
  });

  it('fills every row in at once: all paid, or all carried but what must be paid', () => {
    expect(payAll(row({}))).toEqual({ carry: '0', pay: '10' });
    expect(carryRest(row({}))).toEqual({ carry: '7', pay: '3' });
    expect(carryRest(row({ mustSettle: 0 }))).toEqual({ carry: '10', pay: '0' });
  });
});

describe('the closing as a whole', () => {
  const rows = [row({}), row({ employee: { id: 'e2', fullNameEn: 'Karim Nabil', department: null, team: null }, unused: 4.5, mustSettle: 0, carry: 4.5, pay: 0, dayRate: 300 })];

  it('adds up the days and what the pay comes to, and counts the rows to put right', () => {
    const checks = [checkRow(rows[0], { carry: '7', pay: '3' }), checkRow(rows[1], { carry: '2', pay: '2' })];
    expect(closingTotals(rows, checks)).toEqual({ unused: 14.5, carry: 9, pay: 5, amount: 2100, problems: 1 });
  });

  it('is sent as a row for each employee, with their days carried and paid', () => {
    const body = closingBody(
      form([
        ['employeeId', 'e1'],
        [cellName('carry', 'e1'), '7'],
        [cellName('pay', 'e1'), '3'],
        ['employeeId', 'e2'],
        [cellName('carry', 'e2'), '4.5'],
        [cellName('pay', 'e2'), ''],
      ]),
    );
    expect(body).toEqual({
      body: {
        rows: [
          { employeeId: 'e1', carry: 7, pay: 3 },
          { employeeId: 'e2', carry: 4.5, pay: 0 },
        ],
      },
      errors: [],
    });
    expect(closingBody(form([])).errors).toEqual(['There is no one to close the year for.']);
    // only C-level people left out for the caller (19 October 2026): closed by default, with no rows sent
    expect(closingBody(form([[CLOSES_CONFIDENTIAL, '1']]))).toEqual({ body: { rows: [] }, errors: [] });
    expect(closingBody(form([['employeeId', 'e1'], [cellName('pay', 'e1'), 'x']])).errors).toEqual(['Enter the days carried and paid in whole or half days in every row.']);
  });

  it('words the days carried by year, and what was just done', () => {
    expect(carriedText({ '2025': 2, '2024': 3, '2023': 0 })).toBe('2024: 3 · 2025: 2');
    expect(carriedText({})).toBeNull();
    expect(closingDoneText({ done: 'closed' }, 2026)).toContain('2026 is closed');
    expect(closingDoneText({ done: 'reopened' }, 2026)).toContain('open again');
    expect(closingDoneText({}, 2026)).toBeNull();
  });

  it('says where a closed year’s payout stands', () => {
    expect(payoutText({ adjustmentId: 'a', month: '2027-01', status: 'pending' })).toBe('To be paid with the January 2027 payroll');
    expect(payoutText({ adjustmentId: 'a', month: '2027-01', status: 'applied' })).toBe('Paid with the January 2027 payroll');
    expect(payoutText({ adjustmentId: 'a', month: '2027-02', status: 'cancelled' })).toBe('Cancelled on the February 2027 payroll');
    expect(payoutText(null)).toBeNull();
    expect(payoutText(undefined)).toBeNull();
  });
});

describe('the C-level people left out (owner, 19 October 2026: "make C level Employees details not visible to HR")', () => {
  it('are said to be left out, and, while the year is open, closed by default', () => {
    expect(closingExcludedText(2, 2026, false)).toBe(
      'C-level (2 people) are left out: only the CEO and the Super Admin see their leave. Closing the year settles theirs by default: the days that must be paid now are paid, the rest carried into 2027.',
    );
    expect(closingExcludedText(1, 2026, true)).toBe('C-level (1 person) is left out: only the CEO and the Super Admin see their leave.');
  });

  it('say nothing when none are, or an older API doesn’t say', () => {
    expect(closingExcludedText(0, 2026, false)).toBeNull();
    expect(closingExcludedText(undefined, 2026, false)).toBeNull();
  });

  it('are in what Close the year asks first', () => {
    const totals = { carry: 7, pay: 3, amount: 1500 };
    expect(closingConfirmText(2026, totals)).toBe('Close 2026? 7 days are carried into 2027, and 3 days are paid (EGP 1,500.00) with the payroll of January 2027, or the next one open.');
    expect(closingConfirmText(2026, totals, 1)).toBe(
      'Close 2026? 7 days are carried into 2027, and 3 days are paid (EGP 1,500.00) with the payroll of January 2027, or the next one open. C-level (1 person), left out here, is closed by default: the days that must be paid now are paid, the rest carried into 2027.',
    );
  });
});
