import type { Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { BULK_ACTION_GROUPS, BULK_ACTIONS, bulkActionsFor, employeesExportHref, runsBulkActions, selectedText } from './employee-bulk';

// The Employees list's bulk actions (owner, 1 November 2026: "i want to select and create bulk actions").

const as = (...roles: Role[]) => ({ roles });

describe('bulk actions', () => {
  // owner, 2 November 2026: "emplyees bulk actions for super admin only"
  it('are a Super Admin’s only, never a developer’s', () => {
    expect(runsBulkActions(as('super_admin'))).toBe(true);
    expect([as('hr'), as('admin'), as('ceo'), as('finance'), as('employee'), as('manager')].map(runsBulkActions)).toEqual([false, false, false, false, false, false]);
    expect(runsBulkActions({ roles: ['super_admin'], developer: true })).toBe(false);
  });

  it('give a Super Admin every action, and nobody else any', () => {
    expect(bulkActionsFor(as('super_admin'))).toEqual([...BULK_ACTIONS]);
    expect(bulkActionsFor(as('hr'))).toEqual([]);
    expect(bulkActionsFor(as('hr', 'super_admin'))).toEqual([...BULK_ACTIONS]);
  });

  it('lists every action once in the menu', () => {
    expect(BULK_ACTION_GROUPS.flatMap((g) => g.actions).sort()).toEqual([...BULK_ACTIONS].sort());
  });

  it('exports the chosen people', () => {
    expect(employeesExportHref(['a', 'b'])).toBe('/employees/export?ids=a,b');
    expect(selectedText(3)).toBe('3 selected');
  });
});
