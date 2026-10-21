import {
  ASSET_CODE_PATTERN,
  ASSET_GROUP_RULES,
  ASSET_GROUPS,
  ASSET_TYPE_CODES,
  ASSET_TYPES,
  assetCode,
  assetCodePrefix,
  assetFieldsOf,
  assetLabelUrl,
  assetProblems,
  assetsAccessAtLeast,
  assetsAccessOf,
  assetsCan,
  assetStatusProblem,
  assetTypesFor,
  assetValuesProblems,
  bookValue,
  custodyCode,
  fitToGroup,
  isAssetCode,
  kitCode,
  kitLetters,
  needsReorder,
  needsValues,
  normalAssetCode,
  seesAssetValues,
  thresholdProblem,
  type AssetInput,
  type AssetValuesInput,
} from '@trendlix/shared';

// The Assets module's rules (owner, 21 October 2026: "i want to add this module with a special permission to the
// system", with the "Asset Register" spec; "3 levels per user"; values: "CEO and Finance"): packages/shared assets.ts.

const TODAY = '2026-10-21';

const asset = (over: Partial<AssetInput> = {}): AssetInput => ({
  name: 'Sony FX3',
  group: 'kit',
  type: 'CAM',
  assetClass: 'fixed',
  brand: 'Sony',
  model: 'FX3',
  serial: 'S01-123',
  condition: 'good',
  roomId: null,
  kitId: null,
  quantity: null,
  unit: null,
  reorderLevel: null,
  purchaseDate: '2025-10-21',
  usefulLifeYears: 5,
  warrantyEnd: null,
  notes: null,
  ...over,
});

const NO_VALUES: AssetValuesInput = { purchasePrice: null, supplier: null, invoiceNo: null, priceLow: null, marketValue: null, priceHigh: null, priceNote: null };

describe('Assets access', () => {
  it('a Super Admin is always a manager, whatever is set', () => {
    for (const set of ['none', 'viewer', 'custodian', 'manager', null, undefined]) expect(assetsAccessOf({ roles: ['super_admin'], assetsAccess: set })).toBe('manager');
  });

  it('the CEO and Finance are at least viewers, and keep a higher level set', () => {
    expect(assetsAccessOf({ roles: ['ceo'], assetsAccess: 'none' })).toBe('viewer');
    expect(assetsAccessOf({ roles: ['employee', 'finance'], assetsAccess: 'none' })).toBe('viewer');
    expect(assetsAccessOf({ roles: ['finance'], assetsAccess: 'custodian' })).toBe('custodian');
    expect(assetsAccessOf({ roles: ['ceo'], assetsAccess: 'manager' })).toBe('manager');
  });

  it('everyone else has the level set, none until one is (an unknown value is none)', () => {
    expect(assetsAccessOf({ roles: ['employee'] })).toBe('none');
    expect(assetsAccessOf({ roles: ['hr'], assetsAccess: 'viewer' })).toBe('viewer');
    expect(assetsAccessOf({ roles: ['admin'], assetsAccess: 'manager' })).toBe('manager');
    expect(assetsAccessOf({ roles: ['employee'], assetsAccess: 'owner' })).toBe('none');
  });

  it('each level does what those below it do', () => {
    expect(assetsAccessAtLeast('manager', 'custodian')).toBe(true);
    expect(assetsAccessAtLeast('custodian', 'viewer')).toBe(true);
    expect(assetsAccessAtLeast('viewer', 'custodian')).toBe(false);
    expect(assetsAccessAtLeast('custodian', 'manager')).toBe(false);
    expect(assetsAccessAtLeast('none', 'viewer')).toBe(false);
  });

  it('only the CEO, Finance and a Super Admin see the values; not an Assets manager, HR or an Admin', () => {
    expect(seesAssetValues({ roles: ['ceo'] })).toBe(true);
    expect(seesAssetValues({ roles: ['finance'] })).toBe(true);
    expect(seesAssetValues({ roles: ['super_admin'] })).toBe(true);
    expect(seesAssetValues({ roles: ['hr', 'admin', 'manager', 'employee'] })).toBe(false);
  });

  it('what each may do: the settings for a manager or someone who sets the values', () => {
    expect(assetsCan({ access: 'none', values: false, ai: false })).toEqual({ view: false, register: false, manage: false, values: false, settings: false });
    expect(assetsCan({ access: 'viewer', values: false, ai: false })).toEqual({ view: true, register: false, manage: false, values: false, settings: false });
    expect(assetsCan({ access: 'custodian', values: false, ai: false })).toEqual({ view: true, register: true, manage: false, values: false, settings: false });
    expect(assetsCan({ access: 'manager', values: false, ai: false })).toEqual({ view: true, register: true, manage: true, values: false, settings: true });
    expect(assetsCan({ access: 'viewer', values: true, ai: false })).toEqual({ view: true, register: false, manage: false, values: true, settings: true });
  });
});

