import type { Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  advanceBody,
  canSeeUnsettled,
  clearanceOption,
  counted,
  daysText,
  documentHref,
  lockedChangeHref,
  paidOutBody,
  settleBody,
  settlesPayroll,
  summaryTiles,
  unsettledCount,
  type UnsettledView,
} from './unsettled';

// Unsettled (owner, 17 October 2026): the runs not yet paid, the lines on hold, the final settlements and the advances
// and loans. Everyone here is invented.

const as = (...roles: Role[]) => ({ roles });

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

const view = (over: Partial<UnsettledView> = {}): UnsettledView => ({
  generatedAt: '2026-10-17T08:00:00Z',
  today: '2026-10-17',
  runs: { count: 2, transfer: 512300.5, rows: [] },
  held: { count: 1, amount: 9000, rows: [] },
  settlements: { count: 2, rows: [{ daysOpen: 3 } as never, { daysOpen: 45 } as never], recentlySettled: [] },
  advances: { count: 1, amount: 6000, outstanding: 4000, rows: [] },
  ...over,
});

describe('who sees it', () => {
  it('is HR, Finance and the CEO; HR settles', () => {
    expect(canSeeUnsettled(as('finance'))).toBe(true);
    expect(canSeeUnsettled(as('ceo'))).toBe(true);
    expect(canSeeUnsettled(as('admin'))).toBe(false);
    expect(settlesPayroll(as('hr'))).toBe(true);
    expect(settlesPayroll(as('ceo', 'finance'))).toBe(false);
  });
});

describe('the summary', () => {
  it('counts each part with its total, linking to its section', () => {
    expect(summaryTiles(view())).toEqual([
      { key: 'runs', href: '#runs', label: 'Runs not yet paid', count: '2', note: 'EGP 512,300.50 to transfer' },
      { key: 'held', href: '#held', label: 'Lines on hold', count: '1', note: 'EGP 9,000.00 held' },
      { key: 'settlements', href: '#settlements', label: 'Final settlements', count: '2', note: 'The oldest open for 45 days' },
      { key: 'advances', href: '#advances', label: 'Advances and loans', count: '1', note: 'EGP 4,000.00 outstanding' },
    ]);
    expect(summaryTiles(view({ settlements: { count: 0, rows: [], recentlySettled: [] } }))[2].note).toBe('None open');
    expect(unsettledCount(view())).toBe(6);
  });

  // owner's brief, 27 October 2026: leave and attendance changes made after a month's payroll moved on, listed until handled
  it('adds the changes made after the payroll moved on when the API sends them, each linking to its request', () => {
    const tiles = summaryTiles(view({ lockedChanges: { count: 2, rows: [] } }));
    expect(tiles).toHaveLength(5);
    expect(tiles[4]).toEqual({ key: 'locked', href: '#locked', label: 'Changed after the payroll moved on', count: '2', note: 'To correct by hand' });
    expect(summaryTiles(view({ lockedChanges: { count: 0, rows: [] } }))[4].note).toBe('None to handle');
    expect(unsettledCount(view({ lockedChanges: { count: 2, rows: [] } }))).toBe(8);
    expect(lockedChangeHref({ kind: 'leave', requestId: 'a' })).toBe('/leave/a');
    expect(lockedChangeHref({ kind: 'permission', requestId: 'b' })).toBe('/leave/permissions/b');
    expect(lockedChangeHref({ kind: 'wfh', requestId: 'c' })).toBe('/attendance/wfh/c');
    expect(lockedChangeHref({ kind: 'od', requestId: 'd' })).toBe('/attendance/official-duty/d');
  });

  it('says how long one is open', () => {
    expect(daysText(0)).toBe('Since today');
    expect(daysText(1)).toBe('1 day');
    expect(daysText(20)).toBe('20 days');
    expect(counted(1, 'run', 'runs')).toBe('1 run');
    expect(counted(3, 'run', 'runs')).toBe('3 runs');
  });

  it('names and links the clearance documents', () => {
    expect(clearanceOption({ id: 'd1', fileName: 'Clearance EMP-1.docx', generatedAt: '2026-10-01T10:00:00Z', status: 'generated' })).toBe('Clearance EMP-1.docx, 01/10/2026');
    expect(clearanceOption({ id: 'd1', fileName: 'C.docx', generatedAt: '2026-10-01T10:00:00Z', status: 'signed' })).toBe('C.docx, 01/10/2026 (signed)');
    expect(documentHref('e1', 'd1')).toBe('/employees/e1/documents/d1/file');
  });
});

