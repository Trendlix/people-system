import { describe, expect, it } from 'vitest';
import { CONFIDENTIAL_GRADES_LEFT_OUT, pickableGrades } from './label';

const g8 = { id: 'g8', code: 'G8', confidential: false };
const g9 = { id: 'g9', code: 'G9', confidential: true };
const old = { id: 'g1', code: 'G1' };

describe('pickableGrades', () => {
  it('offers every grade to someone who sets C-level grades', () => {
    expect(pickableGrades([old, g8, g9], true)).toEqual({ grades: [old, g8, g9], leftOut: false });
  });

  it('leaves the C-level grades out for anyone else, and says so', () => {
    expect(pickableGrades([old, g8, g9], false)).toEqual({ grades: [old, g8], leftOut: true });
    expect(CONFIDENTIAL_GRADES_LEFT_OUT).toBe('C-level grades are set by the CEO or the Super Admin.');
  });

  it('leaves nothing out when no grade is C-level, or from an API without the flag', () => {
    expect(pickableGrades([old, g8], false)).toEqual({ grades: [old, g8], leftOut: false });
    expect(pickableGrades([], false)).toEqual({ grades: [], leftOut: false });
  });
});
