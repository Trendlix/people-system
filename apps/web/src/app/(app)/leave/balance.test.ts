import { describe, expect, it } from 'vitest';
import type { AnnualLeaveBalance } from '../../../lib/types';
import { adjustmentBody, adjustmentDays, annualFigures, availableText, balanceYear, seesLeaveBalance, signedDays, typeLeftText } from './balance';

// an invented balance (Labour Law 14/2025, Art. 124: a joiner's first year, pro rata, usable after six months)
const annual: AnnualLeaveBalance = { entitlement: 7.5, usableFrom: '2026-09-01', carriedIn: 0, adjustments: -1, taken: 2, booked: 1, pending: 0.5, available: 3 };

const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
};

describe('the annual balance (owner, 18 October 2026: "can you apply the leaves according to the law?")', () => {
  it('lists its figures in the order they add up, with when a first year may be used', () => {
    expect(annualFigures(annual, 2026).map((f) => [f.label, f.value, f.note])).toEqual([
      ['Entitlement 2026', '7.5', 'Usable from 01/09/2026'],
      ['Carried in', '0', null],
      ['Adjusted by HR', '−1', null],
      ['Taken', '2', null],
      ['Booked', '1', 'Approved, to come'],
      ['Waiting', '0.5', 'Being decided'],
      ['Available', '3', null],
    ]);
    expect(annualFigures({ ...annual, usableFrom: '2026-01-01', carriedIn: 4 }, 2026)[0].note).toBeNull();
    expect(annualFigures({ ...annual, carriedIn: 4 }, 2026)[1]).toMatchObject({ value: '+4', note: 'From before 2026' });
    expect(availableText(annual)).toBe('3 days available');
    expect(signedDays(2.5)).toBe('+2.5');
  });

  it('says what is left of the other types', () => {
    const b = { typeId: 'c', nameEn: 'Casual leave', nameAr: 'إجازة عارضة', used: 2, timesInService: 1, left: 5 };
    expect(typeLeftText(b, { daysPerYear: 7, maxTimesInService: null, balance: 'from_annual' })).toBe('5 days left of 7 this year');
    // a share in the year someone joins: the year's own number, not the type's
    expect(typeLeftText({ ...b, daysPerYear: 3.5, left: 2.5 }, { daysPerYear: 7, maxTimesInService: null, balance: 'from_annual' })).toBe('2.5 days left of 3.5 this year');
    expect(typeLeftText(b)).toBe('5 days left this year');
    const birth = { ...b, left: null, used: 0, timesInService: 1 };
    expect(typeLeftText(birth, { daysPerYear: null, maxTimesInService: 3, balance: 'per_request' })).toBe('2 of 3 times left in service');
    expect(typeLeftText({ ...birth, timesInService: 1 }, { daysPerYear: null, maxTimesInService: 1, balance: 'per_request' })).toBe('Taken once: none left in service');
    expect(typeLeftText({ ...b, left: null, used: 3 }, { daysPerYear: null, maxTimesInService: null, balance: 'none' })).toBe('3 days used this year');
    expect(typeLeftText({ ...b, left: null, used: 0 }, null)).toBe('None used this year');
  });

  it('is seen by HR, the CEO, Finance, the employee and their manager', () => {
    const profile = { id: 'e1' };
    expect(seesLeaveBalance({ roles: ['finance'] }, profile, false)).toBe(true);
    expect(seesLeaveBalance({ roles: ['employee'], employeeId: 'e1' }, profile, false)).toBe(true);
    expect(seesLeaveBalance({ roles: ['manager'], employeeId: 'm1' }, profile, true)).toBe(true);
    expect(seesLeaveBalance({ roles: ['admin'], employeeId: 'a1' }, profile, false)).toBe(false);
  });

  it('is shown for the address’s year, up to next year', () => {
    expect(balanceYear('2025', '2026-10-18')).toBe(2025);
    expect(balanceYear('2027', '2026-10-18')).toBe(2027);
    expect(balanceYear('2030', '2026-10-18')).toBe(2026);
    expect(balanceYear(undefined, '2026-10-18')).toBe(2026);
  });
});

describe('HR’s adjustment of a balance', () => {
  it('reads days added or taken off, whole or half, Arabic digits too', () => {
    expect(adjustmentDays('+2')).toBe(2);
    expect(adjustmentDays('-1.5')).toBe(-1.5);
    expect(adjustmentDays('−3')).toBe(-3);
    expect(adjustmentDays('٢')).toBe(2);
    expect(adjustmentDays('1.25')).toBeNaN();
    expect(adjustmentDays('')).toBeNull();
  });

  it('needs the days, not 0, and a reason', () => {
    expect(adjustmentBody(form({ days: '2', reason: ' Worked on Eid (Art. 129) ' }), 2026)).toEqual({ body: { year: 2026, days: 2, reason: 'Worked on Eid (Art. 129)' }, errors: [] });
    expect(adjustmentBody(form({ days: '0', reason: '' }), 2026).errors).toEqual([
      'Enter the days to add (e.g. 2) or take off (e.g. -1.5), in whole or half days, up to 366.',
      'Write the reason for the adjustment: it is kept with it.',
    ]);
    expect(adjustmentBody(form({ days: '400', reason: 'x' }), 2026).body).toBeNull();
  });
});
