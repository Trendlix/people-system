import { seesRaiseRequests } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { askOptions, offersRaise } from './options';

const keys = (p: Parameters<typeof askOptions>[0]) => askOptions(p).map((o) => o.key);
const hours = { hoursPerMonth: 4 };

describe('what the phone pages offer to ask for', () => {
  it('offers everything to a full-timer who may ask for a raise', () => {
    expect(keys({ employment: { employmentType: 'full_time' }, permissionMonth: hours, asksRaise: true })).toEqual(['leave', 'permission', 'reimbursement', 'correction', 'raise']);
  });

  it('leaves permission out while Leave Setup gives no hours, or they couldn’t be read', () => {
    expect(keys({ employment: { employmentType: 'full_time' }, permissionMonth: { hoursPerMonth: 0 }, asksRaise: false })).toEqual(['leave', 'reimbursement', 'correction']);
    expect(keys({ employment: { employmentType: 'full_time' }, permissionMonth: null, asksRaise: false })).toEqual(['leave', 'reimbursement', 'correction']);
  });

  it('offers a freelancer no leave and no permission (outside the labour law)', () => {
    expect(keys({ employment: { employmentType: 'freelance' }, permissionMonth: hours, asksRaise: false })).toEqual(['reimbursement', 'correction']);
  });

  it('offers someone without an employment a reimbursement alone', () => {
    expect(keys({ employment: null, permissionMonth: null, asksRaise: false })).toEqual(['reimbursement']);
  });

  it('opens each form on the phone pages', () => {
    expect(askOptions({ employment: { employmentType: 'full_time' }, permissionMonth: hours, asksRaise: true }).map((o) => o.href)).toEqual([
      '/app/requests/new/leave',
      '/app/requests/new/permission',
      '/app/requests/new/reimbursement',
      '/app/requests/new/correction',
      '/app/requests/new/raise',
    ]);
  });
});

describe('a raise on New Request (owner, 20 October 2026: "raises not to be visible to employee level for now", then "Hide from managers too")', () => {
  it('is never offered to someone who doesn’t see raise requests, a manager neither', () => {
    expect(offersRaise({ seesRaises: false, canRequest: true, manager: true })).toBe(false);
    expect(offersRaise({ seesRaises: seesRaiseRequests({ roles: ['employee', 'manager'] }), canRequest: true, manager: true })).toBe(false);
    expect(keys({ employment: { employmentType: 'full_time' }, permissionMonth: hours, asksRaise: offersRaise({ seesRaises: false, canRequest: true, manager: true }) })).toEqual([
      'leave',
      'permission',
      'reimbursement',
      'correction',
    ]);
  });

  it('is offered as before to someone who sees them: when they may ask now, or to a manager', () => {
    expect(offersRaise({ seesRaises: true, canRequest: true, manager: false })).toBe(true);
    expect(offersRaise({ seesRaises: true, canRequest: false, manager: true })).toBe(true);
    expect(offersRaise({ seesRaises: true, canRequest: false, manager: false })).toBe(false);
    expect(offersRaise({ seesRaises: seesRaiseRequests({ roles: ['hr'] }), canRequest: true, manager: false })).toBe(true);
  });
});
