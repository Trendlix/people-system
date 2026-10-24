import { describe, expect, it } from 'vitest';
import { ASSETS_PAGE_SIZE, type AssetListView, type AssetRowView } from '@trendlix/shared';
import { APP_ASSET_PATHS, ASSET_API, ASSET_PATHS, assetPhotoSrc } from '../../../lib/asset-paths';
import {
  accessInEffectText,
  accessShort,
  assetBody,
  bookValueText,
  codeFromParam,
  countText,
  doneText,
  draftDefaults,
  draftedText,
  editDefaults,
  groupChips,
  holderText,
  isFiltered,
  keptQuery,
  marketText,
  numberFrom,
  pagesOf,
  photosLeftText,
  photosSentText,
  placeText,
  quantityText,
  readAssetForm,
  readAssetQuery,
  readValuesForm,
  rowBookText,
  statusChips,
  statusTone,
  usefulLifeHint,
  valuesDefaults,
  warrantyText,
} from './assets';
import { LABEL_SIZE, labelDocument, labelMarkup } from './label';
import { photoTarget } from './photo-files';

// The Assets pages' rules (owner, 21 October 2026: "i want to add this module with a special permission to the system").

const TODAY = '2026-10-21';
const ROOM = '0b8f3c2e-1d4a-4c6b-9e7f-1a2b3c4d5e6f';
const KIT = '1c9f3c2e-1d4a-4c6b-9e7f-1a2b3c4d5e6f';

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

/** n rows of the register, for counting (what is in them doesn't matter here). */
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i) }) as AssetRowView);

const counts: AssetListView['counts'] = {
  group: { studio: 2, kit: 10, it: 4, office: 3, consumable: 1 },
  status: { available: 12, custody: 4, repair: 2, lost: 1, disposed: 3 },
};

describe('the addresses', () => {
  it('names the API, the site, the phone pages and the photos', () => {
    expect(ASSET_API.list({ q: ' fx3 ', group: 'kit', needsValues: true, page: 2 })).toBe('/assets?q=fx3&group=kit&needsValues=1&page=2');
    expect(ASSET_API.list()).toBe('/assets');
    expect(ASSET_API.asset('PK-CAM-0001')).toBe('/assets/PK-CAM-0001');
    expect(ASSET_API.values('PK-CAM-0001')).toBe('/assets/PK-CAM-0001/values');
    expect(ASSET_API.photoFirst('PK-CAM-0001', 'abc')).toBe('/assets/PK-CAM-0001/photos/abc/first');
    expect(ASSET_PATHS.listWith({ roomId: ROOM, page: 1 })).toBe(`/assets?roomId=${ROOM}`);
    expect(ASSET_PATHS.label('IT-LAP-0012')).toBe('/assets/IT-LAP-0012/label');
    expect(APP_ASSET_PATHS.asset('OF-CHR-0007')).toBe('/app/assets/OF-CHR-0007');
    expect(assetPhotoSrc('PK-CAM-0001', 'p1')).toBe('/asset-photo/PK-CAM-0001/p1');
  });

  it('names the drafts from Claude, the connector’s reports and the holder search (step 2)', () => {
    const id = '7d1e2f3a-4b5c-4d6e-8f9a-0b1c2d3e4f5a';
    expect(ASSET_API.drafts).toBe('/assets/drafts');
    expect(ASSET_API.draft(id)).toBe(`/assets/drafts/${id}`);
    expect(ASSET_API.draftConfirm(id)).toBe(`/assets/drafts/${id}/confirm`);
    expect(ASSET_API.draftDiscard(id)).toBe(`/assets/drafts/${id}/discard`);
    expect(ASSET_API.reports.holders('Mona Hassan')).toBe('/assets/reports/holders?q=Mona%20Hassan');
    expect(ASSET_API.reports.overdue).toBe('/assets/reports/overdue');
    expect(ASSET_API.reports.stock()).toBe('/assets/reports/stock');
    expect(ASSET_API.reports.stock(true)).toBe('/assets/reports/stock?reorder=1');
    expect(ASSET_API.reports.countsDue).toBe('/assets/reports/counts-due');
    expect(ASSET_API.list({ holder: ' EMP-0042 ' })).toBe('/assets?holder=EMP-0042');
    expect(ASSET_PATHS.drafts).toBe('/assets/drafts');
    expect(ASSET_PATHS.connectClaude).toBe('/assets/connect-claude');
  });

  it('reads an asset page’s code as kept, and nothing that isn’t one', () => {
    expect(codeFromParam('PK-CAM-0003')).toBe('PK-CAM-0003');
    expect(codeFromParam('pk-cam-0003')).toBe('PK-CAM-0003');
    expect(codeFromParam('st-ac-0001')).toBe('ST-AC-0001');
    expect(codeFromParam('new')).toBeNull();
    expect(codeFromParam('PK-CAM-3')).toBeNull();
    expect(codeFromParam('%E0%A4%A')).toBeNull();
  });
});

