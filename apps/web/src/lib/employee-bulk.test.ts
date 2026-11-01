import type { Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { BULK_ACTION_GROUPS, BULK_ACTIONS, bulkActionsFor, employeesExportHref, runsBulkActions, selectedText } from './employee-bulk';

// The Employees list's bulk actions (owner, 1 November 2026: "i want to select and create bulk actions").

const as = (...roles: Role[]) => ({ roles });

describe('bulk actions', () => {
  it('are for HR, an Admin, a Super Admin and the CEO, never a developer', () => {
    expect([as('hr'), as('admin'), as('super_admin'), as('ceo')].map(runsBulkActions)).toEqual([true, true, true, true]);
    expect([as('employee'), as('manager'), as('finance')].map(runsBulkActions)).toEqual([false, false, false]);
    expect(runsBulkActions({ roles: ['super_admin'], developer: true })).toBe(false);
  });

  it('give HR every action, and the others all but the employment’s changes', () => {
    expect(bulkActionsFor(as('hr'))).toEqual([...BULK_ACTIONS]);
    expect(bulkActionsFor(as('admin'))).toEqual(['hold', 'release', 'invite', 'exempt', 'message', 'export']);
    expect(bulkActionsFor(as('ceo'))).toEqual(bulkActionsFor(as('admin')));
    expect(bulkActionsFor(as('finance'))).toEqual([]);
  });

  it('lists every action once in the menu', () => {
    expect(BULK_ACTION_GROUPS.flatMap((g) => g.actions).sort()).toEqual([...BULK_ACTIONS].sort());
  });

  it('exports the chosen people', () => {
    expect(employeesExportHref(['a', 'b'])).toBe('/employees/export?ids=a,b');
    expect(selectedText(3)).toBe('3 selected');
  });
});
