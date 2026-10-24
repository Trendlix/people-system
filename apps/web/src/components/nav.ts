// Sidebar items. Kept out of the 'use client' file so server components can read them. Relative imports: the tests run
// without the "@/" alias.
import { assetsCan, type AssetsAccessView, type Role } from '@trendlix/shared';
import { ATTENDANCE_PATH, ATTENDANCE_SECTIONS } from '../app/(app)/attendance/sections';
import { PAYROLL_SECTIONS } from '../app/(app)/payroll/sections';
import { firstSetupPage, SETUP_PATHS } from '../app/(app)/organization/setup-pages';
import { ASSET_PATHS, CUSTODY_PATHS } from '../lib/asset-paths';
import { KPI_PATHS } from '../lib/kpi-paths';
import { hasRole, isSelfService } from '../lib/roles';

export interface NavItem {
  href: string;
  label: string;
  /** Highlighted on every page under this path. */
  section?: string;
  /**
   * Shown only to users with one of these roles (a Super Admin counts as an Admin: `hasRole`). Hiding a link is a
   * convenience: the API checks every request.
   */
  roles?: Role[];
  /**
   * Links shown under this one (indented, smaller), each for whoever sees the item or for the roles it names. An item
   * with them is a heading that opens and closes them, no longer a link (owner, 20 October 2026: "make the side menu
   * subs expandable"; nav-groups.ts); its href is the first one the user sees (navFor), the page it linked to before.
   */
  items?: NavSubItem[];
}

export interface NavSubItem {
  href: string;
  label: string;
  /** Highlighted on every page under this path; when several match, the one with the longest path. */
  section: string;
  /**
   * Shown only to users with one of these roles, as an item's `roles`; none: to whoever sees its item. An item whose
   * sub-items all have roles is shown to whoever sees at least one of them, and links to the first they see.
   */
  roles?: Role[];
  /**
   * Shown also to these users, whatever their roles (alone, without `roles`: to them only): `profile`, those with an
   * employee profile of their own; `team`, those who decide for a team (decidesForTeam: a direct manager, a department's
   * head or a team's lead). For pages that are about the user's own work rather than a role's (owner, 21 October 2026:
   * My KPIs and Team KPIs). The Assets pages (owner, 21 October 2026: "i want to add this module with a special
   * permission to the system"; "3 levels per user") go by the user's Assets access, not their roles: `assets`, any
   * access (viewer and up); `assets-register`, a custodian or manager; `assets-manager`, a manager; `asset-values`, those
   * who see the values (the CEO, Finance, a Super Admin: "CEO and Finance"); `assets-settings`, a manager or one of
   * them. A word, not a function: the sidebar's items go to the browser as they are.
   */
  audience?: NavAudience;
  /**
   * Its pages as tabs (owner, 24 October 2026, on the 14 pages under Assets: "i thing we need to arragne the assets
   * menu"; asked, "7 entries, the rest as tabs"), each page keeping its own address and its own `roles` or `audience`, as
   * a sub-item's: the sub-item is shown to whoever sees at least one of them and links to the first they see (its own
   * roles and audience are left out then), and it is highlighted on any of their pages and the pages under them. The
   * pages draw the row of tabs the user sees (tabsFor), none when they see one alone.
   */
  tabs?: NavTab[];
  /** A button at the top right of its pages, for whoever it names (the Assets' Add asset: actionFor). */
  action?: NavAction;
}

/** A page shown as a tab on a sidebar page's pages (NavSubItem.tabs); its label in sentence case, as tabs are. */
export interface NavTab {
  href: string;
  label: string;
  /** Its sub-item is highlighted on every page under this path. */
  section: string;
  roles?: Role[];
  audience?: NavAudience;
}

/** A button on a sidebar page's pages (NavSubItem.action), for its roles or audience, as a tab's; sentence case. */
export interface NavAction {
  href: string;
  label: string;
  roles?: Role[];
  audience?: NavAudience;
}

/** Who a sub-item is for besides its roles (NavSubItem.audience). */
export type NavAudience = 'profile' | 'team' | 'assets' | 'assets-register' | 'assets-manager' | 'asset-values' | 'assets-settings' | 'hiring';