describe('the register’s address and chips', () => {
  it('keeps what it knows and drops the rest', () => {
    expect(readAssetQuery({ q: '  sony ', group: 'kit', status: 'repair', roomId: ROOM, kitId: 'x', page: '3' })).toEqual({
      q: 'sony',
      group: 'kit',
      status: 'repair',
      roomId: ROOM,
      kitId: null,
      page: 3,
    });
    expect(readAssetQuery({ group: 'cars', status: 'gone', page: '-1' })).toEqual({ q: '', group: null, status: null, roomId: null, kitId: null, page: 1 });
    expect(isFiltered(readAssetQuery({}))).toBe(false);
    expect(isFiltered(readAssetQuery({ kitId: KIT }))).toBe(true);
  });

  it('shows each group and status with its count, starting again on page 1', () => {
    const query = readAssetQuery({ q: 'cam', status: 'available', page: '2' });
    const groups = groupChips(query, counts);
    expect(groups.map((c) => [c.label, c.count, c.active])).toEqual([
      ['All groups', 20, true],
      ['Studio installed', 2, false],
      ['Production kit (movable)', 10, false],
      ['IT and devices', 4, false],
      ['Office furniture and equipment', 3, false],
      ['Consumables and stock', 1, false],
    ]);
    expect(groups[2].href).toBe('/assets?q=cam&group=kit&status=available');
    const statuses = statusChips(query, counts);
    // disposed assets leave every total: the first chip counts the others
    expect(statuses[0]).toMatchObject({ label: 'Not disposed', count: 19, active: false, href: '/assets?q=cam' });
    expect(statuses.find((c) => c.key === 'available')?.active).toBe(true);
    expect(statuses.find((c) => c.key === 'disposed')?.count).toBe(3);
    expect(groupChips(query, null)[0].count).toBeUndefined();
  });

  it('pages through the register', () => {
    const query = readAssetQuery({ q: 'cam', page: '2' });
    const list = { total: 120, page: 2, pageSize: ASSETS_PAGE_SIZE, items: rows(50) };
    expect(pagesOf(list, query)).toEqual({ count: 3, previous: '/assets?q=cam', next: '/assets?q=cam&page=3' });
    expect(countText(list)).toBe('Showing 51–100 of 120 assets');
    expect(countText({ total: 1, page: 1, pageSize: 50, items: rows(1) })).toBe('1 asset');
    expect(countText({ total: 0, page: 1, pageSize: 50, items: [] })).toBe('0 assets');
    expect(pagesOf({ total: 0, page: 1, pageSize: 50 }, query)).toEqual({ count: 1, previous: null, next: null });
  });
});

