import { DIAL, DIAL_FIRST, phoneJoin, phoneSplit } from '@trendlix/shared';

// The typing rules of the phone field (components/phone-input.tsx), as Prime ERP's forms follow them: a phone number is
// a country code, chosen from the list of the world's codes with Egypt (+20) first, and the number without the 0 in
// front, kept as one run with no spaces (+201012345678). A 0 typed in front and anything that is not a digit are dropped
// as they are typed; a whole number pasted with its code sets the code. How numbers are kept comes from @trendlix/shared.

/** What the field holds: the country chosen (by name: several countries share a code) and what is in the number box. */
export interface PhoneParts {
  country: string;
  n: string;
}

export const EGYPT = DIAL[0][0];

/** The code of a country on the list; Egypt's for one that is not. */
export function codeOf(country: string): string {
  return DIAL.find(([c]) => c === country)?.[1] ?? '20';
}

/**
 * The country a code is shown as: `current` when it has that code (a +1 number pasted under Canada stays under Canada),
 * else the one a number on file is shown under (DIAL_FIRST), else the one country with that code.
 */
export function countryOf(code: string, current?: string): string {
  if (current && codeOf(current) === code) return current;
  return DIAL_FIRST[code] ?? DIAL.find(([, c]) => c === code)?.[0] ?? EGYPT;
}

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** Arabic-Indic digits (٠-٩, and their Persian forms ۰-۹) as 0-9. */
export function westernDigits(v: string): string {
  return v.replace(/[٠-٩۰-۹]/g, (d) => String(Math.max(ARABIC_DIGITS.indexOf(d), PERSIAN_DIGITS.indexOf(d))));
}

/** A whole number, written with its country code: +44 …, or 0044 … as it is dialled from Egypt. */
export const isWhole = (v: string) => /^(\+|00)/.test(v);

/**
 * The number box as typed, under the country `code`: digits only, and no 0 in front, except for Italy, which dials it
 * from abroad as well. A lone 0 waits for the next digit, so that a whole number can be typed with 00 in front. A whole
 * number keeps its + or 00 until it is split (splitWhole).
 */
export function typedNumber(v: string, code: string): string {
  const t = westernDigits(v).replace(/[^\d+]/g, '');
  if (t.startsWith('+')) return `+${t.replace(/\D/g, '')}`;
  const d = t.replace(/\D/g, '');
  if (d === '0' || d.startsWith('00') || code === '39') return d;
  return d.replace(/^0+/, '');
}

/**
 * A whole number split into its country and the rest: the country is `current` when it has that code, else the one
 * countryOf gives. Null for a number that is not whole, whose code is not on the list, or with nothing after its code.
 */
export function splitWhole(v: string, current: string): PhoneParts | null {
  if (!isWhole(v)) return null;
  const { cc, n } = phoneSplit(v);
  return cc && n ? { country: countryOf(cc, current), n } : null;
}

/**
 * The parts a number on file starts the field with (Egypt and an empty box when there is none). A number whose code is
 * not on the list stays whole in the box, so that saving keeps it as it was.
 */
export function startParts(saved: string | null | undefined): PhoneParts {
  const { cc, n } = phoneSplit(saved);
  if (!cc) return { country: EGYPT, n: n && `+${n}` };
  return { country: countryOf(cc), n };
}

/** The number as it is kept (+201012345678), from the two parts; empty when the box holds no number. */
export function keptNumber({ country, n }: PhoneParts): string {
  return phoneJoin(codeOf(country), n);
}

/**
 * After the number box changed to `v`. `atOnce`: the text came in whole (pasted, dropped, filled in), not a key at a
 * time; then a whole number sets the country straight away. One typed a key at a time is split when the box is left.
 */
export function numberTyped(parts: PhoneParts, v: string, atOnce: boolean): PhoneParts {
  const n = typedNumber(v, codeOf(parts.country));
  return (atOnce && splitWhole(n, parts.country)) || { ...parts, n };
}

/** When the number box is left: a whole number typed in it sets the country, and a lone 0 is dropped. */
export function numberLeft(parts: PhoneParts): PhoneParts {
  if (parts.n === '0' && codeOf(parts.country) !== '39') return { ...parts, n: '' };
  return splitWhole(parts.n, parts.country) ?? parts;
}

/** Another country chosen: the number in the box follows that country's rule for the 0 in front. */
export function countryChosen(parts: PhoneParts, country: string): PhoneParts {
  return { country, n: isWhole(parts.n) ? parts.n : typedNumber(parts.n, codeOf(country)) };
}
