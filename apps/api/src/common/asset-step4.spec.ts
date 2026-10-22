import {
  accessoriesBackProblems,
  accessoriesDeductionReason,
  accessoriesGoingOut,
  accessoriesOutOf,
  accessoriesProblems,
  accessoriesText,
  accessoryText,
  attachedSkipReason,
  attachProblem,
  disposalProblems,
  disposeProblem,
  kitItemProblem,
  kitStatusOf,
  maintenanceProblems,
  missingAccessories,
  stockAfter,
  stockDelta,
  stockMoveProblems,
  tidyAccessories,
  type AttachSide,
} from '@trendlix/shared';

// Assets step 4 (the owner's build order, 21 October 2026: "kits / stock / repairs / disposal") and accessories (owner,
// 22 October 2026: "like laptop charger under the charger, DJI ronin accessories"; "Both kinds"): the shared rules
// (packages/shared asset-accessories.ts, asset-upkeep.ts).

describe('the accessories’ checklist', () => {
  it('tidies what the form sends: trimmed, empty ones null, one unless counted', () => {
    expect(tidyAccessories([{ name: '  Charger ', serial: ' ', notes: '' }, { name: 'Battery', quantity: 2, serial: 'SN 1' }])).toEqual([
      { name: 'Charger', quantity: 1, serial: null, notes: null },
      { name: 'Battery', quantity: 2, serial: 'SN 1', notes: null },
    ]);
    expect(tidyAccessories('nope')).toEqual([]);
  });

  it('wants a name, a whole quantity from 1 to 999, no line twice, at most 30', () => {
    expect(accessoriesProblems([{ name: 'Charger', quantity: 1, serial: null, notes: null }], 'it')).toEqual([]);
    expect(accessoriesProblems([{ name: '', quantity: 0, serial: null, notes: null }], 'it')).toEqual([
      'Accessory 1: give it a name, e.g. Charger.',
      'Accessory 1: give how many as a whole number from 1 to 999.',
    ]);
    expect(
      accessoriesProblems(
        [
          { name: 'Cable', quantity: 1, serial: null, notes: null },
          { name: 'cable', quantity: 2, serial: null, notes: null },
        ],
        'kit',
      ),
    ).toEqual(['Accessory 2 (cable): accessory 1 is the same. Count them in one line.']);
    // one serial number, one item (22 October 2026): two lines with the same serial, however it is typed
    expect(
      accessoriesProblems(
        [
          { name: 'Battery', quantity: 1, serial: 'BT-01', notes: null },
          { name: 'Spare battery', quantity: 1, serial: 'bt 01', notes: null },
        ],
        'kit',
      ),
    ).toEqual(['Accessory 2 (Spare battery): accessory 1 has the same serial number. A serial number is one item’s.']);
    const many = Array.from({ length: 31 }, (_, i) => ({ name: `Part ${i}`, quantity: 1, serial: null, notes: null }));
    expect(accessoriesProblems(many, 'kit')).toEqual(['Keep the accessories to 30 lines or fewer.']);
  });

  it('gives a consumable none', () => {
    expect(accessoriesProblems([{ name: 'Cap', quantity: 1, serial: null, notes: null }], 'consumable')).toEqual(['A consumable has no accessories: it is kept by quantity.']);
    expect(accessoriesProblems([], 'consumable')).toEqual([]);
  });

  it('says them in words', () => {
    expect(accessoryText({ name: 'Battery', quantity: 2, serial: 'SN 1' })).toBe('2 × Battery (SN 1)');
    expect(accessoriesText([{ name: 'Charger', quantity: 1 }, { name: 'Plate', quantity: 3 }])).toBe('Charger, 3 × Plate');
  });
});

