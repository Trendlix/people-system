// Bulk actions on the Employees list (owner, 1 November 2026: "i want to select and create bulk actions such as hold
// access, what else?"; chose Access, Work setup, Check-in rules, Export & message): HR ticks people, then one action for
// all of them. Each person's is done as their own would be (the same checks, refusals and audit), and the answer says
// for whom it was done and why it was skipped for anyone else. Sign-in invitations and check-in exemptions take a list
// already (their own endpoints); these are the rest. Pure: the API checks with it, the web shows it.

import { holdReasonProblem } from './employee-access.js';

/** The actions POST /employees/bulk takes. */
export const EMPLOYEE_BULK_ACTIONS = ['hold', 'release', 'manager', 'department', 'shift', 'check_in_anywhere', 'message'] as const;
export type EmployeeBulkAction = (typeof EMPLOYEE_BULK_ACTIONS)[number];

export const isEmployeeBulkAction = (v: unknown): v is EmployeeBulkAction => typeof v === 'string' && (EMPLOYEE_BULK_ACTIONS as readonly string[]).includes(v);

export const EMPLOYEE_BULK_LABELS: Record<EmployeeBulkAction, string> = {
  hold: 'Hold access',
  release: 'Release hold',
  manager: 'Change manager',
  department: 'Move to department or team',
  shift: 'Change shift',
  check_in_anywhere: 'Check in from anywhere',
  message: 'Send a message',
};

/** The actions that change the employment: HR's, as the profile's Employment tab. */
export const EMPLOYEE_BULK_EMPLOYMENT: readonly EmployeeBulkAction[] = ['manager', 'department', 'shift', 'check_in_anywhere'];

/** The most people one action takes. */
export const EMPLOYEE_BULK_MAX = 200;
/** A message's title and text: the title as the bell's; the text longer, for the email (the bell and push cut it). */
export const EMPLOYEE_BULK_MESSAGE_LIMITS = { title: 100, body: 1000 } as const;

/** What POST /employees/bulk takes. */
export interface EmployeeBulkInput {
  action: EmployeeBulkAction;
  employeeIds: string[];
  /** hold: why (shown to them and kept). */
  reason?: string | null;
  /** manager: the new manager; null: none. */
  managerId?: string | null;
  /** department: a department or one of its teams. */
  departmentId?: string | null;
  /** shift: the new shift; null: none. */
  shiftId?: string | null;
  /** check_in_anywhere: on or off. */
  on?: boolean;
  /** message: its title and text, and whether it is emailed too. */
  title?: string | null;
  body?: string | null;
  email?: boolean;
}

/** One person the action was done for, or skipped with why. */
export interface EmployeeBulkPerson {
  id: string;
  name: string;
}

export interface EmployeeBulkResult {
  action: EmployeeBulkAction;
  done: EmployeeBulkPerson[];
  skipped: (EmployeeBulkPerson & { reason: string })[];
}

/** What is wrong with a bulk action before anyone is touched; empty when fine. */
export function employeeBulkProblems(i: Partial<EmployeeBulkInput>): string[] {
  const out: string[] = [];
  if (!isEmployeeBulkAction(i.action)) return ['Choose an action.'];
  const ids = Array.isArray(i.employeeIds) ? i.employeeIds : [];
  if (!ids.length) out.push('Choose at least one person.');
  if (ids.length > EMPLOYEE_BULK_MAX) out.push(`Choose at most ${EMPLOYEE_BULK_MAX} people at once.`);
  if (i.action === 'hold') {
    const why = holdReasonProblem(i.reason);
    if (why) out.push(why);
  }
  if (i.action === 'department' && !i.departmentId) out.push('Choose a department or team.');
  if (i.action === 'check_in_anywhere' && typeof i.on !== 'boolean') out.push('Choose on or off.');
  if (i.action === 'message') {
    const title = (i.title ?? '').trim();
    const body = (i.body ?? '').trim();
    if (!title) out.push('Write the message’s title.');
    else if (title.length > EMPLOYEE_BULK_MESSAGE_LIMITS.title) out.push(`Keep the title to ${EMPLOYEE_BULK_MESSAGE_LIMITS.title} characters.`);
    if (!body) out.push('Write the message.');
    else if (body.length > EMPLOYEE_BULK_MESSAGE_LIMITS.body) out.push(`Keep the message to ${EMPLOYEE_BULK_MESSAGE_LIMITS.body.toLocaleString('en-US')} characters.`);
  }
  return out;
}

/** "Done for 5 people.", "Done for 4 people. Skipped 1." */
export function employeeBulkSummary(done: number, skipped: number): string {
  const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;
  const text = done ? `Done for ${people(done)}.` : 'Nothing was done.';
  return skipped ? `${text} Skipped ${skipped}.` : text;
}