describe('what a row says', () => {
  it('says where it is, who holds it and how many', () => {
    expect(placeText({ room: { name: 'Studio A' }, kit: { code: 'PK-KIT-A', name: 'Interview kit' } })).toBe('Studio A · PK-KIT-A Interview kit');
    expect(placeText({ room: null, kit: null })).toBeNull();
    expect(holderText({ id: 'e', employeeCode: 'EMP-0042', fullNameEn: 'Mona Hassan' })).toBe('Mona Hassan · EMP-0042');
    expect(holderText(null)).toBeNull();
    expect(quantityText(12, 'rolls')).toBe('12 rolls');
    expect(quantityText(3.5, null)).toBe('3.5');
    expect(quantityText(null, 'm')).toBe('—');
  });

  it('says the book value in EGP, Expensed, or what it needs', () => {
    expect(bookValueText({ amount: 27000, expensed: false, missing: null })).toBe('EGP 27,000.00');
    expect(bookValueText({ amount: 0, expensed: true, missing: null })).toBe('Expensed (below the threshold)');
    expect(bookValueText({ amount: null, expensed: false, missing: 'purchase_date' })).toBe('Needs the purchase date');
    expect(rowBookText({ bookValue: 1500.5, expensed: false })).toBe('EGP 1,500.50');
    expect(rowBookText({ bookValue: 0, expensed: true })).toBe('Expensed');
    expect(rowBookText({ bookValue: null, expensed: false })).toBe('—');
    expect(marketText({ priceLow: 40000, marketValue: 45000, priceHigh: 50000 })).toBe('low EGP 40,000.00 · EGP 45,000.00 · high EGP 50,000.00');
    expect(marketText({ priceLow: null, marketValue: null, priceHigh: null })).toBe('—');
  });

  it('colours each status', () => {
    expect(statusTone('available')).toContain('text-ok');
    expect(statusTone('custody')).toContain('text-accent');
    expect(statusTone('repair')).toContain('text-warn');
    expect(statusTone('lost')).toContain('text-danger');
    expect(statusTone('disposed')).toContain('text-muted');
  });

  it('says the warranty and the group’s useful life', () => {
    expect(warrantyText('2027-01-31', TODAY)).toBe('Until 31/01/2027');
    expect(warrantyText('2025-01-31', TODAY)).toBe('Ended 31/01/2025');
    expect(warrantyText(null, TODAY)).toBeNull();
    expect(usefulLifeHint('kit')).toBe('Production kit (movable): 5 years unless you set another.');
    expect(usefulLifeHint('consumable')).toBe('Consumables have no useful life.');
  });

  it('says what was just done on the asset’s page', () => {
    expect(doneText('added', 'PK-CAM-0001')).toBe('PK-CAM-0001 added.');
    expect(doneText('saved', 'PK-CAM-0001', 2)).toBe('Changes saved. 2 photos were not added: add them under Photos.');
    expect(doneText('values', 'PK-CAM-0001')).toBe('Values saved.');
    expect(doneText(null, 'PK-CAM-0001', 1)).toBe('A photo was not added: add it under Photos.');
    expect(doneText(null, 'PK-CAM-0001')).toBeNull();
    // kept on the way to the app's page of the same asset
    expect(keptQuery({ done: 'saved', photosFailed: '1', q: 'x' })).toBe('?done=saved&photosFailed=1');
    expect(keptQuery({ done: '<script>' })).toBe('');
    expect(keptQuery({})).toBe('');
  });
});

