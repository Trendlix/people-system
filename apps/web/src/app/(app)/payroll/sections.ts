// The pages under Payroll (owner, 17 October 2026: "make the Payroll in the side tab a main title below it - Overview -
// Unsettled - Additions / Deductions - Reports (Statistics)"), as the sidebar lists them under Payroll (components/nav.ts);
// Recurring Deductions after Additions / Deductions (owner, 18 October 2026: "in the deductions i might have a loan of a
// medical subscription or something that needs to be deducted as installments on the employee. how will it be
// managed?": a medical subscription is a fixed amount a month, on a page of its own as Unsettled already has four parts).
// Plain data, with no imports, so the sidebar and its tests take them as they are.

export const PAYROLL_SECTIONS = [
  { key: 'overview', href: '/payroll', label: 'Overview' },
  { key: 'unsettled', href: '/payroll/unsettled', label: 'Unsettled' },
  { key: 'adjustments', href: '/payroll/adjustments', label: 'Additions / Deductions' },
  { key: 'recurring', href: '/payroll/recurring-deductions', label: 'Recurring Deductions' },
  { key: 'reports', href: '/payroll/reports', label: 'Reports' },
] as const;

export type PayrollSection = (typeof PAYROLL_SECTIONS)[number]['key'];

export const UNSETTLED_PATH = '/payroll/unsettled';
export const ADJUSTMENTS_PATH = '/payroll/adjustments';
export const REPORTS_PATH = '/payroll/reports';
export const RECURRING_PATH = '/payroll/recurring-deductions';