describe('the five groups', () => {
  it('as the spec has them: prefixes, default classes, useful lives, counts and who holds them', () => {
    expect(ASSET_GROUPS.map((g) => ASSET_GROUP_RULES[g].prefix)).toEqual(['ST', 'PK', 'IT', 'OF', 'CS']);
    expect(ASSET_GROUPS.map((g) => ASSET_GROUP_RULES[g].defaultClass)).toEqual(['fixed', 'fixed', 'fixed', 'fixed', 'current']);
    expect(ASSET_GROUPS.map((g) => ASSET_GROUP_RULES[g].usefulLifeYears)).toEqual([8, 5, 3, 7, null]);
    expect(ASSET_GROUPS.map((g) => ASSET_GROUP_RULES[g].countEveryDays)).toEqual([182, 30, 91, 365, 30]);
    expect(ASSET_GROUPS.map((g) => ASSET_GROUP_RULES[g].custodyBy)).toEqual(['room', 'employee_per_shoot', 'employee_long_term', 'room', 'storeroom']);
  });

  it('the fields each group has: consumables by quantity, a kit only for production kit assets', () => {
    expect(assetFieldsOf('consumable')).toEqual({ stock: true, kit: false, serial: false, condition: false, usefulLife: false, status: false });
    expect(assetFieldsOf('kit')).toEqual({ stock: false, kit: true, serial: true, condition: true, usefulLife: true, status: true });
    for (const g of ['studio', 'it', 'office'] as const) expect(assetFieldsOf(g)).toMatchObject({ stock: false, kit: false, usefulLife: true });
  });

  it('fitting to a group clears what it doesn’t have, a consumable’s quantity 0 when none is given', () => {
    expect(fitToGroup(asset({ group: 'it', kitId: '00000000-0000-4000-8000-000000000001', quantity: 3 }))).toMatchObject({ kitId: null, quantity: null, usefulLifeYears: 5 });
    const consumable = fitToGroup(asset({ group: 'consumable', type: 'TAP', unit: 'roll', reorderLevel: 2 }));
    expect(consumable).toMatchObject({ quantity: 0, unit: 'roll', reorderLevel: 2, serial: null, condition: null, usefulLifeYears: null, kitId: null });
    expect(fitToGroup(asset({ group: 'kit', kitId: 'k' })).kitId).toBe('k');
  });

  it('the types: their codes and the usual group, Vehicle and Other offered for any', () => {
    expect(ASSET_TYPE_CODES).toHaveLength(31);
    expect(new Set(ASSET_TYPE_CODES).size).toBe(31);
    for (const code of ASSET_TYPE_CODES) expect(code).toMatch(/^[A-Z]{2,4}$/);
    expect(ASSET_TYPES.find((t) => t.code === 'AC')?.label).toBe('Air conditioner');
    expect(assetTypesFor('it')).toEqual(['LAP', 'WKS', 'PHN', 'TAB', 'DRV', 'NET', 'VEH', 'OTH']);
    expect(assetTypesFor('consumable')).toEqual(['VEH', 'GEL', 'TAP', 'PAP', 'SUP', 'OTH']);
  });
});

