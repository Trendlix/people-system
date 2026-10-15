import { gradeRange, inGradeRange } from './grade-range.js';

const G3 = { code: 'G3', rank: 3 };
const G6 = { code: 'G6', rank: 6 };

describe('grade ranges', () => {
  it('reads as people say it', () => {
    expect(gradeRange(G3, G6)).toBe('G3 to G6');
    expect(gradeRange(G3, G3)).toBe('G3');
    expect(gradeRange(G3, null)).toBe('from G3');
    expect(gradeRange(null, G6)).toBe('up to G6');
    expect(gradeRange(null, null)).toBeNull();
  });

  it('takes the grades between its ends, both included; an open end takes any grade on that side', () => {
    expect([2, 3, 6, 7].map((rank) => inGradeRange(rank, G3, G6))).toEqual([false, true, true, false]);
    expect([2, 3, 99].map((rank) => inGradeRange(rank, G3, null))).toEqual([false, true, true]);
    expect([1, 6, 7].map((rank) => inGradeRange(rank, null, G6))).toEqual([true, true, false]);
    expect(inGradeRange(1, null, null)).toBe(true);
  });
});
