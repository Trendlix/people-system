import { readIdCardWithNotes, type CardLine } from './egyptian-id.js';

// A made-up card (no real person), laid out as on an Egyptian national ID: each line with where it lies on the
// 85.6 × 54 mm card, top to bottom. Cutting a scan short is played by taking millimetres off an edge: a line wholly
// beyond the cut is lost, and a line the cut runs through is marked `cut`, as the OCR service's boxes tell the API.
const CARD_H = 54;
type Placed = { text: string; top: number; bottom: number };

const FRONT: Placed[] = [
  { text: 'جمهورية مصر العربية', top: 2.5, bottom: 6.5 },
  { text: 'بطاقة تحقيق الشخصية', top: 7, bottom: 10.5 },
  { text: 'محمد', top: 13, bottom: 17.5 },
  { text: 'أحمد محمود عبد الله', top: 18.5, bottom: 23 },
  { text: '١٥ شارع مكرم عبيد', top: 25, bottom: 29 },
  { text: 'أول مدينة نصر - القاهرة', top: 30, bottom: 34 },
  { text: '٢٩٥٠ ٣١٢٠ ١٢٣٤ ٥٦', top: 43, bottom: 48.5 },
];
const BACK: Placed[] = [
  { text: '٢٩٥٠٣١٢٠١٢٣٤٥٦   ٢٠٢٠/٠٧', top: 2.5, bottom: 7 },
  { text: 'سجل مدني مدينة نصر', top: 8, bottom: 12 },
  { text: 'مهندس برمجيات', top: 13, bottom: 17 },
  { text: 'ذكر     مسلم     أعزب', top: 18, bottom: 22 },
  { text: 'البطاقة سارية حتى ٢٠٢٧/٠٧/١١', top: 23, bottom: 27 },
];
const TODAY = '2026-10-14';

/** The lines left after cutting `mm` off the top or the bottom of the card. */
function cutOff(lines: Placed[], edge: 'top' | 'bottom', mm: number): CardLine[] {
  const from = edge === 'top' ? mm : 0;
  const to = edge === 'bottom' ? CARD_H - mm : CARD_H;
  return lines
    .filter((l) => l.bottom > from && l.top < to)
    .map((l) => ({ text: l.text, cut: (mm > 0 && edge === 'top' && l.top <= from) || (mm > 0 && edge === 'bottom' && l.bottom >= to) }));
}

const whole = readIdCardWithNotes(cutOff(FRONT, 'top', 0), cutOff(BACK, 'top', 0), TODAY).suggestions;

describe('a scan cut short', () => {
  it('reads the whole made-up card completely', () => {
    expect(whole).toEqual({
      nationalId: '29503120123456',
      dateOfBirth: '1995-03-12',
      fullNameAr: 'محمد أحمد محمود عبد الله',
      addressAr: '١٥ شارع مكرم عبيد، أول مدينة نصر - القاهرة',
      gender: 'male',
      issueDate: '2020-07-01',
      expiryDate: '2027-07-11',
      issuingOffice: 'سجل مدني مدينة نصر',
    });
  });

  for (const side of ['front', 'back'] as const) {
    for (const edge of ['top', 'bottom'] as const) {
      for (const mm of [0, 0.5, 1, 1.5, 2, 2.5, 3]) {
        it(`keeps every field as on the whole card, or empty: ${mm} mm off the ${edge} of the ${side}`, () => {
          const front = side === 'front' ? cutOff(FRONT, edge, mm) : cutOff(FRONT, 'top', 0);
          const back = side === 'back' ? cutOff(BACK, edge, mm) : cutOff(BACK, 'top', 0);
          const read = readIdCardWithNotes(front, back, TODAY).suggestions;
          for (const [field, value] of Object.entries(read)) {
            expect({ field, value }).toEqual({ field, value: whole[field as keyof typeof whole] });
          }
          // the name, the address and the number never go missing for a cut this small
          expect(read).toMatchObject({ nationalId: whole.nationalId, fullNameAr: whole.fullNameAr, addressAr: whole.addressAr });
        });
      }
    }
  }

  it('does not take a number the edge cuts through, even when it reads as another well-formed number', () => {
    // the front's number lost to a cut at the bottom; the back's number cut along its top and misread
    const front = cutOff(FRONT, 'bottom', 8);
    const back: CardLine[] = [{ text: '٢٩٥٠٣١٢٠١٢٣٤٥٨   ٢٠٢٠/٠٧', cut: true }, ...cutOff(BACK, 'top', 7.5)];
    const { suggestions, notes } = readIdCardWithNotes(front, back, TODAY);
    expect(suggestions.nationalId).toBeUndefined();
    expect(suggestions.dateOfBirth).toBeUndefined();
    expect(suggestions.issueDate).toBeUndefined(); // printed on the cut line
    expect(notes).toEqual([
      'The national ID number is at the edge of the picture, which cuts through it, so it was not taken. Type it in from the card, or scan the card again with some space around it.',
    ]);
  });

  it('counts the name and address up from the number when the top is cut, never down from the edge', () => {
    // a cut through the first name: the address is still the two lines above the number; the name can't be told
    const front = cutOff(FRONT, 'top', 15);
    expect(front[0]).toEqual({ text: 'محمد', cut: true });
    const read = readIdCardWithNotes(front, cutOff(BACK, 'top', 0), TODAY).suggestions;
    expect(read.fullNameAr).toBeUndefined();
    expect(read.addressAr).toBe(whole.addressAr);
  });

  it('marks nothing as cut when no positions are known (text only)', () => {
    const text = FRONT.map((l) => l.text).join('\n');
    expect(readIdCardWithNotes(text, null, TODAY).suggestions.fullNameAr).toBe(whole.fullNameAr);
  });
});