describe('the Add and Edit forms', () => {
  it('reads numbers as typed, with thousands, Arabic digits and EGP', () => {
    expect(numberFrom('45,000.50')).toBe(45000.5);
    expect(numberFrom('٤٥٠٠٠')).toBe(45000);
    expect(numberFrom(' EGP 12 ')).toBe(12);
    expect(numberFrom('')).toBeNull();
    expect(numberFrom('twelve')).toBeNaN();
  });

  it('fits a production kit asset to its group and sends what Add takes', () => {
    const read = readAssetForm(
      form({ name: 'Sony FX3', group: 'kit', type: 'CAM', assetClass: 'fixed', serial: ' 4012345 ', condition: 'excellent', roomId: ROOM, kitId: KIT, quantity: '3', purchaseDate: '01/03/2026', usefulLifeYears: '5', warrantyEnd: '' }),
      TODAY,
    );
    expect(read.problems).toEqual([]);
    expect(read.asset).toMatchObject({ name: 'Sony FX3', group: 'kit', type: 'CAM', serial: '4012345', kitId: KIT, quantity: null, purchaseDate: '2026-03-01', usefulLifeYears: 5, warrantyEnd: null });
    expect(read.status).toBeNull();
    const body = assetBody(read, 'add', { purchasePrice: 120000, supplier: null, invoiceNo: 'INV-9', priceLow: null, marketValue: null, priceHigh: null, priceNote: null });
    // empty fields are left out on Add, so the group's own apply
    expect(body).toEqual({
      name: 'Sony FX3',
      group: 'kit',
      type: 'CAM',
      assetClass: 'fixed',
      serial: '4012345',
      condition: 'excellent',
      roomId: ROOM,
      kitId: KIT,
      purchaseDate: '2026-03-01',
      usefulLifeYears: 5,
      values: { purchasePrice: 120000, invoiceNo: 'INV-9' },
    });
  });

  it('keeps a consumable by quantity, with no kit, serial, condition or useful life', () => {
    const read = readAssetForm(form({ name: 'Gaffer tape', group: 'consumable', type: 'TAP', kitId: KIT, serial: 'x', condition: 'new', usefulLifeYears: '3', unit: 'rolls', reorderLevel: '4' }), TODAY);
    expect(read.problems).toEqual([]);
    expect(read.asset).toMatchObject({ assetClass: 'current', quantity: 0, unit: 'rolls', reorderLevel: 4, kitId: null, serial: null, condition: null, usefulLifeYears: null });
  });

  it('says every problem in words before anything is sent', () => {
    const read = readAssetForm(form({ name: '', group: 'kit', type: 'ZZZ', purchaseDate: '31/02/2026', usefulLifeYears: '2.5' }), TODAY);
    expect(read.problems).toEqual([
      'Enter the purchase date as DD/MM/YYYY, e.g. 14/10/2026.',
      'Enter the asset’s name.',
      'Choose the type.',
      'Enter the useful life in whole years, from 1 to 50.',
    ]);
    expect(readAssetForm(form({ name: 'Desk', group: 'office', type: 'DSK', purchaseDate: '01/01/2027' }), TODAY).problems).toEqual(['The purchase date can’t be in the future.']);
  });

  it('sends the status chosen by hand on Edit, and clears what is emptied', () => {
    const fields = { name: 'MacBook Pro', group: 'it', type: 'LAP', assetClass: 'fixed', serial: '', status: 'repair' };
    const read = readAssetForm(form(fields), TODAY, 'available');
    expect(read.status).toBe('repair');
    const body = assetBody(read, 'edit', null);
    expect(body).toMatchObject({ name: 'MacBook Pro', serial: null, kitId: null, quantity: null, status: 'repair' });
    expect(body).not.toHaveProperty('values');
    // unchanged: not sent
    expect(readAssetForm(form({ ...fields, status: 'available' }), TODAY, 'available').status).toBeNull();
    // never by hand into custody, nor out of it
    expect(readAssetForm(form({ ...fields, status: 'custody' }), TODAY, 'available').problems).toContain('Custody is set by a handover only, never by hand.');
    expect(readAssetForm(form({ ...fields, status: 'available' }), TODAY, 'custody').problems).toContain('It is held in custody: it changes when it is received back.');
  });

  it('reads the values and their problems', () => {
    const ok = readValuesForm(form({ purchasePrice: '45,000', supplier: ' Samy ', invoiceNo: '', priceLow: '40000', marketValue: '42000', priceHigh: '48000', priceNote: '' }));
    expect(ok.problems).toEqual([]);
    expect(ok.values).toEqual({ purchasePrice: 45000, supplier: 'Samy', invoiceNo: null, priceLow: 40000, marketValue: 42000, priceHigh: 48000, priceNote: null });
    const bad = readValuesForm(form({ purchasePrice: '-5', priceLow: '50000', marketValue: '42000' }));
    expect(bad.problems).toContain('The low market value can’t be more than the market value.');
    expect(bad.problems.some((p) => p.startsWith('Enter the purchase cost in EGP'))).toBe(true);
    // on Edit every value is sent, so an emptied one is cleared
    expect(assetBody({ asset: ok.values as never, status: null, problems: [] }, 'edit', { ...ok.values, supplier: null }).values).toMatchObject({ supplier: null });
  });

  it('fills the Edit form from the asset', () => {
    expect(
      editDefaults({
        name: 'Sony FX3',
        group: 'kit',
        type: 'CAM',
        assetClass: 'fixed',
        brand: 'Sony',
        model: null,
        serial: null,
        condition: 'good',
        status: 'available',
        room: { id: ROOM },
        kit: null,
        quantity: null,
        unit: null,
        reorderLevel: null,
        purchaseDate: '2026-03-01',
        usefulLifeYears: 5,
        warrantyEnd: null,
        notes: null,
      }),
    ).toMatchObject({ brand: 'Sony', model: '', roomId: ROOM, kitId: '', purchaseDate: '01/03/2026', usefulLifeYears: '5', warrantyEnd: '' });
    expect(valuesDefaults(null)).toEqual({ purchasePrice: '', supplier: '', invoiceNo: '', priceLow: '', marketValue: '', priceHigh: '', priceNote: '' });
    expect(valuesDefaults({ purchasePrice: 45000.5, supplier: 'Samy', invoiceNo: null, priceLow: null, marketValue: 40000, priceHigh: null, priceNote: null })).toMatchObject({ purchasePrice: '45000.5', marketValue: '40000' });
  });
});

