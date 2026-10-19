import type { Role } from '@trendlix/shared';

// The pages under Attendance (owner, 19 October 2026: "is the attendance module active?", then "the attendance is not
// active in the side menu"), as the sidebar lists them under Attendance (components/nav.ts): Daily Attendance, a month
// of everyone's days; Import, where HR picks the month and drops Zoho People's files (owner, the same day: "where am i
// going to import the sheets?"); Import History, every import across the payroll runs; Summary, by department and
// team, with Excel. HR, the CEO and Finance (Finance read only); Import HR's alone. Plain data, with no imports but a
// type, so the sidebar and its tests take them as they are.

export const ATTENDANCE_PATH = '/attendance';
export const ATTENDANCE_IMPORT_PATH = '/attendance/import';
export const ATTENDANCE_IMPORTS_PATH = '/attendance/imports';
export const ATTENDANCE_SUMMARY_PATH = '/attendance/summary';

export const ATTENDANCE_SECTIONS: readonly { key: string; href: string; label: string; roles?: Role[] }[] = [
  { key: 'daily', href: ATTENDANCE_PATH, label: 'Daily Attendance' },
  // HR uploads; the CEO and Finance read what was imported
  { key: 'import', href: ATTENDANCE_IMPORT_PATH, label: 'Import', roles: ['hr'] },
  { key: 'imports', href: ATTENDANCE_IMPORTS_PATH, label: 'Import History' },
  { key: 'summary', href: ATTENDANCE_SUMMARY_PATH, label: 'Summary' },
];
