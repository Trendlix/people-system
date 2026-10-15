import { describe, expect, it } from 'vitest';
import { bankNamed, type Bank } from '@trendlix/shared';
import { accountCount, accountHint, accountKept, bankShown } from './bank-rules';

const bank = (name: string): Bank => {
  const b = bankNamed(name);
  if (!b) throw new Error(`${name} is not on the list`);
  return b;
};

describe('the account number hint', () => {
  it('gives the length and how the number is made up', () => {
    expect(accountHint(bank('NBE'))).toBe(
      'National Bank of Egypt account numbers have 19 digits: branch code (3), product type (3), CIF ID (8), sequence (5).',
    );
    expect(accountHint(bank('AIB'))).toBe('Arab Investment Bank account numbers have 6 digits: the customer ID.');
    expect(accountHint(bank('AUDI'))).toBe('Audi Bank account numbers have 12 or 16 digits and start with 00.');
  });

  it('gives only the length when the list doesn’t say how the number is made up, and nothing without a length', () => {
    expect(accountHint(bank('CIB'))).toBe('Commercial International Bank account numbers have 12 digits.');
    expect(accountHint(bank('ABK'))).toBe('Al Ahli Bank of Kuwait – Egypt account numbers have up to 10 digits.');
    expect(accountHint(bank('CBE'))).toBeNull();
  });
});

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

describe('the bank on the profile', () => {
  it('adds the abbreviation of a bank on the list, and leaves the rest as saved', () => {
    expect(bankShown('National Bank of Egypt')).toBe('National Bank of Egypt (NBE)');
    expect(bankShown('national bank of egypt')).toBe('national bank of egypt (NBE)');
    expect(bankShown('NBE')).toBe('NBE');
    expect(bankShown('Some Bank Abroad')).toBe('Some Bank Abroad');
    expect(bankShown(null)).toBeNull();
  });
});
