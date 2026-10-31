import { assetDraftPath, type AssetsAccess, type Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { hasRole } from '../lib/roles';
import {
  actionFor,
  activeSubItem,
  ASSETS_NAV,
  ASSETS_TABS,
  AUDIT_LOG_PATH,
  CLIENT_ACCOUNTS_PATH,
  CLIENTS_NAV,
  decidesForTeam,
  DETAILS_CHANGES_PATH,
  isActive,
  isUnder,
  KPIS_NAV,
  LEAVE_PATH,
  MY_ASSETS,
  MY_ATTENDANCE,
  MY_REQUESTS,
  MY_TEAM,
  myAssetsInMenu,
  myAttendanceInMenu,
  NAV,
  navFor,
  ORGANIZATION_NAV,
  profileBack,
  RAISE_REQUESTS_PATH,
  REIMBURSEMENTS_PATH,
  tabsFor,
} from './nav';

const as = (...roles: Role[]) => ({ roles });

describe('the sidebar', () => {
  // the pages brought into Organization's setup menu (owner, 23 October 2026: "Check-in Setup, KPI Pillars and
  // deadlines, Recruitment and checklists, Templates") are no longer under their old headings
  it('no longer has Templates, Check-in Setup, KPI Pillars or Recruitment Settings, nor the checklists', () => {
    const everywhere = NAV.flatMap((n) => [n.href, ...(n.items ?? []).map((s) => s.href)]);
    for (const old of ['/templates', '/templates/tags', '/attendance/check-in-setup', '/kpis/pillars', '/recruitment/settings', '/onboarding/checklist', '/offboarding/checklist']) {
      expect(everywhere).not.toContain(old);
    }
    expect(NAV.map((n) => n.label)).not.toContain('Templates');
    const labels = NAV.flatMap((n) => (n.items ?? []).map((s) => `${n.label} → ${s.label}`));
    for (const gone of ['Attendance → Check-in Setup', 'KPIs → KPI Pillars', 'Recruitment → Settings']) expect(labels).not.toContain(gone);
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
    // and the Contracts report beside it (25 October 2026)
    expect(current('/payroll/reports/contracts')).toBe('Reports');
    // and the Leave report (26 October 2026)
    expect(current('/payroll/reports/leave')).toBe('Reports');
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
      // the work from home days, after Leave Requests (owner, 26 October 2026: "Show it with leave"), at their old address
      ['Work From Home', '/attendance/wfh'],
    ]);
    expect([RAISE_REQUESTS_PATH, DETAILS_CHANGES_PATH, REIMBURSEMENTS_PATH, LEAVE_PATH]).toEqual(['/raise-requests', '/requests/details-changes', '/reimbursements', '/leave']);
    // each page for its own roles; the heading for whoever sees one of them
    expect(requests.roles).toBeUndefined();
    expect(requests.items?.map((i) => i.roles)).toEqual([
      ['hr', 'ceo', 'finance'],
      ['hr', 'admin', 'ceo'],
      ['hr', 'finance', 'ceo'],
      ['hr', 'ceo'],
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

    it('is a heading after Requests, for HR, the CEO and Finance, linking to Daily Attendance; no longer an Admin’s, as Check-in Setup moved to Organization (23 October 2026)', () => {
      const labels = NAV.map((n) => n.label);
      expect(labels.indexOf('Attendance')).toBe(labels.indexOf('Requests') + 1);
      expect(attendance).toMatchObject({ href: '/attendance', section: '/attendance' });
      for (const role of ['hr', 'ceo', 'finance'] as const) expect(hasRole(as(role), ...(attendance.roles ?? []))).toBe(true);
      expect(hasRole(as('employee', 'manager', 'admin', 'super_admin'), ...(attendance.roles ?? []))).toBe(false);
    });

    it('has Daily Attendance, Import (HR’s: "where am i going to import the sheets?"), Import History, Summary and Corrections for HR; the CEO all but Import; Finance neither Import nor Corrections', () => {
      expect(pagesFor('hr')).toEqual([
        ['Daily Attendance', '/attendance'],
        ['Import', '/attendance/import'],
        ['Import History', '/attendance/imports'],
        ['Summary', '/attendance/summary'],
        // the days asked to be corrected (19 October 2026: "Attendance corrections with approval")
        ['Corrections', '/attendance/corrections'],
        // the work-from-home days moved under Requests (26 October 2026: "Show it with leave")
        // the official duties (23 October 2026: "Official duty (OD) requests")
        ['Official Duty', '/attendance/official-duty'],
        // the compensatory days (26 October 2026), and their rules (27 October 2026: "i need a setup dashboard for the
        // compensatory leaves")
        ['Compensatory Days', '/attendance/compensatory'],
        ['Compensatory Setup', '/attendance/compensatory/setup'],
      ]);
      expect(pagesFor('ceo')).toEqual([
        ['Daily Attendance', '/attendance'],
        ['Import History', '/attendance/imports'],
        ['Summary', '/attendance/summary'],
        ['Corrections', '/attendance/corrections'],
        ['Official Duty', '/attendance/official-duty'],
        ['Compensatory Days', '/attendance/compensatory'],
        ['Compensatory Setup', '/attendance/compensatory/setup'],
      ]);
      expect(pagesFor('finance')).toEqual([
        ['Daily Attendance', '/attendance'],
        ['Import History', '/attendance/imports'],
        ['Summary', '/attendance/summary'],
      ]);
      // an Admin and a Super Admin: none since Check-in Setup is under Organization (23 October 2026)
      expect(pagesFor('admin')).toBeNull();
      expect(pagesFor('super_admin')).toBeNull();
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
      // Work From Home's pages are under Requests since 26 October 2026, at their old address: not Attendance's
      expect(isActive(attendance, '/attendance/wfh')).toBe(false);
      expect(isActive(attendance, '/attendance/wfh/0b8f2c1e-1111-4222-8333-444455556666')).toBe(false);
      expect(current('/attendance/wfh/record')).toBeNull();
      expect(isActive(attendance, '/attendance/official-duty')).toBe(true);
      expect(current('/attendance/wfhx')).toBe('Daily Attendance');
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
    // the work from home list, a request, the employee's form and HR's record, at their old address (26 October 2026)
    expect(current('/attendance/wfh')).toBe('Work From Home');
    expect(current('/attendance/wfh/0b8f2c1e-1111-4222-8333-444455556666')).toBe('Work From Home');
    expect(current('/attendance/wfh/new')).toBe('Work From Home');
    expect(current('/attendance/wfh/record')).toBe('Work From Home');
    expect(current('/attendance/official-duty')).toBeNull();
    expect(isActive(requests, '/attendance/wfh/record')).toBe(true);
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
    expect(isActive(ORGANIZATION_NAV, '/organization/templates/tags')).toBe(true);
    expect(isActive(ORGANIZATION_NAV, '/organization/check-in-setup')).toBe(true);
    expect(isActive(item('/approvals'), '/raise-requests')).toBe(false);
  });

  it('links an item with pages under it to the first one the user sees', () => {
    for (const item of NAV.filter((n) => n.items)) expect(item.href).toBe(item.items![0].href);
  });

  it('has no sub-item to highlight for an item without any', () => {
    expect(activeSubItem(NAV.find((n) => n.href === '/approvals')!, '/approvals')).toBeNull();
  });

  it('counts a page under a path, not one that only starts with the same letters', () => {
    expect(isUnder('/organization/templates', '/organization/templates')).toBe(true);
    expect(isUnder('/organization/templates/tags', '/organization/templates')).toBe(true);
    expect(isUnder('/organization/templates-old', '/organization/templates')).toBe(false);
    expect(isUnder('/organization/templates', '/organization/templates/tags')).toBe(false);
  });
});

describe('the sidebar of an employee or a manager', () => {
  const ME = '3f1c2a9e-5b7d-4e1f-9a2b-6c8d0e4f1a2b';
  const links = (user: Parameters<typeof navFor>[0]) => navFor(user).map((n) => [n.label, n.href]);

  it('is Dashboard, My Profile, My Requests, My Attendance and My Assets for an employee, in that order (My Attendance since 19 October 2026: "the attendance is not active in the side menu"; My Assets since 31 October 2026: "every employee sees his assets")', () => {
    expect(links({ roles: ['employee'], employeeId: ME })).toEqual([
      ['Dashboard', '/'],
      ['My Profile', `/employees/${ME}`],
      ['My Requests', MY_REQUESTS],
      ['My Attendance', MY_ATTENDANCE],
      ['My Assets', MY_ASSETS],
      // the KPIs heading, with My KPIs (owner, 21 October 2026)
      ['KPIs', '/kpis'],
    ]);
    expect(MY_ATTENDANCE).toBe('/my-attendance');
    expect(MY_ASSETS).toBe('/my-custody');
  });

  it('adds My Team for a direct manager', () => {
    expect(links({ roles: ['employee', 'manager'], employeeId: ME })).toEqual([
      ['Dashboard', '/'],
      ['My Profile', `/employees/${ME}`],
      ['My Requests', MY_REQUESTS],
      ['My Attendance', MY_ATTENDANCE],
      ['My Assets', MY_ASSETS],
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
      ['My Assets', MY_ASSETS],
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

  it('links My Assets from the user menu for HR, Finance, the CEO and Admins with a profile, who hold assets too (31 October 2026)', () => {
    for (const role of ['hr', 'finance', 'ceo', 'admin', 'super_admin'] as const) {
      expect(myAssetsInMenu({ roles: [role], employeeId: ME })).toBe(true);
      expect(myAssetsInMenu({ roles: [role], employeeId: null })).toBe(false);
      expect(myAssetsInMenu({ roles: [role] })).toBe(false);
      // their sidebar doesn't list it
      expect(navFor({ roles: [role], employeeId: ME }).map((n) => n.href)).not.toContain(MY_ASSETS);
    }
    // an employee or a manager has it in the sidebar already
    expect(myAssetsInMenu({ roles: ['employee'], employeeId: ME })).toBe(false);
    expect(myAssetsInMenu({ roles: ['employee', 'manager'], employeeId: ME })).toBe(false);
  });

  it('highlights My Assets on its page and a signed form under it, not on the custodians’ custody pages', () => {
    const mine = navFor({ roles: ['employee'], employeeId: ME }).find((n) => n.label === 'My Assets')!;
    expect(isUnder('/my-custody', mine.section!)).toBe(true);
    expect(isUnder('/my-custody/CUS-0042/files/f1', mine.section!)).toBe(true);
    expect(isUnder('/assets/custody', mine.section!)).toBe(false);
  });

  it('leaves out My Profile, My Attendance and My Assets without a profile of their own', () => {
    expect(links({ roles: ['employee'], employeeId: null })).toEqual([
      ['Dashboard', '/'],
      ['My Requests', MY_REQUESTS],
    ]);
    expect(links({ roles: ['employee'] }).map(([label]) => label)).toEqual(['Dashboard', 'My Requests']);
  });

  it('shows them no Organization, Employees or HR page', () => {
    for (const roles of [['employee'], ['manager'], ['employee', 'manager']] as Role[][]) {
      const hrefs = navFor({ roles, employeeId: ME }).map((n) => n.href);
      for (const page of ['/organization/company', '/employees', '/contracts', '/payroll', '/attendance', '/raise-requests', '/requests/details-changes', '/reimbursements', '/leave', '/offers', '/approvals', '/organization/templates', '/users']) {
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
    // Clients after the KPIs and Assets (25 October 2026)
    expect(labels('employee', 'hr')).toEqual(['Home', 'Organization', 'People', 'Recruitment', 'Payroll', 'Requests', 'Attendance', 'KPIs', 'Clients', 'Approvals', 'WhatsApp Messages']);
    expect(labels('employee', 'finance')).toEqual(['Home', 'Organization', 'People', 'Payroll', 'Requests', 'Attendance', 'KPIs', 'Clients']);
    expect(labels('ceo')).toEqual(['Home', 'Organization', 'People', 'Recruitment', 'Payroll', 'Requests', 'Attendance', 'KPIs', 'Clients', 'Approvals', 'Audit Log']);
    // no Attendance for an Admin, nor Templates for a Super Admin: Check-in Setup and Templates are under Organization
    // (23 October 2026: "Check-in Setup, KPI Pillars and deadlines, Recruitment and checklists, Templates")
    expect(labels('admin')).toEqual(['Home', 'Organization', 'People', 'Requests', 'KPIs', 'Approvals', 'Users']);
    expect(labels('super_admin')).toEqual(['Home', 'Organization', 'People', 'Recruitment', 'Requests', 'KPIs', 'Clients', 'Approvals', 'Users', 'Audit Log', 'WhatsApp Messages']);
  });

  it('shows WhatsApp Messages to HR and the Super Admin, never a developer (owner, 24 October 2026: "how to make whatsapp notifications?")', () => {
    const log = NAV.find((n) => n.label === 'WhatsApp Messages')!;
    expect(log).toMatchObject({ href: '/whatsapp-messages', section: '/whatsapp-messages' });
    for (const role of ['ceo', 'finance', 'admin'] as const) expect(labels(role)).not.toContain('WhatsApp Messages');
    expect(navFor({ roles: ['super_admin', 'hr'], employeeId: 'x', developer: true }).map((n) => n.label)).not.toContain('WhatsApp Messages');
    expect(isActive(log, '/whatsapp-messages')).toBe(true);
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
      // Resignations (owner, 26 October 2026): the requests employees sent, for HR, the CEO and a Super Admin
      expect(pages('hr')).toEqual(['Employees', 'Contracts', 'Missing Details', 'Offboarding', 'Resignations', 'Former Employees']);
      expect(pages('ceo')).toEqual(['Employees', 'Contracts', 'Missing Details', 'Offboarding', 'Resignations', 'Former Employees']);
      expect(pages('finance')).toEqual(['Employees', 'Contracts', 'Offboarding']);
      expect(pages('admin')).toEqual(['Employees', 'Offboarding']);
      expect(pages('super_admin')).toEqual(['Employees', 'Offboarding', 'Resignations', 'Former Employees']);
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

    it('has Vacancies, Applicants, Candidates, Interviews, Offers, Onboarding and Analytics for HR and the CEO (Offers not for a Super Admin), nothing for anyone else; Settings is under Organization (23 October 2026)', () => {
      expect(pages('hr')).toEqual(['Vacancies', 'Applicants', 'Candidates', 'Interviews', 'Offers', 'Onboarding', 'Analytics']);
      expect(pages('ceo')).toEqual(['Vacancies', 'Applicants', 'Candidates', 'Interviews', 'Offers', 'Onboarding', 'Analytics']);
      expect(pages('super_admin')).toEqual(['Vacancies', 'Applicants', 'Candidates', 'Interviews', 'Onboarding', 'Analytics']);
      for (const role of ['finance', 'admin', 'manager', 'employee'] as const) expect(recruitmentFor(role)).toBeNull();
      expect(recruitmentFor('hr')?.href).toBe('/recruitment/vacancies');
    });

    // Phase 2 (22 October 2026: "Show it only to people who are a hiring manager or interviewer on something open")
    it('has My Hiring for a hiring manager or an interviewer, in an employee’s own sidebar too', () => {
      const withHiring = (...roles: Role[]) => navFor({ roles, employeeId: 'x', hiring: true }).find((n) => n.label === 'Recruitment') ?? null;
      expect(withHiring('employee')?.items?.map((i) => i.label)).toEqual(['My Hiring']);
      expect(withHiring('employee')?.href).toBe('/recruitment/my-hiring');
      expect(withHiring('employee', 'manager')?.items?.map((i) => i.label)).toEqual(['My Hiring']);
      expect(withHiring('hr')?.items?.map((i) => i.label)).toEqual(['Vacancies', 'Applicants', 'Candidates', 'Interviews', 'My Hiring', 'Offers', 'Onboarding', 'Analytics']);
      expect(navFor({ roles: ['employee'], employeeId: 'x', hiring: false }).find((n) => n.label === 'Recruitment')).toBeUndefined();
    });

    it('highlights the page the user is on', () => {
      const recruitment = NAV.find((n) => n.label === 'Recruitment')!;
      expect(activeSubItem(recruitment, '/recruitment/vacancies/new')?.label).toBe('Vacancies');
      expect(activeSubItem(recruitment, '/recruitment/vacancies/0b8f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e')?.label).toBe('Vacancies');
      expect(activeSubItem(recruitment, '/recruitment/applicants/0b8f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e')?.label).toBe('Applicants');
      expect(activeSubItem(recruitment, '/offers/new')?.label).toBe('Offers');
      expect(activeSubItem(recruitment, '/recruitment/interviews')?.label).toBe('Interviews');
      expect(activeSubItem(recruitment, '/recruitment/candidates/0b8f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e')?.label).toBe('Candidates');
      expect(activeSubItem(recruitment, '/recruitment/candidates/matches')?.label).toBe('Candidates');
      expect(activeSubItem(recruitment, '/recruitment/my-hiring')?.label).toBe('My Hiring');
      expect(activeSubItem(recruitment, '/onboarding/0b8f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e')?.label).toBe('Onboarding');
      expect(activeSubItem(recruitment, '/recruitment/analytics')?.label).toBe('Analytics');
      // the checklist's page is Organization's now, not Onboarding's
      expect(activeSubItem(recruitment, '/organization/onboarding-checklist')).toBeNull();
    });
  });

  describe('Requests', () => {
    const requestsFor = (...roles: Role[]) => navFor({ roles, employeeId: 'x' }).find((n) => n.label === 'Requests') ?? null;
    const pages = (...roles: Role[]) => requestsFor(...roles)?.items?.map((i) => i.label) ?? null;

    it('has Raise Requests, Details Changes, Reimbursements, Leave Requests and Work From Home for HR, and links to Raise Requests', () => {
      expect(pages('hr')).toEqual(['Raise Requests', 'Details Changes', 'Reimbursements', 'Leave Requests', 'Work From Home']);
      expect(pages('employee', 'hr', 'manager')).toEqual(['Raise Requests', 'Details Changes', 'Reimbursements', 'Leave Requests', 'Work From Home']);
      expect(requestsFor('hr')?.href).toBe('/raise-requests');
    });

    it('has Raise Requests and Reimbursements for Finance, who doesn’t decide details changes, and all four for the CEO, who decides C-level people’s (19 October 2026)', () => {
      expect(pages('finance')).toEqual(['Raise Requests', 'Reimbursements']);
      expect(pages('ceo')).toEqual(['Raise Requests', 'Details Changes', 'Reimbursements', 'Leave Requests', 'Work From Home']);
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
      expect(navFor({ roles: ['hr'], employeeId: 'x' }).find((n) => n.label === 'Payroll')?.href).toBe('/payroll');
    });

    it('doesn’t change NAV itself for the next user', () => {
      navFor({ roles: ['admin'], employeeId: 'x' });
      const requests = NAV.find((n) => n.label === 'Requests')!;
      expect(requests.href).toBe('/raise-requests');
      // Work From Home after Leave Requests since 26 October 2026
      expect(requests.items).toHaveLength(5);
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

  it('is a heading after Attendance with My KPIs, Team KPIs, All KPIs and KPI Templates (KPI Pillars under Organization since 23 October 2026)', () => {
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
    expect(pages({ roles: ['hr', 'manager'], employeeId: ME })).toEqual(['My KPIs', 'Team KPIs', 'All KPIs', 'KPI Templates']);
    expect(pages({ roles: ['admin'], employeeId: ME, leads: true })).toEqual(['My KPIs', 'Team KPIs']);
    expect(pages({ roles: ['finance'], employeeId: ME })).toEqual(['My KPIs']);
  });

  it('shows All KPIs to HR, the CEO and the Super Admin, and KPI Templates to HR and the Super Admin ("Templates: HR")', () => {
    expect(pages({ roles: ['hr'], employeeId: ME })).toEqual(['My KPIs', 'All KPIs', 'KPI Templates']);
    expect(pages({ roles: ['super_admin'], employeeId: ME })).toEqual(['My KPIs', 'All KPIs', 'KPI Templates']);
    expect(pages({ roles: ['admin'], employeeId: ME })).toEqual(['My KPIs']);
    for (const roles of [['admin'], ['finance'], ['employee'], ['employee', 'manager']] as Role[][]) {
      expect(pages({ roles, employeeId: ME })).not.toContain('All KPIs');
      expect(pages({ roles, employeeId: ME })).not.toContain('KPI Templates');
    }
    expect(pages({ roles: ['ceo'], employeeId: ME })).not.toContain('KPI Templates');
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

  it('is after My Attendance (and My Assets, 31 October 2026) in an employee’s or a manager’s sidebar, before My Team', () => {
    const labels = navFor({ roles: ['employee', 'manager'], employeeId: ME }).map((n) => n.label);
    expect(labels.indexOf('KPIs')).toBe(labels.indexOf('My Assets') + 1);
    expect(labels.indexOf('My Assets')).toBe(labels.indexOf('My Attendance') + 1);
    expect(labels.indexOf('My Team')).toBe(labels.indexOf('KPIs') + 1);
  });

  it('highlights the page the user is on, and the heading on a scorecard’s page', () => {
    const current = (pathname: string) => activeSubItem(KPIS_NAV, pathname)?.label ?? null;
    expect(current('/kpis')).toBe('My KPIs');
    expect(current('/kpis/team')).toBe('Team KPIs');
    expect(current('/kpis/all')).toBe('All KPIs');
    expect(current('/kpis/templates')).toBe('KPI Templates');
    expect(current('/kpis/templates/0b8f2c1e-1111-4222-8333-444455556666')).toBe('KPI Templates');
    // a scorecard: under My KPIs for those who have it, and the heading holding the page for everyone
    expect(current('/kpis/scorecards/0b8f2c1e-1111-4222-8333-444455556666')).toBe('My KPIs');
    const hr = kpis({ roles: ['hr'], employeeId: null })!;
    expect(activeSubItem(hr, '/kpis/scorecards/0b8f2c1e-1111-4222-8333-444455556666')).toBeNull();
    expect(isActive(hr, '/kpis/scorecards/0b8f2c1e-1111-4222-8333-444455556666')).toBe(true);
    expect(isActive(KPIS_NAV, '/organization/templates')).toBe(false);
    // the document templates are not the KPI templates, nor the pillars the KPIs' any more
    expect(isActive(ORGANIZATION_NAV, '/kpis/templates')).toBe(false);
    expect(isActive(KPIS_NAV, '/organization/kpi-pillars')).toBe(false);
  });

  it('doesn’t change the heading itself for the next user', () => {
    navFor({ roles: ['admin'], employeeId: ME });
    navFor({ roles: ['employee'], employeeId: ME });
    expect(KPIS_NAV.href).toBe('/kpis');
    expect(KPIS_NAV.items).toHaveLength(4);
  });
});

describe('Assets (owner, 21 October 2026: "i want to add this module with a special permission to the system")', () => {
  const ME = '3f1c2a9e-5b7d-4e1f-9a2b-6c8d0e4f1a2b';
  const at = (access: AssetsAccess, values = false) => ({ access, values, ai: false });
  type User = NonNullable<Parameters<typeof navFor>[0]>;
  const assets = (user: Parameters<typeof navFor>[0]) => navFor(user).find((n) => n.label === 'Assets') ?? null;
  const entries = (user: User) => assets(user)?.items?.map((i) => i.label) ?? null;
  const entry = (user: User, label: string) => assets(user)?.items?.find((i) => i.label === label) ?? null;
  // an entry as the menu defines it, every tab whoever sees it, as the pages read it (assets/frame.tsx)
  const defined = (label: string) => ASSETS_NAV.items!.find((i) => i.label === label)!;
  // the tabs a page draws for the user (none when only one: the page alone)
  const tabs = (user: User, label: string) => tabsFor(user, defined(label)).map((t) => t.label);
  const addsAssets = (user: User) => actionFor(user, defined('All Assets'));

  // the users the owner named, one of each: the three levels ("3 levels per user"), and those who see the values ("CEO
  // and Finance", a Super Admin too) at a level each
  const user = (roles: Role[], access: AssetsAccess, values = false): User => ({ roles, employeeId: ME, assets: at(access, values) });
  const VIEWER = user(['employee'], 'viewer');
  const CUSTODIAN = user(['employee'], 'custodian');
  const MANAGER = user(['hr'], 'manager');
  const FINANCE = user(['finance'], 'viewer', true);
  const CEO = user(['ceo'], 'custodian', true);
  const SUPER_ADMIN = user(['super_admin'], 'manager', true);

  const SEVEN = ['Dashboard', 'All Assets', 'Custody', 'Kits', 'Stock', 'Counts & Labels', 'Setup'];

  // what each saw before, page by page (14 entries until 24 October 2026); each still reaches those, and no other
  const BEFORE: Record<string, string> = {
    'All Assets': '/assets',
    Dashboard: '/assets/dashboard',
    Custody: '/assets/custody',
    Holdings: '/assets/holders',
    'Add Asset': '/assets/new',
    'Drafts From Claude': '/assets/drafts',
    'Needs Values': '/assets/needs-values',
    Kits: '/assets/kits',
    Stock: '/assets/stock',
    Counts: '/assets/counts',
    'Label Sheets': '/assets/labels',
    Rooms: '/assets/rooms',
    Settings: '/assets/settings',
    'Connect Claude': '/assets/connect-claude',
  };
  const VIEWER_BEFORE = ['All Assets', 'Dashboard', 'Custody', 'Holdings', 'Kits', 'Stock', 'Counts', 'Connect Claude'];
  const CUSTODIAN_BEFORE = [...VIEWER_BEFORE, 'Add Asset', 'Drafts From Claude', 'Label Sheets'];

  // owner, 24 October 2026: "i thing we need to arragne the assets menu"; asked, "7 entries, the rest as tabs"
  it('is a heading after the KPIs with 7 entries, the other pages their tabs, for no role as such', () => {
    const labels = NAV.map((n) => n.label);
    expect(labels.indexOf('Assets')).toBe(labels.indexOf('KPIs') + 1);
    expect(NAV).toContain(ASSETS_NAV);
    // opening on the Dashboard, its first page; highlighted on every page under /assets
    expect(ASSETS_NAV).toMatchObject({ href: '/assets/dashboard', section: '/assets' });
    expect(ASSETS_NAV.roles).toBeUndefined();
    expect(ASSETS_NAV.items?.map((i) => [i.label, i.href, i.tabs?.map((t) => [t.label, t.href]) ?? null])).toEqual([
      ['Dashboard', '/assets/dashboard', null],
      [
        'All Assets',
        '/assets',
        [
          ['All', '/assets'],
          ['Needs values', '/assets/needs-values'],
          ['Drafts from Claude', '/assets/drafts'],
        ],
      ],
      [
        'Custody',
        '/assets/custody',
        [
          ['Records', '/assets/custody'],
          ['Holdings', '/assets/holders'],
        ],
      ],
      ['Kits', '/assets/kits', null],
      ['Stock', '/assets/stock', null],
      [
        'Counts & Labels',
        '/assets/counts',
        [
          ['Counts', '/assets/counts'],
          ['Label sheets', '/assets/labels'],
        ],
      ],
      [
        'Setup',
        '/assets/rooms',
        [
          ['Rooms', '/assets/rooms'],
          ['Settings', '/assets/settings'],
          ['Connect Claude', '/assets/connect-claude'],
        ],
      ],
    ]);
    // Add Asset left the menu: a button at the top right of All Assets' pages, its page where it was
    expect(ASSETS_NAV.items?.find((i) => i.label === 'All Assets')?.action).toEqual({ href: '/assets/new', label: 'Add asset', audience: 'assets-register' });
    expect(ASSETS_NAV.items?.some((i) => i.href === '/assets/new' || i.tabs?.some((t) => t.href === '/assets/new'))).toBe(false);
    // the Assets access decides, never a role: an entry by its own audience, or by its tabs'
    for (const i of ASSETS_NAV.items ?? []) {
      expect(i.roles).toBeUndefined();
      if (i.tabs) {
        expect(i.audience).toBeUndefined();
        expect(i.tabs.every((t) => !t.roles && t.audience)).toBe(true);
      } else expect(i.audience).toBe('assets');
    }
  });

  it('keeps every page at its address, each once, Add Asset’s as the button', () => {
    const pages = (ASSETS_NAV.items ?? []).flatMap((i) => (i.tabs ? i.tabs.map((t) => t.href) : [i.href]));
    expect(new Set(pages).size).toBe(pages.length);
    expect([...pages, '/assets/new'].sort()).toEqual(Object.values(BEFORE).sort());
    for (const tab of Object.values(ASSETS_TABS)) expect(tab.section).toBe(tab.href);
  });

  it('is hidden without Assets access, whatever the roles, and from an API from before it', () => {
    for (const roles of [['hr'], ['ceo'], ['admin'], ['employee'], ['employee', 'manager']] as Role[][]) {
      expect(assets({ roles, employeeId: ME, assets: at('none') })).toBeNull();
      expect(assets({ roles, employeeId: ME })).toBeNull();
      expect(assets({ roles, employeeId: ME, assets: null })).toBeNull();
    }
  });

  it.each([
    ['a viewer', VIEWER, VIEWER_BEFORE],
    ['a custodian', CUSTODIAN, CUSTODIAN_BEFORE],
    ['a manager', MANAGER, [...CUSTODIAN_BEFORE, 'Rooms', 'Settings']],
    ['Finance, a viewer who sees the values', FINANCE, [...VIEWER_BEFORE, 'Needs Values', 'Settings']],
    ['the CEO, a custodian who sees the values', CEO, [...CUSTODIAN_BEFORE, 'Needs Values', 'Settings']],
    ['a Super Admin, a manager who sees the values', SUPER_ADMIN, Object.keys(BEFORE)],
  ])('gives %s the pages they had, in the 7 entries and their tabs', (_who, u, before) => {
    expect(entries(u)).toEqual(SEVEN);
    const reached = (assets(u)?.items ?? []).flatMap((i) => (i.tabs ? i.tabs.map((t) => t.href) : [i.href]));
    const add = addsAssets(u);
    expect([...reached, ...(add ? [add.href] : [])].sort()).toEqual(before.map((label) => BEFORE[label]).sort());
    // the tabs the pages draw are those the sidebar's entries have
    for (const label of ['All Assets', 'Custody', 'Counts & Labels', 'Setup']) expect(entry(u, label)?.tabs?.map((t) => t.label)).toEqual(tabs(u, label));
  });

  it('shows a viewer the register alone, the custody records and holdings, the counts and Connect Claude', () => {
    expect(tabs(VIEWER, 'All Assets')).toEqual(['All']);
    expect(tabs(VIEWER, 'Custody')).toEqual(['Records', 'Holdings']);
    expect(tabs(VIEWER, 'Counts & Labels')).toEqual(['Counts']);
    expect(tabs(VIEWER, 'Setup')).toEqual(['Connect Claude']);
    // one tab alone: no row of tabs, the page alone; the entry links to it
    expect(entry(VIEWER, 'Setup')?.href).toBe('/assets/connect-claude');
    expect(entry(VIEWER, 'All Assets')?.href).toBe('/assets');
    expect(addsAssets(VIEWER)).toBeNull();
  });

  it('shows a custodian the drafts, the label sheets and Add asset too, and a manager the rooms and settings', () => {
    expect(tabs(CUSTODIAN, 'All Assets')).toEqual(['All', 'Drafts from Claude']);
    expect(tabs(CUSTODIAN, 'Counts & Labels')).toEqual(['Counts', 'Label sheets']);
    expect(tabs(CUSTODIAN, 'Setup')).toEqual(['Connect Claude']);
    expect(addsAssets(CUSTODIAN)?.href).toBe('/assets/new');
    expect(tabs(MANAGER, 'All Assets')).toEqual(['All', 'Drafts from Claude']);
    expect(tabs(MANAGER, 'Counts & Labels')).toEqual(['Counts', 'Label sheets']);
    expect(tabs(MANAGER, 'Setup')).toEqual(['Rooms', 'Settings', 'Connect Claude']);
    expect(entry(MANAGER, 'Setup')?.href).toBe('/assets/rooms');
    expect(addsAssets(MANAGER)?.href).toBe('/assets/new');
  });

  it('shows Needs values and Settings to those who see the values ("CEO and Finance"), whatever their level', () => {
    expect(tabs(FINANCE, 'All Assets')).toEqual(['All', 'Needs values']);
    expect(tabs(FINANCE, 'Counts & Labels')).toEqual(['Counts']);
    expect(tabs(FINANCE, 'Setup')).toEqual(['Settings', 'Connect Claude']);
    expect(entry(FINANCE, 'Setup')?.href).toBe('/assets/settings');
    // a viewer: they don't add assets
    expect(addsAssets(FINANCE)).toBeNull();
    expect(tabs(CEO, 'All Assets')).toEqual(['All', 'Needs values', 'Drafts from Claude']);
    expect(tabs(CEO, 'Counts & Labels')).toEqual(['Counts', 'Label sheets']);
    expect(tabs(CEO, 'Setup')).toEqual(['Settings', 'Connect Claude']);
    expect(addsAssets(CEO)?.href).toBe('/assets/new');
    expect(tabs(SUPER_ADMIN, 'All Assets')).toEqual(['All', 'Needs values', 'Drafts from Claude']);
    expect(tabs(SUPER_ADMIN, 'Custody')).toEqual(['Records', 'Holdings']);
    expect(tabs(SUPER_ADMIN, 'Counts & Labels')).toEqual(['Counts', 'Label sheets']);
    expect(tabs(SUPER_ADMIN, 'Setup')).toEqual(['Rooms', 'Settings', 'Connect Claude']);
    expect(addsAssets(SUPER_ADMIN)?.href).toBe('/assets/new');
    // a manager who isn't the CEO, Finance or a Super Admin: no values
    expect(tabs(MANAGER, 'All Assets')).not.toContain('Needs values');
  });

  it('is in an employee’s own sidebar too, after the KPIs, for an employee-only custodian, opening on the Dashboard', () => {
    const labels = navFor(CUSTODIAN).map((n) => n.label);
    expect(labels).toContain('Assets');
    expect(labels.indexOf('Assets')).toBe(labels.indexOf('KPIs') + 1);
    expect(assets(CUSTODIAN)?.href).toBe('/assets/dashboard');
    expect(entries(CUSTODIAN)).toEqual(SEVEN);
  });

  it('highlights the entry on any of its tabs’ pages and the pages under them', () => {
    const on = (pathname: string, item = ASSETS_NAV) => activeSubItem(item, pathname)?.label ?? null;
    // an asset's page (its QR label's address) and its own pages, Add asset and a draft's review on its form
    for (const page of ['/assets', '/assets/PK-CAM-0001', '/assets/PK-CAM-0001/edit', '/assets/PK-CAM-0001/values', '/assets/PK-CAM-0001/label', '/assets/new']) {
      expect(on(page)).toBe('All Assets');
    }
    expect(on(new URL(assetDraftPath(ME), 'https://people.trendlix.com').pathname)).toBe('All Assets');
    expect(on('/assets/needs-values')).toBe('All Assets');
    expect(on('/assets/drafts')).toBe('All Assets');
    // a custody record, its form, a new handover; the holdings, a person's and their statement
    for (const page of ['/assets/custody', '/assets/custody/new', '/assets/custody/CUS-0042', '/assets/custody/CUS-0042/form', '/assets/holders', `/assets/holders/${ME}`, `/assets/holders/${ME}/statement`]) {
      expect(on(page)).toBe('Custody');
    }
    expect(on('/assets/kits')).toBe('Kits');
    expect(on('/assets/stock')).toBe('Stock');
    // a count, a new one; the label sheets and the sheets to print
    for (const page of ['/assets/counts', '/assets/counts/new', `/assets/counts/${ME}`, '/assets/labels', '/assets/labels/print']) expect(on(page)).toBe('Counts & Labels');
    for (const page of ['/assets/rooms', '/assets/settings', '/assets/connect-claude']) expect(on(page)).toBe('Setup');
    expect(on('/assets/dashboard')).toBe('Dashboard');
    // as each user's sidebar has them: their entry, linking to its first tab they see
    expect(activeSubItem(assets(VIEWER)!, '/assets/connect-claude')?.href).toBe('/assets/connect-claude');
    expect(activeSubItem(assets(FINANCE)!, '/assets/settings')?.href).toBe('/assets/settings');
    expect(activeSubItem(assets(VIEWER)!, `/assets/holders/${ME}`)?.label).toBe('Custody');
    expect(activeSubItem(assets(CEO)!, '/assets/needs-values')?.label).toBe('All Assets');
    // not the photos, nor the phone pages (/app/assets…, which have their own menu)
    expect(isActive(ASSETS_NAV, '/asset-photo/PK-CAM-0001/x')).toBe(false);
    expect(isActive(ASSETS_NAV, '/app/assets')).toBe(false);
  });

  it('doesn’t change the menu itself for the next user', () => {
    const before = JSON.stringify(ASSETS_NAV);
    navFor(VIEWER);
    navFor(FINANCE);
    expect(JSON.stringify(ASSETS_NAV)).toBe(before);
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

// Organization, the setup home (owner, 23 October 2026: "Side menu with headings"): one link, for whoever sees a setup
// page, to the first they see (organization/setup-pages.ts)
describe('Organization', () => {
  const organization = (user: Parameters<typeof navFor>[0]) => navFor(user).find((n) => n.label === 'Organization') ?? null;

  it('stays one link, no heading of its own, highlighted on every setup page', () => {
    expect(NAV).toContain(ORGANIZATION_NAV);
    expect(ORGANIZATION_NAV.items).toBeUndefined();
    expect(NAV.map((n) => n.label).indexOf('Organization')).toBe(1);
    for (const page of ['/organization/company', '/organization/email', '/organization/templates/nda', '/organization/check-in-setup', '/organization/kpi-pillars/0b8f', '/organization/clearance-checklist']) {
      expect(isActive(ORGANIZATION_NAV, page)).toBe(true);
    }
  });

  it('is shown to whoever sees a setup page, linking to the first: Company Details for everyone who had the tabs', () => {
    for (const roles of [['hr'], ['finance'], ['ceo'], ['admin'], ['super_admin'], ['employee', 'hr'], ['admin', 'finance']] as Role[][]) {
      expect(organization({ roles, employeeId: 'x' })?.href).toBe('/organization/company');
    }
    // a developer, with a Super Admin's sight
    expect(organization({ roles: ['super_admin'], developer: true })?.href).toBe('/organization/company');
  });

  it('is never an employee’s or a manager’s, nor anyone’s while who it is can’t be read', () => {
    for (const roles of [['employee'], ['manager'], ['employee', 'manager']] as Role[][]) {
      expect(organization({ roles, employeeId: 'x' })).toBeNull();
      expect(organization({ roles, employeeId: 'x', leads: true, hiring: true })).toBeNull();
    }
    expect(organization(null)).toBeNull();
  });

  it('doesn’t change the item itself for the next user', () => {
    navFor({ roles: ['hr'], employeeId: 'x' });
    expect(ORGANIZATION_NAV).toEqual({ href: '/organization/company', label: 'Organization', section: '/organization' });
  });
});

describe('Clients (owner, 25 October 2026: "if an employee has an allowance per account, how can we deal with it?")', () => {
  const clients = (...roles: Role[]) => navFor({ roles, employeeId: 'x' }).find((n) => n.label === 'Clients') ?? null;

  it('is a heading with Client Accounts, for HR, the CEO, Finance and a Super Admin; never an Admin’s or an employee’s', () => {
    expect(NAV).toContain(CLIENTS_NAV);
    expect(CLIENTS_NAV.items?.map((i) => [i.label, i.href, i.roles])).toEqual([['Client Accounts', '/clients/accounts', ['hr', 'ceo', 'finance', 'super_admin']]]);
    for (const roles of [['hr'], ['ceo'], ['finance'], ['super_admin']] as Role[][]) {
      expect(clients(...roles)).toMatchObject({ href: CLIENT_ACCOUNTS_PATH, items: [{ label: 'Client Accounts' }] });
    }
    for (const roles of [['admin'], ['employee'], ['employee', 'manager']] as Role[][]) expect(clients(...roles)).toBeNull();
    expect(activeSubItem(CLIENTS_NAV, '/clients/accounts')?.label).toBe('Client Accounts');
  });
});
