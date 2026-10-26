import { describe, expect, it } from 'vitest';
import { leaveStepText } from './list';
import { restoreBody, restoreWarning } from './restore';

// A Super Admin undoing a cancellation (owner, 26 October 2026: "allow superadmin to undo cancellation").

const form = (note?: string) => {
  const fd = new FormData();
  if (note !== undefined) fd.set('note', note);
  return fd;
};

describe('the restore form', () => {
  it('sends the note trimmed, or nothing', () => {
    expect(restoreBody(form('  Cancelled the wrong dates  '))).toEqual({ body: { note: 'Cancelled the wrong dates' }, errors: [] });
    expect(restoreBody(form('   ')).body).toEqual({});
    expect(restoreBody(form()).body).toEqual({});
  });

  it('refuses a note over 500 characters', () => {
    expect(restoreBody(form('x'.repeat(501))).errors).toEqual(['Keep the note to 500 characters; it has 501.']);
  });
});

describe('the warning before restoring', () => {
  it('says what the balance is left at when it goes below 0', () => {
    expect(restoreWarning({ days: 5, balanceBeforeRestore: 3 })).toBe('This leaves the annual balance at −2 days.');
    expect(restoreWarning({ days: 4, balanceBeforeRestore: 3 })).toBe('This leaves the annual balance at −1 day.');
  });

  it('is silent when it fits, or the leave is not from the annual balance', () => {
    expect(restoreWarning({ days: 3, balanceBeforeRestore: 3 })).toBeNull();
    expect(restoreWarning({ days: 3, balanceBeforeRestore: null })).toBeNull();
    expect(restoreWarning({ days: 3 })).toBeNull();
  });
});

it('words the restored step', () => {
  expect(leaveStepText({ kind: 'restored', decision: null, comment: null })).toBe('Restored by a Super Admin');
});