describe('accessories on a handover and a return', () => {
  const checklist = [
    { id: 'a1', name: 'Charger', quantity: 1, serial: null, notes: null },
    { id: 'a2', name: 'Battery', quantity: 2, serial: null, notes: 'spare' },
  ];

  it('sends all of them unless some stay behind, as a snapshot', () => {
    expect(accessoriesGoingOut(checklist)).toEqual([
      { name: 'Charger', quantity: 1, serial: null },
      { name: 'Battery', quantity: 2, serial: null },
    ]);
    expect(accessoriesGoingOut(checklist, ['a2', 'unknown'])).toEqual([{ name: 'Battery', quantity: 2, serial: null }]);
    expect(accessoriesGoingOut(checklist, [])).toEqual([]);
  });

  it('counts what came back, from 0 to what went', () => {
    const out = accessoriesGoingOut(checklist);
    expect(accessoriesBackProblems(out, [1, 2])).toEqual([]);
    expect(accessoriesBackProblems(out, [1, 3])).toEqual(['2 × Battery: say how many came back, from 0 to 2.']);
    expect(accessoriesBackProblems(out, [1])).toEqual(['Say how many of each accessory came back. Reload the page and try again.']);
  });

  it('works out what is missing; an item missing has all of them missing', () => {
    const out = accessoriesGoingOut(checklist);
    expect(missingAccessories(out, [1, 2])).toEqual([]);
    expect(missingAccessories(out, null)).toEqual([]);
    expect(missingAccessories(out, [0, 1])).toEqual([
      { name: 'Charger', quantity: 1, serial: null },
      { name: 'Battery', quantity: 1, serial: null },
    ]);
    expect(missingAccessories(out, [1, 2], true)).toEqual(out);
  });

  it('prefills the deduction’s reason, and reads a snapshot back', () => {
    expect(accessoriesDeductionReason([{ name: 'Charger', quantity: 1, serial: null }], 'IT-LAP-0003', 'CUS-0042')).toBe('Loss: Charger of IT-LAP-0003 on CUS-0042');
    expect(accessoriesOutOf([{ name: 'Charger', quantity: 1 }, { nope: true }, 'x'])).toEqual([{ name: 'Charger', quantity: 1, serial: null }]);
    expect(accessoriesOutOf(null)).toEqual([]);
  });
});

describe('attached assets', () => {
  const side = (over: Partial<AttachSide>): AttachSide => ({ id: 'x', code: 'PK-ACC-0001', group: 'kit', status: 'available', parentId: null, attached: 0, ...over });
  const main = side({ id: 'm', code: 'PK-GMB-0001' });

  it('attaches one level only', () => {
    expect(attachProblem(side({ id: 'c' }), main)).toBeNull();
    expect(attachProblem(side({ id: 'c' }), { ...main, parentId: 'p' })).toBe('PK-GMB-0001 is itself attached to another asset: attach to that one instead (one level only).');
    expect(attachProblem(side({ id: 'c', attached: 2 }), main)).toBe('PK-ACC-0001 has assets attached to it: it can’t be attached to another (one level only).');
  });

  it('never to itself, never a consumable, never a disposed one, never twice', () => {
    expect(attachProblem(main, main)).toBe('An asset can’t be attached to itself.');
    expect(attachProblem(side({ id: 'c', group: 'consumable' }), main)).toBe('PK-ACC-0001 is a consumable: consumables are kept by quantity, not attached.');
    expect(attachProblem(side({ id: 'c' }), { ...main, group: 'consumable' })).toBe('PK-GMB-0001 is a consumable: nothing is attached to a consumable.');
    expect(attachProblem(side({ id: 'c', status: 'disposed' }), main)).toBe('PK-ACC-0001 is disposed: it can’t be attached.');
    expect(attachProblem(side({ id: 'c' }), { ...main, status: 'disposed' })).toBe('PK-GMB-0001 is disposed: nothing can be attached to it.');
    expect(attachProblem(side({ id: 'c', parentId: 'm' }), main)).toBe('PK-ACC-0001 is attached to PK-GMB-0001 already.');
  });

  it('skips an attached asset that isn’t available, saying why', () => {
    expect(attachedSkipReason({ status: 'available' })).toBeNull();
    expect(attachedSkipReason({ status: 'custody', holder: 'Nour Adel', custodyCode: 'CUS-0007' })).toBe('Out with Nour Adel on CUS-0007');
    expect(attachedSkipReason({ status: 'repair' })).toBe('Under repair');
  });
});

