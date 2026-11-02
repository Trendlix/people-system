import { documentSerial, luhnDigit, serialCheckOf, serialsIn, validSerial } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';

// A serial on every generated document (owner, 2 November 2026: "print like a serial number on each document generated
// … and when uploaded verify the document from the OCR and the Serial Printed").

describe('document serials', () => {
  it('are the year, a running number and a Luhn check digit', () => {
    expect(luhnDigit('7992739871')).toBe(3);
    expect(documentSerial(2026, 123)).toMatch(/^DOC-2026-000123-\d$/);
    expect(validSerial(documentSerial(2026, 123))).toBe(true);
    expect(validSerial(documentSerial(2026, 1_234_567))).toBe(true);
    // a digit misread, two swapped, or the check digit wrong: not a serial
    const s = documentSerial(2026, 123);
    expect(validSerial(s.replace('000123', '000128'))).toBe(false);
    expect(validSerial(s.replace('000123', '000132'))).toBe(false);
    expect(validSerial(s.slice(0, -1) + ((Number(s.at(-1)) + 1) % 10))).toBe(false);
    expect(validSerial('DOC-26-000123-4')).toBe(false);
  });

  it('are read off a scan’s text as OCR gives it: look-alike letters, spaces and dashes, each once', () => {
    const s = documentSerial(2026, 123);
    const [, year, num, check] = s.split('-');
    const misread = `D0C ${year.replace('0', 'O')} — ${num.replace('1', 'I')} . ${check}`;
    expect(serialsIn(`Signed by Mona\n${s}   ·   1/2\n${misread}   ·   2/2`)).toEqual([s]);
    // a wrong check digit is left out, never taken for another document
    expect(serialsIn(`DOC-2026-000124-${check}`)).toEqual([]);
    expect(serialsIn('no serial here')).toEqual([]);
  });

  it('checks a scan: this document’s, another’s, or none', () => {
    const mine = documentSerial(2026, 5);
    const other = documentSerial(2026, 6);
    expect(serialCheckOf(mine, [mine])).toBe('match');
    expect(serialCheckOf(mine, [other, mine])).toBe('match');
    expect(serialCheckOf(mine, [other])).toBe('mismatch');
    expect(serialCheckOf(mine, [])).toBe('not_found');
  });
});
