import {
  assetActionProblem,
  assetActionsOf,
  CUSTODY_FILTERS,
  CUSTODY_TERMS_STANDARD,
  CUSTODY_TERMS_STANDARD_AR,
  CUSTODY_UNSIGNED_DAYS,
  custodyTermsArOf,
  custodyTermsArPrinted,
  custodyDeductionProblem,
  custodyDeductionReason,
  custodyStatusOf,
  custodyTermsOf,
  daysOverdue,
  handoverProblems,
  handOverProblem,
  inCustodyFilter,
  isCustodyCode,
  isOverdue,
  kitQuickAdd,
  kitSkipReason,
  normalCustodyCode,
  returnedDamagedNote,
  STATUS_ON_RETURN,
  termsArProblems,
  termsArToKeep,
  termsFromText,
  termsProblems,
  unsignedTooLong,
  type HandoverInput,
} from '@trendlix/shared';

// Custody's shared rules (Assets step 3, owner, 21 October 2026; packages/shared custody.ts): the status transitions
// (what can be handed over, what a return does to an asset and to its record, the repairs, lost and found), the overdue
// rule (a shoot past its return date and not closed), not signed after 3 days, the kit quick-add, the handover's checks,
// the terms, and the deduction HR makes from a damaged or missing item.

describe('custody (shared)', () => {
  it('hands over only available assets that aren’t consumables (spec §6.1)', () => {
    expect(handOverProblem({ code: 'PK-CAM-0001', status: 'available', group: 'kit' })).toBeNull();
    expect(handOverProblem({ code: 'CS-TAP-0001', status: 'available', group: 'consumable' })).toBe('CS-TAP-0001 is a consumable: consumables are kept by quantity, not handed over.');
    expect(handOverProblem({ code: 'PK-CAM-0002', status: 'custody', group: 'kit' })).toBe('PK-CAM-0002 is in custody: only available assets are handed over.');
    expect(handOverProblem({ code: 'PK-CAM-0003', status: 'repair', group: 'kit' })).toBe('PK-CAM-0003 is under repair: only available assets are handed over.');
    for (const status of ['lost', 'disposed']) expect(handOverProblem({ code: 'IT-LAP-0001', status, group: 'it' })).toContain('only available assets are handed over');
  });

  it('a return sets the asset’s status: good → available, damaged → under repair, missing → lost (spec §6.4)', () => {
    expect(STATUS_ON_RETURN).toEqual({ good: 'available', damaged: 'repair', missing: 'lost' });
    expect(returnedDamagedNote('CUS-0042', 'Mona Adel')).toBe('Returned damaged on CUS-0042 by Mona Adel');
    expect(returnedDamagedNote('CUS-0042', 'Mona Adel', ' Cracked screen ')).toBe('Returned damaged on CUS-0042 by Mona Adel: Cracked screen');
  });

  it('a record is open until something is back, partly returned, then closed when all are', () => {
    expect(custodyStatusOf([{ returned: false }, { returned: false }])).toBe('open');
    expect(custodyStatusOf([{ returned: true }, { returned: false }])).toBe('partial');
    expect(custodyStatusOf([{ returned: true }, { returned: true }])).toBe('closed');
  });

  it('overdue: a shoot past its return date, not closed; never a long-term assignment', () => {
    const shoot = { kind: 'shoot', status: 'open', dueDate: '2026-10-20' };
    expect(isOverdue(shoot, '2026-10-20')).toBe(false); // due today: not yet
    expect(isOverdue(shoot, '2026-10-21')).toBe(true);
    expect(daysOverdue(shoot, '2026-10-24')).toBe(4);
    expect(isOverdue({ ...shoot, status: 'partial' }, '2026-10-21')).toBe(true);
    expect(isOverdue({ ...shoot, status: 'closed' }, '2026-10-21')).toBe(false);
    expect(daysOverdue({ ...shoot, status: 'closed' }, '2026-10-24')).toBe(0);
    expect(isOverdue({ kind: 'assignment', status: 'open', dueDate: null }, '2030-01-01')).toBe(false);
  });

  it('the list’s filters: Active, Overdue, Not signed, Closed, All', () => {
    expect([...CUSTODY_FILTERS]).toEqual(['active', 'overdue', 'unsigned', 'closed', 'all']);
    const late = { kind: 'shoot', status: 'open', dueDate: '2026-10-01', signed: false };
    const closed = { kind: 'shoot', status: 'closed', dueDate: '2026-10-01', signed: true };
    expect(CUSTODY_FILTERS.filter((f) => inCustodyFilter(late, f, '2026-10-21'))).toEqual(['active', 'overdue', 'unsigned', 'all']);
    expect(CUSTODY_FILTERS.filter((f) => inCustodyFilter(closed, f, '2026-10-21'))).toEqual(['closed', 'all']);
  });

  it('not signed: told once the signed copy is still missing 3 days after the handover', () => {
    expect(CUSTODY_UNSIGNED_DAYS).toBe(3);
    const outAt = '2026-10-18T09:00:00.000Z';
    expect(unsignedTooLong({ signed: false, outAt }, new Date('2026-10-21T08:59:59.000Z'))).toBe(false);
    expect(unsignedTooLong({ signed: false, outAt }, new Date('2026-10-21T09:00:00.000Z'))).toBe(true);
    expect(unsignedTooLong({ signed: true, outAt }, new Date('2026-10-30T09:00:00.000Z'))).toBe(false);
  });

  it('the kit quick-add takes the available ones and says why the others are skipped (spec §6.3)', () => {
    const kit = [
      { id: 'a', code: 'PK-CAM-0001', name: 'Camera', status: 'available', group: 'kit' },
      { id: 'b', code: 'PK-LEN-0001', name: 'Lens', status: 'custody', group: 'kit', holder: 'Omar Khaled', custodyCode: 'CUS-0007' },
      { id: 'c', code: 'PK-GRP-0001', name: 'Tripod', status: 'repair', group: 'kit' },
      { id: 'd', code: 'PK-BAT-0001', name: 'Batteries', status: 'lost', group: 'kit' },
      { id: 'e', code: 'PK-MON-0001', name: 'Monitor', status: 'disposed', group: 'kit' },
    ];
    expect(kitQuickAdd(kit)).toEqual({
      add: ['a'],
      skipped: [
        { code: 'PK-LEN-0001', name: 'Lens', why: 'Out with Omar Khaled on CUS-0007' },
        { code: 'PK-GRP-0001', name: 'Tripod', why: 'Under repair' },
        { code: 'PK-BAT-0001', name: 'Batteries', why: 'Lost' },
      ],
    });
    expect(kitSkipReason({ status: 'custody', group: 'kit' })).toBe('In custody');
    expect(kitSkipReason({ status: 'custody', group: 'kit', holder: 'Omar Khaled', custodyCode: null })).toBe('Out with Omar Khaled');
  });

  it('a handover’s own checks: a shoot needs its return date (not before today), an assignment has none', () => {
    const base: HandoverInput = { employeeId: 'e', kind: 'shoot', dueDate: '2026-10-25', purpose: 'Ad shoot', handedOverBy: 'Mona Adel', notes: null, items: [{ assetId: 'a', conditionOut: null, accessories: null }] };
    expect(handoverProblems(base, '2026-10-21')).toEqual([]);
    expect(handoverProblems({ ...base, dueDate: null }, '2026-10-21')).toEqual(['A shoot needs its return date.']);
    expect(handoverProblems({ ...base, dueDate: '2026-10-20' }, '2026-10-21')).toEqual(['The return date can’t be before today.']);
    expect(handoverProblems({ ...base, dueDate: '2026-02-30' }, '2026-01-01')).toEqual(['Enter the return date as DD/MM/YYYY.']);
    expect(handoverProblems({ ...base, kind: 'assignment' }, '2026-10-21')).toEqual(['A long-term assignment has no return date: it comes back at clearance.']);
    expect(handoverProblems({ ...base, kind: 'assignment', dueDate: null }, '2026-10-21')).toEqual([]);
    expect(handoverProblems({ ...base, items: [] }, '2026-10-21')).toEqual(['Choose the assets to hand over.']);
    expect(handoverProblems({ ...base, handedOverBy: ' ' }, '2026-10-21')).toEqual(['Say who handed it over.']);
    expect(handoverProblems(base, '2026-10-21', 101)).toEqual(['Hand over at most 100 assets at a time.']);
  });

  it('an asset page’s actions follow its status; custody and disposal only by their own steps', () => {
    const kit = (status: string) => ({ code: 'PK-CAM-0001', status, group: 'kit' });
    expect(assetActionsOf(kit('available'))).toEqual({ hand_over: true, send_to_repair: true, back_from_repair: false, mark_lost: true, mark_found: false });
    expect(assetActionsOf(kit('repair'))).toEqual({ hand_over: false, send_to_repair: false, back_from_repair: true, mark_lost: true, mark_found: false });
    expect(assetActionsOf(kit('lost'))).toEqual({ hand_over: false, send_to_repair: false, back_from_repair: false, mark_lost: false, mark_found: true });
    expect(assetActionsOf(kit('custody'))).toEqual({ hand_over: false, send_to_repair: false, back_from_repair: false, mark_lost: false, mark_found: false });
    expect(assetActionsOf(kit('disposed'))).toEqual({ hand_over: false, send_to_repair: false, back_from_repair: false, mark_lost: false, mark_found: false });
    expect(assetActionProblem('mark_lost', kit('custody'))).toBe('PK-CAM-0001 is in custody: receive it back missing to mark it lost.');
    expect(assetActionProblem('send_to_repair', kit('custody'))).toBe('PK-CAM-0001 is in custody: receive it back damaged to send it to repair.');
    expect(assetActionProblem('send_to_repair', { code: 'CS-TAP-0001', status: 'available', group: 'consumable' })).toBe('Consumables are always available: they are kept by quantity.');
  });

  it('codes CUS-0042, as typed', () => {
    expect(isCustodyCode('CUS-0042')).toBe(true);
    expect(isCustodyCode('CUS-42')).toBe(false);
    expect(normalCustodyCode(' cus-0042 ')).toBe('CUS-0042');
  });

  it('the terms: the standard wording until a manager writes others, one a line', () => {
    expect(CUSTODY_TERMS_STANDARD).toHaveLength(5);
    expect(custodyTermsOf([])).toEqual([...CUSTODY_TERMS_STANDARD]);
    expect(custodyTermsOf(['Mine.'])).toEqual(['Mine.']);
    expect(termsFromText(' One. \n\n Two.\r\n')).toEqual(['One.', 'Two.']);
    expect(termsProblems([])).toEqual(['Write at least one term.']);
    expect(termsProblems(['x'.repeat(601)])).toEqual(['Keep each term to 600 characters or fewer.']);
    expect(termsProblems(Array.from({ length: 16 }, () => 'A term.'))).toEqual(['Keep the terms to 15 or fewer.']);
  });

  it('the Arabic terms (24 October 2026: "Arabic and English"): the standard Arabic only beside the standard English, a record’s as kept', () => {
    // a faithful translation, term for term, in Arabic letters with 0–9 numbers (bilingual documents keep 0–9)
    expect(CUSTODY_TERMS_STANDARD_AR).toHaveLength(CUSTODY_TERMS_STANDARD.length);
    for (const term of CUSTODY_TERMS_STANDARD_AR) {
      expect(term).toMatch(/^[\u0600-\u06FF0-9\s،.]+$/);
      expect(term).not.toMatch(/[٠-٩]/);
    }
    expect(CUSTODY_TERMS_STANDARD_AR[3]).toContain('24 ساعة');
    // in force: those written; else the standard Arabic while the English are the standard ones; else none
    expect(custodyTermsArOf([], [])).toEqual([...CUSTODY_TERMS_STANDARD_AR]);
    expect(custodyTermsArOf(null, undefined)).toEqual([...CUSTODY_TERMS_STANDARD_AR]);
    expect(custodyTermsArOf([...CUSTODY_TERMS_STANDARD], [])).toEqual([...CUSTODY_TERMS_STANDARD_AR]);
    expect(custodyTermsArOf(['Mine.'], [])).toEqual([]);
    expect(custodyTermsArOf(['Mine.'], ['بندي.'])).toEqual(['بندي.']);
    expect(custodyTermsArOf([], ['بندي.'])).toEqual(['بندي.']);
    // the standard Arabic typed back unchanged is kept as none written, so it follows the English
    expect(termsArToKeep([...CUSTODY_TERMS_STANDARD_AR])).toEqual([]);
    expect(termsArToKeep(['بندي.'])).toEqual(['بندي.']);
    // none written is allowed; the limits as the English
    expect(termsArProblems([])).toEqual([]);
    expect(termsArProblems(['ب'.repeat(601)])).toEqual(['Keep each Arabic term to 600 characters or fewer.']);
    expect(termsArProblems(Array.from({ length: 16 }, () => 'بند.'))).toEqual(['Keep the Arabic terms to 15 or fewer.']);
    expect(termsArProblems([' '])).toEqual(['An Arabic term can’t be empty.']);
    // what a record's form prints: its own; a record from before with the standard English, the standard Arabic; else none
    expect(custodyTermsArPrinted({ terms: ['Mine.'], termsAr: ['بندي.'] })).toEqual({ terms: ['بندي.'], source: 'record' });
    expect(custodyTermsArPrinted({ terms: [...CUSTODY_TERMS_STANDARD] })).toEqual({ terms: [...CUSTODY_TERMS_STANDARD_AR], source: 'standard' });
    expect(custodyTermsArPrinted({ terms: [...CUSTODY_TERMS_STANDARD], termsAr: [] })).toEqual({ terms: [...CUSTODY_TERMS_STANDARD_AR], source: 'standard' });
    expect(custodyTermsArPrinted({ terms: ['Mine.'], termsAr: [] })).toEqual({ terms: [], source: 'none' });
  });

  it('HR decides a deduction from a damaged or missing item: Damage or loss, the employee’s own item', () => {
    expect(custodyDeductionReason('damaged', 'PK-CAM-0003', 'CUS-0042')).toBe('Damage: PK-CAM-0003 on CUS-0042');
    expect(custodyDeductionReason('missing', 'PK-CAM-0003', 'CUS-0042')).toBe('Loss: PK-CAM-0003 on CUS-0042');
    const item = { returnCondition: 'damaged', employeeId: 'e1' };
    expect(custodyDeductionProblem({ kind: 'deduction', type: 'damage_loss' }, item, 'e1')).toBeNull();
    expect(custodyDeductionProblem({ kind: 'deduction', type: 'penalty' }, item, 'e1')).toBe('Only a Damage or loss deduction is linked to a custody item.');
    expect(custodyDeductionProblem({ kind: 'deduction', type: 'damage_loss' }, item, 'e2')).toBe('Choose a damaged or missing item of this employee’s custody.');
    expect(custodyDeductionProblem({ kind: 'deduction', type: 'damage_loss' }, { ...item, returnCondition: 'good' }, 'e1')).toBe(
      'Only an item returned damaged or missing, or without some of its accessories, becomes a deduction.',
    );
    // step 4 (owner, 22 October 2026: accessories): back good but without some of its accessories
    expect(custodyDeductionProblem({ kind: 'deduction', type: 'damage_loss' }, { ...item, returnCondition: 'good', missingAccessories: 1 }, 'e1')).toBeNull();
    expect(custodyDeductionProblem({ kind: 'deduction', type: 'damage_loss' }, { ...item, returnCondition: 'good', missingAccessories: 0 }, 'e1')).not.toBeNull();
    expect(custodyDeductionProblem({ kind: 'deduction', type: 'damage_loss' }, null, 'e1')).toBe('Choose a damaged or missing item of this employee’s custody.');
  });
});
