import { englishAmountInWords, englishNumber } from './english.js';

describe('amounts in English words', () => {
  it('writes the pounds and the piasters, ending with "only"', () => {
    expect(englishAmountInWords(15000)).toBe('Fifteen thousand Egyptian pounds only');
    expect(englishAmountInWords(13069.65)).toBe('Thirteen thousand sixty-nine Egyptian pounds and sixty-five piasters only');
    expect(englishAmountInWords(16700)).toBe('Sixteen thousand seven hundred Egyptian pounds only');
    expect(englishAmountInWords(1)).toBe('One Egyptian pound only');
    expect(englishAmountInWords(0.01)).toBe('One piaster only');
    expect(englishAmountInWords(0)).toBe('Zero Egyptian pounds only');
    expect(englishAmountInWords(1_250_000.5)).toBe('One million two hundred fifty thousand Egyptian pounds and fifty piasters only');
  });

  it('rounds to the piaster and refuses what it can’t write', () => {
    expect(englishAmountInWords(100.005)).toBe('One hundred Egyptian pounds and one piaster only');
    expect(() => englishAmountInWords(-1)).toThrow(RangeError);
    expect(() => englishAmountInWords(1_000_000_000)).toThrow(RangeError);
  });

  it('writes the numbers the way they are said', () => {
    expect(englishNumber(19)).toBe('nineteen');
    expect(englishNumber(40)).toBe('forty');
    expect(englishNumber(101)).toBe('one hundred one');
    expect(englishNumber(999_999_999)).toBe('nine hundred ninety-nine million nine hundred ninety-nine thousand nine hundred ninety-nine');
  });
});
