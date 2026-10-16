import type { Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { hasRole } from '../lib/roles';
import { activeSubItem, COMING_SOON, isUnder, MY_REQUESTS, MY_TEAM, NAV, navFor, profileBack } from './nav';

const as = (...roles: Role[]) => ({ roles });
const templates = NAV.find((n) => n.href === '/templates')!;

describe('the sidebar', () => {
  it('shows Library and Fields Guide under Templates, for the same people as Templates', () => {
    expect(templates.items?.map((s) => [s.label, s.href])).toEqual([
      ['Library', '/templates'],
      ['Fields Guide', '/templates/tags'],
    ]);
    // the sub-items have no roles of their own: they show with their item
    expect(templates.items?.every((s) => !('roles' in s))).toBe(true);
    expect(hasRole(as('hr'), ...(templates.roles ?? []))).toBe(true);
    expect(hasRole(as('ceo'), ...(templates.roles ?? []))).toBe(true);
    expect(hasRole(as('super_admin'), ...(templates.roles ?? []))).toBe(true);
    expect(hasRole(as('employee', 'manager', 'finance'), ...(templates.roles ?? []))).toBe(false);
  });

  it('highlights the Fields Guide on its page, and Library on every other page of the templates', () => {
    const current = (path: string) => activeSubItem(templates, path)?.label ?? null;
    expect(current('/templates')).toBe('Library');
    expect(current('/templates/contract_full_time')).toBe('Library');
    expect(current('/templates/nda/versions/0b8f/map')).toBe('Library');
    expect(current('/templates/tags')).toBe('Fields Guide');
    expect(current('/employees')).toBeNull();
    expect(current('/templatesx')).toBeNull();
  });

  it('shows Payroll after Contracts to HR, Finance and the CEO only, and no longer as coming next', () => {
    const labels = NAV.map((n) => n.label);
    expect(labels.indexOf('Payroll')).toBe(labels.indexOf('Contracts') + 1);
    const payroll = NAV.find((n) => n.href === '/payroll')!;
    expect(payroll.section).toBe('/payroll');
    for (const role of ['hr', 'finance', 'ceo'] as const) expect(hasRole(as(role), ...(payroll.roles ?? []))).toBe(true);
    // salary data: not for an Admin or a Super Admin as such, nor a manager or an employee
    expect(hasRole(as('employee', 'manager', 'admin', 'super_admin'), ...(payroll.roles ?? []))).toBe(false);
    expect(COMING_SOON).not.toContain('Payroll');
  });

  it('has Payroll as a heading with Overview, Unsettled, Additions / Deductions and Reports under it (owner, 17 October 2026)', () => {
    const payroll = NAV.find((n) => n.href === '/payroll')!;
    expect(payroll.items?.map((i) => [i.label, i.href])).toEqual([
      ['Overview', '/payroll'],
      ['Unsettled', '/payroll/unsettled'],
      ['Additions / Deductions', '/payroll/adjustments'],
      ['Reports', '/payroll/reports'],
    ]);
    const current = (pathname: string) => activeSubItem(payroll, pathname)?.label ?? null;
    // a run is under Overview; the Salary Raises report under Reports
    expect(current('/payroll')).toBe('Overview');
    expect(current('/payroll/0b8f2c1e-1111-4222-8333-444455556666')).toBe('Overview');
    expect(current('/payroll/unsettled')).toBe('Unsettled');
    expect(current('/payroll/adjustments')).toBe('Additions / Deductions');
    expect(current('/payroll/reports/salary-raises')).toBe('Reports');
    // Raise Requests stays an item of its own
    expect(payroll.items?.map((i) => i.label)).not.toContain('Raise Requests');
  });

  it('shows Raise Requests after Payroll to HR, the CEO and Finance only', () => {
    const labels = NAV.map((n) => n.label);
    expect(labels.indexOf('Raise Requests')).toBe(labels.indexOf('Payroll') + 1);
    const requests = NAV.find((n) => n.href === '/raise-requests')!;
    expect(requests.section).toBe('/raise-requests');
    for (const role of ['hr', 'ceo', 'finance'] as const) expect(hasRole(as(role), ...(requests.roles ?? []))).toBe(true);
    // the employee and the manager ask on the profile; an Admin as such doesn't see salaries
    expect(hasRole(as('employee', 'manager', 'admin', 'super_admin'), ...(requests.roles ?? []))).toBe(false);
  });

  it('has no sub-item to highlight for an item without any', () => {
    expect(activeSubItem(NAV.find((n) => n.href === '/employees')!, '/employees')).toBeNull();
  });

  it('counts a page under a path, not one that only starts with the same letters', () => {
    expect(isUnder('/templates', '/templates')).toBe(true);
    expect(isUnder('/templates/tags', '/templates')).toBe(true);
    expect(isUnder('/templates-old', '/templates')).toBe(false);
    expect(isUnder('/templates', '/templates/tags')).toBe(false);
  });
});

describe('the sidebar of an employee or a manager', () => {
  const ME = '3f1c2a9e-5b7d-4e1f-9a2b-6c8d0e4f1a2b';
  const links = (user: Parameters<typeof navFor>[0]) => navFor(user).map((n) => [n.label, n.href]);

  it('is Dashboard, My Profile and My Requests for an employee, in that order', () => {
    expect(links({ roles: ['employee'], employeeId: ME })).toEqual([
      ['Dashboard', '/'],
      ['My Profile', `/employees/${ME}`],
      ['My Requests', MY_REQUESTS],
    ]);
  });

  it('adds My Team for a direct manager', () => {
    expect(links({ roles: ['employee', 'manager'], employeeId: ME })).toEqual([
      ['Dashboard', '/'],
      ['My Profile', `/employees/${ME}`],
      ['My Requests', MY_REQUESTS],
      ['My Team', MY_TEAM],
    ]);
    expect(links({ roles: ['manager'], employeeId: ME }).map(([label]) => label)).toContain('My Team');
  });

  it('leaves out My Profile without a profile of their own', () => {
    expect(links({ roles: ['employee'], employeeId: null })).toEqual([
      ['Dashboard', '/'],
      ['My Requests', MY_REQUESTS],
    ]);
    expect(links({ roles: ['employee'] }).map(([label]) => label)).toEqual(['Dashboard', 'My Requests']);
  });

  it('shows them no Organization, Employees or HR page', () => {
    for (const roles of [['employee'], ['manager'], ['employee', 'manager']] as Role[][]) {
      const hrefs = navFor({ roles, employeeId: ME }).map((n) => n.href);
      for (const page of ['/organization/company', '/employees', '/contracts', '/payroll', '/raise-requests', '/offers', '/approvals', '/templates', '/users']) {
        expect(hrefs).not.toContain(page);
      }
    }
  });

  it('highlights My Profile on their profile and the pages under it, not on someone else', () => {
    const profile = navFor({ roles: ['employee'], employeeId: ME }).find((n) => n.label === 'My Profile')!;
    expect(isUnder(`/employees/${ME}`, profile.section!)).toBe(true);
    expect(isUnder(`/employees/${ME}/change-request`, profile.section!)).toBe(true);
    expect(isUnder('/employees/0b8f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e', profile.section!)).toBe(false);
  });

  it('keeps Coming Next as it is', () => {
    expect(COMING_SOON).toEqual(['Attendance', 'Leave']);
  });
});

describe('the sidebar of HR, Finance, the CEO and Admins', () => {
  const labels = (...roles: Role[]) => navFor({ roles, employeeId: 'x' }).map((n) => n.label);

  it('is the sidebar as before, each item for the roles it names', () => {
    expect(labels('employee', 'hr')).toEqual(['Home', 'Organization', 'Employees', 'Contracts', 'Payroll', 'Raise Requests', 'Offers', 'Approvals', 'Templates']);
    expect(labels('employee', 'finance')).toEqual(['Home', 'Organization', 'Employees', 'Contracts', 'Payroll', 'Raise Requests']);
    expect(labels('ceo')).toEqual(['Home', 'Organization', 'Employees', 'Contracts', 'Payroll', 'Raise Requests', 'Offers', 'Approvals', 'Templates']);
    expect(labels('admin')).toEqual(['Home', 'Organization', 'Employees', 'Approvals', 'Templates', 'Users']);
    expect(labels('super_admin')).toEqual(['Home', 'Organization', 'Employees', 'Approvals', 'Templates', 'Users']);
  });

  it('has none of the employee’s own links, even for HR who manage people', () => {
    for (const roles of [['hr', 'manager'], ['ceo'], ['admin', 'manager']] as Role[][]) {
      const shown = navFor({ roles, employeeId: 'x' }).map((n) => n.href);
      expect(shown).not.toContain(MY_REQUESTS);
      expect(shown).not.toContain(MY_TEAM);
    }
  });

  it('is Home alone while who it is for can’t be read', () => {
    expect(navFor(null).map((n) => [n.label, n.href])).toEqual([['Home', '/']]);
  });
});

describe('the back link of a profile', () => {
  const ME = 'me-0000';
  it('goes to Employees for those who have the list', () => {
    expect(profileBack({ roles: ['hr'], employeeId: ME }, { id: 'other', isSelf: false })).toEqual({ href: '/employees', label: 'Employees' });
    expect(profileBack({ roles: ['admin'], employeeId: ME }, { id: ME, isSelf: true })).toEqual({ href: '/employees', label: 'Employees' });
  });

  it('is left out on their own profile for an employee, and goes to My Team on a direct report’s', () => {
    expect(profileBack({ roles: ['employee'], employeeId: ME }, { id: ME, isSelf: true })).toBeNull();
    // an API from before isSelf: told by the profile's id
    expect(profileBack({ roles: ['employee'], employeeId: ME }, { id: ME })).toBeNull();
    expect(profileBack({ roles: ['employee', 'manager'], employeeId: ME }, { id: 'report', isSelf: false })).toEqual({ href: MY_TEAM, label: 'My Team' });
  });
});
