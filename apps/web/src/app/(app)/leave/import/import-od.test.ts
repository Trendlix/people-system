import { ZOHO_OD_TARGET } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import type { LeaveImportRow } from '../../../../lib/leave-import-types';
import { applyConfirmText, deleteBlocked, historyStateText, keptText, odSpanText, rowTypeText, typeChoice, typeMapValue, undoWhatText } from './import';

// Official duty in the leave import (owner, 26 October 2026, asked "how to apply or import official duty": "Import
// (template + Zoho)"): the template's Official duty rows and Zoho's types mapped to official duty days, each one
// official duty. Every name is invented.

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
  typeText: 'On Duty',
  type: null,
  from: '2026-08-06',
  to: '2026-08-09',
  fromText: '',
  toText: '',
  days: 2,
  fileDays: null,
  halfDay: false,
  pending: false,
  wfh: false,
  wfhDays: null,
  od: true,
  odDays: ['2026-08-06', '2026-08-09'],
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

const fd = (values: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
};

describe('official duty rows on the review', () => {
  it('name their type, and the official duty’s days when its ends are left out', () => {
    expect(rowTypeText(row({}))).toBe('Official duty');
    expect(rowTypeText(row({ od: false, type: { id: 't', nameEn: 'Annual leave' } }))).toBe('Annual leave');
    expect(odSpanText(row({}))).toBeNull();
    expect(odSpanText(row({ from: '2026-08-05', to: '2026-08-09' }))).toBe('As one official duty: 06/08/2026 – 09/08/2026');
    expect(odSpanText(row({ from: '2026-08-05', to: '2026-08-07', odDays: ['2026-08-06'] }))).toBe('As one official duty: 06/08/2026');
    expect(odSpanText(row({ od: false }))).toBeNull();
    // an API from before it
    expect(odSpanText(row({ od: undefined, odDays: undefined }))).toBeNull();
  });

  it('map a Zoho type to official duty days, and back', () => {
    expect(typeMapValue({ wfh: false, od: true, typeId: null })).toBe(ZOHO_OD_TARGET);
    expect(typeMapValue({ wfh: false, typeId: null })).toBe('skip');
    expect(typeChoice(fd({ zohoType: 'On Duty', typeId: ZOHO_OD_TARGET }))).toEqual({ zohoType: 'On Duty', od: true });
  });

  it('say what Apply makes, Undo removes and Delete waits for', () => {
    const text = applyConfirmText({ leaves: [row({}), row({ row: 3, pending: true }), row({ row: 4, od: false, type: { id: 't', nameEn: 'Annual leave' } })], balances: [] });
    expect(text).toMatch(/^Apply 1 leave as approved, 1 official duty as approved, 1 pending official duty request sent for a decision\?/);
    const kept = { leaves: 1, adjustments: 0, wfhDays: 2, od: 3 };
    expect(keptText(kept)).toBe('1 leave, 2 work-from-home days and 3 official duties');
    expect(keptText({ leaves: 0, adjustments: 0, wfhDays: 0, od: 1 })).toBe('1 official duty');
    expect(undoWhatText({ undoable: 6, kept })).toBe('the 1 leave, 2 work-from-home days and 3 official duties');
    expect(deleteBlocked({ leaves: 0, adjustments: 0, wfhDays: 0, od: 1 })).toBe('Undo it first: what it made is still in the system.');
    // an API from before it sends no count of them
    expect(deleteBlocked({ leaves: 0, adjustments: 0, wfhDays: 0 })).toBeNull();
    expect(historyStateText({ state: 'applied', kept: { leaves: 0, adjustments: 0, wfhDays: 0, od: 2 }, appliedAt: '2026-10-26T09:30:00.000Z', appliedBy: 'Hala', undoneAt: null, undoneBy: null })).toMatch(
      /by Hala: 2 official duties$/,
    );
  });
});
