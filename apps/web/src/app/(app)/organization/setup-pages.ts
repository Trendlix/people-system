import type { Role } from '@trendlix/shared';
import { EMAIL_SETTINGS_PATH } from '../../../lib/email-setup';
import { hasRole } from '../../../lib/roles';

// Organization, the setup home (owner, 23 October 2026: "lets perform a regorganization of this menu. we can perform
// groupings to related items"; asked, "Side menu with headings"): the setup pages in groups, each heading over its pages,
// a menu on the left at desktop widths and a drop-down on a phone (setup-menu.tsx). Brought in from their modules the
// same day, their old links redirecting (next.config.ts, lib/moved-pages.ts): "Check-in Setup, KPI Pillars and
// deadlines, Recruitment and checklists, Templates". Each page is for exactly the roles it was for before: the nine
// tabs for whoever had the Organization tabs (HR, Finance, the CEO and Admins, a Super Admin as an Admin), Email
// Settings for a Super Admin (never a developer), and each page brought in for the roles its module's link was for. A
// heading shows when its user sees one of its pages; the sidebar's Organization links to the first they see
// (components/nav.ts). Hiding a page is a convenience: each page and the API check every request again. Plain data
// with relative imports, so the sidebar (which goes to the browser) and the tests take it as it is.

/** The setup pages' addresses. */
export const SETUP_PATHS = {
  company: '/organization/company',
  email: EMAIL_SETTINGS_PATH,
  templates: '/organization/templates',
  departments: '/organization/departments',
  grades: '/organization/grades',
  shifts: '/organization/shifts',
  holidays: '/organization/holidays',
  leave: '/organization/leave',
  checkInSetup: '/organization/check-in-setup',
  allowances: '/organization/allowances',
  contracts: '/organization/contracts',
  payroll: '/organization/payroll',
  kpiPillars: '/organization/kpi-pillars',
  kpiDeadlines: '/organization/kpi-deadlines',
  recruitment: '/organization/recruitment',
  onboardingChecklist: '/organization/onboarding-checklist',
  clearanceChecklist: '/organization/clearance-checklist',
} as const;

/** Who a setup page is checked for: their roles, and whether the session is a developer's (lib/types.ts). */
export type SetupViewer = { roles: readonly Role[]; developer?: boolean };

export interface SetupPage {
  /** What a section's layout names to mark it (SetupFrame's `active`). */
  key: SetupKey;
  href: string;
  label: string;
  /**
   * Shown only to these roles (a Super Admin counts as an Admin: `hasRole`); none: to everyone who had the Organization
   * tabs, HR, Finance, the CEO and Admins.
   */
  roles?: readonly Role[];
  /** A Super Admin's own, never a developer's, though a developer is answered with a Super Admin's sight. */
  noDevelopers?: true;
}

export interface SetupGroup {
  label: string;
  pages: readonly SetupPage[];
}

export type SetupKey =
  | 'company'
  | 'email'
  | 'templates'
  | 'departments'
  | 'grades'
  | 'shifts'
  | 'holidays'
  | 'leave'
  | 'check-in-setup'
  | 'allowances'
  | 'contracts'
  | 'payroll'
  | 'kpi-pillars'
  | 'kpi-deadlines'
  | 'recruitment'
  | 'onboarding-checklist'
  | 'clearance-checklist';

/** Who had the Organization tabs: everyone but an employee or a direct manager alone (isSelfService). */
const STAFF: readonly Role[] = ['hr', 'finance', 'ceo', 'admin'];

