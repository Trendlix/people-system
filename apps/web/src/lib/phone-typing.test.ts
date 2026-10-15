import { describe, expect, it } from 'vitest';
import {
  codeOf,
  countryChosen,
  countryOf,
  EGYPT,
  keptNumber,
  numberLeft,
  numberTyped,
  splitWhole,
  startParts,
  typedNumber,
  westernDigits,
  type PhoneParts,
} from './phone-typing';

const egypt = (n = ''): PhoneParts => ({ country: 'Egypt', n });

/** Types `keys` one at a time into the number box, as a person does. */
function typeKeys(parts: PhoneParts, keys: string): PhoneParts {
  return [...keys].reduce((p, key) => numberTyped(p, p.n + key, false), parts);
}

describe('the country list', () => {
  it('Egypt comes first, and is the default', () => {
    expect(EGYPT).toBe('Egypt');
    expect(codeOf('Egypt')).toBe('20');
    expect(codeOf('Nowhere')).toBe('20');
    expect(startParts('')).toEqual(egypt());
    expect(startParts(null)).toEqual(egypt());
  });
  it('a code several countries share is shown as the one a number on file is shown under, unless the chosen one has it', () => {
    expect(countryOf('1')).toBe('United States');
    expect(countryOf('39')).toBe('Italy');
    expect(countryOf('1', 'Canada')).toBe('Canada');
    expect(countryOf('44', 'Canada')).toBe('United Kingdom');
    expect(countryOf('1242')).toBe('Bahamas');
  });
});