/**
 * The KPIs (owner, 21 October 2026: "lets start with the KPI's First", "Full framework per role"): a heading with its
 * pages, each for whoever it concerns. My KPIs, their own scorecards, for anyone with an employee profile; Team KPIs,
 * the scorecards they score, for a direct manager, a department's head or a team's lead (the person in charge scores:
 * "The manager is the approver in charge") and the CEO, who scores the C-level people ("For C-level people the CEO
 * scores"); All KPIs, every scorecard by month, for HR, the CEO and the Super Admin; KPI Templates for HR and the Super
 * Admin ("Templates: HR"). KPI Pillars, the company's and each department's (owner, 22 October 2026: "but i need
 * pillars to each department"), were here for them too until they moved, with the deadlines, to Organization's setup
 * menu (owner, 23 October 2026: "Check-in Setup, KPI Pillars and deadlines, Recruitment and checklists, Templates"). In
 * both sidebars, each with the pages its user sees.
 */
export const KPIS_NAV: NavItem = {
  href: KPI_PATHS.mine,
  label: 'KPIs',
  section: '/kpis',
  items: [
    { href: KPI_PATHS.mine, label: 'My KPIs', section: KPI_PATHS.mine, audience: 'profile' },
    { href: KPI_PATHS.team, label: 'Team KPIs', section: KPI_PATHS.team, roles: ['ceo'], audience: 'team' },
    { href: KPI_PATHS.all, label: 'All KPIs', section: KPI_PATHS.all, roles: ['hr', 'ceo', 'super_admin'] },
    { href: KPI_PATHS.templates, label: 'KPI Templates', section: KPI_PATHS.templates, roles: ['hr', 'super_admin'] },
  ],
};

/**
 * Assets (owner, 21 October 2026: "i want to add this module with a special permission to the system"; "3 levels per
 * user"), after the KPIs: a heading with its pages, each for the Assets access it needs, never a role: All Assets (the
 * register) and Kits for anyone with access, Add Asset for a custodian or a manager, Needs Values for those who see the
 * values (the CEO, Finance and a Super Admin: "CEO and Finance"), Rooms for a manager, Settings (the capitalization
 * threshold) for a manager or those who see the values. Without access, none of them: the heading is left out (and the
 * API answers 403). In both sidebars: an employee-only custodian sees it too. Step 2 (owner, 21 October 2026: "the
 * connection method"): Drafts From Claude for a custodian or a manager (who confirm them), Connect Claude for anyone
 * with access (the connector reads at their level). Step 3 (custody, 21 October 2026): Custody, the custody records,
 * and Holdings, what each person holds, after All Assets, for anyone with access (a custodian or a manager hands over and
 * receives back from them). Step 4 (22 October 2026: "kits / stock / repairs / disposal"): Stock, the consumables with
 * Use and Restock, after Kits, for anyone with access (a custodian or a manager moves the stock).
 * Step 5 (22 October 2026): the Dashboard, for anyone with access; Counts after Stock, for anyone with access (a
 * custodian or a manager counts); Label Sheets for a custodian or a manager.
 * Those 14 pages arranged in 7 entries (owner, 24 October 2026: "i thing we need to arragne the assets menu"; asked, "7
 * entries, the rest as tabs", and "Keep them inside Assets", as Assets has its own access): the Dashboard first, All
 * Assets with the register, Needs values and the drafts as tabs and Add asset as a button (its page stays, no longer in
 * the menu), Custody with the records and the holdings, Kits, Stock, Counts & Labels, and Setup with the rooms, the
 * settings and Connect Claude. Every page keeps its address and its audience: each person sees the pages they saw.
 * ASSETS_TABS are the pages shown as tabs; ASSETS_NAV the heading with its entries.
 */
export const ASSETS_TABS = {
  register: { href: ASSET_PATHS.list, label: 'All', section: ASSET_PATHS.list, audience: 'assets' },
  needsValues: { href: ASSET_PATHS.needsValues, label: 'Needs values', section: ASSET_PATHS.needsValues, audience: 'asset-values' },
  drafts: { href: ASSET_PATHS.drafts, label: 'Drafts from Claude', section: ASSET_PATHS.drafts, audience: 'assets-register' },
  custody: { href: CUSTODY_PATHS.list, label: 'Records', section: CUSTODY_PATHS.list, audience: 'assets' },
  holdings: { href: CUSTODY_PATHS.holders, label: 'Holdings', section: CUSTODY_PATHS.holders, audience: 'assets' },
  // step 5 (22 October 2026: "stock counts, label sheets"): the counts for anyone with access (a custodian or a manager
  // counts), the label sheets for a custodian or a manager
  counts: { href: ASSET_PATHS.counts, label: 'Counts', section: ASSET_PATHS.counts, audience: 'assets' },
  labels: { href: ASSET_PATHS.labels, label: 'Label sheets', section: ASSET_PATHS.labels, audience: 'assets-register' },
  rooms: { href: ASSET_PATHS.rooms, label: 'Rooms', section: ASSET_PATHS.rooms, audience: 'assets-manager' },
  settings: { href: ASSET_PATHS.settings, label: 'Settings', section: ASSET_PATHS.settings, audience: 'assets-settings' },
  connectClaude: { href: ASSET_PATHS.connectClaude, label: 'Connect Claude', section: ASSET_PATHS.connectClaude, audience: 'assets' },
} as const satisfies Record<string, NavTab>;

