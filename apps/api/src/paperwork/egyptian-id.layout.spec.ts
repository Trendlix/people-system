import { readIdCardWithNotes, type CardLine } from './egyptian-id.js';

// The front as the OCR service really reads it (owner's report, 14 October 2026), on a made-up card: the calligraphic
// heading comes back as words read with little certainty, the photo side has a date and the card's code, the number's
// dotted zeros can be missed, and the back's dates can lose their slashes. No real person's data.
const TODAY = '2026-10-14';
const line = (text: string, confidence: number, left: number, right: number): CardLine => ({ text, confidence, left, right });

const HEADING_AS_WORDS = line('جهون مصم العي', 0.54, 0.45, 0.84); // "جمهورية مصر العربية" drawn in calligraphy
const FRONT: CardLine[] = [
  HEADING_AS_WORDS,
  line('بطاقة تحقيق الشخصية', 0.98, 0.52, 0.78),
  line('محمد', 0.96, 0.82, 0.91),
  line('أحمد محمود عبد الله', 0.94, 0.57, 0.92),
  line('١٥ب شارع مكرم عبيد', 0.9, 0.38, 0.91),
  line('أول مدينة نصر - القاهرة', 0.94, 0.6, 0.91),
  line('٢٩٥٠ ٣١٢٠ ١٢٣٤ ٥٦', 0.97, 0.56, 0.93),
  line('١٩٩٥/٠٣', 0.87, 0.09, 0.24), // the date under the photo
  line('KH1234567', 1, 0.11, 0.34), // the card's code
];
const BACK: CardLine[] = [
  line('٢٩٥٠٣١٢٠١٢٣٤٥٦ ٢٠٢٠٠٧', 0.97, 0.28, 0.79), // the issue month beside the number, its slash dropped
  line('مهندس برمجيات', 0.98, 0.34, 0.79),
  line('ذكر', 0.94, 0.73, 0.79),
  line('مسلم', 0.86, 0.57, 0.63),
  line('أعزب', 0.94, 0.35, 0.44),
  line('البطاقة سارية حتى ٢٠٢٧٠٧١١', 0.91, 0.33, 0.79), // the expiry, its slashes dropped
];
const WHOLE = {
  nationalId: '29503120123456',
  dateOfBirth: '1995-03-12',
  fullNameAr: 'محمد أحمد محمود عبد الله',
  addressAr: '١٥ب شارع مكرم عبيد، أول مدينة نصر - القاهرة',
  gender: 'male',
  issueDate: '2020-07-01',
  expiryDate: '2027-07-11',
  printedNo: 'KH1234567',
};

describe('the card as the reader really reads it', () => {
  it('leaves out the heading read as words, and the photo side; dates without slashes still read', () => {
    const { suggestions, notes } = readIdCardWithNotes(FRONT, BACK, TODAY);
    expect(suggestions).toEqual(WHOLE);
    expect(notes).toEqual([]);
  });

  it('counts the name and address up from the number row, even when the heading is read with certainty', () => {
    const sure = FRONT.map((l) => (l === HEADING_AS_WORDS ? { ...l, confidence: 0.95 } : l));
    expect(readIdCardWithNotes(sure, BACK, TODAY).suggestions).toMatchObject({ fullNameAr: WHOLE.fullNameAr, addressAr: WHOLE.addressAr });
  });

  it('still finds the name and address when the number row was misread, and says why the number is missing', () => {
    // the dotted zeros missed on both sides: 11 and 13 digits, no valid number
    const front = FRONT.map((l) => (l.text.startsWith('٢٩٥٠') ? { ...l, text: '٢٩٥ ٣١٢ ١٢٣٤ ٥٦' } : l));
    const back = BACK.map((l, i) => (i === 0 ? { ...l, text: '٢٩٥٣١٢٠١٢٣٤٥٦' } : l));
    const { suggestions, notes } = readIdCardWithNotes(front, back, TODAY);
    expect(suggestions.nationalId).toBeUndefined();
    expect(suggestions.dateOfBirth).toBeUndefined();
    expect(suggestions).toMatchObject({ fullNameAr: WHOLE.fullNameAr, addressAr: WHOLE.addressAr, expiryDate: WHOLE.expiryDate });
    expect(notes).toEqual([
      'The national ID number could not be read completely: its zeros are printed as small dots, which the reader can miss. Type it in from the card.',
    ]);
  });

  it('never takes a line on the photo side for the address, whatever it says', () => {
    const front = [...FRONT.slice(0, 6), line('شارع وهمي', 0.99, 0.08, 0.3), ...FRONT.slice(6)];
    expect(readIdCardWithNotes(front, BACK, TODAY).suggestions.addressAr).toBe(WHOLE.addressAr);
  });

  it('takes no 6- or 8-digit group for a date unless it is one', () => {
    const back = BACK.map((l, i) => (i === 0 ? { ...l, text: '٢٩٥٠٣١٢٠١٢٣٤٥٦ ٢٠٢٠٩٩' } : i === 5 ? { ...l, text: 'البطاقة سارية حتى ٢٠٢٧١٣٤٠' } : l));
    const read = readIdCardWithNotes(FRONT, back, TODAY).suggestions;
    expect(read.issueDate).toBeUndefined();
    expect(read.expiryDate).toBeUndefined();
  });
});
