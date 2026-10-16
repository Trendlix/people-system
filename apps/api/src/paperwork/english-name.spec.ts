import { nameParts, roughNote, spellingsOnFile, spellName } from './english-name.js';

// The English name spelled from the Arabic name the ID card gives (from Prime ERP's reader, 16 October 2026). Made-up
// people only.
const NOBODY = spellingsOnFile([]);

describe('the English name, spelled from the Arabic one', () => {
  it('splits names into parts that line up, compound names as one part', () => {
    expect(nameParts('عبد الرحمن أبو بكر جمال الدين يوسف', true)).toEqual(['عبد الرحمن', 'ابو بكر', 'جمال الدين', 'يوسف']);
    expect(nameParts('Abdel Rahman Abu Bakr Gamal El Din Youssef', false)).toEqual(['Abdel Rahman', 'Abu Bakr', 'Gamal El Din', 'Youssef']);
    expect(nameParts('Abd El Rahman El Sayed', false)).toEqual(['Abd El Rahman', 'El Sayed']);
    expect(nameParts('  السيّد  ', true)).toEqual(['السيد']); // normalised: diacritics, spaces
  });

  it('spells common names from the list', () => {
    expect(spellName('يوسف كريم عبد الله السيد', NOBODY)).toEqual({ name: 'Youssef Karim Abdallah El Sayed', rough: 0 });
    expect(spellName('مَنى هبة', NOBODY)).toEqual({ name: 'Mona Heba', rough: 0 }); // ى, ة and diacritics as the list writes them
  });

  it('spells the rest letter by letter, and counts those parts', () => {
    expect(spellName('يوسف الشربيني', NOBODY)).toEqual({ name: 'Youssef El Shrbyny', rough: 1 });
    expect(spellName('تميم قنديل', NOBODY)).toEqual({ name: 'Tmym Kndyl', rough: 2 });
    expect(spellName('عبد الكريم', NOBODY)).toEqual({ name: 'Abd El Krym', rough: 1 });
  });

  it('follows how the employees on file spell a part, the most used spelling first', () => {
    const onFile = spellingsOnFile([
      { fullNameAr: 'تميم كريم', fullNameEn: 'Tamim Kareem' },
      { fullNameAr: 'تميم يوسف', fullNameEn: 'Tameem Youssef' },
      { fullNameAr: 'تميم سامح', fullNameEn: 'TAMIM SAMEH' }, // capitals as typed count as the same spelling
      { fullNameAr: 'قنديل حسن', fullNameEn: 'Kandil Hassan' },
    ]);
    // the list says Karim, but the one employee on file with that part writes Kareem
    expect(spellName('تميم كريم قنديل', onFile)).toEqual({ name: 'Tamim Kareem Kandil', rough: 0 });
  });

  it('chooses between spellings used as often in alphabetical order', () => {
    const onFile = spellingsOnFile([
      { fullNameAr: 'تميم', fullNameEn: 'Tameem' },
      { fullNameAr: 'تميم', fullNameEn: 'Tamim' },
    ]);
    expect(spellName('تميم', onFile)?.name).toBe('Tameem');
  });

  it('learns nothing from names whose parts do not line up, or that hold digits or another script', () => {
    const onFile = spellingsOnFile([
      { fullNameAr: 'تميم كريم قنديل', fullNameEn: 'Tamim Kandil' }, // three parts against two
      { fullNameAr: 'كريم قنديل', fullNameEn: 'Test 20261016' }, // a name with digits
      { fullNameAr: 'كريم قنديل', fullNameEn: 'كريم قنديل' }, // the Arabic name typed again
      { fullNameAr: 'Karim Kandil', fullNameEn: 'Karim Kandil' },
    ]);
    expect(onFile.size).toBe(0);
  });

  it('spells nothing when the Arabic name is not in Arabic letters', () => {
    expect(spellName('', NOBODY)).toBeUndefined();
    expect(spellName('Karim', NOBODY)).toBeUndefined();
    expect(spellName('كريم ٢', NOBODY)).toBeUndefined();
  });

  it('says how many parts were spelled only roughly', () => {
    expect(roughNote(1)).toBe('The English name is spelled from the Arabic name, one part of it only roughly, letter by letter. Check its spelling before saving.');
    expect(roughNote(2)).toBe('The English name is spelled from the Arabic name, 2 parts of it only roughly, letter by letter. Check its spelling before saving.');
  });
});
