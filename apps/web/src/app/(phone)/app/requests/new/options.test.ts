import { seesRaiseRequests } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { askOptions, offersCompensatory, offersOd, offersRaise, offersWfh } from './options';

const keys = (p: Parameters<typeof askOptions>[0]) => askOptions(p).map((o) => o.key);
const hours = { hoursPerMonth: 4 };

describe('what the phone pages offer to ask for', () => {
  it('offers everything to a full-timer who may ask for a raise', () => {
    expect(keys({ employment: { employmentType: 'full_time' }, permissionMonth: hours, asksRaise: true })).toEqual(['leave', 'permission', 'reimbursement', 'correction', 'raise', 'home']);
  });

  it('leaves permission out while Leave Setup gives no hours, or they couldn’t be read', () => {
    expect(keys({ employment: { employmentType: 'full_time' }, permissionMonth: { hoursPerMonth: 0 }, asksRaise: false })).toEqual(['leave', 'reimbursement', 'correction', 'home']);
    expect(keys({ employment: { employmentType: 'full_time' }, permissionMonth: null, asksRaise: false })).toEqual(['leave', 'reimbursement', 'correction', 'home']);
  });

  it('offers a freelancer no leave and no permission (outside the labour law)', () => {
    expect(keys({ employment: { employmentType: 'freelance' }, permissionMonth: hours, asksRaise: false })).toEqual(['reimbursement', 'correction', 'home']);
  });

  it('offers someone without an employment a reimbursement and a home location alone', () => {
    expect(keys({ employment: null, permissionMonth: null, asksRaise: false })).toEqual(['reimbursement', 'home']);
  });

  // owner, 20 October 2026: "allow other users to request to add their home locations when working from home"; everyone may ask
  it('offers a home location to everyone with a profile, last', () => {
    expect(askOptions({ employment: null, permissionMonth: null, asksRaise: false }).at(-1)).toMatchObject({ key: 'home', label: 'Check-in location', href: '/app/requests/new/home' });
  });

  it('opens each form on the phone pages', () => {
    expect(askOptions({ employment: { employmentType: 'full_time' }, permissionMonth: hours, asksRaise: true }).map((o) => o.href)).toEqual([
      '/app/requests/new/leave',
      '/app/requests/new/permission',
      '/app/requests/new/reimbursement',
      '/app/requests/new/correction',
      '/app/requests/new/raise',
      '/app/requests/new/home',
    ]);
  });
});

describe('working from home on New Request (owner, 21 October 2026: "think about how should we handle the working from home in out erp")', () => {
  const allowance = { offered: true, refusal: null, daysPerMonth: 2 };

  // beside leave since 26 October 2026 (of work from home: "move it to leaves")
  it('is offered right after leave when their month says their arrangement needs it', () => {
    expect(keys({ employment: { employmentType: 'full_time' }, permissionMonth: hours, asksRaise: false, asksWfh: offersWfh(allowance) })).toEqual([
      'leave',
      'wfh',
      'permission',
      'reimbursement',
      'correction',
      'home',
    ]);
    expect(askOptions({ employment: { employmentType: 'full_time' }, permissionMonth: hours, asksRaise: false, asksWfh: true }).find((o) => o.key === 'wfh')).toMatchObject({
      label: 'Work from home',
      href: '/app/requests/new/wfh',
    });
  });

  it('is hidden for an arrangement that never needs it, when refused or turned off, unread, or without an employment', () => {
    expect(offersWfh({ offered: false, refusal: 'You work from home already: no work from home day is needed.', daysPerMonth: 2 })).toBe(false);
    expect(offersWfh({ ...allowance, refusal: 'You work freelance, outside the labour law and its working hours: no work from home day is needed.' })).toBe(false);
    expect(offersWfh({ ...allowance, daysPerMonth: 0 })).toBe(false);
    expect(offersWfh(null)).toBe(false);
    expect(keys({ employment: null, permissionMonth: null, asksRaise: false, asksWfh: true })).toEqual(['reimbursement', 'home']);
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
      'home',
    ]);
  });

  it('is offered as before to someone who sees them: when they may ask now, or to a manager', () => {
    expect(offersRaise({ seesRaises: true, canRequest: true, manager: false })).toBe(true);
    expect(offersRaise({ seesRaises: true, canRequest: false, manager: true })).toBe(true);
    expect(offersRaise({ seesRaises: true, canRequest: false, manager: false })).toBe(false);
    expect(offersRaise({ seesRaises: seesRaiseRequests({ roles: ['hr'] }), canRequest: true, manager: false })).toBe(true);
  });
});