/** The menu's groups in the owner's order (23 October 2026), each with its pages in order. */
export const SETUP_GROUPS: readonly SetupGroup[] = [
  {
    label: 'Company',
    pages: [
      { key: 'company', href: SETUP_PATHS.company, label: 'Company Details' },
      // the company's email (owner, 23 October 2026: "why dont we add SMTP setup in the organization setup"): a Super
      // Admin's only, as lib/email-setup.ts seesEmailSettings
      { key: 'email', href: SETUP_PATHS.email, label: 'Email Settings', roles: ['super_admin'], noDevelopers: true },
      // the document templates, from their own sidebar heading: a Super Admin's (owner, 19 October 2026: "enable
      // templates sidebar to super admin only"), as templates/wording.ts seesTemplates
      { key: 'templates', href: SETUP_PATHS.templates, label: 'Templates', roles: ['super_admin'] },
    ],
  },
  {
    label: 'Structure',
    pages: [
      { key: 'departments', href: SETUP_PATHS.departments, label: 'Departments & Job Titles' },
      { key: 'grades', href: SETUP_PATHS.grades, label: 'Grades' },
    ],
  },
  {
    label: 'Time & Leave',
    pages: [
      { key: 'shifts', href: SETUP_PATHS.shifts, label: 'Shifts' },
      { key: 'holidays', href: SETUP_PATHS.holidays, label: 'Holidays' },
      { key: 'leave', href: SETUP_PATHS.leave, label: 'Leave' },
      // from Attendance: HR's and Admin's, as check-in-setup/setup.ts seesCheckInSetup
      { key: 'check-in-setup', href: SETUP_PATHS.checkInSetup, label: 'Check-in Setup', roles: ['hr', 'admin'] },
    ],
  },
  {
    label: 'Pay & Contracts',
    pages: [
      { key: 'allowances', href: SETUP_PATHS.allowances, label: 'Allowances' },
      { key: 'contracts', href: SETUP_PATHS.contracts, label: 'Contracts & Endings' },
      { key: 'payroll', href: SETUP_PATHS.payroll, label: 'Payroll Setup' },
    ],
  },
  {
    label: 'Performance',
    pages: [
      // from KPIs, HR's and the Super Admin's as there ("Templates: HR", 21 October 2026): the pillars, and the
      // deadlines of each month's steps, which were a section of KPI Templates
      { key: 'kpi-pillars', href: SETUP_PATHS.kpiPillars, label: 'KPI Pillars', roles: ['hr', 'super_admin'] },
      { key: 'kpi-deadlines', href: SETUP_PATHS.kpiDeadlines, label: 'KPI Deadlines', roles: ['hr', 'super_admin'] },
    ],
  },
  {
    label: 'Hiring & Leaving',
    pages: [
      // from Recruitment, and from the Onboarding and Offboarding pages' buttons: HR's, the CEO's and a Super Admin's
      { key: 'recruitment', href: SETUP_PATHS.recruitment, label: 'Recruitment Settings', roles: ['hr', 'ceo', 'super_admin'] },
      { key: 'onboarding-checklist', href: SETUP_PATHS.onboardingChecklist, label: 'Onboarding Checklist', roles: ['hr', 'ceo', 'super_admin'] },
      { key: 'clearance-checklist', href: SETUP_PATHS.clearanceChecklist, label: 'Clearance Checklist', roles: ['hr', 'ceo', 'super_admin'] },
    ],
  },
];

/** Whether the user sees a setup page. */
export function seesSetupPage(user: SetupViewer, page: SetupPage): boolean {
  if (page.noDevelopers && user.developer) return false;
  return hasRole(user, ...(page.roles ?? STAFF));
}

/**
 * The groups as the user sees them: each with the pages they see, a group with none left out. Null (who it is can't be
 * read, e.g. the API is down): the pages for everyone who had the tabs, as the tabs were shown then.
 */
export function setupGroupsFor(user: SetupViewer | null): SetupGroup[] {
  const sees = (p: SetupPage) => (user ? seesSetupPage(user, p) : !p.roles);
  return SETUP_GROUPS.map((g) => ({ ...g, pages: g.pages.filter(sees) })).filter((g) => g.pages.length > 0);
}

/** The first setup page the user sees (where the sidebar's Organization goes); null when they see none. */
export function firstSetupPage(user: SetupViewer): SetupPage | null {
  return setupGroupsFor(user)[0]?.pages[0] ?? null;
}

/** A setup page by its key. */
export function setupPage(key: SetupKey): SetupPage {
  const page = SETUP_GROUPS.flatMap((g) => g.pages).find((p) => p.key === key);
  if (!page) throw new Error(`No setup page ${key}`);
  return page;
}
