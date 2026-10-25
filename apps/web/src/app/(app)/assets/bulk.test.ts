import { describe, expect, it } from 'vitest';
import type { AssetRowView } from '@trendlix/shared';
import {
  assetsText,
  bracketed,
  bulkCan,
  bulkDisposeBody,
  bulkDoneText,
  bulkRowOf,
  codesProblem,
  deleteConfirmText,
  deleteForecast,
  disposableSkipped,
  disposeConfirmText,
  disposeForecast,
  disposeTheseText,
  needsTypedDelete,
  pageTicks,
  skippedText,
  ticked,
  tickedPage,
  tickedRows,
  typedDelete,
  type BulkRow,
} from './bulk';

// Delete selected and Dispose selected on All Assets (owner, 25 October 2026: "can i delete multiple assets at one?";
// "Never-in-custody only").

const TODAY = '2026-10-25';

const row = (code: string, over: Partial<BulkRow> = {}): BulkRow => ({ code, name: `Asset ${code}`, group: 'kit', status: 'available', everInCustody: false, ...over });

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

const A = row('PK-CAM-0001');
const B = row('PK-CAM-0002');
const BACK = row('PK-CAM-0004', { everInCustody: true });
const HELD = row('PK-CAM-0005', { status: 'custody', everInCustody: true });
const TAPE = row('CS-TAP-0001', { group: 'consumable' });
const GONE = row('PK-CAM-0006', { status: 'disposed' });

describe('who gets the ticks', () => {
  const superAdmin = { roles: ['super_admin' as const] };
  it('Delete selected for a Super Admin, Dispose selected for an Assets manager (a Super Admin is one)', () => {
    expect(bulkCan(superAdmin, { access: 'manager' })).toEqual({ delete: true, dispose: true, any: true });
    expect(bulkCan({ roles: ['hr'] }, { access: 'manager' })).toEqual({ delete: false, dispose: true, any: true });
  });

  it('nobody else, a developer neither, nor a Super Admin viewing as someone view only', () => {
    expect(bulkCan({ roles: ['employee'] }, { access: 'custodian' })).toEqual({ delete: false, dispose: false, any: false });
    expect(bulkCan({ roles: ['ceo'] }, { access: 'viewer' })).toEqual({ delete: false, dispose: false, any: false });
    expect(bulkCan({ ...superAdmin, developer: true }, { access: 'manager' })).toEqual({ delete: false, dispose: false, any: false });
    const viewing = { roles: ['hr' as const], viewAs: { by: { id: 'x', email: 'sa@example.com' }, act: false } };
    expect(bulkCan(viewing, { access: 'manager' }).any).toBe(false);
    expect(bulkCan({ ...viewing, viewAs: { ...viewing.viewAs, act: true } }, { access: 'manager' })).toMatchObject({ dispose: true });
  });

  it('a row says whether it was ever in custody; an API from before: taken as never', () => {
    const r = { code: 'PK-CAM-0001', name: 'Camera', group: 'kit', status: 'available', everInCustody: true, room: null } as unknown as AssetRowView;
    expect(bulkRowOf(r)).toEqual({ code: 'PK-CAM-0001', name: 'Camera', group: 'kit', status: 'available', everInCustody: true });
    expect(bulkRowOf({ ...r, everInCustody: undefined }).everInCustody).toBe(false);
  });
});

describe('the ticks', () => {
  const page = ['PK-CAM-0001', 'PK-CAM-0002', 'PK-CAM-0003'];

  it('a row ticked and unticked, the set itself never changed', () => {
    const none = new Set<string>();
    const one = ticked(none, 'PK-CAM-0001', true);
    expect([...one]).toEqual(['PK-CAM-0001']);
    expect(none.size).toBe(0);
    expect([...ticked(one, 'PK-CAM-0001', false)]).toEqual([]);
    expect([...ticked(one, 'PK-CAM-0001', true)]).toEqual(['PK-CAM-0001']);
  });

  it('Select all on this page: all, some (half ticked) or none', () => {
    expect(pageTicks(new Set(), page)).toBe('none');
    expect(pageTicks(new Set(['PK-CAM-0002']), page)).toBe('some');
    expect(pageTicks(new Set(page), page)).toBe('all');
    expect(pageTicks(new Set(), [])).toBe('none');
    const all = tickedPage(new Set(['PK-CAM-0002']), page, true);
    expect([...all].sort()).toEqual(page);
    expect([...tickedPage(all, page, false)]).toEqual([]);
  });

  it('the rows ticked the page still shows, in its order', () => {
    expect(tickedRows([A, B, BACK], new Set(['PK-CAM-0004', 'PK-CAM-0001', 'PK-CAM-9999'])).map((r) => r.code)).toEqual(['PK-CAM-0001', 'PK-CAM-0004']);
  });
});