describe('drafts from Claude (step 2, owner, 21 October 2026: "the connection method")', () => {
  const fields = {
    name: 'Sony FX3',
    group: 'kit' as const,
    type: 'CAM' as const,
    assetClass: 'fixed' as const,
    brand: 'Sony',
    model: 'FX3',
    serial: 'SN-1',
    condition: 'good' as const,
    roomId: ROOM,
    kitId: null,
    quantity: null,
    unit: null,
    reorderLevel: null,
    purchaseDate: '2026-03-01',
    usefulLifeYears: 5,
    warrantyEnd: null,
    notes: 'With two batteries',
  };

  it('fills the Add form in from a draft, the dates as DD/MM/YYYY and its room chosen', () => {
    expect(draftDefaults(fields)).toMatchObject({
      name: 'Sony FX3',
      group: 'kit',
      type: 'CAM',
      serial: 'SN-1',
      condition: 'good',
      roomId: ROOM,
      kitId: '',
      purchaseDate: '01/03/2026',
      usefulLifeYears: '5',
      warrantyEnd: '',
      notes: 'With two batteries',
    });
  });

  it('says who drafted it and when', () => {
    expect(draftedText({ createdAt: '2026-10-21T14:42:00Z', createdBy: { email: 'mona@trendlix.com', name: 'Mona Hassan' } })).toBe(
      'Drafted with Claude by Mona Hassan on 21/10/2026, 5:42 PM',
    );
    expect(draftedText({ createdAt: '2026-10-21T14:42:00Z', createdBy: null })).toBe('Drafted with Claude on 21/10/2026, 5:42 PM');
  });
});

describe('photos', () => {
  it('says how many more can be added, and what was sent', () => {
    expect(photosLeftText(0, 0, 6)).toBe('Up to 6 photos. The first is the one the lists show.');
    expect(photosLeftText(2, 3, 6)).toBe('1 more photo can be added.');
    expect(photosLeftText(4, 2, 6)).toBe('That is 6, the most an asset has.');
    expect(photosSentText(2, [])).toBe('2 photos added.');
    expect(photosSentText(1, ['An asset has at most 6 photos.'])).toBe('1 photo added. 1 photo was not added: An asset has at most 6 photos.');
    expect(photosSentText(0, [])).toBeNull();
  });

  it('draws a photo at most 1600 pixels on its long side, never larger', () => {
    expect(photoTarget(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(photoTarget(3000, 4000)).toEqual({ width: 1200, height: 1600 });
    expect(photoTarget(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe('the label', () => {
  const content = { code: 'PK-CAM-0001', name: 'Sony <FX3> & cage', company: 'TrendLIX', qrSvg: '<svg viewBox="0 0 33 33"></svg>' };

  it('is one page of 63 × 30 mm with the QR, the code, the name and the company', () => {
    expect(LABEL_SIZE).toEqual({ widthMm: 63, heightMm: 30 });
    const doc = labelDocument(content);
    expect(doc).toContain('@page{size:63mm 30mm;margin:0}');
    expect(doc).toContain('<svg viewBox="0 0 33 33"></svg>');
    expect(doc).toContain('<div class="code">PK-CAM-0001</div>');
    // the name and the company are text, never markup
    expect(labelMarkup(content)).toContain('<div class="name">Sony &lt;FX3&gt; &amp; cage</div>');
    expect(doc).toContain('<div class="company">TrendLIX</div>');
  });
});

describe('the Users page', () => {
  it('says the level in effect when it differs from the one set', () => {
    expect(accessInEffectText('viewer', 'manager', ['super_admin'])).toBe('In effect: Manager, as a Super Admin always is.');
    expect(accessInEffectText('none', 'viewer', ['finance'])).toBe('In effect: Viewer: the CEO and Finance always see the register, to fill the values.');
    expect(accessInEffectText('custodian', 'custodian', ['employee'])).toBeNull();
    expect(accessShort('custodian')).toBe('Custodian');
    expect(accessShort('none')).toBe('—');
    expect(accessShort(undefined)).toBe('—');
  });
});
