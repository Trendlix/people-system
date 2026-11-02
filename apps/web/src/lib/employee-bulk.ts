import type { Role } from '@trendlix/shared';

// The Employees list's bulk actions (owner, 1 November 2026: "i want to select and create bulk actions such as hold
// access, what else?"; chose Access, Work setup, Check-in rules, Export & message): the actions picked from once people
// are ticked; a Super Admin's only (owner, 2 November 2026: "emplyees bulk actions for super admin only"). Pure, tested.

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

/** Whether the user ticks people at all: a Super Admin only (owner, 2 November 2026), never a developer. */
export const runsBulkActions = (user: { roles: readonly Role[]; developer?: boolean }): boolean => !user.developer && user.roles.includes('super_admin');

/** The actions the user may pick: every one, for a Super Admin. */
export function bulkActionsFor(user: { roles: readonly Role[]; developer?: boolean }): BulkAction[] {
  return runsBulkActions(user) ? [...BULK_ACTIONS] : [];
}

/** The chosen people's spreadsheet. */
export const employeesExportHref = (ids: readonly string[]): string => `/employees/export?ids=${ids.map(encodeURIComponent).join(',')}`;

/** "3 selected" */
export const selectedText = (n: number): string => `${n} selected`;
