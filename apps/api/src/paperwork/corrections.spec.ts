import { applyCorrections, changedPhrases } from './corrections.js';

describe('ID card corrections', () => {
  it('finds the words HR changed', () => {
    expect(changedPhrases('محمد أحمد محمو عبد الله', 'محمد أحمد محمود عبد الله')).toEqual([['محمو', 'محمود']]);
    expect(changedPhrases('شارع مكرم عبيد اول مدينه نصر', 'شارع مكرم عبيد أول مدينة نصر')).toEqual([['اول مدينه', 'أول مدينة']]);
    // a word split in two by the reader
    expect(changedPhrases('عبد الر حمن', 'عبد الرحمن')).toEqual([['الر حمن', 'الرحمن']]);
    // the address separators don't count as words
    expect(changedPhrases('١٥ شارع مكرم عبيد، اول مدينة نصر', '١٥ شارع مكرم عبيد، أول مدينة نصر')).toEqual([['اول', 'أول']]);
  });

  it('learns nothing from words only added or removed, unchanged values or whole new values', () => {
    expect(changedPhrases('محمد أحمد', 'محمد أحمد محمود')).toEqual([]);
    expect(changedPhrases('محمد أحمد محمود', 'محمد محمود')).toEqual([]);
    expect(changedPhrases('محمد أحمد', 'محمد أحمد')).toEqual([]);
    expect(changedPhrases('', 'محمد')).toEqual([]);
    expect(changedPhrases('ا ب ج د ه', 'و ز ح ط ي')).toEqual([]); // five words replaced: a different value
  });

  it('applies learned fixes to whole words, longest first', () => {
    const fixes = [
      { field: 'fullNameAr', wrong: 'محمو', right: 'محمود' },
      { field: 'fullNameAr', wrong: 'الر حمن', right: 'الرحمن' },
    ];
    expect(applyCorrections('محمد محمو عبد الر حمن', fixes)).toBe('محمد محمود عبد الرحمن');
    expect(applyCorrections('محمودي محمو', fixes)).toBe('محمودي محمود'); // not inside another word
    expect(applyCorrections('أحمد علي', fixes)).toBeNull();
    expect(applyCorrections('مكرم عبيد، اول مدينة نصر', [{ field: 'addressAr', wrong: 'اول', right: 'أول' }])).toBe('مكرم عبيد، أول مدينة نصر');
  });
});