describe('typing the number', () => {
  it('drops anything that is not a digit', () => {
    expect(typedNumber('10 1234-5678', '20')).toBe('1012345678');
    expect(typedNumber('(10) 1234 abc 5678', '20')).toBe('1012345678');
  });
  it('drops the 0 in front, except for Italy', () => {
    expect(typeKeys(egypt(), '01012345678')).toEqual(egypt('1012345678'));
    expect(typedNumber('01012345678', '20')).toBe('1012345678');
    expect(typedNumber('0612345678', '44')).toBe('612345678');
    expect(typedNumber('0612345678', '39')).toBe('0612345678');
    expect(typeKeys({ country: 'Italy', n: '' }, '0612345678')).toEqual({ country: 'Italy', n: '0612345678' });
  });
  it('a lone 0 waits for the next digit, and is dropped when the box is left', () => {
    expect(typedNumber('0', '20')).toBe('0');
    expect(typedNumber('01', '20')).toBe('1');
    expect(numberLeft(egypt('0'))).toEqual(egypt());
    expect(numberLeft({ country: 'Italy', n: '0' })).toEqual({ country: 'Italy', n: '0' });
    expect(keptNumber(egypt('0'))).toBe('');
  });
  it('turns Arabic-Indic digits into 0-9', () => {
    expect(westernDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(westernDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
    expect(typeKeys(egypt(), '٠١٠١٢٣٤٥٦٧٨')).toEqual(egypt('1012345678'));
    expect(numberTyped(egypt(), '٠١٠ ١٢٣٤ ٥٦٧٨', true)).toEqual(egypt('1012345678'));
  });
});

describe('a whole number, with its country code', () => {
  it('pasted, it sets the country and leaves the rest in the box', () => {
    expect(numberTyped(egypt(), '+44 20 7946 0958', true)).toEqual({ country: 'United Kingdom', n: '2079460958' });
    expect(numberTyped(egypt(), '00966 50 123 4567', true)).toEqual({ country: 'Saudi Arabia', n: '501234567' });
    expect(numberTyped(egypt(), '+20 10 1234 5678', true)).toEqual(egypt('1012345678'));
    expect(numberTyped(egypt(), '+20 (0) 10 1234 5678', true)).toEqual(egypt('1012345678'));
    expect(numberTyped(egypt(), '+٢٠١٠١٢٣٤٥٦٧٨', true)).toEqual(egypt('1012345678'));
    expect(numberTyped(egypt(), '+1242 359 1234', true)).toEqual({ country: 'Bahamas', n: '3591234' });
    expect(numberTyped({ country: 'Canada', n: '' }, '+1 416 555 0123', true)).toEqual({ country: 'Canada', n: '4165550123' });
    expect(numberTyped(egypt(), '+39 06 1234 5678', true)).toEqual({ country: 'Italy', n: '0612345678' });
  });
  it('pasted without a code, it is a number of the country chosen', () => {
    expect(numberTyped(egypt(), '010 1234 5678', true)).toEqual(egypt('1012345678'));
  });
  it('typed a key at a time, it stays as typed until the box is left: +1 may be the start of +1242', () => {
    const typed = typeKeys(egypt(), '+1242 359 1234');
    expect(typed).toEqual(egypt('+12423591234'));
    expect(keptNumber(typed)).toBe('+12423591234');
    expect(numberLeft(typed)).toEqual({ country: 'Bahamas', n: '3591234' });
  });
  it('typed with 00 in front, the 0s are kept until the box is left', () => {
    const typed = typeKeys(egypt(), '00447946095');
    expect(typed).toEqual(egypt('00447946095'));
    expect(numberLeft(typed)).toEqual({ country: 'United Kingdom', n: '7946095' });
  });
  it('is left as typed while its code is not known, or nothing follows it', () => {
    expect(splitWhole('+44', 'Egypt')).toBeNull();
    expect(splitWhole('+999123', 'Egypt')).toBeNull();
    expect(numberLeft(egypt('+999123'))).toEqual(egypt('+999123'));
    expect(numberTyped(egypt(), '+', true)).toEqual(egypt('+'));
    expect(keptNumber(egypt('+'))).toBe('');
  });
  it('is never split from a number without + or 00', () => {
    expect(splitWhole('201012345678', 'Egypt')).toBeNull();
  });
});

describe('choosing the country', () => {
  it('the number follows the rule of the country chosen for the 0 in front', () => {
    expect(countryChosen({ country: 'Italy', n: '0612345678' }, 'Egypt')).toEqual(egypt('612345678'));
    expect(countryChosen(egypt('1012345678'), 'Italy')).toEqual({ country: 'Italy', n: '1012345678' });
  });
  it('a whole number in the box stays as it is', () => {
    expect(countryChosen(egypt('+4420'), 'France')).toEqual({ country: 'France', n: '+4420' });
  });
});

describe('the number the form sends', () => {
  it('is the country code and the number in one run, or empty', () => {
    expect(keptNumber(egypt('1012345678'))).toBe('+201012345678');
    expect(keptNumber({ country: 'United Kingdom', n: '2079460958' })).toBe('+442079460958');
    expect(keptNumber({ country: 'Italy', n: '0612345678' })).toBe('+390612345678');
    expect(keptNumber({ country: 'Canada', n: '4165550123' })).toBe('+14165550123');
    expect(keptNumber(egypt())).toBe('');
  });
  it('a whole number still in the box is sent as it is kept, whatever the country chosen', () => {
    expect(keptNumber(egypt('+442079460958'))).toBe('+442079460958');
    expect(keptNumber(egypt('00442079460958'))).toBe('+442079460958');
  });
});

describe('starting from a number on file, or one sent before a refused save', () => {
  it('splits it into the country and the number', () => {
    expect(startParts('+201012345678')).toEqual(egypt('1012345678'));
    expect(startParts('+442079460958')).toEqual({ country: 'United Kingdom', n: '2079460958' });
    expect(startParts('+14165550123')).toEqual({ country: 'United States', n: '4165550123' });
    expect(startParts('+390612345678')).toEqual({ country: 'Italy', n: '0612345678' });
  });
  it('reads one kept another way as an Egyptian number as dialled', () => {
    expect(startParts('010 1234 5678')).toEqual(egypt('1012345678'));
  });
  it('keeps a number whose code is not on the list whole, so saving does not change it', () => {
    const parts = startParts('+999123456');
    expect(parts).toEqual(egypt('+999123456'));
    expect(keptNumber(parts)).toBe('+999123456');
  });
  it('sends back what it started with', () => {
    for (const v of ['+201012345678', '+442079460958', '+390612345678', '+12423591234', '']) expect(keptNumber(startParts(v))).toBe(v);
  });
});
