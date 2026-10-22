import type { AssetsAccess, Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { hasRole } from '../lib/roles';
import {
  activeSubItem,
  ASSETS_NAV,
  AUDIT_LOG_PATH,
  decidesForTeam,
  DETAILS_CHANGES_PATH,
  isActive,
  isUnder,
  KPIS_NAV,
  LEAVE_PATH,
  MY_ATTENDANCE,
  MY_REQUESTS,
  MY_TEAM,
  myAttendanceInMenu,
  NAV,
  navFor,
  profileBack,
  RAISE_REQUESTS_PATH,
  REIMBURSEMENTS_PATH,
} from './nav';

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
    // a Super Admin's only (owner, 19 October 2026: "enable templates sidebar to super admin only")
    expect(hasRole(as('super_admin'), ...(templates.roles ?? []))).toBe(true);
    expect(hasRole(as('hr'), ...(templates.roles ?? []))).toBe(false);
    expect(hasRole(as('ceo'), ...(templates.roles ?? []))).toBe(false);
    expect(hasRole(as('admin'), ...(templates.roles ?? []))).toBe(false);
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

  it('shows Payroll after People and Recruitment to HR, Finance and the CEO only, and no longer as coming next', () => {
    const labels = NAV.map((n) => n.label);
    expect(labels.indexOf('Recruitment')).toBe(labels.indexOf('People') + 1);
    expect(labels.indexOf('Payroll')).toBe(labels.indexOf('Recruitment') + 1);
    const payroll = NAV.find((n) => n.href === '/payroll')!;
    expect(payroll.section).toBe('/payroll');
    for (const role of ['hr', 'finance', 'ceo'] as const) expect(hasRole(as(role), ...(payroll.roles ?? []))).toBe(true);
    // salary data: not for an Admin or a Super Admin as such, nor a manager or an employee
    expect(hasRole(as('employee', 'manager', 'admin', 'super_admin'), ...(payroll.roles ?? []))).toBe(false);
  });

  it('has Payroll as a heading with Overview, Unsettled, Additions / Deductions, Recurring Deductions and Reports under it (owner, 17 and 18 October 2026)', () => {
    const payroll = NAV.find((n) => n.href === '/payroll')!;
    expect(payroll.items?.map((i) => [i.label, i.href])).toEqual([
      ['Overview', '/payroll'],
      ['Unsettled', '/payroll/unsettled'],
      ['Additions / Deductions', '/payroll/adjustments'],
      ['Recurring Deductions', '/payroll/recurring-deductions'],
      ['Reports', '/payroll/reports'],
    ]);
    const current = (pathname: string) => activeSubItem(payroll, pathname)?.label ?? null;
    // a run is under Overview; the Salary Raises report under Reports
    expect(current('/payroll')).toBe('Overview');
    expect(current('/payroll/0b8f2c1e-1111-4222-8333-444455556666')).toBe('Overview');
    expect(current('/payroll/unsettled')).toBe('Unsettled');
    expect(current('/payroll/adjustments')).toBe('Additions / Deductions');
    expect(current('/payroll/recurring-deductions')).toBe('Recurring Deductions');
    expect(current('/payroll/reports/salary-raises')).toBe('Reports');
    // Raise Requests is under Requests, not Payroll
    expect(payroll.items?.map((i) => i.label)).not.toContain('Raise Requests');
  });

  it('has Requests as a heading after Payroll, with Raise Requests, Details Changes, Reimbursements and Leave Requests under it (owner, 17 and 18 October 2026)', () => {
    const labels = NAV.map((n) => n.label);
    expect(labels.indexOf('Requests')).toBe(labels.indexOf('Payroll') + 1);
    // no longer an item of its own
    expect(labels).not.toContain('Raise Requests');
    const requests = NAV.find((n) => n.label === 'Requests')!;
    expect(requests.items?.map((i) => [i.label, i.href])).toEqual([
      ['Raise Requests', '/raise-requests'],
      ['Details Changes', '/requests/details-changes'],
      ['Reimbursements', '/reimbursements'],
      ['Leave Requests', '/leave'],
    ]);
    expect([RAISE_REQUESTS_PATH, DETAILS_CHANGES_PATH, REIMBURSEMENTS_PATH, LEAVE_PATH]).toEqual(['/raise-requests', '/requests/details-changes', '/reimbursements', '/leave']);
    // each page for its own roles; the heading for whoever sees one of them
    expect(requests.roles).toBeUndefined();
    expect(requests.items?.map((i) => i.roles)).toEqual([
      ['hr', 'ceo', 'finance'],
      ['hr', 'admin', 'ceo'],
      ['hr', 'finance', 'ceo'],
      ['hr', 'ceo'],
    ]);
    // details changes: HR and Admin decide them, and the CEO a C-level person's (owner, 19 October 2026: "make C level
    // Employees details not visible to HR"); Finance doesn't
    const details = requests.items![1];
    for (const role of ['hr', 'admin', 'super_admin', 'ceo'] as const) expect(hasRole(as(role), ...(details.roles ?? []))).toBe(true);
    expect(hasRole(as('employee', 'manager', 'finance'), ...(details.roles ?? []))).toBe(false);
    // the employee and the manager ask for raises on the profile; an Admin as such doesn't see salaries
    const raise = requests.items![0];
    for (const role of ['hr', 'ceo', 'finance'] as const) expect(hasRole(as(role), ...(raise.roles ?? []))).toBe(true);
    expect(hasRole(as('employee', 'manager', 'admin', 'super_admin'), ...(raise.roles ?? []))).toBe(false);
    // reimbursements (owner, 18 October 2026): HR and Finance decide them, the CEO views them; the employee claims from
    // My Requests and the manager decides theirs from My Team; an Admin as such doesn't see pay
    const claims = requests.items![2];
    for (const role of ['hr', 'finance', 'ceo'] as const) expect(hasRole(as(role), ...(claims.roles ?? []))).toBe(true);
    expect(hasRole(as('employee', 'manager', 'admin', 'super_admin'), ...(claims.roles ?? []))).toBe(false);
    // leave (owner, 18 October 2026: "can you apply the leaves according to the law?"): HR decides and records it, the
    // CEO views it; the direct manager decides their team's from My Team and the employee asks from My Requests; Finance
    // and an Admin as such don't
    const leave = requests.items![3];
    for (const role of ['hr', 'ceo'] as const) expect(hasRole(as(role), ...(leave.roles ?? []))).toBe(true);
    expect(hasRole(as('employee', 'manager', 'finance', 'admin', 'super_admin'), ...(leave.roles ?? []))).toBe(false);
  });

  describe('Attendance (owner, 19 October 2026: "the attendance is not active in the side menu")', () => {
    const attendance = NAV.find((n) => n.label === 'Attendance')!;
    const pagesFor = (...roles: Role[]) =>
      navFor({ roles, employeeId: 'x' })
        .find((n) => n.label === 'Attendance')
        ?.items?.map((i) => [i.label, i.href]) ?? null;

    it('is a heading after Requests, for HR, the CEO and Finance, linking to Daily Attendance; and for an Admin, for Check-in Setup', () => {
      const labels = NAV.map((n) => n.label);
      expect(labels.indexOf('Attendance')).toBe(labels.indexOf('Requests') + 1);
      expect(attendance).toMatchObject({ href: '/attendance', section: '/attendance' });
      for (const role of ['hr', 'ceo', 'finance', 'admin', 'super_admin'] as const) expect(hasRole(as(role), ...(attendance.roles ?? []))).toBe(true);
      expect(hasRole(as('employee', 'manager'), ...(attendance.roles ?? []))).toBe(false);
    });

    it('has Daily Attendance, Import (HR’s: "where am i going to import the sheets?"), Import History, Summary and Corrections for HR; the CEO all but Import; Finance neither Import nor Corrections', () => {
      expect(pagesFor('hr')).toEqual([
        ['Daily Attendance', '/attendance'],
        ['Import', '/attendance/import'],
        ['Import History', '/attendance/imports'],
        ['Summary', '/attendance/summary'],
        // the days asked to be corrected (19 October 2026: "Attendance corrections with approval")
        ['Corrections', '/attendance/corrections'],
        // the work-from-home days (21 October 2026: "Manager, then HR")
        ['Work From Home', '/attendance/wfh'],
        // the check-in locations and the office network's lock (20 October 2026: "Own page, several locations")
        ['Check-in Setup', '/attendance/check-in-setup'],
      ]);
      expect(pagesFor('ceo')).toEqual([
        ['Daily Attendance', '/attendance'],
        ['Import History', '/attendance/imports'],
        ['Summary', '/attendance/summary'],
        ['Corrections', '/attendance/corrections'],
        ['Work From Home', '/attendance/wfh'],
      ]);
      expect(pagesFor('finance')).toEqual([
        ['Daily Attendance', '/attendance'],
        ['Import History', '/attendance/imports'],
        ['Summary', '/attendance/summary'],
      ]);
      // an Admin and a Super Admin: Check-in Setup alone, the heading linking to it
      expect(pagesFor('admin')).toEqual([['Check-in Setup', '/attendance/check-in-setup']]);
      expect(pagesFor('super_admin')).toEqual([['Check-in Setup', '/attendance/check-in-setup']]);
      expect(navFor({ roles: ['admin'], employeeId: 'x' }).find((n) => n.label === 'Attendance')?.href).toBe('/attendance/check-in-setup');
      expect(navFor({ roles: ['hr'], employeeId: 'x' }).find((n) => n.label === 'Attendance')?.href).toBe('/attendance');
    });

    it('highlights the page the user is on: a person’s month under Daily Attendance, Import apart from Import History', () => {
      const current = (pathname: string) => activeSubItem(attendance, pathname)?.label ?? null;
      expect(current('/attendance')).toBe('Daily Attendance');
      expect(current('/attendance/0b8f2c1e-1111-4222-8333-444455556666')).toBe('Daily Attendance');
      expect(current('/attendance/import')).toBe('Import');
      expect(current('/attendance/imports')).toBe('Import History');
      expect(current('/attendance/summary')).toBe('Summary');
      expect(current('/attendance/corrections')).toBe('Corrections');
      expect(current('/attendance/corrections/0b8f2c1e-1111-4222-8333-444455556666')).toBe('Corrections');
      expect(current('/attendancex')).toBeNull();
      expect(isActive(attendance, '/attendance/summary')).toBe(true);
      // an import's review is on its payroll run, under Payroll
      expect(isActive(attendance, '/payroll/0b8f/attendance/1c9e')).toBe(false);
    });
  });

  it('highlights the Requests page the user is on, and Requests as the section it is in', () => {
    const requests = NAV.find((n) => n.label === 'Requests')!;
    const current = (pathname: string) => activeSubItem(requests, pathname)?.label ?? null;
    expect(current('/raise-requests')).toBe('Raise Requests');
    expect(current('/requests/details-changes')).toBe('Details Changes');
    // the list, a claim and the new claim form
    expect(current('/reimbursements')).toBe('Reimbursements');
    expect(current('/reimbursements/0b8f2c1e-1111-4222-8333-444455556666')).toBe('Reimbursements');
    expect(current('/reimbursements/new')).toBe('Reimbursements');
    expect(current('/reimbursementsx')).toBeNull();
    // the list, a request, the calendar and recording leave
    expect(current('/leave')).toBe('Leave Requests');
    expect(current('/leave/0b8f2c1e-1111-4222-8333-444455556666')).toBe('Leave Requests');
    expect(current('/leave/record')).toBe('Leave Requests');
    expect(current('/leaves')).toBeNull();
    expect(current('/approvals')).toBeNull();
    expect(current('/raise-requestsx')).toBeNull();
    expect(isActive(requests, '/raise-requests')).toBe(true);
    expect(isActive(requests, '/requests/details-changes')).toBe(true);
    expect(isActive(requests, '/reimbursements/new')).toBe(true);
    expect(isActive(requests, '/leave/new')).toBe(true);
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
    expect(activeSubItem(NAV.find((n) => n.href === '/approvals')!, '/approvals')).toBeNull();
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

  it('is Dashboard, My Profile, My Requests and My Attendance for an employee, in that order (My Attendance since 19 October 2026: "the attendance is not active in the side menu")', () => {
    expect(links({ roles: ['employee'], employeeId: ME })).toEqual([
      ['Dashboard', '/'],
      ['My Profile', `/employees/${ME}`],
      ['My Requests', MY_REQUESTS],
      ['My Attendance', MY_ATTENDANCE],
      // the KPIs heading, with My KPIs (owner, 21 October 2026)
      ['KPIs', '/kpis'],
    ]);
    expect(MY_ATTENDANCE).toBe('/my-attendance');
  });

  it('adds My Team for a direct manager', () => {
    expect(links({ roles: ['employee', 'manager'], employeeId: ME })).toEqual([
      ['Dashboard', '/'],
      ['My Profile', `/employees/${ME}`],
      ['My Requests', MY_REQUESTS],
      ['My Attendance', MY_ATTENDANCE],
      ['KPIs', '/kpis'],
      ['My Team', MY_TEAM],
    ]);
    expect(links({ roles: ['manager'], employeeId: ME }).map(([label]) => label)).toContain('My Team');
  });

  it('adds My Team for a department head or team lead without the manager role (19 October 2026), for what waits for them', () => {
    expect(links({ roles: ['employee'], employeeId: ME, leads: true })).toEqual([
      ['Dashboard', '/'],
      ['My Profile', `/employees/${ME}`],
      ['My Requests', MY_REQUESTS],
      ['My Attendance', MY_ATTENDANCE],
      ['KPIs', '/kpis'],
      ['My Team', MY_TEAM],
    ]);
    // once for a lead who is a manager too
    expect(links({ roles: ['employee', 'manager'], employeeId: ME, leads: true }).filter(([label]) => label === 'My Team')).toHaveLength(1);
    // not a lead, or an API from before leads: as before
    expect(links({ roles: ['employee'], employeeId: ME, leads: false }).map(([label]) => label)).not.toContain('My Team');
    expect(links({ roles: ['employee'], employeeId: ME }).map(([label]) => label)).not.toContain('My Team');
    expect(decidesForTeam({ roles: ['employee'], leads: true })).toBe(true);
    expect(decidesForTeam({ roles: ['manager'] })).toBe(true);
    expect(decidesForTeam({ roles: ['employee'] })).toBe(false);
    // HR who lead a department keep their own sidebar: no My Team there
    expect(navFor({ roles: ['hr'], employeeId: ME, leads: true }).map((n) => n.href)).not.toContain(MY_TEAM);
  });

  it('links My Attendance from the user menu for HR, Finance, the CEO and Admins with a profile, who check in too (19 October 2026)', () => {
    for (const role of ['hr', 'finance', 'ceo', 'admin', 'super_admin'] as const) {
      expect(myAttendanceInMenu({ roles: [role], employeeId: ME })).toBe(true);
      expect(myAttendanceInMenu({ roles: [role], employeeId: null })).toBe(false);
      expect(myAttendanceInMenu({ roles: [role] })).toBe(false);
    }
    // an employee or a manager has it in the sidebar already
    expect(myAttendanceInMenu({ roles: ['employee'], employeeId: ME })).toBe(false);
    expect(myAttendanceInMenu({ roles: ['employee', 'manager'], employeeId: ME })).toBe(false);
  });

  it('leaves out My Profile and My Attendance without a profile of their own', () => {
    expect(links({ roles: ['employee'], employeeId: null })).toEqual([
      ['Dashboard', '/'],
      ['My Requests', MY_REQUESTS],
    ]);
    expect(links({ roles: ['employee'] }).map(([label]) => label)).toEqual(['Dashboard', 'My Requests']);
  });

  it('shows them no Organization, Employees or HR page', () => {
    for (const roles of [['employee'], ['manager'], ['employee', 'manager']] as Role[][]) {
      const hrefs = navFor({ roles, employeeId: ME }).map((n) => n.href);
      for (const page of ['/organization/company', '/employees', '/contracts', '/payroll', '/attendance', '/raise-requests', '/requests/details-changes', '/reimbursements', '/leave', '/offers', '/approvals', '/templates', '/users']) {
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

  it('has nothing coming next any more: Attendance, its last item, is a heading of its own (19 October 2026)', () => {
    expect(NAV.map((n) => n.label)).toContain('Attendance');
  });
});

describe('the sidebar of HR, Finance, the CEO and Admins', () => {
  const labels = (...roles: Role[]) => navFor({ roles, employeeId: 'x' }).map((n) => n.label);

  it('is the sidebar, each item for the roles it names: Employees and Contracts under People, Offers under Recruitment', () => {
    // the KPIs after Attendance (owner, 21 October 2026), My KPIs at least for everyone with a profile; Recruitment after
    // People (22 October 2026: "where will we include the ATS?")
    expect(labels('employee', 'hr')).toEqual(['Home', 'Organization', 'People', 'Recruitment', 'Payroll', 'Requests', 'Attendance', 'KPIs', 'Approvals']);
    expect(labels('employee', 'finance')).toEqual(['Home', 'Organization', 'People', 'Payroll', 'Requests', 'Attendance', 'KPIs']);
    expect(labels('ceo')).toEqual(['Home', 'Organization', 'People', 'Recruitment', 'Payroll', 'Requests', 'Attendance', 'KPIs', 'Approvals', 'Audit Log']);
    // Attendance for Check-in Setup alone (20 October 2026: "Own page, several locations")
    expect(labels('admin')).toEqual(['Home', 'Organization', 'People', 'Requests', 'Attendance', 'KPIs', 'Approvals', 'Users']);
    expect(labels('super_admin')).toEqual(['Home', 'Organization', 'People', 'Recruitment', 'Requests', 'Attendance', 'KPIs', 'Approvals', 'Templates', 'Users', 'Audit Log']);
  });

  it('shows the Audit Log to the Super Admin, beside Users, and the CEO only (owner, 19 October 2026: "an Audit Log page showing who changed what and when")', () => {
    const audit = NAV.find((n) => n.label === 'Audit Log')!;
    expect(audit).toMatchObject({ href: AUDIT_LOG_PATH, section: '/audit' });
    expect(AUDIT_LOG_PATH).toBe('/audit');
    const all = NAV.map((n) => n.label);
    expect(all.indexOf('Audit Log')).toBe(all.indexOf('Users') + 1);
    for (const role of ['super_admin', 'ceo'] as const) expect(hasRole(as(role), ...(audit.roles ?? []))).toBe(true);
    for (const role of ['hr', 'finance', 'admin', 'manager', 'employee'] as const) expect(hasRole(as(role), ...(audit.roles ?? []))).toBe(false);
    expect(labels('hr', 'admin')).not.toContain('Audit Log');
    expect(isActive(audit, '/audit')).toBe(true);
    expect(isActive(audit, '/audit/excel')).toBe(true);
    expect(isActive(audit, '/users')).toBe(false);
  });

  describe('People', () => {
    // owner, 17 October 2026: "i think employees, contracts and offers need to be grouped from the side bar", with the
    // Employees page's reports
    const peopleFor = (...roles: Role[]) => navFor({ roles, employeeId: 'x' }).find((n) => n.label === 'People') ?? null;
    const pages = (...roles: Role[]) => peopleFor(...roles)?.items?.map((i) => i.label) ?? null;

    it('has each page for the roles that open it, and links to Employees', () => {
      // Offboarding and Former Employees (owner, 22 October 2026: the full module): the cases for those who handle them
      // and those who clear items on most of them; Former Employees for those who handle them
      expect(pages('hr')).toEqual(['Employees', 'Contracts', 'Missing Details', 'Offboarding', 'Former Employees']);
      expect(pages('ceo')).toEqual(['Employees', 'Contracts', 'Missing Details', 'Offboarding', 'Former Employees']);
      expect(pages('finance')).toEqual(['Employees', 'Contracts', 'Offboarding']);
      expect(pages('admin')).toEqual(['Employees', 'Offboarding']);
      expect(pages('super_admin')).toEqual(['Employees', 'Offboarding', 'Former Employees']);
      expect(peopleFor('hr')?.href).toBe('/employees');
    });

    it('highlights the page the user is on, a report rather than Employees', () => {
      const people = NAV.find((n) => n.label === 'People')!;
      expect(activeSubItem(people, '/employees')?.label).toBe('Employees');
      expect(activeSubItem(people, '/employees/0b8f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e')?.label).toBe('Employees');
      expect(activeSubItem(people, '/employees/missing')?.label).toBe('Missing Details');
      expect(activeSubItem(people, '/employees/former')?.label).toBe('Former Employees');
      expect(activeSubItem(people, '/offboarding/0b8f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e')?.label).toBe('Offboarding');
      expect(activeSubItem(people, '/offboarding/turnover')?.label).toBe('Offboarding');
      expect(activeSubItem(people, '/contracts/calculator')?.label).toBe('Contracts');
      // not in the menu (owner, 18 October 2026): under Employees, where they are opened from
      expect(activeSubItem(people, '/employees/documents')?.label).toBe('Employees');
      expect(activeSubItem(people, '/employees/card-corrections')?.label).toBe('Employees');
    });
  });

  // recruitment, the ATS (owner, 22 October 2026: "where will we include the ATS?")
  describe('Recruitment', () => {
    const recruitmentFor = (...roles: Role[]) => navFor({ roles, employeeId: 'x' }).find((n) => n.label === 'Recruitment') ?? null;
    const pages = (...roles: Role[]) => recruitmentFor(...roles)?.items?.map((i) => i.label) ?? null;

    it('has Vacancies, Applicants and Offers for HR and the CEO, the first two for a Super Admin, nothing for anyone else', () => {
      expect(pages('hr')).toEqual(['Vacancies', 'Applicants', 'Offers']);
      expect(pages('ceo')).toEqual(['Vacancies', 'Applicants', 'Offers']);
      expect(pages('super_admin')).toEqual(['Vacancies', 'Applicants']);
      for (const role of ['finance', 'admin', 'manager', 'employee'] as const) expect(recruitmentFor(role)).toBeNull();
      expect(recruitmentFor('hr')?.href).toBe('/recruitment/vacancies');
    });

    it('highlights the page the user is on', () => {
      const recruitment = NAV.find((n) => n.label === 'Recruitment')!;
      expect(activeSubItem(recruitment, '/recruitment/vacancies/new')?.label).toBe('Vacancies');
      expect(activeSubItem(recruitment, '/recruitment/vacancies/0b8f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e')?.label).toBe('Vacancies');
      expect(activeSubItem(recruitment, '/recruitment/applicants/0b8f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e')?.label).toBe('Applicants');
      expect(activeSubItem(recruitment, '/offers/new')?.label).toBe('Offers');
    });
  });

  describe('Requests', () => {
    const requestsFor = (...roles: Role[]) => navFor({ roles, employeeId: 'x' }).find((n) => n.label === 'Requests') ?? null;
    const pages = (...roles: Role[]) => requestsFor(...roles)?.items?.map((i) => i.label) ?? null;

    it('has Raise Requests, Details Changes, Reimbursements and Leave Requests for HR, and links to Raise Requests', () => {
      expect(pages('hr')).toEqual(['Raise Requests', 'Details Changes', 'Reimbursements', 'Leave Requests']);
      expect(pages('employee', 'hr', 'manager')).toEqual(['Raise Requests', 'Details Changes', 'Reimbursements', 'Leave Requests']);
      expect(requestsFor('hr')?.href).toBe('/raise-requests');
    });

    it('has Raise Requests and Reimbursements for Finance, who doesn’t decide details changes, and all four for the CEO, who decides C-level people’s (19 October 2026)', () => {
      expect(pages('finance')).toEqual(['Raise Requests', 'Reimbursements']);
      expect(pages('ceo')).toEqual(['Raise Requests', 'Details Changes', 'Reimbursements', 'Leave Requests']);
      expect(requestsFor('finance')?.href).toBe('/raise-requests');
      expect(requestsFor('ceo')?.href).toBe('/raise-requests');
    });

    it('has Details Changes alone for an Admin and a Super Admin, who don’t see salaries, and links to it', () => {
      expect(pages('admin')).toEqual(['Details Changes']);
      expect(pages('super_admin')).toEqual(['Details Changes']);
      expect(requestsFor('admin')?.href).toBe('/requests/details-changes');
      expect(requestsFor('super_admin')?.href).toBe('/requests/details-changes');
    });

    it('has all three for someone who is an Admin and Finance, linking to the first', () => {
      expect(pages('admin', 'finance')).toEqual(['Raise Requests', 'Details Changes', 'Reimbursements']);
      expect(requestsFor('admin', 'finance')?.href).toBe('/raise-requests');
    });

    it('is not shown to an employee or a manager, whose requests are on My Requests', () => {
      for (const roles of [['employee'], ['manager'], ['employee', 'manager']] as Role[][]) {
        const shown = navFor({ roles, employeeId: 'x' });
        expect(shown.map((n) => n.label)).not.toContain('Requests');
        // the KPIs' pages alone are under a heading (owner, 21 October 2026)
        expect(shown.flatMap((n) => n.items ?? []).every((i) => i.href.startsWith('/kpis'))).toBe(true);
        expect(shown.map((n) => n.href)).not.toContain(DETAILS_CHANGES_PATH);
        expect(shown.map((n) => n.href)).not.toContain(REIMBURSEMENTS_PATH);
        expect(shown.map((n) => n.href)).not.toContain(LEAVE_PATH);
      }
    });

    it('leaves the other headings’ pages as they are', () => {
      const sub = (label: string, ...roles: Role[]) =>
        navFor({ roles, employeeId: 'x' })
          .find((n) => n.label === label)
          ?.items?.map((i) => i.label);
      expect(sub('Payroll', 'finance')).toEqual(['Overview', 'Unsettled', 'Additions / Deductions', 'Recurring Deductions', 'Reports']);
      expect(sub('Templates', 'super_admin')).toEqual(['Library', 'Fields Guide']);
      expect(navFor({ roles: ['hr'], employeeId: 'x' }).find((n) => n.label === 'Payroll')?.href).toBe('/payroll');
      expect(navFor({ roles: ['super_admin'], employeeId: 'x' }).find((n) => n.label === 'Templates')?.href).toBe('/templates');
    });

    it('doesn’t change NAV itself for the next user', () => {
      navFor({ roles: ['admin'], employeeId: 'x' });
      const requests = NAV.find((n) => n.label === 'Requests')!;
      expect(requests.href).toBe('/raise-requests');
      expect(requests.items).toHaveLength(4);
    });
  });

  it('has none of the employee’s own links, even for HR who manage people', () => {
    for (const roles of [['hr', 'manager'], ['ceo'], ['admin', 'manager']] as Role[][]) {
      const shown = navFor({ roles, employeeId: 'x' }).map((n) => n.href);
      expect(shown).not.toContain(MY_REQUESTS);
      expect(shown).not.toContain(MY_TEAM);
      expect(shown).not.toContain(MY_ATTENDANCE);
    }
  });

  it('is Home alone while who it is for can’t be read', () => {
    expect(navFor(null).map((n) => [n.label, n.href])).toEqual([['Home', '/']]);
  });
});

describe('the KPIs (owner, 21 October 2026: "lets start with the KPI’s First")', () => {
  const ME = '3f1c2a9e-5b7d-4e1f-9a2b-6c8d0e4f1a2b';
  const kpis = (user: Parameters<typeof navFor>[0]) => navFor(user).find((n) => n.label === 'KPIs') ?? null;
  const pages = (user: Parameters<typeof navFor>[0]) => kpis(user)?.items?.map((i) => i.label) ?? null;

  it('is a heading after Attendance with My KPIs, Team KPIs, All KPIs, KPI Templates and KPI Pillars', () => {
    const labels = NAV.map((n) => n.label);
    expect(labels.indexOf('KPIs')).toBe(labels.indexOf('Attendance') + 1);
    expect(NAV).toContain(KPIS_NAV);
    expect(KPIS_NAV).toMatchObject({ href: '/kpis', section: '/kpis' });
    expect(KPIS_NAV.roles).toBeUndefined();
    expect(KPIS_NAV.items?.map((i) => [i.label, i.href])).toEqual([
      ['My KPIs', '/kpis'],
      ['Team KPIs', '/kpis/team'],
      ['All KPIs', '/kpis/all'],
      ['KPI Templates', '/kpis/templates'],
      ['KPI Pillars', '/kpis/pillars'],
    ]);
  });

  it('shows My KPIs to everyone with an employee profile, whatever their roles', () => {
    for (const roles of [['hr'], ['finance'], ['ceo'], ['admin'], ['super_admin'], ['employee'], ['manager']] as Role[][]) {
      expect(pages({ roles, employeeId: ME })).toContain('My KPIs');
      expect(pages({ roles, employeeId: null }) ?? []).not.toContain('My KPIs');
      expect(pages({ roles }) ?? []).not.toContain('My KPIs');
    }
  });

  it('shows Team KPIs to whoever scores a team: a direct manager, a head or a lead, and the CEO (the C-level people’s)', () => {
    expect(pages({ roles: ['employee', 'manager'], employeeId: ME })).toEqual(['My KPIs', 'Team KPIs']);
    expect(pages({ roles: ['employee'], employeeId: ME, leads: true })).toEqual(['My KPIs', 'Team KPIs']);
    expect(pages({ roles: ['employee'], employeeId: ME, leads: false })).toEqual(['My KPIs']);
    expect(pages({ roles: ['ceo'], employeeId: ME })).toEqual(['My KPIs', 'Team KPIs', 'All KPIs']);
    // in the full sidebar too: HR or an Admin who manage people, or lead a team
    expect(pages({ roles: ['hr', 'manager'], employeeId: ME })).toEqual(['My KPIs', 'Team KPIs', 'All KPIs', 'KPI Templates', 'KPI Pillars']);
    expect(pages({ roles: ['admin'], employeeId: ME, leads: true })).toEqual(['My KPIs', 'Team KPIs']);
    expect(pages({ roles: ['finance'], employeeId: ME })).toEqual(['My KPIs']);
  });

  it('shows All KPIs to HR, the CEO and the Super Admin, and KPI Templates and KPI Pillars to HR and the Super Admin ("Templates: HR")', () => {
    expect(pages({ roles: ['hr'], employeeId: ME })).toEqual(['My KPIs', 'All KPIs', 'KPI Templates', 'KPI Pillars']);
    expect(pages({ roles: ['super_admin'], employeeId: ME })).toEqual(['My KPIs', 'All KPIs', 'KPI Templates', 'KPI Pillars']);
    expect(pages({ roles: ['admin'], employeeId: ME })).toEqual(['My KPIs']);
    for (const roles of [['admin'], ['finance'], ['employee'], ['employee', 'manager']] as Role[][]) {
      expect(pages({ roles, employeeId: ME })).not.toContain('All KPIs');
      expect(pages({ roles, employeeId: ME })).not.toContain('KPI Templates');
      expect(pages({ roles, employeeId: ME })).not.toContain('KPI Pillars');
    }
    expect(pages({ roles: ['ceo'], employeeId: ME })).not.toContain('KPI Templates');
    expect(pages({ roles: ['ceo'], employeeId: ME })).not.toContain('KPI Pillars');
  });

  it('links the heading to the first page the user sees, and leaves it out for someone who sees none', () => {
    expect(kpis({ roles: ['hr'], employeeId: ME })?.href).toBe('/kpis');
    // without a profile of their own
    expect(kpis({ roles: ['hr'], employeeId: null })?.href).toBe('/kpis/all');
    expect(kpis({ roles: ['ceo'] })?.href).toBe('/kpis/team');
    expect(kpis({ roles: ['employee', 'manager'], employeeId: null })?.href).toBe('/kpis/team');
    expect(kpis({ roles: ['admin'], employeeId: null })).toBeNull();
    expect(kpis({ roles: ['finance'] })).toBeNull();
    expect(kpis({ roles: ['employee'], employeeId: null })).toBeNull();
  });

  it('is after My Attendance in an employee’s or a manager’s sidebar, before My Team', () => {
    const labels = navFor({ roles: ['employee', 'manager'], employeeId: ME }).map((n) => n.label);
    expect(labels.indexOf('KPIs')).toBe(labels.indexOf('My Attendance') + 1);
    expect(labels.indexOf('My Team')).toBe(labels.indexOf('KPIs') + 1);
  });

  it('highlights the page the user is on, and the heading on a scorecard’s page', () => {
    const current = (pathname: string) => activeSubItem(KPIS_NAV, pathname)?.label ?? null;
    expect(current('/kpis')).toBe('My KPIs');
    expect(current('/kpis/team')).toBe('Team KPIs');
    expect(current('/kpis/all')).toBe('All KPIs');
    expect(current('/kpis/templates')).toBe('KPI Templates');
    expect(current('/kpis/templates/0b8f2c1e-1111-4222-8333-444455556666')).toBe('KPI Templates');
    expect(current('/kpis/pillars')).toBe('KPI Pillars');
    expect(current('/kpis/pillars/0b8f2c1e-1111-4222-8333-444455556666')).toBe('KPI Pillars');
    // a scorecard: under My KPIs for those who have it, and the heading holding the page for everyone
    expect(current('/kpis/scorecards/0b8f2c1e-1111-4222-8333-444455556666')).toBe('My KPIs');
    const hr = kpis({ roles: ['hr'], employeeId: null })!;
    expect(activeSubItem(hr, '/kpis/scorecards/0b8f2c1e-1111-4222-8333-444455556666')).toBeNull();
    expect(isActive(hr, '/kpis/scorecards/0b8f2c1e-1111-4222-8333-444455556666')).toBe(true);
    expect(isActive(KPIS_NAV, '/templates')).toBe(false);
    // the document templates are not the KPI templates
    expect(isActive(NAV.find((n) => n.href === '/templates')!, '/kpis/templates')).toBe(false);
  });

  it('doesn’t change the heading itself for the next user', () => {
    navFor({ roles: ['admin'], employeeId: ME });
    navFor({ roles: ['employee'], employeeId: ME });
    expect(KPIS_NAV.href).toBe('/kpis');
    expect(KPIS_NAV.items).toHaveLength(5);
  });
});

describe('Assets (owner, 21 October 2026: "i want to add this module with a special permission to the system")', () => {
  const ME = '3f1c2a9e-5b7d-4e1f-9a2b-6c8d0e4f1a2b';
  const at = (access: AssetsAccess, values = false) => ({ access, values, ai: false });
  const assets = (user: Parameters<typeof navFor>[0]) => navFor(user).find((n) => n.label === 'Assets') ?? null;
  const pages = (user: Parameters<typeof navFor>[0]) => assets(user)?.items?.map((i) => i.label) ?? null;

  it('is a heading after the KPIs with All Assets, Custody, Holdings, Add Asset, Drafts From Claude, Needs Values, Kits, Rooms, Settings and Connect Claude, for no role as such', () => {
    const labels = NAV.map((n) => n.label);
    expect(labels.indexOf('Assets')).toBe(labels.indexOf('KPIs') + 1);
    expect(NAV).toContain(ASSETS_NAV);
    expect(ASSETS_NAV).toMatchObject({ href: '/assets', section: '/assets' });
    expect(ASSETS_NAV.roles).toBeUndefined();
    expect(ASSETS_NAV.items?.map((i) => [i.label, i.href])).toEqual([
      ['All Assets', '/assets'],
      ['Dashboard', '/assets/dashboard'],
      ['Custody', '/assets/custody'],
      ['Holdings', '/assets/holders'],
      ['Add Asset', '/assets/new'],
      ['Drafts From Claude', '/assets/drafts'],
      ['Needs Values', '/assets/needs-values'],
      ['Kits', '/assets/kits'],
      ['Stock', '/assets/stock'],
      ['Counts', '/assets/counts'],
      ['Label Sheets', '/assets/labels'],
      ['Rooms', '/assets/rooms'],
      ['Settings', '/assets/settings'],
      ['Connect Claude', '/assets/connect-claude'],
    ]);
    // the Assets access decides, never a role
    expect(ASSETS_NAV.items?.every((i) => !i.roles && i.audience)).toBe(true);
  });

  it('is hidden without Assets access, whatever the roles, and from an API from before it', () => {
    for (const roles of [['hr'], ['ceo'], ['admin'], ['employee'], ['employee', 'manager']] as Role[][]) {
      expect(assets({ roles, employeeId: ME, assets: at('none') })).toBeNull();
      expect(assets({ roles, employeeId: ME })).toBeNull();
      expect(assets({ roles, employeeId: ME, assets: null })).toBeNull();
    }
  });

  it('shows each page for its level: a viewer reads, a custodian adds, a manager has the rooms and settings', () => {
    expect(pages({ roles: ['employee'], employeeId: ME, assets: at('viewer') })).toEqual(['All Assets', 'Dashboard', 'Custody', 'Holdings', 'Kits', 'Stock', 'Counts', 'Connect Claude']);
    expect(pages({ roles: ['employee'], employeeId: ME, assets: at('custodian') })).toEqual([
      'All Assets',
      'Dashboard',
      'Custody',
      'Holdings',
      'Add Asset',
      'Drafts From Claude',
      'Kits',
      'Stock',
      'Counts',
      'Label Sheets',
      'Connect Claude',
    ]);
    expect(pages({ roles: ['hr'], employeeId: ME, assets: at('manager') })).toEqual([
      'All Assets',
      'Dashboard',
      'Custody',
      'Holdings',
      'Add Asset',
      'Drafts From Claude',
      'Kits',
      'Stock',
      'Counts',
      'Label Sheets',
      'Rooms',
      'Settings',
      'Connect Claude',
    ]);
  });

  it('shows Needs Values and Settings to those who see the values ("CEO and Finance"), whatever their level', () => {
    expect(pages({ roles: ['finance'], employeeId: ME, assets: at('viewer', true) })).toEqual([
      'All Assets',
      'Dashboard',
      'Custody',
      'Holdings',
      'Needs Values',
      'Kits',
      'Stock',
      'Counts',
      'Settings',
      'Connect Claude',
    ]);
    expect(pages({ roles: ['ceo'], employeeId: ME, assets: at('custodian', true) })).toEqual([
      'All Assets',
      'Dashboard',
      'Custody',
      'Holdings',
      'Add Asset',
      'Drafts From Claude',
      'Needs Values',
      'Kits',
      'Stock',
      'Counts',
      'Label Sheets',
      'Settings',
      'Connect Claude',
    ]);
    expect(pages({ roles: ['super_admin'], employeeId: ME, assets: at('manager', true) })).toEqual([
      'All Assets',
      'Dashboard',
      'Custody',
      'Holdings',
      'Add Asset',
      'Drafts From Claude',
      'Needs Values',
      'Kits',
      'Stock',
      'Counts',
      'Label Sheets',
      'Rooms',
      'Settings',
      'Connect Claude',
    ]);
    // a manager who isn't the CEO, Finance or a Super Admin: no values
    expect(pages({ roles: ['hr'], employeeId: ME, assets: at('manager') })).not.toContain('Needs Values');
  });

  it('is in an employee’s own sidebar too, after the KPIs, for an employee-only custodian', () => {
    const labels = navFor({ roles: ['employee'], employeeId: ME, assets: at('custodian') }).map((n) => n.label);
    expect(labels).toContain('Assets');
    expect(labels.indexOf('Assets')).toBe(labels.indexOf('KPIs') + 1);
    expect(assets({ roles: ['employee'], employeeId: ME, assets: at('custodian') })?.href).toBe('/assets');
  });

  it('highlights the page it is on, an asset’s page under All Assets', () => {
    expect(activeSubItem(ASSETS_NAV, '/assets/new')?.label).toBe('Add Asset');
    expect(activeSubItem(ASSETS_NAV, '/assets/PK-CAM-0001')?.label).toBe('All Assets');
    expect(activeSubItem(ASSETS_NAV, '/assets/needs-values')?.label).toBe('Needs Values');
    expect(activeSubItem(ASSETS_NAV, '/assets/drafts')?.label).toBe('Drafts From Claude');
    expect(activeSubItem(ASSETS_NAV, '/assets/connect-claude')?.label).toBe('Connect Claude');
    // custody (step 3): a record, its form and a new handover under Custody; a person's holdings under Holdings
    expect(activeSubItem(ASSETS_NAV, '/assets/custody/CUS-0042/form')?.label).toBe('Custody');
    expect(activeSubItem(ASSETS_NAV, '/assets/custody/new')?.label).toBe('Custody');
    expect(activeSubItem(ASSETS_NAV, '/assets/holders/3f1c2a9e-5b7d-4e1f-9a2b-6c8d0e4f1a2b')?.label).toBe('Holdings');
    // step 5 (22 October 2026): the dashboard, a count and a new one under Counts, the sheets to print under Label Sheets
    expect(activeSubItem(ASSETS_NAV, '/assets/dashboard')?.label).toBe('Dashboard');
    expect(activeSubItem(ASSETS_NAV, '/assets/counts/new')?.label).toBe('Counts');
    expect(activeSubItem(ASSETS_NAV, '/assets/counts/3f1c2a9e-5b7d-4e1f-9a2b-6c8d0e4f1a2b')?.label).toBe('Counts');
    expect(activeSubItem(ASSETS_NAV, '/assets/labels/print')?.label).toBe('Label Sheets');
    expect(isActive(ASSETS_NAV, '/asset-photo/PK-CAM-0001/x')).toBe(false);
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