export const ASSETS_NAV: NavItem = {
  href: ASSET_PATHS.dashboard,
  label: 'Assets',
  section: ASSET_PATHS.list,
  items: [
    // step 5 (22 October 2026: "the Assets dashboard"): the figures, the chips that need attention and the exports
    { href: ASSET_PATHS.dashboard, label: 'Dashboard', section: ASSET_PATHS.dashboard, audience: 'assets' },
    // the register's pages, an asset's own (/assets/{code}) and a draft's review on the Add form (/assets/new?draft=) under
    // it; Add asset for a custodian or a manager
    {
      href: ASSET_PATHS.list,
      label: 'All Assets',
      section: ASSET_PATHS.list,
      tabs: [ASSETS_TABS.register, ASSETS_TABS.needsValues, ASSETS_TABS.drafts],
      action: { href: ASSET_PATHS.new, label: 'Add asset', audience: 'assets-register' },
    },
    { href: CUSTODY_PATHS.list, label: 'Custody', section: CUSTODY_PATHS.list, tabs: [ASSETS_TABS.custody, ASSETS_TABS.holdings] },
    { href: ASSET_PATHS.kits, label: 'Kits', section: ASSET_PATHS.kits, audience: 'assets' },
    // step 4 (22 October 2026): the consumables' stock, Use and Restock
    { href: ASSET_PATHS.stock, label: 'Stock', section: ASSET_PATHS.stock, audience: 'assets' },
    { href: ASSET_PATHS.counts, label: 'Counts & Labels', section: ASSET_PATHS.counts, tabs: [ASSETS_TABS.counts, ASSETS_TABS.labels] },
    { href: ASSET_PATHS.rooms, label: 'Setup', section: ASSET_PATHS.rooms, tabs: [ASSETS_TABS.rooms, ASSETS_TABS.settings, ASSETS_TABS.connectClaude] },
  ],
};

/** The Raise Requests page (app/(app)/raise-requests), under Requests. */
export const RAISE_REQUESTS_PATH = '/raise-requests';

/** The employees' requests to change their details (app/(app)/requests/details-changes), under Requests. */
export const DETAILS_CHANGES_PATH = '/requests/details-changes';

/** The employees' reimbursement claims (app/(app)/reimbursements), under Requests. */
export const REIMBURSEMENTS_PATH = '/reimbursements';

/** The employees' leave requests and the month's calendar of who is off (app/(app)/leave), under Requests. */
export const LEAVE_PATH = '/leave';

/**
 * Recruitment, the ATS (owner, 22 October 2026: "where will we include the ATS?"): the vacancies (the CEO approves them
 * before the careers page shows them), every applicant, the interviews to come, the job offers (moved here from People:
 * the offer stage, before someone is an employee; owner's request, 15 October 2026), onboarding and the analytics, for
 * HR, the CEO and a Super Admin (the settings, the rejection email, moved to Organization's setup menu on 23 October
 * 2026: "Recruitment and checklists"); and My Hiring (Phase 2: "Show it only to people who
 * are a hiring manager or interviewer on something open"), for a vacancy's hiring manager and the interviewers, in
 * anyone's sidebar, an employee's too.
 */
