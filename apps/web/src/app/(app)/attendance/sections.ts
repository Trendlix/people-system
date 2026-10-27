import type { Role } from '@trendlix/shared';

// The pages under Attendance (owner, 19 October 2026: "is the attendance module active?", then "the attendance is not
// active in the side menu"), as the sidebar lists them under Attendance (components/nav.ts): Daily Attendance, a month
// of everyone's days; Import, where HR picks the month and drops Zoho People's files (owner, the same day: "where am i
// going to import the sheets?"); Import History, every import across the payroll runs; Summary, by department and
// team, with Excel; Corrections, the days asked to be corrected (19 October 2026). HR, the CEO and Finance (Finance read
// only); Import HR's alone, Corrections HR's and the CEO's. Check-in Setup, HR's and Admin's, was here until it moved to
// Organization's setup menu (owner, 23 October 2026: "Check-in Setup, KPI Pillars and deadlines, Recruitment and
// checklists, Templates"; organization/setup-pages.ts). Work From Home was here until it moved to the Leave area, under
// Requests after Leave Requests (owner, 26 October 2026: "YES move it to leaves", then "Show it with leave"), keeping its
// address. Plain data, with no imports but a type, so the sidebar and its tests take them as they are.

export const ATTENDANCE_PATH = '/attendance';
export const ATTENDANCE_IMPORT_PATH = '/attendance/import';
export const ATTENDANCE_IMPORTS_PATH = '/attendance/imports';
export const ATTENDANCE_SUMMARY_PATH = '/attendance/summary';
export const ATTENDANCE_CORRECTIONS_PATH = '/attendance/corrections';
/** Work From Home's address, kept when its menu item moved under Requests (26 October 2026). */
export const ATTENDANCE_WFH_PATH = '/attendance/wfh';
export const ATTENDANCE_OD_PATH = '/attendance/official-duty';
export const ATTENDANCE_COMPENSATORY_PATH = '/attendance/compensatory';
/** The Compensatory Setup (27 October 2026), under Compensatory Days. */
export const ATTENDANCE_COMPENSATORY_SETUP_PATH = '/attendance/compensatory/setup';

/** Who reads the attendance itself: HR, the CEO and Finance. */
const READERS: Role[] = ['hr', 'ceo', 'finance'];

export const ATTENDANCE_SECTIONS: readonly { key: string; href: string; label: string; roles?: Role[] }[] = [
  { key: 'daily', href: ATTENDANCE_PATH, label: 'Daily Attendance', roles: READERS },
  // HR uploads; the CEO and Finance read what was imported
  { key: 'import', href: ATTENDANCE_IMPORT_PATH, label: 'Import', roles: ['hr'] },
  { key: 'imports', href: ATTENDANCE_IMPORTS_PATH, label: 'Import History', roles: READERS },
  { key: 'summary', href: ATTENDANCE_SUMMARY_PATH, label: 'Summary', roles: READERS },
  // the days employees asked to correct (owner, 19 October 2026: "Attendance corrections with approval ("I forgot to
  // check out")"): HR decides them after the manager, the CEO a C-level person's; the waiting count beside it
  { key: 'corrections', href: ATTENDANCE_CORRECTIONS_PATH, label: 'Corrections', roles: ['hr', 'ceo'] },
  // the official duties asked for (owner, 23 October 2026: "Official duty (OD) requests", "Manager, then HR"), beside
  // working from home until it moved to the Leave area (26 October 2026)
  { key: 'od', href: ATTENDANCE_OD_PATH, label: 'Official Duty', roles: ['hr', 'ceo'] },
  // the compensatory days asked for (owner, 26 October 2026: "my compensatory is a compensation with another day in the same
  // month", "Manager, then HR"), HR deciding a day off or cash instead
  { key: 'compensatory', href: ATTENDANCE_COMPENSATORY_PATH, label: 'Compensatory Days', roles: ['hr', 'ceo'] },
  // their rules (owner, 27 October 2026: "i need a setup dashboard for the compensatory leaves"): HR changes them, the CEO
  // reads them; the Leave Setup and Compensatory Days link to it too
  { key: 'compensatory-setup', href: ATTENDANCE_COMPENSATORY_SETUP_PATH, label: 'Compensatory Setup', roles: ['hr', 'ceo'] },
];
