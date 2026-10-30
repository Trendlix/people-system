import { describe, expect, it } from 'vitest';
import type { LeaveTypeBalance, LeaveTypeView } from '../../../lib/types';
import { annualShareLeft, otherLeaveFigure, otherLeaveTypes, percentText, permissionFigure } from './overview';

const balance = (over: Partial<LeaveTypeBalance> = {}): LeaveTypeBalance => ({
  typeId: 't',
  nameEn: 'Casual leave',
  nameAr: 'إجازة عارضة',
  used: 1,
  timesInService: 0,
  left: 6,
  ...over,
});

describe('the annual leave card', () => {
  it('gives the share of the year’s days still available, out of the entitlement with what was carried in and adjusted', () => {
    expect(
      annualShareLeft({
        entitlement: 21,
        carriedIn: 0,
        adjustments: 0,
        available: 19,
      }),
    ).toBeCloseTo(19 / 21);
    expect(
      percentText(
        annualShareLeft({
          entitlement: 21,
          carriedIn: 0,
          adjustments: 0,
          available: 19,
        }),
      ),
    ).toBe('90%');
    expect(
      annualShareLeft({
        entitlement: 21,
        carriedIn: 3,
        adjustments: -2,
        available: 11,
      }),
    ).toBeCloseTo(0.5);
  });

  it('keeps the share between none and all, and none when there are no days', () => {
    expect(
      annualShareLeft({
        entitlement: 0,
        carriedIn: 0,
        adjustments: 0,
        available: 0,
      }),
    ).toBe(0);
    expect(
      annualShareLeft({
        entitlement: 10,
        carriedIn: 0,
        adjustments: 0,
        available: -1,
      }),
    ).toBe(0);
    expect(
      annualShareLeft({
        entitlement: 10,
        carriedIn: 0,
        adjustments: 0,
        available: 12,
      }),
    ).toBe(1);
  });
});

describe('Other leave', () => {
  const types = [
    { id: 'annual', balance: 'annual', active: true },
    {
      id: 'casual',
      balance: 'yearly',
      active: true,
      daysPerYear: 7,
      maxTimesInService: null,
    },
    {
      id: 'old',
      balance: 'none',
      active: false,
      daysPerYear: null,
      maxTimesInService: null,
    },
    {
      id: 'hajj',
      balance: 'none',
      active: true,
      daysPerYear: null,
      maxTimesInService: 1,
    },
  ] as unknown as LeaveTypeView[];

  it('shows every other type but the annual leave, and one turned off only once used', () => {
    const list = [balance({ typeId: 'annual' }), balance({ typeId: 'casual' }), balance({ typeId: 'old', used: 0 }), balance({ typeId: 'hajj' })];
    expect(otherLeaveTypes({ types: list }, types).map((t) => t.typeId)).toEqual(['casual', 'hajj']);
    expect(otherLeaveTypes({ types: [balance({ typeId: 'old', used: 2 })] }, types).map((t) => t.typeId)).toEqual(['old']);
  });

  it('gives the days left of the year’s, the times left in service, or the days used', () => {
    expect(otherLeaveFigure(balance({ left: 6 }), types[1])).toEqual({
      value: '6',
      note: 'of 7 days left this year',
    });
    // the year's own share in a first year (26 October 2026)
    expect(otherLeaveFigure(balance({ left: 1.5, daysPerYear: 3.5 }), types[1])).toEqual({ value: '1.5', note: 'of 3.5 days left this year' });
    expect(otherLeaveFigure(balance({ left: 2 }), null)).toEqual({
      value: '2',
      note: 'days left this year',
    });
    expect(otherLeaveFigure(balance({ left: null, timesInService: 0 }), types[3])).toEqual({ value: '1', note: 'of 1 time left in service' });
    expect(otherLeaveFigure(balance({ left: null, timesInService: 1 }), types[3])).toEqual({ value: '0', note: 'of 1 time left in service' });
    expect(otherLeaveFigure(balance({ left: null, used: 0 }), types[2])).toEqual({ value: '0', note: 'days used this year' });
    expect(otherLeaveFigure(balance({ left: null, used: 1 }), types[2])).toEqual({ value: '1', note: 'day used this year' });
  });
});

describe('the permission figure', () => {
  it('gives this month’s hours left as a clock, and of how many', () => {
    expect(permissionFigure({ hoursPerMonth: 4, left: 4 })).toEqual({
      value: '4:00',
      note: 'of 4:00 hours this month',
      off: false,
    });
    expect(permissionFigure({ hoursPerMonth: 4, left: 1.5 })).toEqual({
      value: '1:30',
      note: 'of 4:00 hours this month',
      off: false,
    });
  });

  it('says permission is off when Leave Setup gives no hours', () => {
    expect(permissionFigure({ hoursPerMonth: 0, left: 0 })).toEqual({
      value: 'Off',
      note: 'No permission hours a month',
      off: true,
    });
  });
});