export const RECRUITMENT_NAV: NavItem = {
  href: '/recruitment/vacancies',
  label: 'Recruitment',
  items: [
    { href: '/recruitment/vacancies', label: 'Vacancies', section: '/recruitment/vacancies', roles: ['hr', 'ceo', 'super_admin'] },
    { href: '/recruitment/applicants', label: 'Applicants', section: '/recruitment/applicants', roles: ['hr', 'ceo', 'super_admin'] },
    // one profile per candidate (22 October 2026: "how to make like a profile for each candidate to store history and prevent duplication?")
    { href: '/recruitment/candidates', label: 'Candidates', section: '/recruitment/candidates', roles: ['hr', 'ceo', 'super_admin'] },
    { href: '/recruitment/interviews', label: 'Interviews', section: '/recruitment/interviews', roles: ['hr', 'ceo', 'super_admin'] },
    { href: '/recruitment/my-hiring', label: 'My Hiring', section: '/recruitment/my-hiring', audience: 'hiring' },
    { href: '/offers', label: 'Offers', section: '/offers', roles: ['hr', 'ceo'] },
    { href: '/onboarding', label: 'Onboarding', section: '/onboarding', roles: ['hr', 'ceo', 'super_admin'] },
    { href: '/recruitment/analytics', label: 'Analytics', section: '/recruitment/analytics', roles: ['hr', 'ceo', 'super_admin'] },
  ],
};

/** The Audit Log (app/(app)/audit): who changed what and when, for the Super Admin and the CEO. */
export const AUDIT_LOG_PATH = '/audit';

/**
 * Organization, the setup home (owner, 23 October 2026: "lets perform a regorganization of this menu. we can perform
 * groupings to related items"; "Side menu with headings"), one link: to the first setup page the user sees (navFor), for
 * whoever sees one (organization/setup-pages.ts); its pages are in its own menu, not here.
 */
export const ORGANIZATION_NAV: NavItem = { href: SETUP_PATHS.company, label: 'Organization', section: '/organization' };

