import { bankCheck, lineBank } from './bank.js';
import { firstDay, lastDay, monthArabic, monthName, monthShort, monthsLater } from './months.js';

// Which bank file pays each line, and what stops it (owner's decisions, 16 October 2026). Account numbers are invented.

describe('lineBank', () => {
  const details = (bank: string | null, accountNo: string | null = null, iban: string | null = null) => ({ bank, accountNo, iban, holderName: null });

  it('CIB accounts go in the CIB file, with the 12-digit account number', () => {
    expect(lineBank(details('Commercial International Bank', '100012345678'))).toEqual({ file: 'cib', bankShort: 'CIB', problem: null });
    // the copy taken at the approval keeps the short code
    expect(lineBank(details('CIB', '100012345678'))).toEqual({ file: 'cib', bankShort: 'CIB', problem: null });
    // an IBAN alone won't do: CIB's file takes the account number
    expect(lineBank(details('CIB', null, 'EG380019000500000000263180002'))).toEqual({
      file: 'cib',
      bankShort: 'CIB',
      problem: 'The CIB file needs the 12-digit CIB account number.',
    });
    expect(lineBank(details('CIB', '10001234567')).problem).toBe('The CIB file needs the 12-digit CIB account number.');
  });

  it('every other listed bank goes in the ACH file, with the IBAN or an account number of the bank’s length', () => {
    expect(lineBank(details('Qatar National Bank Alahli', '12345678901'))).toEqual({ file: 'ach', bankShort: 'QNB', problem: null });
    expect(lineBank(details('National Bank of Egypt', null, 'EG380019000500000000263180002'))).toEqual({ file: 'ach', bankShort: 'NBE', problem: null });
    expect(lineBank(details('National Bank of Egypt', '1234'))).toEqual({
      file: 'ach',
      bankShort: 'NBE',
      problem: 'The ACH file needs the IBAN, or the account number (NBE: 19 digits).',
    });
    // a bank the list gives no length for takes any number
    expect(lineBank(details('Central Bank of Egypt', '42'))).toEqual({ file: 'ach', bankShort: 'CBE', problem: null });
    expect(lineBank(details('Central Bank of Egypt')).problem).toBe('The ACH file needs the IBAN, or the account number.');
  });

  it('no details, no bank, or a bank off the EG-ACH list: no file', () => {
    expect(lineBank(details(null))).toEqual({ file: null, bankShort: null, problem: 'No bank details on file.' });
    expect(lineBank(details(null, '12345678901'))).toEqual({ file: null, bankShort: null, problem: 'The bank details have no bank chosen.' });
    expect(lineBank(details('Invented Savings Bank', '12345678901'))).toEqual({
      file: null,
      bankShort: null,
      problem: "The bank isn't on the EG-ACH list, so neither bank file can pay it.",
    });
  });
});

describe('bankCheck', () => {
  it('counts the lines paid by the bank: those on hold or with nothing to transfer are left out', () => {
    const cib = { file: 'cib' as const, bankShort: 'CIB', problem: null };
    const ach = { file: 'ach' as const, bankShort: 'QNB', problem: null };
    const broken = { file: null, bankShort: null, problem: 'No bank details on file.' };
    expect(
      bankCheck([
        { onHold: false, transfer: 100, bank: cib },
        { onHold: false, transfer: 100, bank: cib },
        { onHold: true, transfer: 100, bank: cib },
        { onHold: false, transfer: 100, bank: ach },
        { onHold: false, transfer: 0, bank: ach },
        { onHold: false, transfer: -5, bank: broken },
        { onHold: false, transfer: 100, bank: broken },
        { onHold: false, transfer: 100, bank: { ...ach, problem: 'The ACH file needs the IBAN, or the account number.' } },
      ]),
    ).toEqual({ cib: 2, ach: 1, problems: 2 });
  });
});

describe('payroll months', () => {
  it('names and bounds a month', () => {
    expect([firstDay('2026-02'), lastDay('2026-02'), lastDay('2028-02'), lastDay('2026-12')]).toEqual(['2026-02-01', '2026-02-28', '2028-02-29', '2026-12-31']);
    expect([monthName('2026-09'), monthShort('2026-09'), monthArabic('2026-03')]).toEqual(['September 2026', 'SEP', 'مارس 2026']);
    expect([monthsLater('2026-10', -12), monthsLater('2026-10', 1), monthsLater('2026-12', 1)]).toEqual(['2025-10', '2026-11', '2027-01']);
  });
});
