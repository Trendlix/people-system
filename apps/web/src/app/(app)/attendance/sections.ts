import type { Role } from '@trendlix/shared';

// The pages under Attendance (owner, 19 October 2026: "is the attendance module active?", then "the attendance is not
// active in the side menu"), as the sidebar lists them under Attendance (components/nav.ts): Daily Attendance, a month
// of everyone's days; Import, where HR picks the month and drops Zoho People's files (owner, the same day: "where am i
// going to import the sheets?"); Import History, every import across the payroll runs; Summary, by department and
// team, with Excel; Corrections, the days asked to be corrected (19 October 2026). HR, the CEO and Finance (Finance read
// only); Import HR's alone, Corrections HR's and the CEO's. Check-in Setup (owner, 20 October 2026: "i cant find in
// the system where to add the eligable check in locations", then "Own page, several locations"): the check-in locations,
// the office networks with the lock on check-ins, and Zoho People's check-in addresses, for HR and Admin (a Super Admin
// as an Admin), the only page here an Admin sees. Plain data, with no imports but a type, so the sidebar and its tests
// take them as they are.

export const ATTENDANCE_PATH = '/attendance';
export const ATTENDANCE_IMPORT_PATH = '/attendance/import';
export const ATTENDANCE_IMPORTS_PATH = '/attendance/imports';
export const ATTENDANCE_SUMMARY_PATH = '/attendance/summary';
export const ATTENDANCE_CORRECTIONS_PATH = '/attendance/corrections';
export const CHECK_IN_SETUP_PATH = '/attendance/check-in-setup';
export const ATTENDANCE_WFH_PATH = '/attendance/wfh';

/** Who reads the attendance itself: HR, the CEO and Finance (an Admin sees Check-in Setup alone). */
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
  // the work-from-home days asked for and recorded (owner, 21 October 2026: "Manager, then HR", 2 a month a week apart)
  { key: 'wfh', href: ATTENDANCE_WFH_PATH, label: 'Work From Home', roles: ['hr', 'ceo'] },
  // where check-ins count as the office, and the office network's lock (owner, 20 October 2026)
  { key: 'check-in-setup', href: CHECK_IN_SETUP_PATH, label: 'Check-in Setup', roles: ['hr', 'admin'] },
];