export const NAV: NavItem[] = [
  { href: '/', label: 'Home' },
  ORGANIZATION_NAV,
  // the people the company employs, under one heading (owner, 17 October 2026: "i think employees, contracts and offers
  // need to be grouped from the side bar", with the Missing Details report; Search Documents and Card Reading Fixes left
  // it on 18 October 2026, as not used every day: the first is a button on the Employees page, the second a link in the
  // ID card scan); each page for its own roles, the heading for whoever sees one of them, linking to the first they see
  {
    href: '/employees',
    label: 'People',
    items: [
      { href: '/employees', label: 'Employees', section: '/employees' },
      { href: '/contracts', label: 'Contracts', section: '/contracts', roles: ['hr', 'ceo', 'finance'] },
      // what each profile still lacks
      { href: '/employees/missing', label: 'Missing Details', section: '/employees/missing', roles: ['hr', 'ceo'] },
      // offboarding (owner, 22 October 2026: the full module; "where will the data be stored? will it be another tab?"):
      // the cases, for those who handle them and those who clear items on most (an Admin, a Super Admin, Finance); a
      // direct manager opens theirs from its notification. Former Employees, for those who handle cases
      { href: '/offboarding', label: 'Offboarding', section: '/offboarding', roles: ['hr', 'ceo', 'super_admin', 'admin', 'finance'] },
      { href: '/employees/former', label: 'Former Employees', section: '/employees/former', roles: ['hr', 'ceo', 'super_admin'] },
    ],
  },
  RECRUITMENT_NAV,
  // the month's pay: HR prepares a run, the CEO approves it, HR marks it paid (owner's decisions, 16 October 2026); a
  // heading with its pages under it (owner, 17 October 2026: "make the Payroll in the side tab a main title below it -
  // Overview - Unsettled - Additions / Deductions - Reports (Statistics)"), the runs under Overview
  {
    href: '/payroll',
    label: 'Payroll',
    section: '/payroll',
    roles: ['hr', 'finance', 'ceo'],
    items: PAYROLL_SECTIONS.map((s) => ({ href: s.href, label: s.label, section: s.href })),
  },
  // the requests HR and the others decide, under one heading (owner, 17 October 2026: asked whether raise requests are
  // about money or requests like the others, the owner chose "A Requests heading"); each page for its own roles, the
  // heading for whoever sees one of them, with no page of its own: it links to the first page they see (navFor), Raise
  // Requests for HR, Finance and the CEO, Details Changes for an Admin; Reimbursements since 18 October 2026. Approvals
  // stays the inbox of what waits for the user, and an employee's own requests stay on My Requests.
  {
    href: RAISE_REQUESTS_PATH,
    label: 'Requests',
    items: [
      // raises asked for by the employee, their manager or HR, through HR and the CEO (owner's decisions, 16 October
      // 2026); Finance may view them
      { href: RAISE_REQUESTS_PATH, label: 'Raise Requests', section: RAISE_REQUESTS_PATH, roles: ['hr', 'ceo', 'finance'] },
      // the employees' requests to change their details, which HR and Admin (a Super Admin too) decide (owner's decision,
      // 15 October 2026); a C-level person's the CEO decides (owner, 19 October 2026: "make C level Employees details not
      // visible to HR"), so the CEO has it too, with those alone
      { href: DETAILS_CHANGES_PATH, label: 'Details Changes', section: DETAILS_CHANGES_PATH, roles: ['hr', 'admin', 'ceo'] },
      // the employees' reimbursement claims, through their direct manager, HR and Finance (owner, 18 October 2026: "allow
      // the employee to add reimbursement request … for specific preset up conditions"); the CEO may view them
      { href: REIMBURSEMENTS_PATH, label: 'Reimbursements', section: REIMBURSEMENTS_PATH, roles: ['hr', 'finance', 'ceo'] },
      // the employees' leave, through their direct manager, then HR (owner, 18 October 2026: "if we will work on the
      // attendance and leaves, how will we build it?", leaves first, then "can you apply the leaves according to the
      // law?"), with the month's calendar of who is off; HR decides and records leave, the CEO may view them; a direct
      // manager decides their team's from My Team, an employee asks from My Requests
      { href: LEAVE_PATH, label: 'Leave Requests', section: LEAVE_PATH, roles: ['hr', 'ceo'] },
    ],
  },
  // attendance (owner, 19 October 2026: "the attendance is not active in the side menu"; it was under Coming Next until
  // then): a heading with its pages, for HR, the CEO and Finance (Finance read only); Import is HR's (owner, the same
  // day: "where am i going to import the sheets?"). A manager sees their team's from My Team, an employee their own on
  // My Attendance. Check-in Setup (owner, 20 October 2026: "Own page, several locations"), HR's and Admin's, was here,
  // an Admin's one page under it, until it moved to Organization's setup menu (owner, 23 October 2026: "Check-in Setup,
  // KPI Pillars and deadlines, Recruitment and checklists, Templates").
  {
    href: ATTENDANCE_PATH,
    label: 'Attendance',
    section: ATTENDANCE_PATH,
    roles: ['hr', 'ceo', 'finance'],
    items: ATTENDANCE_SECTIONS.map((s) => ({ href: s.href, label: s.label, section: s.href, ...(s.roles && { roles: [...s.roles] }) })),
  },
  // the KPIs, after Attendance (owner, 21 October 2026)
  KPIS_NAV,
  // Assets, after the KPIs, for those with Assets access (owner, 21 October 2026)
  ASSETS_NAV,
  { href: '/approvals', label: 'Approvals', section: '/approvals', roles: ['hr', 'ceo', 'admin'] },
  // Templates, a Super Admin's heading with the Library and the Fields Guide (owner, 19 October 2026: "enable templates
  // sidebar to super admin only"), was here until it moved to Organization's setup menu (23 October 2026)
  { href: '/users', label: 'Users', section: '/users', roles: ['admin'] },
  // who changed what and when (owner, 19 October 2026: "an Audit Log page showing who changed what and when"): the
  // Super Admin's and the CEO's, last: beside Users for the Super Admin, after Approvals for the CEO
  { href: AUDIT_LOG_PATH, label: 'Audit Log', section: AUDIT_LOG_PATH, roles: ['super_admin', 'ceo'] },
];

// ---------- the employee's own side (owner's decisions, 17 October 2026) ----------

/** The employee's own requests: the changes to their details and the raises they asked for (app/(app)/my-requests). */
export const MY_REQUESTS = '/my-requests';

/** A direct manager's direct reports (app/(app)/my-team), and what waits for them to decide. */
export const MY_TEAM = '/my-team';

/** The employee's own attendance, month by month (app/(app)/my-attendance; owner, 19 October 2026). */
export const MY_ATTENDANCE = '/my-attendance';

/**
 * Who the sidebar is for: their roles, their own employee profile (none: null; an API from before it: left out),
 * whether they lead a department or a team (`leads`; left out by an API from before it), and their Assets access
 * (`assets`, 21 October 2026; left out by an API from before it: none).
 */
type NavUser = { roles: readonly Role[]; employeeId?: string | null; leads?: boolean; assets?: AssetsAccessView | null; hiring?: boolean; developer?: boolean };

