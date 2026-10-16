import { readIdCard, withoutReligion } from './egyptian-id.js';

// The religion printed on the back of the card is never shown or kept (as in Prime ERP's reader, owner's request of
// 16 October 2026).
// A made-up card: no real person's data.
const FRONT = `جمهورية مصر العربية
بطاقة تحقيق الشخصية
يوسف
كريم سامح مسلم
٧ شارع النصر
سيدي جابر - الإسكندرية
٢٨٨٠٧١٥٠٢١٢٣٤٥`;
const BACK = `٢٨٨٠٧١٥٠٢١٢٣٤٥   ٢٠٢١/٠٣
محاسب
ذكر     مسلم     متزوج
البطاقة سارية حتى ٢٠٢٨/٠٣/٠٩`;
const BACK_KEPT = `٢٨٨٠٧١٥٠٢١٢٣٤٥   ٢٠٢١/٠٣
محاسب
ذكر متزوج
البطاقة سارية حتى ٢٠٢٨/٠٣/٠٩`;

describe('the religion on the card', () => {
  it('is taken out of the back, each other line as read', () => {
    expect(withoutReligion(BACK, 'back')).toBe(BACK_KEPT);
  });

  it('is taken out however it is printed or read, and a line holding nothing else is dropped', () => {
    for (const word of ['مسلمة', 'مسلمـه', 'مسيحي', 'مسيحية', 'مسيحيه.', '|مسلم']) {
      expect(withoutReligion(`أنثى ${word} آنسة`, 'back')).toBe('أنثى آنسة');
    }
    // the back as the reader often gives it: gender, religion and marital status each on a line of its own
    expect(withoutReligion('ذكر\nمسيحي\nمتزوج', 'back')).toBe('ذكر\nمتزوج');
    expect(withoutReligion('البطاقة سارية حتى ٢٠٢٨/٠٣/٠٩\nمسلم', 'back')).toBe('البطاقة سارية حتى ٢٠٢٨/٠٣/٠٩');
  });

  it('leaves a front alone, so that a name such as مسلم stays', () => {
    expect(withoutReligion(FRONT, 'front')).toBe(FRONT);
  });

  it('is taken out of a front file that holds the back too: on a later page, or on the same page', () => {
    expect(withoutReligion(`${FRONT}\f${BACK}`, 'front')).toBe(`${FRONT}\f${BACK_KEPT}`);
    // a photo of both sides on one page: what shows the back is the back (the name on it goes with the religion)
    const both = withoutReligion(`${FRONT}\n${BACK}`, 'front');
    expect(both).not.toMatch(/مسلم/);
    expect(both).toContain('ذكر متزوج');
  });

  it('is never read into anything, and reading the card does not change', () => {
    expect(readIdCard(FRONT, withoutReligion(BACK, 'back'), '2026-10-16')).toEqual(readIdCard(FRONT, BACK, '2026-10-16'));
    expect(JSON.stringify(readIdCard(null, BACK, '2026-10-16'))).not.toMatch(/مسلم/);
  });
});