describe('stock', () => {
  it('uses up to what is in stock and restocks within the limit', () => {
    expect(stockMoveProblems('use', 2, 5, 'rolls')).toEqual([]);
    expect(stockMoveProblems('use', 6, 5, 'rolls')).toEqual(['Only 5 rolls in stock: use at most that.']);
    expect(stockMoveProblems('use', 1, 0, null)).toEqual(['None is in stock: restock it first.']);
    expect(stockMoveProblems('restock', 0, 5, null)).toEqual(['Enter how many, above 0, with at most 2 decimals.']);
    expect(stockMoveProblems('restock', 1.234, 5, null)).toEqual(['Enter how many, above 0, with at most 2 decimals.']);
    expect(stockMoveProblems('restock', 999_999, 5, null)).toEqual(['The stock can be at most 1,000,000.']);
    expect(stockMoveProblems('take', 1, 5, null)).toEqual(['Choose Use or Restock.']);
  });

  it('moves the stock, never below 0', () => {
    expect(stockDelta('use', 2.5)).toBe(-2.5);
    expect(stockDelta('restock', 3)).toBe(3);
    expect(stockAfter(5, -2.5)).toBe(2.5);
    expect(stockAfter(1, -2)).toBe(0);
  });
});

describe('kits', () => {
  it('stands Available, Partly out, Out or Empty', () => {
    expect(kitStatusOf([])).toBe('empty');
    expect(kitStatusOf([{ status: 'available' }, { status: 'available' }])).toBe('available');
    expect(kitStatusOf([{ status: 'available' }, { status: 'custody' }])).toBe('partly_out');
    expect(kitStatusOf([{ status: 'custody' }, { status: 'repair' }])).toBe('out');
    expect(kitStatusOf([{ status: 'disposed' }])).toBe('empty');
  });

  it('takes production kit assets only, never a disposed one', () => {
    expect(kitItemProblem({ code: 'PK-CAM-0001', group: 'kit', status: 'custody' })).toBeNull();
    expect(kitItemProblem({ code: 'IT-LAP-0001', group: 'it', status: 'available' })).toBe('IT-LAP-0001 isn’t a production kit asset: only those go in a kit.');
    expect(kitItemProblem({ code: 'PK-CAM-0002', group: 'kit', status: 'disposed' })).toBe('PK-CAM-0002 is disposed: it can’t go in a kit.');
  });
});

describe('the maintenance log by hand', () => {
  const entry = { kind: 'service' as const, on: '2026-10-20', vendor: 'Camera Clinic', cost: 1500, notes: null };

  it('wants a kind, a past day, and who did it or what was done', () => {
    expect(maintenanceProblems(entry, '2026-10-22')).toEqual([]);
    expect(maintenanceProblems({ ...entry, on: '2026-10-23' }, '2026-10-22')).toEqual(['The date can’t be in the future.']);
    expect(maintenanceProblems({ ...entry, vendor: null }, '2026-10-22')).toEqual(['Say who did it or what was done.']);
    expect(maintenanceProblems({ ...entry, cost: -1 }, '2026-10-22')).toEqual(['Enter the cost in EGP as 0 or more, with at most 2 decimals.']);
  });
});

describe('disposal', () => {
  const d = { method: 'sold' as const, on: '2026-10-22', amount: 12000, approvedBy: 'The CEO', notes: null };

  it('never one in custody, a consumable, or one disposed already', () => {
    expect(disposeProblem({ code: 'PK-CAM-0001', group: 'kit', status: 'repair' })).toBeNull();
    expect(disposeProblem({ code: 'PK-CAM-0001', group: 'kit', status: 'custody' })).toBe('PK-CAM-0001 is in custody: receive it back first, then dispose of it.');
    expect(disposeProblem({ code: 'CS-TAP-0001', group: 'consumable', status: 'available' })).toBe('CS-TAP-0001 is a consumable: it is used up through Stock, not disposed of.');
    expect(disposeProblem({ code: 'PK-CAM-0001', group: 'kit', status: 'disposed' })).toBe('PK-CAM-0001 is disposed already.');
  });

  it('wants the method, a day not in the future nor before the purchase, and who approved it', () => {
    expect(disposalProblems(d, '2026-10-22')).toEqual([]);
    expect(disposalProblems({ ...d, amount: null }, '2026-10-22')).toEqual([]);
    expect(disposalProblems({ ...d, on: '2026-10-23' }, '2026-10-22')).toEqual(['The disposal date can’t be in the future.']);
    expect(disposalProblems({ ...d, on: '2025-01-01' }, '2026-10-22', '2025-06-01')).toEqual(['The disposal date can’t be before the purchase date.']);
    expect(disposalProblems({ ...d, approvedBy: ' ' }, '2026-10-22')).toEqual(['Say who approved the disposal.']);
    expect(disposalProblems({ ...d, method: 'burnt' as never }, '2026-10-22')).toEqual(['Choose how it was disposed of: sold, scrapped, written off or donated.']);
  });
});