/**
 * Whether someone decides others' leave and reimbursement claims first, on My Team: a direct manager, or the person in
 * charge of a department or team (owner, 19 October 2026: "i want to add department lead person, the person in
 * charge"), who decides them for its people without a direct manager, with or without the manager role.
 */
export const decidesForTeam = (user: Pick<NavUser, 'roles' | 'leads'>) => hasRole(user, 'manager') || user.leads === true;

/**
 * Whether the user menu links to My Attendance (owner, 19 October 2026: "Check-in through the system (phone or web with
 * the office location check, or a device) to replace Zoho"): HR, Finance, the CEO and Admins with an employee profile
 * check in too, and their sidebar doesn't list it; an employee's or a manager's sidebar has it.
 */
export const myAttendanceInMenu = (user: NavUser): boolean => !!user.employeeId && !isSelfService(user);

/**
 * The sidebar of someone who is only an employee and/or a direct manager (isSelfService), as the owner suggested it (17
 * October 2026: "my suggestion for the employee side bar is 1- Dashboard 2- My Profile 3- My Requests"): their
 * dashboard (the home page), their own profile (when they have one) and their requests; their own attendance with
 * their profile (owner, 19 October 2026: "the attendance is not active in the side menu"); their KPIs (21 October 2026:
 * My KPIs, and Team KPIs for whoever scores a team's); a manager also My Team, their
 * direct reports, so they can reach their profiles (and their month's attendance). Nothing else: not Organization (the
 * owner: "dont show him the organization tab"), nor the Employees list or any HR page.
 */
function selfServiceNav(user: NavUser): NavItem[] {
  const profile = user.employeeId ? `/employees/${user.employeeId}` : null;
  return [
    { href: '/', label: 'Dashboard' },
    ...(profile ? [{ href: profile, label: 'My Profile', section: profile }] : []),
    { href: MY_REQUESTS, label: 'My Requests', section: MY_REQUESTS },
    ...(profile ? [{ href: MY_ATTENDANCE, label: 'My Attendance', section: MY_ATTENDANCE }] : []),
    // their KPIs (owner, 21 October 2026): My KPIs with their profile, Team KPIs for whoever scores a team's
    ...shownWithItems(user, KPIS_NAV),
    // Assets, with an Assets access given on the Users page (owner, 21 October 2026: "3 levels per user")
    ...shownWithItems(user, ASSETS_NAV),
    // My Hiring, for a vacancy's hiring manager and the interviewers (recruitment, Phase 2, 22 October 2026)
    ...shownWithItems(user, RECRUITMENT_NAV),
    // a department's head or a team's lead too (19 October 2026), for what waits for them there
    ...(decidesForTeam(user) ? [{ href: MY_TEAM, label: 'My Team', section: MY_TEAM }] : []),
  ];
}

/** Whether the user is among a sub-item's audience (NavSubItem.audience). */
function inAudience(user: NavUser, audience: NavAudience | undefined): boolean {
  if (audience === 'profile') return !!user.employeeId;
  if (audience === 'team') return decidesForTeam(user);
  if (audience === 'hiring') return user.hiring === true;
  if (audience === undefined) return false;
  const can = assetsCan(user.assets ?? { access: 'none', values: false, ai: false });
  switch (audience) {
    case 'assets':
      return can.view;
    case 'assets-register':
      return can.register;
    case 'assets-manager':
      return can.manage;
    case 'asset-values':
      return can.values;
    case 'assets-settings':
      return can.settings;
  }
}

/**
 * Whether the user sees an item, a sub-item, a tab or a button: with neither roles nor an audience, yes; else when they
 * have one of its roles or are among its audience.
 */
function sees(user: NavUser, entry: { roles?: Role[]; audience?: NavAudience }): boolean {
  if (!entry.roles && !entry.audience) return true;
  return (!!entry.roles && hasRole(user, ...entry.roles)) || inAudience(user, entry.audience);
}

/**
 * An item as the user sees it: as it is without sub-items; with them, with those the user sees and linking to the first
 * of them (its href the page the heading linked to until it opened and closed them, 20 October 2026), or left out
 * when they see none.
 */
function shownWithItems(user: NavUser, item: NavItem): NavItem[] {
  if (!item.items) return [item];
  const items = item.items.flatMap((sub) => shownSubItem(user, sub));
  return items.length ? [{ ...item, href: items[0].href, items }] : [];
}

