// Test accounts (owner, 6 November 2026: "i want to create a tester account for google and apple, but without real
// data", then "Yes, build it"): a tick on a profile that keeps the person out of payroll runs, employee lists and counts,
// attendance, reports and KPIs, and stops their requests from notifying anyone. HR and Super Admins still find them under
// Employees → Test accounts. Pure code (no JSX, no @/ imports), so it can be tested.
import type { Role } from '@trendlix/shared';
import { hasRole } from '../../../lib/roles';

/** The badge's title on a test account's profile. */
export const TEST_ACCOUNT_BADGE_TITLE = 'Kept out of payroll, lists, counts and reports; its requests tell nobody.';

/** What the Test Account section on a profile says. */
export const TEST_ACCOUNT_TEXT =
  'A test account, e.g. for Google’s and Apple’s app reviewers: kept out of payroll runs, employee lists and counts, attendance, reports and KPIs, and its requests notify nobody. HR and Super Admins still find it under Employees → Test accounts.';

/** The address of the Employees list's Test accounts filter. */
export const TEST_ACCOUNTS_HREF = '/employees?tests=only';

/**
 * Whether the user makes profiles test accounts and lists them: HR and a Super Admin, as the API checks; never a
 * developer, whose changes the API refuses.
 */
export function managesTestAccounts(user: { roles: readonly Role[]; developer?: boolean }): boolean {
  return hasRole(user, 'hr', 'super_admin') && !user.developer;
}

/** The confirm before a profile becomes a test account. */
export function testAccountConfirm(name: string): string {
  return `Make ${name} a test account? They leave payroll runs, employee lists and counts, attendance and reports, and their requests notify nobody.`;
}

/** What the Employees list asks the API for: only the test accounts, or everyone else. */
export function employeesApiPath(tests: boolean): string {
  return tests ? '/employees?tests=only' : '/employees';
}

// A sample account for the app stores' reviewers (owner, 7 November 2026: "the test account shows nothing after the
// login, allow apple testers to see some dummy data"): the API makes the account with this email a test profile with
// sample data (apps/api sample-account.service.ts).

/** What the API answers when it set one up or made its data again. */
export interface SampleAccountResult {
  employeeId: string;
  created: boolean;
  days: number;
  requests: number;
}

/** What the Sample account form on Employees → Test accounts says. */
export const SAMPLE_ACCOUNT_TEXT =
  'For Google’s and Apple’s reviewers: the account they sign in with (made on the Users page, with a password) becomes an invented employee, Nour Hassan, signing in as an Employee only, working from home and checking in from anywhere. It gets two months of check-ins, leave, a permission and a leave request waiting for HR. Again for the same account: its data is made afresh as of today.';

/** The confirm before a test profile's data is made again. */
export const SAMPLE_REFRESH_CONFIRM = 'Make its sample data again as of today? Its check-ins and requests, the reviewers’ own too, are replaced.';

/** What the website says once it is done. */
export function sampleAccountMessage(r: Pick<SampleAccountResult, 'created' | 'days' | 'requests'>): string {
  const what = `${r.days} days of check-ins and ${r.requests} requests`;
  return r.created ? `Sample account set up, with ${what}.` : `Sample data made again as of today: ${what}.`;
}
