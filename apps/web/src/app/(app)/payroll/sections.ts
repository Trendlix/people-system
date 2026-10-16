// The pages under Payroll (owner, 17 October 2026: "make the Payroll in the side tab a main title below it - Overview -
// Unsettled - Additions / Deductions - Reports (Statistics)"), as the sidebar lists them under Payroll (components/nav.ts).
// Plain data, with no imports, so the sidebar and its tests take them as they are.

export const PAYROLL_SECTIONS = [
  { key: 'overview', href: '/payroll', label: 'Overview' },
  { key: 'unsettled', href: '/payroll/unsettled', label: 'Unsettled' },
  { key: 'adjustments', href: '/payroll/adjustments', label: 'Additions / Deductions' },
  { key: 'reports', href: '/payroll/reports', label: 'Reports' },
] as const;

export type PayrollSection = (typeof PAYROLL_SECTIONS)[number]['key'];

export const UNSETTLED_PATH = '/payroll/unsettled';
export const ADJUSTMENTS_PATH = '/payroll/adjustments';
export const REPORTS_PATH = '/payroll/reports';
