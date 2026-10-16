import { birthDateFromNationalId, hasRealGovernorateCode, isValidEgyptianIban, maskTail, normalizeAccountNo, normalizeIban, normalizeName } from './checks.js';

describe('employee checks', () => {
  it('reads the birth date from a national ID', () => {
    expect(birthDateFromNationalId('29503121234567')).toBe('1995-03-12');
    expect(birthDateFromNationalId('30102281234567')).toBe('2001-02-28');
    expect(birthDateFromNationalId('29502301234567')).toBeNull(); // 30 February
    expect(birthDateFromNationalId('19503121234567')).toBeNull(); // no such century digit
    expect(birthDateFromNationalId('2950312123456')).toBeNull(); // 13 digits
  });

  it('tells a governorate code that exists from one that does not', () => {
    // made-up numbers: born 15/07/1988, then the governorate code
    const born = (code: string) => `2880715${code}12345`;
    for (const code of ['01', '04', '11', '19', '21', '29', '31', '35', '88']) expect(hasRealGovernorateCode(born(code))).toBe(true);
    for (const code of ['00', '05', '10', '20', '30', '36', '87', '99']) expect(hasRealGovernorateCode(born(code))).toBe(false);
    expect(hasRealGovernorateCode('2880715021234')).toBe(false); // 13 digits
  });

  it('checks an Egyptian IBAN, including its check digits', () => {
    expect(normalizeIban(' eg38 0019 0005 0000 0000 2631 8000 2 ')).toBe('EG380019000500000000263180002');
    expect(isValidEgyptianIban('EG380019000500000000263180002')).toBe(true);
    expect(isValidEgyptianIban('EG380019000500000000263180003')).toBe(false); // one digit off
    expect(isValidEgyptianIban('EG38001900050000000026318000')).toBe(false); // too short
    expect(isValidEgyptianIban('GB82WEST12345698765432')).toBe(false); // valid, but not Egyptian
  });

  it('keeps bank details without spaces around them or invisible characters copied with them (owner, 17 October 2026)', () => {
    // a non-breaking space, a right-to-left mark and a pop-directional mark, as pasted from a message in Arabic
    expect(normalizeAccountNo(' 100-123\u00A04567\u200F ')).toBe('1001234567');
    expect(normalizeAccountNo('\u200B\uFEFF')).toBe('');
    expect(normalizeIban('\u200Eeg38 0019 0005 0000 0000 2631 8000 2\u202C ')).toBe('EG380019000500000000263180002');
    expect(normalizeName('\u200F  Habiba   Mostafa\u00A0 ')).toBe('Habiba Mostafa');
    expect(normalizeName('   ')).toBe('');
  });

  it('masks all but the last four characters', () => {
    expect(maskTail('29503121234567')).toBe('•••• 4567');
    expect(maskTail(null)).toBeNull();
  });
});