describe('what the forms send', () => {
  it('a final settlement: the day as YYYY-MM-DD, the amount (0 too), the note and the document if any', () => {
    expect(settleBody(form({ settledOn: '17/10/2026', amountPaid: '18,500.50', note: ' By transfer ', documentId: 'd1' }))).toEqual({
      body: { settledOn: '2026-10-17', amountPaid: 18500.5, note: 'By transfer', documentId: 'd1' },
      errors: [],
    });
    expect(settleBody(form({ settledOn: '17/10/2026', amountPaid: '0' })).body).toMatchObject({ amountPaid: 0, note: null, documentId: null });
    expect(settleBody(form({ settledOn: '2026-10-17', amountPaid: '' })).errors).toEqual([
      'Enter the day the final dues were settled as DD/MM/YYYY, e.g. 17/10/2026.',
      'Enter the amount paid in EGP, 0 or more, e.g. 18500.50.',
    ]);
  });

  it('held pay paid out: the day, how, the note', () => {
    expect(paidOutBody(form({ paidOn: '1/11/2026', method: 'cash' }))).toEqual({ body: { paidOn: '2026-11-01', method: 'cash', note: null }, errors: [] });
    expect(paidOutBody(form({ paidOn: '', method: 'cheque' })).errors).toEqual(['Enter the day it was paid out as DD/MM/YYYY, e.g. 17/10/2026.', 'Choose how it was paid out.']);
  });

  it('an advance or loan: the person and kind when new, the amount, the day, the reason and the plan', () => {
    expect(advanceBody(form({ employeeId: 'e1', kind: 'loan', amount: '6,000', givenOn: '30/09/2026', reason: ' Car ', plan: '6 of 1,000' }), true)).toEqual({
      body: { employeeId: 'e1', kind: 'loan', amount: 6000, givenOn: '2026-09-30', reason: 'Car', plan: '6 of 1,000' },
      errors: [],
    });
    expect(advanceBody(form({ amount: '5000', givenOn: '30/09/2026', reason: 'Car' }), false).body).toEqual({ amount: 5000, givenOn: '2026-09-30', reason: 'Car', plan: null });
    expect(advanceBody(form({}), true).errors).toEqual([
      'Choose the employee.',
      'Choose advance or loan.',
      'Enter the amount given in EGP, more than 0, e.g. 6000.',
      'Enter the day it was given as DD/MM/YYYY, e.g. 17/10/2026.',
      'Say what it was given for.',
    ]);
  });

  it('a new one in installments (18 October 2026): how many and the first month in place of the plan, checked by the shared rules', () => {
    expect(
      advanceBody(
        form({ employeeId: 'e1', kind: 'loan', amount: '6,000', givenOn: '30/09/2026', reason: 'Medical', plan: 'ignored', byInstallments: 'yes', count: '6', firstMonth: '2026-10' }),
        true,
      ),
    ).toEqual({
      body: { employeeId: 'e1', kind: 'loan', amount: 6000, givenOn: '2026-09-30', reason: 'Medical', installments: { count: 6, firstMonth: '2026-10' } },
      errors: [],
    });
    expect(advanceBody(form({ employeeId: 'e1', kind: 'loan', amount: '6000', givenOn: '30/09/2026', reason: 'Medical', byInstallments: 'yes' }), true).errors).toEqual([
      'Enter how many monthly installments, 1 to 60.',
      'Choose the month of the first installment.',
    ]);
    // the amount's problem said once
    expect(advanceBody(form({ employeeId: 'e1', kind: 'loan', amount: '', givenOn: '30/09/2026', reason: 'Medical', byInstallments: 'yes', count: '6', firstMonth: '2026-10' }), true).errors).toEqual([
      'Enter the amount given in EGP, more than 0, e.g. 6000.',
    ]);
    // not ticked: the plan as before
    expect(advanceBody(form({ employeeId: 'e1', kind: 'advance', amount: '500', givenOn: '30/09/2026', reason: 'Rent', plan: 'Next month' }), true).body).toMatchObject({ plan: 'Next month' });
  });
});
