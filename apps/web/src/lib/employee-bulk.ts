import type { Role } from '@trendlix/shared';
import { hasRole } from './roles';

// The Employees list's bulk actions (owner, 1 November 2026: "i want to select and create bulk actions such as hold
// access, what else?"; chose Access, Work setup, Check-in rules, Export & message): the actions HR picks from once people
// are ticked, and who sees which, as the API allows. Pure, tested.

export const BULK_ACTIONS = ['hold', 'release', 'invite', 'manager', 'department', 'shift', 'check_in_anywhere', 'exempt', 'message', 'export'] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

export const BULK_ACTION_LABELS: Record<BulkAction, string> = {
  hold: 'Hold access',
  release: 'Release hold',
  invite: 'Send sign-in invitations',
  manager: 'Change manager',
  department: 'Move to department or team',
  shift: 'Change shift',
  check_in_anywhere: 'Check in from anywhere',
  exempt: 'Exempt from check-in',
  message: 'Send a message',
  export: 'Export to Excel',
};

/** The groups the action menu shows. */
export const BULK_ACTION_GROUPS: readonly { label: string; actions: readonly BulkAction[] }[] = [
  { label: 'Access', actions: ['hold', 'release', 'invite'] },
  { label: 'Work setup', actions: ['manager', 'department', 'shift'] },
  { label: 'Check-in', actions: ['check_in_anywhere', 'exempt'] },
  { label: 'Other', actions: ['message', 'export'] },
];

const EMPLOYMENT: readonly BulkAction[] = ['manager', 'department', 'shift', 'check_in_anywhere'];

/** Whether the user ticks people at all: HR, an Admin (a Super Admin too) and the CEO. */
export const runsBulkActions = (user: { roles: readonly Role[]; developer?: boolean }): boolean => !user.developer && hasRole(user, 'hr', 'admin', 'ceo');

/** The actions the user may pick: all for HR; the employment's changes are HR's only. */
export function bulkActionsFor(user: { roles: readonly Role[]; developer?: boolean }): BulkAction[] {
  if (!runsBulkActions(user)) return [];
  const hr = hasRole(user, 'hr');
  return BULK_ACTIONS.filter((a) => hr || !EMPLOYMENT.includes(a));
}

/** The chosen people's spreadsheet. */
export const employeesExportHref = (ids: readonly string[]): string => `/employees/export?ids=${ids.map(encodeURIComponent).join(',')}`;

/** "3 selected" */
export const selectedText = (n: number): string => `${n} selected`;