describe('official duty on New Request (owner, 23 October 2026: "Official duty (OD) requests")', () => {
  it('is offered after permission when its form says nothing refuses them', () => {
    expect(offersOd({ refusal: null })).toBe(true);
    expect(keys({ employment: { employmentType: 'full_time' }, permissionMonth: hours, asksRaise: false, asksWfh: true, asksOd: offersOd({ refusal: null }) })).toEqual([
      'leave',
      'wfh',
      'permission',
      'od',
      'reimbursement',
      'correction',
      'home',
    ]);
    expect(askOptions({ employment: { employmentType: 'full_time' }, permissionMonth: hours, asksRaise: false, asksOd: true }).find((o) => o.key === 'od')).toMatchObject({
      label: 'Official duty',
      href: '/app/requests/new/od',
    });
  });

  it('is hidden when refused (a freelancer), unread, or without an employment', () => {
    expect(offersOd({ refusal: 'You work freelance, outside the labour law and its working hours: no official duty is needed.' })).toBe(false);
    expect(offersOd(null)).toBe(false);
    expect(keys({ employment: null, permissionMonth: null, asksRaise: false, asksOd: true })).toEqual(['reimbursement', 'home']);
  });
});

describe('a compensatory day on New Request (owner, 26 October 2026: "WFH and compensatory pages in the phone app")', () => {
  const form = { offered: true, refusal: null };

  it('is offered with working from home right after leave, grouped with it, when its form says nothing refuses them', () => {
    expect(offersCompensatory(form)).toBe(true);
    expect(
      keys({ employment: { employmentType: 'full_time' }, permissionMonth: hours, asksRaise: true, asksWfh: true, asksOd: true, asksCompensatory: offersCompensatory(form) }),
    ).toEqual(['leave', 'wfh', 'compensatory', 'permission', 'od', 'reimbursement', 'correction', 'raise', 'home']);
    // without working from home, still right after leave
    expect(keys({ employment: { employmentType: 'full_time' }, permissionMonth: hours, asksRaise: false, asksCompensatory: true })).toEqual([
      'leave',
      'compensatory',
      'permission',
      'reimbursement',
      'correction',
      'home',
    ]);
    expect(askOptions({ employment: { employmentType: 'full_time' }, permissionMonth: hours, asksRaise: false, asksCompensatory: true }).find((o) => o.key === 'compensatory')).toMatchObject({
      label: 'Compensatory day',
      href: '/app/requests/new/compensatory',
    });
  });

  it('is hidden when refused (a freelancer), not offered, unread, or without an employment', () => {
    expect(offersCompensatory({ offered: false, refusal: 'You work freelance, outside the labour law and its working hours: there are no compensatory days.' })).toBe(false);
    expect(offersCompensatory({ offered: true, refusal: 'You have no current employment.' })).toBe(false);
    expect(offersCompensatory({ offered: false, refusal: null })).toBe(false);
    expect(offersCompensatory(null)).toBe(false);
    expect(offersCompensatory(undefined)).toBe(false);
    expect(keys({ employment: null, permissionMonth: null, asksRaise: false, asksCompensatory: true })).toEqual(['reimbursement', 'home']);
    expect(keys({ employment: { employmentType: 'full_time' }, permissionMonth: hours, asksRaise: false })).not.toContain('compensatory');
  });
});
