import { describe, expect, it } from 'vitest';
import type { LeaveImportRow } from '../../../../lib/leave-import-types';
import {
  adjustmentText,
  applyConfirmText,
  countChips,
  deleteBlocked,
  deletedNotice,
  historyRowsText,
  historyStateText,
  importsLeave,
  leaveImportHref,
  orderedRows,
  peopleChosen,
  peopleToConfirm,
  personChoice,
  personIds,
  rowDaysText,
  rowPersonText,
  statusLabel,
  typeChoice,
  uploadProblem,
  whenText,
} from './import';

// Importing leave in bulk (owner, 21 October 2026: "how to import bulk leaves?"): the review's and the history's helpers.
// Every name is invented.

const row = (over: Partial<LeaveImportRow>): LeaveImportRow => ({
  sheet: 'leaves',
  row: 2,
  status: 'ready',
  reasons: [],
  warnings: [],
  notes: [],
  personKey: 'code:EMP-0001',
  nameInFile: 'Ann Invented',
  code: 'EMP-0001',
  employee: null,
  confidential: false,
  typeText: 'Annual leave',
  type: null,
  from: '2026-05-03',
  to: '2026-05-05',
  fromText: '',
  toText: '',
  days: 3,
  fileDays: null,
  halfDay: false,
  pending: false,
  approval: null,
  approvalText: null,
  balance: null,
  asOf: null,
  adjustment: null,
  applied: null,
  yours: true,
  notYours: null,
  ...over,
});

