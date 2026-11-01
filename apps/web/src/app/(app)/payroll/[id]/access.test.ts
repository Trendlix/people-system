import { describe, expect, it } from 'vitest';
import {
  anyEditable,
  employeesNote,
  figuresNote,
  hiddenCount,
  hiddenRowLabel,
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

  it('are on the Employees card with those left out of the run', () => {
    expect(employeesNote(1, 2)).toBe('1 left out · C-level (2 people) hidden');
    expect(employeesNote(0, 1)).toBe('C-level (1 person) hidden');
    expect(employeesNote(3, 0)).toBe('3 left out');
    expect(employeesNote(0, 0)).toBeUndefined();
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
  it('is locked once the run is with the CEO or approved, nothing on a draft', () => {
    expect(figuresNote('pending_ceo')).toBe('Locked while with the CEO.');
    expect(figuresNote('approved')).toBe('Approved: the figures are locked.');
    expect(figuresNote('paid')).toBe('Approved: the figures are locked.');
    expect(figuresNote('draft')).toBeNull();
  });
});
