import type { HandoverAssetChoice } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { attachedText, handoverBody, handoverStart, readAccessoriesBack, readReturnForm } from './custody';
import {
  accessoriesDeductionHref,
  deltaText,
  disposalBody,
  disposalResultText,
  incidentDeductionHref,
  kitCodesFrom,
  kitStatusTone,
  maintenanceBody,
  missingAccessoriesText,
  readAccessoriesForm,
  readParentCode,
  stockBody,
} from './upkeep';

// Assets step 4 on the site (the owner's build order, 21 October 2026: "kits / stock / repairs / disposal"; owner, 22
// October 2026: accessories, "Both kinds"): the forms read into what the API takes, and what the pages say.

const form = (values: Record<string, string | string[]>) => ({
  get: (k: string) => {
    const v = values[k];
    return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
  },
  getAll: (k: string) => {
    const v = values[k];
    return v === undefined ? [] : Array.isArray(v) ? v : [v];
  },
});

describe('the accessories’ checklist form', () => {
  it('reads its lines, an empty one left out, one unless counted', () => {
    const fd = form({ 'acc-name-0': ' Charger ', 'acc-serial-0': 'CH-1', 'acc-name-1': 'Cable', 'acc-quantity-1': '2', 'acc-quantity-2': '1' });
    expect(readAccessoriesForm(fd, 3, 'it')).toEqual({
      items: [
        { name: 'Charger', quantity: 1, serial: 'CH-1', notes: null },
        { name: 'Cable', quantity: 2, serial: null, notes: null },
      ],
      problems: [],
    });
  });

  it('says what is wrong, as the API will', () => {
    expect(readAccessoriesForm(form({ 'acc-name-0': 'Cable', 'acc-quantity-0': 'two' }), 1, 'kit').problems).toEqual(['Accessory 1 (Cable): give how many as a whole number from 1 to 999.']);
    expect(readAccessoriesForm(form({ 'acc-serial-0': 'X1' }), 1, 'kit').problems).toEqual(['Accessory 1: give it a name, e.g. Charger.']);
    expect(readAccessoriesForm(form({ 'acc-name-0': 'Cap' }), 1, 'consumable').problems).toEqual(['A consumable has no accessories: it is kept by quantity.']);
  });
});

describe('attaching', () => {
  it('reads the main asset’s code as kept', () => {
    expect(readParentCode(' pk-gmb-0001 ')).toEqual({ code: 'PK-GMB-0001', problem: null });
    expect(readParentCode('ronin')).toEqual({ code: null, problem: 'RONIN isn’t an asset code: type it as on its label, e.g. PK-GMB-0001.' });
    expect(readParentCode('')).toEqual({ code: null, problem: 'Enter the main asset’s code, e.g. PK-GMB-0001.' });
  });

  it('says what goes with an asset on a handover, and what stays', () => {
    const a = {
      attached: [
        { id: '1', code: 'PK-ACC-0001', name: 'Plate', status: 'available', why: null },
        { id: '2', code: 'PK-BAT-0001', name: 'Battery', status: 'repair', why: 'Under repair' },
      ],
    } as Pick<HandoverAssetChoice, 'attached'>;
    expect(attachedText(a)).toEqual({ going: 'Goes with it: PK-ACC-0001 Plate', skipped: 'Stays behind: PK-BAT-0001 (Under repair)' });
    expect(attachedText({})).toEqual({ going: null, skipped: null });
  });
});

describe('the handover with accessories', () => {
  it('sends the checklist’s lines ticked to go, and starts from a kit', () => {
    const { body } = handoverBody(
      {
        employeeId: 'e1',
        kind: 'assignment',
        dueDate: '',
        purpose: '',
        handedOverBy: 'Kareem',
        notes: '',
        items: [
          { assetId: 'a1', conditionOut: 'good', accessories: '', accessoryIds: ['x1'] },
          { assetId: 'a2', conditionOut: '', accessories: 'Bag' },
        ],
      },
      '2026-10-22',
    );
    expect(body.items).toEqual([
      { assetId: 'a1', conditionOut: 'good', accessories: null, accessoryIds: ['x1'] },
      { assetId: 'a2', conditionOut: null, accessories: 'Bag' },
    ]);
    const kit = '0b9d3f5e-2c1a-4f6b-9e7d-1a2b3c4d5e6f';
    expect(handoverStart({ kit })).toEqual({ employeeId: null, assetCode: null, kitId: kit });
    expect(handoverStart({ kit: 'nope' }).kitId).toBeNull();
  });
});

