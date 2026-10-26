import { canWithdrawResignation, noticeSentence, preferredDayProblem, resignationOffered, resignationProblems } from '@trendlix/shared';
import { checkedLetter, LETTER_MAX_BYTES } from './letter.js';

// An employee's request to resign (owner, 26 October 2026): who may resign, the dates, the letter, one open request.
const TODAY = '2026-10-26';
const file = (buffer: Buffer, originalname = 'letter.pdf') => ({ buffer, size: buffer.length, originalname });

describe('resignation request rules', () => {
  it('is offered under the labour law only: not to a freelancer or an intern', () => {
    expect(resignationOffered('full_time')).toBe(true);
    expect(resignationOffered('part_time')).toBe(true);
    expect(resignationOffered('freelance')).toBe(false);
    expect(resignationOffered('intern')).toBe(false);
  });

  it('takes a preferred day of today up to a year ahead, or none', () => {
    expect(preferredDayProblem(null, TODAY)).toBeNull();
    expect(preferredDayProblem('', TODAY)).toBeNull();
    expect(preferredDayProblem(TODAY, TODAY)).toBeNull();
    expect(preferredDayProblem('2026-10-25', TODAY)).toMatch(/today or later/);
    expect(preferredDayProblem('2026-02-30', TODAY)).toMatch(/real date/);
    expect(preferredDayProblem('2028-01-01', TODAY)).toMatch(/more than a year/);
  });

  it('lists every problem in the order to fix them', () => {
    expect(resignationProblems({ reason: ' ', preferredLastDay: '2026-01-01', confirmed: false }, TODAY)).toHaveLength(3);
    expect(resignationProblems({ reason: 'x'.repeat(301), confirmed: true }, TODAY)).toEqual(['The reason can be at most 300 characters.']);
    expect(resignationProblems({ reason: 'A move', preferredLastDay: '2027-01-31', confirmed: true }, TODAY)).toEqual([]);
  });

  it('words a notice and lets only a waiting request be withdrawn', () => {
    expect(noticeSentence(3, 'months')).toBe('3 months');
    expect(noticeSentence(1, 'working_days')).toBe('1 working day');
    expect(canWithdrawResignation('sent')).toBe(true);
    for (const s of ['recorded', 'withdrawn', 'returned']) expect(canWithdrawResignation(s)).toBe(false);
  });
});

describe('the signed letter', () => {
  it('is none, or a PDF or photo told by its content', () => {
    expect(checkedLetter(undefined)).toEqual({ letter: null, problems: [] });
    const ok = checkedLetter(file(Buffer.from('%PDF-1.4 x'), '../../a:b.png'));
    expect(ok.problems).toEqual([]);
    expect(ok.letter).toMatchObject({ mimeType: 'application/pdf', fileName: 'a_b.pdf' });
  });
  it('refuses an empty file, another kind and one too large', () => {
    expect(checkedLetter(file(Buffer.alloc(0))).problems).toEqual(['The letter is empty.']);
    expect(checkedLetter(file(Buffer.from('hello'))).problems).toEqual(['The letter must be a PDF or a JPEG, PNG or WebP photo.']);
    expect(checkedLetter({ buffer: Buffer.from('%PDF-1'), size: LETTER_MAX_BYTES + 1, originalname: 'a.pdf' }).problems).toEqual(['The letter must be 4 MB or smaller.']);
  });
});
