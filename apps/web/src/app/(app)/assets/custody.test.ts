import { CUSTODY_TERMS_STANDARD, type CustodyRecordView, type HandoverAssetChoice, type HandoverKitChoice, type HoldingsView } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  CUSTODY_FORM_CSS,
  custodyFormDocument,
  custodyFormMarkup,
  custodyFormTitle,
  custodyStatementDocument,
  custodyStatementMarkup,
} from './custody-form';
import {
  custodyChips,
  custodyCodeFromParam,
  custodyPagesOf,
  deductionHref,
  deductionText,
  dueText,
  handoverBody,
  hiddenRecordsText,
  kitAdd,
  kitAddText,
  maintenanceTitle,
  outText,
  readCustodyQuery,
  readReturnForm,
  repairBody,
  returnText,
  sizeText,
  termsBody,
} from './custody';

// The custody pages' rules (Assets step 3, 21 October 2026). Today is 21 October 2026; everyone and everything invented.

const TODAY = '2026-10-21';
const form = (values: Record<string, string>) => ({ get: (k: string) => values[k] ?? null });

describe('the Custody list', () => {
  it('reads its address, Active unless another filter is asked for', () => {
    expect(readCustodyQuery({})).toEqual({ filter: 'active', q: '', page: 1 });
    expect(readCustodyQuery({ filter: 'unsigned', q: ' cus-0042 ', page: '3' })).toEqual({ filter: 'unsigned', q: 'cus-0042', page: 3 });
    expect(readCustodyQuery({ filter: 'lost', page: '-1' })).toEqual({ filter: 'active', q: '', page: 1 });
  });

  it('reads a record’s code from its address, as kept; anything else is no record', () => {
    expect(custodyCodeFromParam('cus-0042')).toBe('CUS-0042');
    expect(custodyCodeFromParam('CUS-0042')).toBe('CUS-0042');
    expect(custodyCodeFromParam('CUS-42')).toBeNull();
    expect(custodyCodeFromParam('%E0%A4%A')).toBeNull();
  });

  it('has the five chips with their counts, each from page 1 with the search kept', () => {
    const chips = custodyChips({ filter: 'overdue', q: 'Mona', page: 2 }, { active: 4, overdue: 1, unsigned: 2, closed: 7, all: 11 });
    expect(chips.map((c) => [c.label, c.count, c.active])).toEqual([
      ['Active', 4, false],
      ['Overdue', 1, true],
      ['Not signed', 2, false],
      ['Closed', 7, false],
      ['All', 11, false],
    ]);
    expect(chips[0].href).toBe('/assets/custody?q=Mona');
    expect(chips[2].href).toBe('/assets/custody?filter=unsigned&q=Mona');
    expect(custodyPagesOf({ total: 120, page: 2, pageSize: 50 }, { filter: 'all', q: '', page: 2 })).toEqual({
      count: 3,
      previous: '/assets/custody?filter=all',
      next: '/assets/custody?filter=all&page=3',
    });
  });

  it('says the return date, overdue, and how many are out', () => {
    expect(dueText({ kind: 'shoot', status: 'open', dueDate: '2026-10-24', overdue: false, daysOverdue: 0 })).toBe('Return by 24/10/2026');
    expect(dueText({ kind: 'shoot', status: 'partial', dueDate: '2026-10-19', overdue: true, daysOverdue: 2 })).toBe('Overdue 2 days (due 19/10/2026)');
    expect(dueText({ kind: 'shoot', status: 'closed', dueDate: '2026-10-19', overdue: false, daysOverdue: 0 })).toBe('Was due 19/10/2026');
    expect(dueText({ kind: 'assignment', dueDate: null, overdue: false, daysOverdue: 0 })).toBe('Long term: back at clearance');
    expect([outText({ items: 3, out: 3 }), outText({ items: 3, out: 1 }), outText({ items: 3, out: 0 }), outText({ items: 1, out: 0 })]).toEqual(['3 out', '1 of 3 out', 'All 3 back', 'Back']);
    expect(returnText({ returnedAt: null, returnCondition: null })).toBe('Out');
    expect(returnText({ returnedAt: '2026-10-21T13:15:00.000Z', returnCondition: 'damaged' })).toBe('Damaged on return, 21/10/2026, 4:15 PM');
    expect([sizeText(800), sizeText(2.4 * 1024 * 1024)]).toEqual(['1 KB', '2.4 MB']);
  });
});

