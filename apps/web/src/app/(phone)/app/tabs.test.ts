import { describe, expect, it } from 'vitest';
import { activeTab, countText, decidesSomething, tabLabel, tabsFor } from './tabs';

const keys = (user: Parameters<typeof tabsFor>[0]) => tabsFor(user).map((t) => t.key);

describe('the phone pages’ tabs', () => {
  it('gives an employee four, without To Approve', () => {
    expect(keys({ roles: ['employee'] })).toEqual(['home', 'requests', 'attendance', 'payslips']);
    expect(keys(null)).toEqual(['home', 'requests', 'attendance', 'payslips']);
  });

  it('adds To Approve for those who decide something', () => {
    expect(keys({ roles: ['employee', 'manager'] })).toContain('approve');
    expect(keys({ roles: ['employee'], leads: true })).toContain('approve');
    expect(decidesSomething({ roles: ['hr'] })).toBe(true);
    expect(decidesSomething({ roles: ['ceo'] })).toBe(true);
    expect(decidesSomething({ roles: ['finance'] })).toBe(true);
  });

  it('leaves it out for an Admin or a Super Admin alone, who decide nothing on the phone', () => {
    expect(decidesSomething({ roles: ['admin'] })).toBe(false);
    expect(decidesSomething({ roles: ['super_admin'] })).toBe(false);
    expect(decidesSomething({ roles: ['employee'], leads: false })).toBe(false);
  });

  it('highlights the tab a page is under', () => {
    expect(activeTab('/app')).toBe('home');
    expect(activeTab('/app/requests')).toBe('requests');
    expect(activeTab('/app/requests/new/leave')).toBe('requests');
    expect(activeTab('/app/attendance')).toBe('attendance');
    expect(activeTab('/app/payslips/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed')).toBe('payslips');
    expect(activeTab('/app/approve/leave/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed')).toBe('approve');
    expect(activeTab('/app/requestsx')).toBeNull();
    expect(activeTab('/my-requests')).toBeNull();
  });

  it('says a count briefly', () => {
    expect(countText(0)).toBeNull();
    expect(countText(undefined)).toBeNull();
    expect(countText(3)).toBe('3');
    expect(countText(12)).toBe('9+');
  });

  it('names a tab for a screen reader with how many wait, the badge left unread', () => {
    expect(tabLabel('Home', undefined)).toBe('Home');
    expect(tabLabel('To Approve', 0)).toBe('To Approve');
    expect(tabLabel('To Approve', 3)).toBe('To Approve, 3 waiting');
    expect(tabLabel('To Approve', 12)).toBe('To Approve, more than 9 waiting');
  });
});
