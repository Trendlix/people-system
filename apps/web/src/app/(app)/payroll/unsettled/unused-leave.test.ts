import { describe, expect, it } from 'vitest';
import { canPayUnusedLeave, unusedLeaveText, type UnusedLeave } from './unused-leave';

// The unused leave paid on leaving (Labour Law Art. 125; owner, 18 October 2026): invented figures.
const leave = (u: Partial<UnusedLeave>): UnusedLeave => ({ year: 2026, days: 5, dayRate: 500, amount: 2500, paid: null, ...u });

describe('the unused leave to pay in a final settlement', () => {
  it('can be recorded paid while there are days and no addition for them', () => {
    expect(canPayUnusedLeave(leave({}))).toBe(true);
    expect(canPayUnusedLeave(leave({ days: 0 }))).toBe(false);
    expect(canPayUnusedLeave(leave({ paid: { adjustmentId: 'a', month: '2026-10', status: 'pending', days: 5, amount: 2500 } }))).toBe(false);
    // its addition cancelled since: recorded again
    expect(canPayUnusedLeave(leave({ paid: { adjustmentId: 'a', month: '2026-10', status: 'cancelled', days: 5, amount: 2500 } }))).toBe(true);
  });

  it('says its days, its day rate and where its payment stands', () => {
    expect(unusedLeaveText(leave({}))).toEqual({ figures: "5 days of 2026's annual leave at EGP 500.00 a day", status: null });
    expect(unusedLeaveText(leave({ days: 0, amount: 0 })).status).toBe('Nothing unused: no leave to pay.');
    expect(unusedLeaveText(leave({ paid: { adjustmentId: 'a', month: '2026-10', status: 'pending', days: 5, amount: 2500 } })).status).toBe(
      'Recorded: EGP 2,500.00 added to the October 2026 payroll as Unused leave paid.',
    );
    expect(unusedLeaveText(leave({ paid: { adjustmentId: 'a', month: '2026-11', status: 'applied', days: 5, amount: 2500 } })).status).toBe('Paid with the November 2026 payroll: EGP 2,500.00.');
    expect(unusedLeaveText(leave({ days: 1, paid: { adjustmentId: 'a', month: '2026-10', status: 'cancelled', days: 1, amount: 500 } })).figures).toBe(
      "1 day of 2026's annual leave at EGP 500.00 a day",
    );
  });
});
