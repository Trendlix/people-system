import { describe, expect, it } from 'vitest';
import { askOptions } from './options';

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