describe('the leave import', () => {
  it('is HR’s and the CEO’s', () => {
    expect(importsLeave({ roles: ['hr'] })).toBe(true);
    expect(importsLeave({ roles: ['ceo'] })).toBe(true);
    expect(importsLeave({ roles: ['finance', 'manager', 'employee'] })).toBe(false);
    expect(leaveImportHref('abc')).toBe('/leave/import/abc');
  });

  it('checks the file before it is sent: an .xlsx of up to 5 MB', () => {
    expect(uploadProblem(null)).toMatch(/^Choose the file to import/);
    expect(uploadProblem({ name: 'leave.csv', size: 10 })).toMatch(/^Choose an Excel workbook/);
    expect(uploadProblem({ name: 'leave.xlsx', size: 6 * 1024 * 1024 })).toBe('The file must be 5 MB or smaller.');
    expect(uploadProblem({ name: 'Leave View.XLSX', size: 1000 })).toBeNull();
  });

  it('lists the rows to act on first, and counts each status with the pending among the ready', () => {
    const rows = [row({ row: 2, status: 'applied' }), row({ row: 3, status: 'problem' }), row({ row: 4, status: 'ready' }), row({ row: 5, status: 'waiting' })];
    expect(orderedRows(rows).map((r) => r.row)).toEqual([3, 5, 4, 2]);
    const counts = { ready: 3, applied: 1, waiting: 0, problem: 2, duplicate: 0, skipped: 4, pending: 1, hidden: 0 };
    expect(countChips({ counts })).toEqual([
      { key: 'problem', label: 'Problem', count: 2 },
      { key: 'ready', label: 'Ready', count: 3 },
      { key: 'pending', label: 'Of them requests', count: 1 },
      { key: 'applied', label: 'Applied', count: 1 },
      { key: 'skipped', label: 'Not imported', count: 4 },
    ]);
    expect(statusLabel(row({ pending: true }))).toBe('Ready: a request');
    expect(statusLabel(row({ status: 'skipped' }))).toBe('Not imported');
  });

  it('says a row’s days, its person and a balance’s change', () => {
    expect(whenText(row({}))).toBe('03/05/2026 – 05/05/2026');
    expect(whenText(row({ from: '2026-05-03', to: '2026-05-03', halfDay: true }))).toBe('03/05/2026 (half day)');
    expect(whenText(row({ from: null, fromText: '31/02/2026' }))).toBe('31/02/2026 – 05/05/2026');
    expect(rowDaysText(row({ days: 2, fileDays: 3 }))).toBe('2 days (the file: 3)');
    expect(rowDaysText(row({ days: 1, fileDays: 1 }))).toBe('1 day');
    expect(rowDaysText(row({ days: null, fileDays: 2 }))).toBe('2 days in the file');
    expect(rowPersonText(row({ employee: { id: 'e1', fullNameEn: 'Ann Invented Adel', employeeCode: 'EMP-0001' } }))).toEqual({ name: 'Ann Invented Adel', detail: 'In the file: Ann Invented' });
    expect(rowPersonText(row({}))).toEqual({ name: 'Ann Invented', detail: 'EMP-0001' });
    expect(adjustmentText(row({ adjustment: -5 }))).toBe('−5 days');
    expect(adjustmentText(row({ adjustment: null }))).toBeNull();
  });

  it('asks before Apply, saying what it does', () => {
    const view = { leaves: [row({}), row({ row: 3, pending: true }), row({ row: 4, yours: false })], balances: [row({ sheet: 'balances', row: 2 })] };
    expect(applyConfirmText(view)).toMatch(/^Apply 1 leave as approved, 1 pending request sent for a decision, 1 balance set\? /);
  });

  it('lists the people to confirm and the choices made, each by what they are known by', () => {
    const person = { key: 'k', code: null, name: 'Yarra', zohoId: null, hint: '10023', rows: 2, toConfirm: true, employee: null, candidates: [], confidential: false };
    const view = { people: [{ ...person, match: 'close' as const }, { ...person, key: 'k2', match: 'confirmed' as const, toConfirm: false }, { ...person, key: 'k3', match: 'skipped' as const }] };
    expect(peopleToConfirm(view).map((p) => p.key)).toEqual(['k']);
    expect(peopleChosen(view).map((p) => p.key)).toEqual(['k2', 'k3']);
    expect(personIds({ code: 'EMP-1', zohoId: '401', hint: null })).toBe('Code EMP-1 · Zoho ID 401');
    expect(personIds({ code: null, zohoId: null, hint: '10023' })).toBe('Zoho number 10023?');
  });

  it('reads back a person’s and a type’s choice', () => {
    const fd = (entries: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(entries)) f.append(k, v);
      return f;
    };
    const id = '00000000-0000-4000-8000-000000000001';
    expect(personChoice(fd({ key: 'k', employeeId: id }))).toEqual({ key: 'k', employeeId: id });
    expect(personChoice(fd({ key: 'k', choice: 'skip' }))).toEqual({ key: 'k', skipped: true });
    expect(personChoice(fd({ key: 'k', choice: 'undo' }))).toEqual({ key: 'k', employeeId: null });
    expect(personChoice(fd({ key: 'k', employeeId: 'nope' }))).toBeNull();
    expect(typeChoice(fd({ zohoType: 'Annual Leave', typeId: id }))).toEqual({ zohoType: 'Annual Leave', typeId: id });
    expect(typeChoice(fd({ zohoType: 'Working from home', typeId: 'skip' }))).toEqual({ zohoType: 'Working from home', skipped: true });
    expect(typeChoice(fd({ zohoType: 'Sick Leave', typeId: 'default' }))).toEqual({ zohoType: 'Sick Leave' });
    expect(typeChoice(fd({ typeId: id }))).toBeNull();
  });

  it('says where an import stands in the history; a Super Admin deletes one with nothing left of it', () => {
    const base = { kept: { leaves: 0, adjustments: 0 }, appliedAt: null, appliedBy: null, undoneAt: null, undoneBy: null };
    expect(historyStateText({ ...base, state: 'not_applied' })).toBe('Not applied');
    expect(historyStateText({ ...base, state: 'applied', kept: { leaves: 12, adjustments: 1 }, appliedAt: '2026-10-21T09:30:00.000Z', appliedBy: 'Hala' })).toBe(
      'Applied 21/10/2026, 12:30 PM by Hala: 12 leaves and 1 balance',
    );
    expect(historyStateText({ ...base, state: 'undone', undoneAt: '2026-10-21T10:00:00.000Z', undoneBy: null })).toBe('Undone 21/10/2026, 1:00 PM');
    expect(historyRowsText({ rows: { leaves: 1, balances: 2 } })).toBe('1 leave and 2 balances');
    expect(historyRowsText({ rows: { leaves: 0, balances: 0 } })).toBe('No rows');
    expect(deleteBlocked({ leaves: 1, adjustments: 0 })).toBe('Undo it first: what it made is still in the system.');
    expect(deleteBlocked({ leaves: 0, adjustments: 0 })).toBeNull();
    expect(deletedNotice({ deleted: '1' })).toBe('The import was deleted.');
    expect(deletedNotice({})).toBeNull();
  });
});