describe('codes', () => {
  it('PREFIX-TYPE-NNNN, padded to 4 digits, more when needed', () => {
    expect(assetCodePrefix('kit', 'CAM')).toBe('PK-CAM-');
    expect(assetCode('PK-CAM-', 3)).toBe('PK-CAM-0003');
    expect(assetCode(assetCodePrefix('it', 'LAP'), 12)).toBe('IT-LAP-0012');
    expect(assetCode(assetCodePrefix('studio', 'AC'), 1)).toBe('ST-AC-0001');
    expect(assetCode('OF-CHR-', 12345)).toBe('OF-CHR-12345');
    for (const code of ['PK-CAM-0003', 'ST-AC-0001', 'CS-TAP-10000']) expect(isAssetCode(code)).toBe(true);
    for (const code of ['PK-CAM-003', 'XX-CAM-0003', 'pk-cam-0003', 'PK-KIT-A', 'PK-CAMERA-0001']) expect(isAssetCode(code)).toBe(false);
    expect(ASSET_CODE_PATTERN.exec('IT-LAP-0012')?.slice(1)).toEqual(['IT', 'LAP', '0012']);
  });

  it('a code as typed or scanned', () => {
    expect(normalAssetCode(' pk-cam-0003 ')).toBe('PK-CAM-0003');
  });

  it('kits: PK-KIT-A … Z, then AA, AB …', () => {
    expect([1, 2, 26, 27, 28, 52, 53, 702, 703].map(kitLetters)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
    expect(kitCode(1)).toBe('PK-KIT-A');
    expect(kitCode(27)).toBe('PK-KIT-AA');
    expect(() => kitLetters(0)).toThrow();
  });

  it('custody records: CUS-0042', () => {
    expect(custodyCode(42)).toBe('CUS-0042');
  });

  it('the QR label’s address is the asset’s page on the site', () => {
    expect(assetLabelUrl('PK-CAM-0003')).toBe('https://people.trendlix.com/assets/PK-CAM-0003');
  });
});

describe('statuses', () => {
  it('custody is never set by hand, nor ended by hand', () => {
    expect(assetStatusProblem('available', 'custody', 'kit')).toMatch(/handover only/);
    expect(assetStatusProblem(null, 'custody', 'kit')).toMatch(/handover only/);
    expect(assetStatusProblem('custody', 'available', 'kit')).toMatch(/received back/);
  });

  it('disposal has its own steps, and a disposed asset stays disposed', () => {
    expect(assetStatusProblem('available', 'disposed', 'it')).toMatch(/Disposal/);
    expect(assetStatusProblem('disposed', 'available', 'it')).toMatch(/stays disposed/);
  });

  it('under repair and lost by hand; a consumable is always available', () => {
    expect(assetStatusProblem('available', 'repair', 'kit')).toBeNull();
    expect(assetStatusProblem('repair', 'lost', 'office')).toBeNull();
    expect(assetStatusProblem('lost', 'available', 'office')).toBeNull();
    expect(assetStatusProblem(null, 'available', 'consumable')).toBeNull();
    expect(assetStatusProblem('available', 'repair', 'consumable')).toMatch(/always available/);
    expect(assetStatusProblem('available', 'available', 'kit')).toBeNull();
  });
});

describe('book value', () => {
  const fixed = { purchasePrice: 100_000, purchaseDate: '2024-10-21', usefulLifeYears: 5, assetClass: 'fixed' };

  it('straight line: price × (1 − years since purchase ÷ useful life)', () => {
    // 730 days: 1.9986 years of 5 → 100,000 × 0.60027 = 60,027.38
    expect(bookValue(fixed, 0, TODAY)).toEqual({ amount: 60_027.38, expensed: false, missing: null });
    // about half its life: 913 days are 2.4997 of its 5 years → 10,000 × 0.50007 = 5,000.68
    expect(bookValue({ purchasePrice: 10_000, purchaseDate: '2024-04-21', usefulLifeYears: 5, assetClass: 'fixed' }, 0, '2026-10-21').amount).toBe(5_000.68);
    expect(bookValue({ ...fixed, purchaseDate: TODAY }, 0, TODAY).amount).toBe(100_000);
  });

  it('never below 0, and no years before the purchase date', () => {
    expect(bookValue({ ...fixed, purchaseDate: '2015-01-01' }, 0, TODAY).amount).toBe(0);
    expect(bookValue({ ...fixed, purchaseDate: '2027-01-01' }, 0, TODAY).amount).toBe(100_000);
  });

  it('Expensed below the capitalization threshold: 0, the threshold itself is capitalized', () => {
    expect(bookValue({ ...fixed, purchasePrice: 4_999.99 }, 5_000, TODAY)).toEqual({ amount: 0, expensed: true, missing: null });
    expect(bookValue({ ...fixed, purchasePrice: 5_000, purchaseDate: TODAY }, 5_000, TODAY)).toEqual({ amount: 5_000, expensed: false, missing: null });
  });

  it('a current asset is its price (stock isn’t depreciated), unless Expensed', () => {
    expect(bookValue({ purchasePrice: 750, purchaseDate: null, usefulLifeYears: null, assetClass: 'current' }, 0, TODAY)).toEqual({ amount: 750, expensed: false, missing: null });
    expect(bookValue({ purchasePrice: 750, purchaseDate: null, usefulLifeYears: null, assetClass: 'current' }, 1_000, TODAY).expensed).toBe(true);
  });

  it('none without what it needs, and says what', () => {
    expect(bookValue({ ...fixed, purchasePrice: null }, 0, TODAY)).toEqual({ amount: null, expensed: false, missing: 'purchase_price' });
    expect(bookValue({ ...fixed, purchaseDate: null }, 0, TODAY).missing).toBe('purchase_date');
    expect(bookValue({ ...fixed, usefulLifeYears: null }, 0, TODAY).missing).toBe('useful_life');
  });

  it('"Needs values": no purchase cost and not disposed', () => {
    expect(needsValues({ purchasePrice: null, status: 'available' })).toBe(true);
    expect(needsValues({ purchasePrice: 0, status: 'available' })).toBe(false);
    expect(needsValues({ purchasePrice: null, status: 'disposed' })).toBe(false);
  });
});

describe('the form’s checks', () => {
  it('a full asset passes', () => {
    expect(assetProblems(asset(), TODAY)).toEqual([]);
  });

  it('the name, a kit only for kit assets, quantity only for consumables', () => {
    expect(assetProblems(asset({ name: ' ' }), TODAY)).toContain('Enter the asset’s name.');
    expect(assetProblems(asset({ group: 'it', kitId: 'k' }), TODAY)).toContain('Only a production kit asset goes in a kit.');
    expect(assetProblems(asset({ quantity: 2 }), TODAY)).toContain('Only consumables are kept by quantity.');
    expect(assetProblems(fitToGroup(asset({ group: 'consumable', quantity: -1 })), TODAY)[0]).toMatch(/quantity/);
  });

  it('dates: real ones, the purchase not in the future, the warranty not before it', () => {
    expect(assetProblems(asset({ purchaseDate: '2026-10-22' }), TODAY)).toContain('The purchase date can’t be in the future.');
    expect(assetProblems(asset({ purchaseDate: '2026-02-30' }), TODAY)).toContain('Enter the purchase date as DD/MM/YYYY.');
    expect(assetProblems(asset({ warrantyEnd: '2025-01-01' }), TODAY)).toContain('The warranty can’t end before the purchase date.');
    expect(assetProblems(asset({ usefulLifeYears: 0 }), TODAY)[0]).toMatch(/useful life/);
  });

  it('values: amounts of 0 or more with 2 decimals, the market value low ≤ mid ≤ high', () => {
    expect(assetValuesProblems({ ...NO_VALUES, purchasePrice: 45_000.5, priceLow: 30_000, marketValue: 35_000, priceHigh: 40_000 })).toEqual([]);
    expect(assetValuesProblems({ ...NO_VALUES, purchasePrice: -1 })[0]).toMatch(/purchase cost/);
    expect(assetValuesProblems({ ...NO_VALUES, purchasePrice: 1.005 })[0]).toMatch(/2 decimals/);
    expect(assetValuesProblems({ ...NO_VALUES, priceLow: 40_000, marketValue: 35_000 })).toContain('The low market value can’t be more than the market value.');
    expect(assetValuesProblems({ ...NO_VALUES, marketValue: 45_000, priceHigh: 40_000 })).toContain('The market value can’t be more than the high one.');
  });

  it('the threshold: 0 or more', () => {
    expect(thresholdProblem(5_000)).toBeNull();
    expect(thresholdProblem(0)).toBeNull();
    expect(thresholdProblem(-1)).not.toBeNull();
  });

  it('reorder at or under the reorder level, consumables only', () => {
    expect(needsReorder({ group: 'consumable', quantity: 2, reorderLevel: 2 })).toBe(true);
    expect(needsReorder({ group: 'consumable', quantity: 3, reorderLevel: 2 })).toBe(false);
    expect(needsReorder({ group: 'consumable', quantity: 0, reorderLevel: null })).toBe(false);
    expect(needsReorder({ group: 'kit', quantity: 0, reorderLevel: 1 })).toBe(false);
  });
});
