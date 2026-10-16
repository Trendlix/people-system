import { looseDateIn, readIdCardWithNotes } from './egyptian-id.js';

// Misreadings taught by Prime ERP's reader (16 October 2026): a national ID number whose governorate code no
// governorate has, and dates whose slashes were read as the digit 1. A made-up card: no real person's data.
const TODAY = '2026-10-16';
const arabic = (s: string) => s.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));

// born 15/07/1988 in Alexandria (code 02); the same number with codes no governorate has
const REAL = '28807150212345';
const FAKE = '28807159912345';
const OTHER_REAL = '28807150412345'; // Suez (04): a different, possible number

const front = (id: string) => `جمهورية مصر العربية
بطاقة تحقيق الشخصية
يوسف
كريم سامح عادل
٧ شارع النصر
سيدي جابر - الإسكندرية
${arabic(id)}`;
const back = (id: string, expiry = '٢٠٢٨/٠٣/٠٩', issued = '٢٠٢١/٠٣') => `${arabic(id)}  ${issued}
محاسب
ذكر     متزوج
البطاقة سارية حتى ${expiry}`;

const NO_SUCH_CODE =
  'The national ID number read has a governorate code (its 8th and 9th digits) that does not exist, so a digit was probably misread. Check the number against the card before saving.';

describe('the governorate code of the national ID number', () => {
  it('still suggests a number whose code does not exist, with a note for HR, and its birth date', () => {
    const { suggestions, notes } = readIdCardWithNotes(front(FAKE), null, TODAY);
    expect(suggestions).toMatchObject({ nationalId: FAKE, dateOfBirth: '1988-07-15' });
    expect(notes).toEqual([NO_SUCH_CODE]);
    // both sides agreeing on it changes nothing: no governorate has the code
    expect(readIdCardWithNotes(front(FAKE), back(FAKE), TODAY).notes).toEqual([NO_SUCH_CODE]);
  });

  it('says nothing about a number whose code is real', () => {
    const { suggestions, notes } = readIdCardWithNotes(front(REAL), back(REAL), TODAY);
    expect(suggestions.nationalId).toBe(REAL);
    expect(notes).toEqual([]);
  });

  it('prefers, among the numbers read on one side, the one whose code is real', () => {
    const twice = `${arabic(FAKE)}\n${back(REAL)}`;
    const { suggestions, notes } = readIdCardWithNotes(null, twice, TODAY);
    expect(suggestions.nationalId).toBe(REAL);
    expect(notes).toEqual([]);
  });

  it('takes the number of the side whose code is real when the two sides disagree, and says so', () => {
    const misreadFront = readIdCardWithNotes(front(FAKE), back(REAL), TODAY);
    expect(misreadFront.suggestions.nationalId).toBe(REAL);
    expect(misreadFront.notes).toEqual([
      'The number read on the front of the card has a governorate code (its 8th and 9th digits) that does not exist, so the number read on the back is used. Check it against the card.',
    ]);
    const misreadBack = readIdCardWithNotes(front(REAL), back(FAKE), TODAY);
    expect(misreadBack.suggestions.nationalId).toBe(REAL);
    expect(misreadBack.notes[0]).toMatch(/^The number read on the back of the card .* the number read on the front is used\./);
  });

  it('still suggests nothing when the two sides give different numbers whose codes are both real', () => {
    const { suggestions, notes } = readIdCardWithNotes(front(REAL), back(OTHER_REAL), TODAY);
    expect(suggestions).not.toHaveProperty('nationalId');
    expect(suggestions).not.toHaveProperty('dateOfBirth');
    expect(notes.join(' ')).not.toMatch(/governorate/);
  });
});

describe('dates whose slashes were read as the digit 1', () => {
  const expiryOf = (expiry: string, issued?: string) => readIdCardWithNotes(null, back(REAL, arabic(expiry), issued && arabic(issued)), TODAY).suggestions.expiryDate;

  it('reads an expiry with one slash read as 1, after the year or after the month, or with both', () => {
    expect(expiryOf('202810309')).toBe('2028-03-09'); // 2028 1 03 09
    expect(expiryOf('202803109')).toBe('2028-03-09'); // 2028 03 1 09
    expect(expiryOf('2028103109')).toBe('2028-03-09'); // both
    expect(expiryOf('2028/03109')).toBe('2028-03-09'); // one slash read, the other as 1
  });

  it('keeps a date only when exactly one reading is a real date, or exactly one is in the month expected', () => {
    // 202810115: 2028/01/15 or 2028/10/15; the issue month printed on the back (10/2021) says October
    expect(expiryOf('202810115', '2021/10')).toBe('2028-10-15');
    expect(expiryOf('202810115', '2021/01')).toBe('2028-01-15');
    expect(expiryOf('202810115', '2021/03')).toBeUndefined(); // neither: left out, never guessed
    expect(expiryOf('202810115', '')).toBeUndefined();
    expect(expiryOf('123456789')).toBeUndefined(); // no 1 where a slash stands
    expect(expiryOf('202813309')).toBeUndefined(); // 2028/33/09 is no date
  });

  it('reads them on a line of words, in any digits, and nothing else as one', () => {
    const valid = (ymd: string) => ymd >= '2000-01-01';
    expect(looseDateIn('البطاقة سارية حتى ٢٠٢٨١٠٣٠٩', valid)).toBe('2028-03-09');
    expect(looseDateIn('2028/03/09', valid)).toBeUndefined(); // an ordinary date: datesIn reads it
    expect(looseDateIn('20280309', valid)).toBeUndefined(); // 8 digits: a date without slashes (compactDatesIn)
    expect(looseDateIn('19991030 9', valid)).toBeUndefined();
    expect(looseDateIn('199910309', valid)).toBeUndefined(); // 1999/03/09: before 2000, not allowed here
    expect(looseDateIn('202810115', valid, '2028-10')).toBe('2028-10-15');
  });

  it('works the issue date out from an expiry read that way, as from any other', () => {
    const { suggestions, notes } = readIdCardWithNotes(null, back(REAL, arabic('202810309'), ''), TODAY); // no issue month printed
    expect(suggestions).toMatchObject({ expiryDate: '2028-03-09', issueDate: '2021-03-01' });
    expect(notes).toEqual([
      'The issue date could not be read on the card, so it is worked out from the expiry date (a card is valid for seven years). Check it against the card.',
    ]);
  });
});
