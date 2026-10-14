import { latinDigits, NORMALIZE_FROM, NORMALIZE_TO, normalizeArabic, snippet } from './arabic-text.js';

describe('Arabic text for search', () => {
  it('ignores hamza forms, ة/ه, ى/ي, tatweel, diacritics, digit forms, case and extra spaces', () => {
    expect(normalizeArabic('  إقـــرارُ   استلام العهدة\nرقم ٤٥٦  ')).toBe('اقرار استلام العهده رقم 456');
    expect(normalizeArabic('أحمد')).toBe(normalizeArabic('احمد'));
    expect(normalizeArabic('آمال')).toBe(normalizeArabic('امال'));
    expect(normalizeArabic('مستشفى')).toBe('مستشفي');
    expect(normalizeArabic('علی')).toBe('علي'); // Persian yeh
    expect(normalizeArabic('۱۲۳ Form ONE')).toBe('123 form one');
  });

  it('gives SQL translate() the same mapping', () => {
    // every character in `from` past the end of `to` is removed
    expect(NORMALIZE_FROM.length).toBeGreaterThan(NORMALIZE_TO.length);
    expect(new Set(NORMALIZE_FROM).size).toBe(NORMALIZE_FROM.length);
    const mapped = Array.from(NORMALIZE_FROM).map((c) => normalizeArabic(`x${c}x`).slice(1, -1)).join('');
    expect(mapped).toBe(NORMALIZE_TO);
  });

  it('converts Arabic-Indic digits only', () => {
    expect(latinDigits('رقم ٢٩٥ و۱۲')).toBe('رقم 295 و12');
  });

  it('shows the words around a match as written', () => {
    const text = `${'كلام قبل '.repeat(20)}إقـرار استلام العهدة رقم ٤٥٦\nثم ${'كلام بعد '.repeat(20)}`;
    const shown = snippet(text, normalizeArabic('اقرار استلام العهده'), 30);
    expect(shown).toContain('إقـرار استلام العهدة رقم ٤٥٦ ثم');
    expect(shown.startsWith('… ')).toBe(true);
    expect(shown.endsWith(' …')).toBe(true);
    expect(shown.length).toBeLessThan(110);
  });

  it('shows the start of the text when the match is not found, and all of a short text', () => {
    expect(snippet('نص قصير', 'غير موجود')).toBe('نص قصير');
    expect(snippet('رقم ٤٥٦', '456')).toBe('رقم ٤٥٦');
  });
});
