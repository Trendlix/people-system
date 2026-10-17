import type { Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { hasRole } from '../lib/roles';
import { activeSubItem, COMING_SOON, DETAILS_CHANGES_PATH, isActive, isUnder, MY_REQUESTS, MY_TEAM, NAV, navFor, profileBack, RAISE_REQUESTS_PATH } from './nav';

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
    // Raise Requests is under Requests, not Payroll
    expect(payroll.items?.map((i) => i.label)).not.toContain('Raise Requests');
  });

  it('has Requests as a heading after Payroll, with Raise Requests and Details Changes under it (owner, 17 October 2026)', () => {
    const labels = NAV.map((n) => n.label);
    expect(labels.indexOf('Requests')).toBe(labels.indexOf('Payroll') + 1);
    // no longer an item of its own
    expect(labels).not.toContain('Raise Requests');
    const requests = NAV.find((n) => n.label === 'Requests')!;
    expect(requests.items?.map((i) => [i.label, i.href])).toEqual([
      ['Raise Requests', '/raise-requests'],
      ['Details Changes', '/requests/details-changes'],
    ]);
    expect([RAISE_REQUESTS_PATH, DETAILS_CHANGES_PATH]).toEqual(['/raise-requests', '/requests/details-changes']);
    // each page for its own roles; the heading for whoever sees one of them
    expect(requests.roles).toBeUndefined();
    expect(requests.items?.map((i) => i.roles)).toEqual([
      ['hr', 'ceo', 'finance'],
      ['hr', 'admin'],
    ]);
    // the employee and the manager ask for raises on the profile; an Admin as such doesn't see salaries
    const raise = requests.items![0];
    for (const role of ['hr', 'ceo', 'finance'] as const) expect(hasRole(as(role), ...(raise.roles ?? []))).toBe(true);
    expect(hasRole(as('employee', 'manager', 'admin', 'super_admin'), ...(raise.roles ?? []))).toBe(false);
    // Leave comes later, with the Leave module
    expect(COMING_SOON).toContain('Leave');
  });

  it('highlights the Requests page the user is on, and Requests as the section it is in', () => {
    const requests = NAV.find((n) => n.label === 'Requests')!;
    const current = (pathname: string) => activeSubItem(requests, pathname)?.label ?? null;
    expect(current('/raise-requests')).toBe('Raise Requests');
    expect(current('/requests/details-changes')).toBe('Details Changes');
    expect(current('/approvals')).toBeNull();
    expect(current('/raise-requestsx')).toBeNull();
    expect(isActive(requests, '/raise-requests')).toBe(true);
    expect(isActive(requests, '/requests/details-changes')).toBe(true);
    expect(isActive(requests, '/approvals')).toBe(false);
    expect(isActive(requests, '/payroll')).toBe(false);
  });

  it('keeps the other items highlighted as before', () => {
    const item = (href: string) => NAV.find((n) => n.href === href)!;
    expect(isActive(item('/'), '/')).toBe(true);
    expect(isActive(item('/'), '/employees')).toBe(false);
    expect(isActive(item('/employees'), '/employees/abc')).toBe(true);
    expect(isActive(item('/payroll'), '/payroll/unsettled')).toBe(true);
    expect(isActive(item('/templates'), '/templates/tags')).toBe(true);
    expect(isActive(item('/approvals'), '/raise-requests')).toBe(false);
  });

  it('links an item with pages under it to the first one the user sees', () => {
    for (const item of NAV.filter((n) => n.items)) expect(item.href).toBe(item.items![0].href);
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
      for (const page of ['/organization/company', '/employees', '/contracts', '/payroll', '/raise-requests', '/requests/details-changes', '/offers', '/approvals', '/templates', '/users']) {
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

  it('is the sidebar as before, each item for the roles it names, with Requests in Raise Requests’ place', () => {
    expect(labels('employee', 'hr')).toEqual(['Home', 'Organization', 'Employees', 'Contracts', 'Payroll', 'Requests', 'Offers', 'Approvals', 'Templates']);
    expect(labels('employee', 'finance')).toEqual(['Home', 'Organization', 'Employees', 'Contracts', 'Payroll', 'Requests']);
    expect(labels('ceo')).toEqual(['Home', 'Organization', 'Employees', 'Contracts', 'Payroll', 'Requests', 'Offers', 'Approvals', 'Templates']);
    expect(labels('admin')).toEqual(['Home', 'Organization', 'Employees', 'Requests', 'Approvals', 'Templates', 'Users']);
    expect(labels('super_admin')).toEqual(['Home', 'Organization', 'Employees', 'Requests', 'Approvals', 'Templates', 'Users']);
  });

  describe('Requests', () => {
    const requestsFor = (...roles: Role[]) => navFor({ roles, employeeId: 'x' }).find((n) => n.label === 'Requests') ?? null;
    const pages = (...roles: Role[]) => requestsFor(...roles)?.items?.map((i) => i.label) ?? null;

    it('has Raise Requests and Details Changes for HR, and links to Raise Requests', () => {
      expect(pages('hr')).toEqual(['Raise Requests', 'Details Changes']);
      expect(pages('employee', 'hr', 'manager')).toEqual(['Raise Requests', 'Details Changes']);
      expect(requestsFor('hr')?.href).toBe('/raise-requests');
    });

    it('has Raise Requests alone for Finance and the CEO, who don’t decide details changes', () => {
      expect(pages('finance')).toEqual(['Raise Requests']);
      expect(pages('ceo')).toEqual(['Raise Requests']);
      expect(requestsFor('finance')?.href).toBe('/raise-requests');
      expect(requestsFor('ceo')?.href).toBe('/raise-requests');
    });

    it('has Details Changes alone for an Admin and a Super Admin, who don’t see salaries, and links to it', () => {
      expect(pages('admin')).toEqual(['Details Changes']);
      expect(pages('super_admin')).toEqual(['Details Changes']);
      expect(requestsFor('admin')?.href).toBe('/requests/details-changes');
      expect(requestsFor('super_admin')?.href).toBe('/requests/details-changes');
    });

    it('has both for someone who is an Admin and Finance, linking to the first', () => {
      expect(pages('admin', 'finance')).toEqual(['Raise Requests', 'Details Changes']);
      expect(requestsFor('admin', 'finance')?.href).toBe('/raise-requests');
    });

    it('is not shown to an employee or a manager, whose requests are on My Requests', () => {
      for (const roles of [['employee'], ['manager'], ['employee', 'manager']] as Role[][]) {
        const shown = navFor({ roles, employeeId: 'x' });
        expect(shown.map((n) => n.label)).not.toContain('Requests');
        expect(shown.flatMap((n) => n.items ?? [])).toEqual([]);
        expect(shown.map((n) => n.href)).not.toContain(DETAILS_CHANGES_PATH);
      }
    });

    it('leaves the other headings’ pages as they are', () => {
      const sub = (label: string, ...roles: Role[]) =>
        navFor({ roles, employeeId: 'x' })
          .find((n) => n.label === label)
          ?.items?.map((i) => i.label);
      expect(sub('Payroll', 'finance')).toEqual(['Overview', 'Unsettled', 'Additions / Deductions', 'Reports']);
      expect(sub('Templates', 'admin')).toEqual(['Library', 'Fields Guide']);
      expect(navFor({ roles: ['hr'], employeeId: 'x' }).find((n) => n.label === 'Payroll')?.href).toBe('/payroll');
      expect(navFor({ roles: ['ceo'], employeeId: 'x' }).find((n) => n.label === 'Templates')?.href).toBe('/templates');
    });

    it('doesn’t change NAV itself for the next user', () => {
      navFor({ roles: ['admin'], employeeId: 'x' });
      const requests = NAV.find((n) => n.label === 'Requests')!;
      expect(requests.href).toBe('/raise-requests');
      expect(requests.items).toHaveLength(2);
    });
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
