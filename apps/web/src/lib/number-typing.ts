import { westernDigits } from './phone-typing';

// The typing rules of number boxes (owner, 22 October 2026, on the careers form: "make the years of experience field
// only numbers, and you add years."; the notice period: "the field accept only numbers"): what is not a digit is dropped
// as it is typed, and Arabic digits (٠-٩) are taken as 0-9. Pure code, tested in number-typing.test.ts.

/**
 * Years of experience as typed: digits and one decimal point, for a half (2.5); a comma or the Arabic ٫ typed for it is
 * taken as the point. At most 2 digits before the point (the most is 60) and 1 after.
 */
export function yearsTyped(v: string): string {
  const t = westernDigits(v)
    .replace(/[,٫]/g, '.')
    .replace(/[^\d.]/g, '');
  const dot = t.indexOf('.');
  if (dot < 0) return t.slice(0, 2);
  return `${t.slice(0, dot).slice(0, 2)}.${t
    .slice(dot + 1)
    .replace(/\./g, '')
    .slice(0, 1)}`;
}

/** What follows the years in their box, not typed and not sent: "year" after 1, else "years". */
export const yearsSuffix = (v: string): string => (Number(v.trim()) === 1 ? 'year' : 'years');

/** A whole number as typed: digits only, at most `max` of them (a notice period's 3: up to 365 days). */
export const wholeTyped = (v: string, max = 3): string => westernDigits(v).replace(/\D/g, '').slice(0, max);