describe('the handover form', () => {
  const draft = {
    employeeId: 'e1',
    kind: 'shoot',
    dueDate: '24/10/2026',
    purpose: ' Ad shoot ',
    handedOverBy: ' Omar Store ',
    notes: '',
    items: [{ assetId: 'a1', conditionOut: 'good', accessories: ' 2 batteries ' }, { assetId: 'a2', conditionOut: '', accessories: '' }],
  };

  it('sends a shoot with its return date, the assets with their condition and accessories', () => {
    expect(handoverBody(draft, TODAY)).toEqual({
      body: {
        employeeId: 'e1',
        kind: 'shoot',
        dueDate: '2026-10-24',
        purpose: 'Ad shoot',
        handedOverBy: 'Omar Store',
        notes: null,
        items: [
          { assetId: 'a1', conditionOut: 'good', accessories: '2 batteries' },
          { assetId: 'a2', conditionOut: null, accessories: null },
        ],
      },
      problems: [],
    });
  });

  it('sends a long-term assignment without a return date, whatever was typed', () => {
    const { body, problems } = handoverBody({ ...draft, kind: 'assignment', dueDate: '24/10/2026' }, TODAY);
    expect(problems).toEqual([]);
    expect(body).not.toHaveProperty('dueDate');
  });

  it('says what is missing or wrong before sending', () => {
    expect(handoverBody({ ...draft, dueDate: '' }, TODAY).problems).toEqual(['A shoot needs its return date.']);
    expect(handoverBody({ ...draft, dueDate: '31/02/2026' }, TODAY).problems).toEqual(['Enter the return date as DD/MM/YYYY, e.g. 24/10/2026.']);
    expect(handoverBody({ ...draft, dueDate: '20/10/2026' }, TODAY).problems).toEqual(['The return date can’t be before today.']);
    expect(handoverBody({ ...draft, employeeId: '', kind: '', items: [] }, TODAY).problems).toEqual(['Choose the employee.', 'Choose a shoot or a long-term assignment.']);
    expect(handoverBody({ ...draft, items: [], handedOverBy: ' ' }, TODAY).problems).toEqual(['Say who handed it over.', 'Choose the assets to hand over.']);
  });

  it('adds a kit’s available assets and lists the others with why (spec §6.3)', () => {
    const available: HandoverAssetChoice[] = [
      { id: 'c1', code: 'PK-CAM-0001', name: 'Camera', group: 'kit', type: 'CAM', serial: null, condition: 'good', kit: { id: 'k1', code: 'PK-KIT-A' } },
      { id: 't1', code: 'PK-GRP-0001', name: 'Tripod', group: 'kit', type: 'GRP', serial: null, condition: null, kit: { id: 'k1', code: 'PK-KIT-A' } },
    ];
    const kit: HandoverKitChoice = {
      id: 'k1',
      code: 'PK-KIT-A',
      name: 'Interview kit',
      items: [
        { id: 'c1', code: 'PK-CAM-0001', name: 'Camera', status: 'available', why: null },
        { id: 't1', code: 'PK-GRP-0001', name: 'Tripod', status: 'available', why: null },
        { id: 'l1', code: 'PK-LEN-0001', name: 'Lens', status: 'repair', why: 'Under repair' },
        { id: 'm1', code: 'PK-AUD-0001', name: 'Mic', status: 'custody', why: 'Out with Mona Adel on CUS-0007' },
      ],
    };
    const { added, skipped } = kitAdd(kit, new Set(['t1']), available);
    expect(added.map((a) => a.code)).toEqual(['PK-CAM-0001']);
    expect(skipped).toEqual([
      { code: 'PK-LEN-0001', name: 'Lens', why: 'Under repair' },
      { code: 'PK-AUD-0001', name: 'Mic', why: 'Out with Mona Adel on CUS-0007' },
    ]);
    expect(kitAddText(kit, 1, 2)).toBe('PK-KIT-A Interview kit: 1 item added; 2 skipped.');
    expect(kitAddText(kit, 0, 0)).toBe('PK-KIT-A Interview kit: nothing added.');
  });
});

