import { describe, expect, it } from 'vitest';
import { bankNamed, type Bank } from '@trendlix/shared';
import { accountCount, accountKept, bankShown } from './bank-rules';

const bank = (name: string): Bank => {
  const b = bankNamed(name);
  if (!b) throw new Error(`${name} is not on the list`);
  return b;
};

describe('the digit count', () => {
  it('keeps the number as the API does: no spaces or dashes, Arabic digits as 0-9', () => {
    expect(accountKept(' 123 456-789 ')).toBe('123456789');
    expect(accountKept('١٢٣ ٤٥٦')).toBe('123456');
  });

  it('counts towards the length the bank uses, and fits only at that length', () => {
    expect(accountCount(bank('NBE'), '123 456 789012')).toEqual({ text: '12 of 19 digits', fits: false, over: false });
    expect(accountCount(bank('NBE'), '123-456-78901234-56789')).toEqual({ text: '19 of 19 digits', fits: true, over: false });
    expect(accountCount(bank('NBE'), '12345678901234567890')).toEqual({ text: '20 of 19 digits', fits: false, over: true });
  });

  it('names the lengths a bank uses when it has several, or the most it takes', () => {
    expect(accountCount(bank('AAIB'), '12345678901234')).toEqual({ text: '14 digits (13 or 16)', fits: false, over: false });
    expect(accountCount(bank('FAB'), '1234567890')).toEqual({ text: '10 digits (10, 11 or 13)', fits: true, over: false });
    expect(accountCount(bank('ABK'), '12345678')).toEqual({ text: '8 digits (up to 10)', fits: true, over: false });
    expect(accountCount(bank('ABK'), '123456789012345')).toEqual({ text: '15 digits (up to 10)', fits: false, over: true });
  });

  it('only counts for a bank with no length, and shows nothing while empty', () => {
    expect(accountCount(bank('CBE'), '123456789012')).toEqual({ text: '12 digits', fits: true, over: false });
    expect(accountCount(bank('CBE'), '1')).toEqual({ text: '1 digit', fits: true, over: false });
    expect(accountCount(bank('NBE'), ' - ')).toBeNull();
  });

  it('warns about anything that isn’t a digit', () => {
    expect(accountCount(bank('CIB'), '12345678901A')).toEqual({ text: '11 of 12 digits. Only digits, spaces and dashes.', fits: false, over: true });
  });
});

describe('a mobile wallet', () => {
  it('is on the list as MIDG, also when typed as Wallet, with no SWIFT code', () => {
    expect(bank('Wallet')).toMatchObject({ name: 'Mobile wallet', short: 'MIDG', wallet: true });
    expect(bank('MIDG').bic).toBeUndefined();
    expect(bankShown('Mobile wallet')).toBe('Mobile wallet (MIDG)');
  });

  it('counts towards a mobile number: 11 digits starting with 01, +20 written as 0', () => {
    expect(accountKept('+20 127 954 9379')).toBe('01279549379');
    expect(accountCount(bank('Mobile wallet'), '0127 954')).toEqual({ text: '7 of 11 digits', fits: false, over: false });
    expect(accountCount(bank('Mobile wallet'), '0127-954-9379')).toEqual({ text: '11 of 11 digits', fits: true, over: false });
    expect(accountCount(bank('Mobile wallet'), '1279549379')).toEqual({ text: '10 of 11 digits. A mobile number starts with 01.', fits: false, over: true });
    expect(accountCount(bank('Mobile wallet'), '012795493790')).toEqual({ text: '12 of 11 digits', fits: false, over: true });
  });
});

describe('the bank on the profile', () => {
  it('adds the abbreviation of a bank on the list, and leaves the rest as saved', () => {
    expect(bankShown('National Bank of Egypt')).toBe('National Bank of Egypt (NBE)');
    expect(bankShown('national bank of egypt')).toBe('national bank of egypt (NBE)');
    expect(bankShown('NBE')).toBe('NBE');
    expect(bankShown('Some Bank Abroad')).toBe('Some Bank Abroad');
    expect(bankShown(null)).toBeNull();
  });
});