describe('receiving back with accessories', () => {
  const out = [
    { name: 'Charger', quantity: 1, serial: null },
    { name: 'Battery', quantity: 2, serial: null },
  ];

  it('reads a tick for one, a number for more (empty: all back)', () => {
    expect(readAccessoriesBack(form({ 'accback-i1-0': '1' }), 'i1', out)).toEqual([1, 2]);
    expect(readAccessoriesBack(form({ 'accback-i1-1': '1' }), 'i1', out)).toEqual([0, 1]);
    expect(readAccessoriesBack(form({ 'accback-i1-1': 'x' }), 'i1', out)).toEqual([0, -1]);
    expect(readAccessoriesBack(form({}), 'i1', [])).toBeNull();
  });

  it('sends them with each line, never for an item missing', () => {
    const fd = form({ 'condition-i1': 'good', 'accback-i1-0': '1', 'accback-i1-1': '1', 'condition-i2': 'missing' });
    expect(readReturnForm(fd, [{ id: 'i1', accessoriesOut: out }, { id: 'i2', accessoriesOut: out }, 'i3']).lines).toEqual([
      { itemId: 'i1', condition: 'good', notes: null, accessoriesBack: [1, 1] },
      { itemId: 'i2', condition: 'missing', notes: null },
    ]);
  });

  it('says what didn’t come back, and HR’s deduction names it', () => {
    expect(missingAccessoriesText([{ name: 'Charger', quantity: 1, serial: 'CH-1' }])).toBe('Not back: Charger (CH-1)');
    expect(missingAccessoriesText([])).toBeNull();
    const href = accessoriesDeductionHref({ employeeId: 'e1', itemId: 'i1', missing: [{ name: 'Charger', quantity: 1, serial: null }], assetCode: 'IT-LAP-0003', custodyCode: 'CUS-0042' }, '2026-10-22');
    expect(new URL(href, 'https://x').searchParams.get('reason')).toBe('Loss: Charger of IT-LAP-0003 on CUS-0042');
    expect(incidentDeductionHref({ employeeId: 'e1', itemId: 'i1', condition: 'good', missing: [], assetCode: 'A', custodyCode: 'C' }, '2026-10-22')).toBeNull();
    expect(incidentDeductionHref({ employeeId: 'e1', itemId: 'i1', condition: 'damaged', assetCode: 'PK-CAM-0001', custodyCode: 'CUS-0001' }, '2026-10-22')).toContain('reason=Damage');
  });
});

describe('stock', () => {
  it('reads Use and Restock, checked against the stock now', () => {
    expect(stockBody(form({ amount: '2', note: 'Shoot' }), 'use', 5, 'roll')).toEqual({ body: { kind: 'use', amount: 2, note: 'Shoot' }, problems: [] });
    expect(stockBody(form({ amount: '6' }), 'use', 5, 'roll').problems).toEqual(['Only 5 roll in stock: use at most that.']);
    expect(stockBody(form({ amount: '' }), 'restock', 5, null).problems).toEqual(['Enter how many, e.g. 2 or 2.5.']);
  });

  it('says a move with its sign', () => {
    expect(deltaText(-8, 'rolls')).toBe('−8 rolls');
    expect(deltaText(12.5, null)).toBe('+12.5');
  });
});

describe('the maintenance log and disposal', () => {
  it('reads a maintenance entry, today when no date, the cost only for those who see the values', () => {
    expect(maintenanceBody(form({ kind: 'service', vendor: 'Clinic', cost: '900' }), { values: false, today: '2026-10-22' })).toEqual({
      body: { kind: 'service', on: '2026-10-22', vendor: 'Clinic', notes: null },
      problems: [],
    });
    expect(maintenanceBody(form({ kind: 'service', vendor: 'Clinic', cost: '900', on: '20/10/2026' }), { values: true, today: '2026-10-22' }).body).toEqual({
      kind: 'service',
      on: '2026-10-20',
      vendor: 'Clinic',
      notes: null,
      cost: 900,
    });
    expect(maintenanceBody(form({ kind: 'service' }), { values: false, today: '2026-10-22' }).problems).toEqual(['Say who did it or what was done.']);
  });

  it('reads a disposal, and says what else it did', () => {
    expect(disposalBody(form({ method: 'sold', approvedBy: 'The CEO', amount: '12000' }), { values: true, today: '2026-10-22', purchaseDate: null })).toEqual({
      body: { method: 'sold', on: '2026-10-22', approvedBy: 'The CEO', notes: null, amount: 12000 },
      problems: [],
    });
    expect(disposalBody(form({ method: 'sold', approvedBy: 'The CEO', amount: '12000' }), { values: false, today: '2026-10-22', purchaseDate: null }).body).not.toHaveProperty('amount');
    expect(disposalBody(form({ method: '', approvedBy: '' }), { values: false, today: '2026-10-22', purchaseDate: null }).problems).toEqual([
      'Choose how it was disposed of: sold, scrapped, written off or donated.',
      'Say who approved the disposal.',
    ]);
    expect(disposalResultText({ leftKit: 'PK-KIT-A', detached: ['PK-ACC-0001'], detachedFrom: null })).toBe('It left PK-KIT-A. Detached from it: PK-ACC-0001.');
    expect(disposalResultText({ leftKit: null, detached: [], detachedFrom: null })).toBeNull();
  });
});

describe('kits', () => {
  it('reads the codes typed, any case and separator, and those that aren’t codes', () => {
    expect(kitCodesFrom('pk-cam-0003, PK-LEN-0007\nPK-CAM-0003 ronin')).toEqual({ codes: ['PK-CAM-0003', 'PK-LEN-0007'], wrong: ['RONIN'] });
  });

  it('colours a kit by how it stands', () => {
    expect(kitStatusTone('available')).toContain('ok');
    expect(kitStatusTone('partly_out')).toContain('warn');
    expect(kitStatusTone('empty')).toContain('muted');
  });
});
