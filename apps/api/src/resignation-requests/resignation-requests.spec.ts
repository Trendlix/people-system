import { canWithdrawResignation, noticeSentence, preferredDayProblem, resignationOffered, resignationProblems } from '@trendlix/shared';
import { checkedLetter, LETTER_MAX_BYTES } from './letter.js';
import { requestView, type RequestRow } from './views.js';

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

describe('the signed letter HR uploads', () => {
  it('is a PDF or photo told by its content; none is asked for', () => {
    expect(checkedLetter(undefined)).toEqual({ letter: null, problems: ['Choose the signed letter: a PDF or a photo.'] });
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

// the letter People prepares (owner, 31 October 2026: "on the resignation, the letter is auto generated, viewed by the
// employee but uploaded by the HR")
describe('the letter on a request', () => {
  const row = {
    id: 'r1',
    employeeId: 'e1',
    employmentId: 'm1',
    employee: { id: 'e1', employeeCode: 'TL-0001', fullNameEn: 'Sara Example' },
    employment: { managerId: 'e2', endDate: null },
    status: 'sent',
    reason: 'A new chapter',
    preferredLastDay: null,
    sentOn: new Date('2026-10-31T00:00:00Z'),
    noticeAmount: 3,
    noticeUnit: 'months',
    ruleLastDay: new Date('2027-01-31T00:00:00Z'),
    letterName: null,
    letterMime: null,
    letterSize: null,
    withdrawnAt: null,
    returnedReason: null,
    returnedById: null,
    returnedBy: null,
    returnedAt: null,
    endingId: null,
    ending: null,
    recordedById: null,
    recordedBy: null,
    recordedAt: null,
    createdAt: new Date('2026-10-31T09:00:00Z'),
    updatedAt: new Date('2026-10-31T09:00:00Z'),
  } as unknown as RequestRow;

  it('is ready once the template is published, for the employee and HR; never shown to the manager', () => {
    expect(requestView(row, 'self', false, true).preparedLetter).toBe('ready');
    expect(requestView(row, 'full', false, false).preparedLetter).toBe('no_template');
    expect(requestView(row, 'manager', false, true)).toMatchObject({ preparedLetter: null, letter: null, reason: null });
  });

  it('shows the signed copy HR uploaded, or the one the employee attached before', () => {
    const signed = { ...row, letterName: 'signed.pdf', letterMime: 'application/pdf', letterSize: 1200 } as RequestRow;
    expect(requestView(signed, 'self', false, true).letter).toEqual({ letterFileName: 'signed.pdf', mimeType: 'application/pdf', sizeBytes: 1200 });
  });
});