/**
 * A sub-item as the user sees it: one with tabs with the tabs they see, linking to the first (24 October 2026), or left
 * out when they see none; any other as it is, when they see it.
 */
function shownSubItem(user: NavUser, sub: NavSubItem): NavSubItem[] {
  if (!sub.tabs) return sees(user, sub) ? [sub] : [];
  const tabs = tabsFor(user, sub);
  return tabs.length ? [{ ...sub, href: tabs[0].href, section: tabs[0].section, tabs }] : [];
}

/**
 * The tabs of a sidebar page the user sees, in their order (owner, 24 October 2026: "7 entries, the rest as tabs"): the
 * row its pages draw, left out when there is one alone. None for a page without tabs.
 */
export function tabsFor(user: NavUser, sub: Pick<NavSubItem, 'tabs'>): NavTab[] {
  return (sub.tabs ?? []).filter((tab) => sees(user, tab));
}

/** The button at the top right of a sidebar page's pages, when the user is among those it is for; else null. */
export function actionFor(user: NavUser, sub: Pick<NavSubItem, 'action'>): NavAction | null {
  return sub.action && sees(user, sub.action) ? sub.action : null;
}

/**
 * The sidebar's items for this user: an employee's or a manager's own (above); for HR, Finance, the CEO and Admins (a
 * Super Admin counts as an Admin) NAV, each item and sub-item for the roles it names, and an item with sub-items only
 * when the user sees one of them, its href the first. Null (who it is couldn't be read, e.g. the API is down): Home
 * alone, which everyone has. Hiding a link is a convenience: the API checks every request.
 */
export function navFor(user: NavUser | null): NavItem[] {
  if (!user) return NAV.filter((item) => item.href === '/');
  if (isSelfService(user)) return selfServiceNav(user);
  // a heading's href the first of its pages the user sees (shownWithItems): Payroll's, Attendance's and People's first is
  // their own page; Requests has none; the KPIs' first is My KPIs for those with a profile; Organization's, the first
  // setup page they see
  return NAV.filter((item) => sees(user, item)).flatMap((item) => (item === ORGANIZATION_NAV ? organizationFor(user) : shownWithItems(user, item)));
}

/** Organization for whoever sees a setup page, linking to the first they see (23 October 2026); else left out. */
function organizationFor(user: NavUser): NavItem[] {
  const first = firstSetupPage(user);
  return first ? [{ ...ORGANIZATION_NAV, href: first.href }] : [];
}

/**
 * Where a profile's back link goes: the Employees list for those who have it; for an employee or a manager, none on
 * their own profile (My Profile is in their sidebar) and My Team on a direct report's.
 */
export function profileBack(user: NavUser, profile: { id: string; isSelf?: boolean }): { href: string; label: string } | null {
  if (!isSelfService(user)) return { href: '/employees', label: 'Employees' };
  return profile.isSelf || profile.id === user.employeeId ? null : { href: MY_TEAM, label: 'My Team' };
}

/** Whether `pathname` is `section` or a page under it ("/kpis/all/practice" is under "/kpis/all"; "/kpis/allx" isn't). */
export function isUnder(pathname: string, section: string): boolean {
  return pathname === section || pathname.startsWith(`${section}/`);
}

/**
 * Whether an item is the section this page is in: under its section (its own page alone when it has none), or on a
 * page of one of its sub-items (Requests, whose pages aren't under one path).
 */
export function isActive(item: Pick<NavItem, 'href' | 'section' | 'items'>, pathname: string): boolean {
  return (item.section ? pathname.startsWith(item.section) : pathname === item.href) || activeSubItem(item, pathname) !== null;
}

/**
 * The sub-item highlighted on this page: the one whose section matches most closely, a sub-item with tabs by its tabs'
 * (24 October 2026: Custody on a holding's page, /assets/holders/…); null when none does.
 */
export function activeSubItem(item: Pick<NavItem, 'items'>, pathname: string): NavSubItem | null {
  let best: NavSubItem | null = null;
  let matched = -1;
  for (const sub of item.items ?? []) {
    const sections = sub.tabs?.length ? sub.tabs.map((tab) => tab.section) : [sub.section];
    for (const section of sections) {
      if (isUnder(pathname, section) && section.length > matched) {
        best = sub;
        matched = section.length;
      }
    }
  }
  return best;
}