describe('the confirms', () => {
  it('Delete selected: those never in custody deleted; one that was or is in custody skipped with the reason', () => {
    const f = deleteForecast([A, BACK, B, HELD]);
    expect(f.will.map((r) => r.code)).toEqual(['PK-CAM-0001', 'PK-CAM-0002']);
    expect(f.skipped).toEqual([
      { code: 'PK-CAM-0004', reason: 'It was in custody: dispose of it instead.' },
      { code: 'PK-CAM-0005', reason: 'In custody now.' },
    ]);
    expect(deleteConfirmText(f)).toBe('2 assets will be deleted, with their photos. Their codes are never given again. This can’t be undone. 2 will be skipped: only an asset never in custody can be deleted.');
    expect(deleteConfirmText(deleteForecast([A]))).toBe('1 asset will be deleted, with their photos. Their codes are never given again. This can’t be undone.');
    expect(deleteConfirmText(deleteForecast([BACK]))).toBe('None of them can be deleted. 1 will be skipped: only an asset never in custody can be deleted.');
  });

  it('DELETE typed for more than 10, exactly', () => {
    expect(needsTypedDelete(10)).toBe(false);
    expect(needsTypedDelete(11)).toBe(true);
    expect(typedDelete('DELETE')).toBe(true);
    expect(typedDelete('  DELETE ')).toBe(true);
    expect(typedDelete('delete')).toBe(false);
    expect(typedDelete('DELET')).toBe(false);
  });

  it('Dispose selected: never one in custody, a consumable or one disposed already', () => {
    const f = disposeForecast([A, HELD, BACK, TAPE, GONE]);
    expect(f.will.map((r) => r.code)).toEqual(['PK-CAM-0001', 'PK-CAM-0004']);
    expect(f.skipped).toEqual([
      { code: 'PK-CAM-0005', reason: 'It is in custody: receive it back first, then dispose of it.' },
      { code: 'CS-TAP-0001', reason: 'It is a consumable: it is used up through Stock, not disposed of.' },
      { code: 'PK-CAM-0006', reason: 'It is disposed already.' },
    ]);
    expect(disposeConfirmText(f)).toBe('2 assets will be disposed of. They stay on record but leave every total and list. 3 will be skipped.');
    expect(disposeConfirmText(disposeForecast([TAPE]))).toBe('None of them can be disposed of. 1 will be skipped.');
  });
});

describe('the result', () => {
  it('"Deleted 12. Skipped 3: PK-CAM-0004 (it was in custody: dispose of it instead) …"', () => {
    const skipped = [
      { code: 'PK-CAM-0004', reason: 'It was in custody: dispose of it instead.' },
      { code: 'PK-CAM-0005', reason: 'In custody now.' },
      { code: 'PK-CAM-9999', reason: 'Not found.' },
    ];
    expect(bulkDoneText('Deleted', 12, skipped)).toBe('Deleted 12. Skipped 3: PK-CAM-0004 (it was in custody: dispose of it instead), PK-CAM-0005 (in custody now), PK-CAM-9999 (not found).');
    expect(bulkDoneText('Deleted', 2, [])).toBe('Deleted 2.');
    expect(bulkDoneText('Disposed of', 1, skipped, 1)).toBe('Disposed of 1. Skipped 3: PK-CAM-0004 (it was in custody: dispose of it instead), and 2 more.');
    expect(bracketed('The disposal date can’t be before the purchase date.')).toBe('the disposal date can’t be before the purchase date');
    expect(skippedText(skipped[1])).toBe('PK-CAM-0005 (in custody now)');
  });

  it('"Dispose these 3": what Delete selected skipped that can be disposed of, as the page shows it', () => {
    const result = {
      skipped: [
        { code: BACK.code, reason: 'It was in custody: dispose of it instead.' },
        { code: HELD.code, reason: 'In custody now.' },
        { code: 'PK-CAM-9999', reason: 'Not found.' },
        { code: 'CS-TAP-0002', reason: 'It was in custody: dispose of it instead.' },
      ],
    };
    expect(disposableSkipped(result, [A, BACK, HELD, row('CS-TAP-0002', { group: 'consumable', everInCustody: true })])).toEqual([BACK.code]);
    expect(disposeTheseText(3)).toBe('Dispose these 3');
    expect(disposeTheseText(1)).toBe('Dispose of it');
    expect(assetsText(1)).toBe('1 asset');
  });
});

describe('sending', () => {
  it('at least one, at most 200', () => {
    expect(codesProblem([])).toBe('Tick the assets first.');
    expect(codesProblem(['PK-CAM-0001'])).toBeNull();
    expect(codesProblem(Array.from({ length: 201 }, (_, i) => `PK-CAM-${i}`))).toBe('Choose at most 200 assets at a time.');
  });

  it('Dispose selected read as one disposal is: how, the day (today when empty), who approved it, a note; no amount', () => {
    const codes = ['PK-CAM-0001', 'PK-CAM-0004'];
    expect(bulkDisposeBody(codes, form({ method: 'scrapped', on: '24/10/2026', approvedBy: 'The CEO', notes: 'Water damage', amount: '500' }), TODAY)).toEqual({
      body: { codes, method: 'scrapped', date: '2026-10-24', approvedBy: 'The CEO', note: 'Water damage' },
      problems: [],
    });
    expect(bulkDisposeBody(codes, form({ method: 'sold', on: '', approvedBy: 'Finance', notes: '' }), TODAY).body).toEqual({ codes, method: 'sold', date: TODAY, approvedBy: 'Finance' });
    expect(bulkDisposeBody(codes, form({ method: '', on: '26/10/2026', approvedBy: '' }), TODAY).problems).toEqual([
      'Choose how it was disposed of: sold, scrapped, written off or donated.',
      'The disposal date can’t be in the future.',
      'Say who approved the disposal.',
    ]);
    expect(bulkDisposeBody([], form({ method: 'sold', on: '', approvedBy: 'Finance' }), TODAY).problems).toEqual(['Tick the assets first.']);
  });
});