describe('receiving back, repairs and the terms', () => {
  it('reads each item’s condition and notes, those left out not sent', () => {
    expect(readReturnForm(form({ 'condition-i1': 'good', 'condition-i2': 'damaged', 'notes-i2': ' Cracked screen ', 'condition-i3': '' }), ['i1', 'i2', 'i3'])).toEqual({
      lines: [
        { itemId: 'i1', condition: 'good', notes: null },
        { itemId: 'i2', condition: 'damaged', notes: 'Cracked screen' },
      ],
      problems: [],
    });
    expect(readReturnForm(form({}), ['i1']).problems).toEqual(['Choose how each item came back: good, damaged or missing.']);
  });

  it('reads a repair’s form, the cost only from those who see the values', () => {
    expect(repairBody(form({ on: '20/10/2026', vendor: ' Fix Lab ', notes: 'Sensor', cost: '1,500' }), { repair: true, values: true, today: TODAY })).toEqual({
      body: { notes: 'Sensor', on: '2026-10-20', vendor: 'Fix Lab', cost: 1500 },
      problems: [],
    });
    expect(repairBody(form({ cost: '1500' }), { repair: true, values: false, today: TODAY }).body).toEqual({ notes: null, vendor: null });
    expect(repairBody(form({ on: '22/10/2026' }), { repair: true, values: false, today: TODAY }).problems).toEqual(['The date can’t be in the future.']);
    expect(repairBody(form({ notes: 'Found in Studio A', vendor: 'x' }), { repair: false, values: true, today: TODAY }).body).toEqual({ notes: 'Found in Studio A' });
  });

  it('reads the terms one a line, and says what is wrong', () => {
    expect(termsBody(' First term. \n\n Second term. ')).toEqual({ terms: ['First term.', 'Second term.'], problems: [] });
    expect(termsBody('  \n ').problems).toEqual(['Write at least one term.']);
  });

  it('opens a deduction on Additions / Deductions for HR, prefilled (owner: "Record it; HR decides a deduction")', () => {
    const href = deductionHref({ employeeId: 'e1', itemId: 'i2', condition: 'damaged', assetCode: 'PK-CAM-0003', custodyCode: 'CUS-0042' }, TODAY);
    const url = new URL(href, 'https://people.trendlix.com');
    expect(url.pathname).toBe('/payroll/adjustments');
    expect(Object.fromEntries(url.searchParams)).toEqual({ month: '2026-10', employee: 'e1', custodyItem: 'i2', reason: 'Damage: PK-CAM-0003 on CUS-0042' });
    expect(new URL(deductionHref({ employeeId: 'e1', itemId: 'i3', condition: 'missing', assetCode: 'PK-LEN-0001', custodyCode: 'CUS-0042' }, TODAY), 'https://x').searchParams.get('reason')).toBe(
      'Loss: PK-LEN-0001 on CUS-0042',
    );
    expect(deductionText({ id: 'd1', month: '2026-10', status: 'pending', amount: 1500 })).toBe('October 2026 · Pending · EGP 1,500.00');
  });

  it('names maintenance entries and the C-level records left out', () => {
    expect(maintenanceTitle({ event: 'returned_damaged', kind: 'repair' })).toBe('Returned damaged');
    expect(maintenanceTitle({ event: null, kind: 'warranty_claim' })).toBe('Warranty claim');
    expect([hiddenRecordsText(0), hiddenRecordsText(1), hiddenRecordsText(2)]).toEqual([null, '1 record of a C-level person is left out.', '2 records of C-level people are left out.']);
  });
});

