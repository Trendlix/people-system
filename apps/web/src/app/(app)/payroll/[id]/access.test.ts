import { describe, expect, it } from 'vitest';
import {
  anyEditable,
  employeesNote,
  figuresNote,
  filesNote,
  hiddenCount,
  hiddenRowLabel,
  hiddenTotalsNote,
  lineEditable,
  typist,
} from './access';

// The C-level people's lines on a run (owner, 19 October 2026: "make C level Employees details not visible to HR"):
// hidden from HR as one row, filled by the CEO; invented lines.

const normal = { confidential: false, editable: true };
const locked = { confidential: false, editable: false };
const cLevelMine = { confidential: true, editable: true };
const cLevelLocked = { confidential: true, editable: false };
// an API from before 19 October 2026 says neither
const older = {};

describe('who changes a line', () => {
  it('follows the line’s `editable` from the API', () => {
    expect(lineEditable(normal, false)).toBe(true);
    expect(lineEditable(locked, true)).toBe(false);
    expect(lineEditable(cLevelMine, false)).toBe(true);
  });

  it('falls back to the run’s rule (HR, on a draft) when an older API leaves it out', () => {
    expect(lineEditable(older, true)).toBe(true);
    expect(lineEditable(older, false)).toBe(false);
  });

  it('opens the grid when any line is the caller’s', () => {
    // the CEO: the C-level people's lines only
    expect(anyEditable([locked, cLevelMine], false)).toBe(true);
    expect(anyEditable([locked, cLevelLocked], true)).toBe(false);
    expect(anyEditable([older, older], true)).toBe(true);
    expect(anyEditable([older], false)).toBe(false);
    expect(anyEditable([], true)).toBe(false);
  });
});

describe('the lines hidden from the caller', () => {
  it('are counted from the API’s `hidden`, none without it', () => {
    expect(hiddenCount({ hidden: { count: 2, label: 'C-level (2 people) — hidden' } })).toBe(2);
    expect(hiddenCount({ hidden: null })).toBe(0);
    expect(hiddenCount({})).toBe(0);
    expect(hiddenCount({ hidden: { count: 0, label: '' } })).toBe(0);
  });

  it('are one row, named as the API names it, else by the count', () => {
    expect(hiddenRowLabel({ hidden: { count: 2, label: 'C-level (2 people) — hidden' } })).toBe('C-level (2 people) — hidden');
    expect(hiddenRowLabel({ hidden: { count: 1, label: '' } })).toBe('C-level (1 person) — hidden');
    expect(hiddenRowLabel({ hidden: null })).toBeNull();
    expect(hiddenRowLabel({})).toBeNull();
  });

  it('are left out of the totals, which say so', () => {
    expect(hiddenTotalsNote(2)).toBe('The totals leave out C-level (2 people): only the CEO and the Super Admin see their lines.');
    expect(hiddenTotalsNote(1)).toBe('The totals leave out C-level (1 person): only the CEO and the Super Admin see their lines.');
    expect(hiddenTotalsNote(0)).toBeNull();
  });

  it('are on the Employees card with those left out of the run', () => {
    expect(employeesNote(1, 2)).toBe('1 left out · C-level (2 people) hidden');
    expect(employeesNote(0, 1)).toBe('C-level (1 person) hidden');
    expect(employeesNote(3, 0)).toBe('3 left out');
    expect(employeesNote(0, 0)).toBeUndefined();
  });

  it('are left out of the caller’s files, which the page says; the CEO’s are complete', () => {
    expect(filesNote({ hidden: { count: 2, label: 'C-level (2 people) — hidden' } })).toBe('C-level (2 people) are left out: only the CEO and the Super Admin see their amounts.');
    expect(filesNote({ hidden: null })).toBeNull();
    expect(filesNote({})).toBeNull();
  });
});

describe('who a typed figure is marked as typed by', () => {
  it('is the CEO on a C-level person’s line, HR on the others', () => {
    expect(typist(true)).toBe('the CEO');
    expect(typist(false)).toBe('HR');
    expect(typist(undefined)).toBe('HR');
  });
});

describe('what the Monthly Figures heading says', () => {
  it('is locked once the run is with the CEO or approved, whoever looks', () => {
    expect(figuresNote('pending_ceo', [normal], false, 0)).toBe('With the CEO: the figures can’t be changed unless the CEO returns it.');
    expect(figuresNote('approved', [normal], false, 2)).toBe('Approved: the figures are locked.');
    expect(figuresNote('paid', [cLevelLocked], false, 0)).toBe('Approved: the figures are locked.');
  });

  it('tells HR they type the figures, and the CEO the C-level people’s hidden from them', () => {
    expect(figuresNote('draft', [normal, normal], true, 0)).toBe('Typed by HR until attendance fills them.');
    expect(figuresNote('draft', [normal, normal], true, 2)).toBe('Typed by HR until attendance fills them; the CEO fills the C-level people’s lines.');
    // only C-level people on the run
    expect(figuresNote('draft', [], true, 1)).toBe('The CEO fills the C-level people’s lines.');
  });

  it('tells the CEO which lines are theirs to fill on a draft', () => {
    expect(figuresNote('draft', [locked, cLevelMine, locked], false, 0)).toBe(
      'The C-level people’s lines, marked C-level, are yours to fill; HR types the rest until attendance fills them.',
    );
    // no C-level person on the run: nothing for the CEO to fill
    expect(figuresNote('draft', [locked, locked], false, 0)).toBe('Only HR types the month’s figures.');
  });

  it('tells HR with Super Admin, who fills every line, that the CEO fills the C-level ones as a rule', () => {
    expect(figuresNote('draft', [normal, cLevelMine], true, 0)).toBe('Typed by HR until attendance fills them; the C-level people’s lines, marked C-level, by the CEO.');
  });

  it('tells Finance, or a Super Admin with Finance, that HR and the CEO fill them', () => {
    expect(figuresNote('draft', [locked], false, 2)).toBe('Only HR types the month’s figures, and the CEO the C-level people’s.');
    expect(figuresNote('draft', [locked, cLevelLocked], false, 0)).toBe('Only HR types the month’s figures, and the CEO the C-level people’s.');
  });

  it('keeps the wording from before for an older API', () => {
    expect(figuresNote('draft', [older, older], true, 0)).toBe('Typed by HR until attendance fills them.');
    expect(figuresNote('draft', [older], false, 0)).toBe('Only HR types the month’s figures.');
  });
});