describe('the printed custody form and statement', () => {
  const record: CustodyRecordView = {
    id: 'r1',
    code: 'CUS-0042',
    kind: 'shoot',
    status: 'partial',
    employee: { id: 'e1', employeeCode: 'EMP-0007', fullNameEn: 'Mona <Adel>', jobTitle: 'Photographer', department: 'Production › Studio' },
    purpose: 'Ad shoot',
    dueDate: '2026-10-24',
    outAt: '2026-10-21T07:00:00.000Z',
    closedAt: null,
    handedOverBy: 'Omar Store',
    issuedBy: null,
    notes: null,
    terms: [...CUSTODY_TERMS_STANDARD],
    items: [
      {
        id: 'i1',
        asset: { id: 'a1', code: 'PK-CAM-0001', name: 'Camera', group: 'kit', type: 'CAM', status: 'repair', brand: 'Sony', model: 'FX3', serial: 'SN-1' },
        conditionOut: 'good',
        accessories: '2 batteries',
        valueAtOut: 100000,
        returnedAt: '2026-10-21T13:15:00.000Z',
        returnCondition: 'damaged',
        receivedBy: { email: 'omar@x.test', name: 'Omar Store' },
        returnNotes: 'Cracked screen',
      },
    ],
    returns: [{ at: '2026-10-21T13:15:00.000Z', receivedBy: { email: 'omar@x.test', name: 'Omar Store' }, items: [{ itemId: 'i1', code: 'PK-CAM-0001', name: 'Camera', condition: 'damaged', notes: 'Cracked screen' }] }],
    files: [],
    signed: false,
    overdue: false,
    daysOverdue: 0,
    valueAtOut: 100000,
    can: { receive: true, attach: true, deduction: false },
  };
  const brand = { company: 'TrendLIX', logoSrc: '/company-logo?v=3' };

  it('prints the receipt: the company, the person, the items, the terms, the signatures and each return; never a value', () => {
    const html = custodyFormMarkup(record, brand);
    expect(custodyFormTitle('shoot')).toBe('Custody Receipt');
    expect(custodyFormTitle('assignment')).toBe('Assignment Form');
    for (const text of ['TrendLIX', '/company-logo?v=3', 'Custody Receipt', 'CUS-0042', 'Mona &lt;Adel&gt;', 'EMP-0007', 'Photographer', 'Production › Studio', 'Return by', '24/10/2026', 'PK-CAM-0001', 'SN-1', 'Good', '2 batteries', 'Handed over by: Omar Store', 'Employee: Mona &lt;Adel&gt;', 'Return of 21/10/2026, 4:15 PM', 'Damaged', 'Cracked screen', 'Received by: Omar Store']) {
      expect(html).toContain(text);
    }
    for (const term of CUSTODY_TERMS_STANDARD) expect(html).toContain(term.replace(/'/g, '&#39;'));
    expect(html).not.toContain('Mona <Adel>');
    expect(html).not.toContain('100000');
    expect(html).not.toContain('100,000');
    expect(html).not.toContain('labour lawyer');
    const doc = custodyFormDocument(record, brand);
    expect(doc.startsWith('<!doctype html>')).toBe(true);
    expect(doc).toContain('@page{size:A4');
    expect(doc).toContain(CUSTODY_FORM_CSS.trim().slice(0, 30));
  });

  it('prints a long-term assignment without a return date, and no return section before one', () => {
    const html = custodyFormMarkup({ ...record, kind: 'assignment', dueDate: null, returns: [] }, { company: 'TrendLIX', logoSrc: null });
    expect(html).toContain('Assignment Form');
    expect(html).toContain('No return date: it comes back at clearance');
    expect(html).not.toContain('Return of');
    expect(html).not.toContain('<img');
  });

  it('prints the custody statement: everything held now, never a value', () => {
    const holdings: HoldingsView = {
      employee: record.employee,
      current: [
        {
          itemId: 'i9',
          asset: { id: 'a9', code: 'IT-LAP-0003', name: 'Laptop', group: 'it', type: 'LAP', status: 'custody', brand: null, model: null, serial: 'LAP-9' },
          custody: { code: 'CUS-0040', kind: 'assignment', dueDate: null },
          since: '2026-09-01T07:00:00.000Z',
          overdue: false,
          daysOverdue: 0,
          conditionOut: 'new',
          accessories: 'Charger',
          valueAtOut: 55000,
        },
      ],
      incidents: [],
      records: [],
      value: 55000,
      can: { handOver: true, deduction: false },
    };
    const html = custodyStatementMarkup(holdings, brand, TODAY);
    for (const text of ['Custody Statement', 'IT-LAP-0003', 'LAP-9', 'CUS-0040', '01/09/2026', 'Long term', '21/10/2026', 'I confirm that I hold the assets listed above.']) expect(html).toContain(text);
    expect(html).not.toContain('55000');
    expect(custodyStatementMarkup({ ...holdings, current: [] }, brand, TODAY)).toContain('Holds nothing of the company');
    expect(custodyStatementDocument(holdings, brand, TODAY)).toContain('<title>Custody statement of Mona &lt;Adel&gt;</title>');
  });
});
