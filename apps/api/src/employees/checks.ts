import { isDateOnly } from '../common/date-only.js';

// Checks on Egyptian identity and bank numbers that catch typing mistakes before they reach a contract or a bank file.

/**
 * The birth date written inside an Egyptian national ID, or null if it holds no real date.
 * Digit 1 is the century (2 = 1900s, 3 = 2000s), digits 2-7 are YYMMDD.
 */
export function birthDateFromNationalId(nationalId: string): string | null {
  const m = /^([23])(\d{2})(\d{2})(\d{2})\d{7}$/.exec(nationalId);
  if (!m) return null;
  const year = (m[1] === '2' ? 1900 : 2000) + Number(m[2]);
  const ymd = `${year}-${m[3]}-${m[4]}`;
  return isDateOnly(ymd) ? ymd : null;
}

// The governorate of birth written inside an Egyptian national ID (digits 8-9): Cairo 01, Alexandria 02, Port Said 03,
// Suez 04, the Delta and Canal 11-19, Upper Egypt 21-29, the frontier governorates 31-35, and 88 for those born abroad.
const GOVERNORATE_CODES = new Set(['01', '02', '03', '04', ...range(11, 19), ...range(21, 29), ...range(31, 35), '88']);

function range(from: number, to: number): string[] {
  return Array.from({ length: to - from + 1 }, (_, i) => String(from + i));
}

/**
 * Whether the governorate code in a national ID (its 8th and 9th digits) is one a governorate has. A number with any
 * other code was misread or mistyped. Only the card reader uses this: what saving accepts is checked elsewhere.
 */
export function hasRealGovernorateCode(nationalId: string): boolean {
  return /^\d{14}$/.test(nationalId) && GOVERNORATE_CODES.has(nationalId.slice(7, 9));
}

/**
 * Characters a number copied from a message or an Arabic text carries without showing them: zero-width spaces and
 * joiners, direction marks and isolates, the word joiner and the byte order mark. Removed from bank details as they
 * are saved (owner's request, 17 October 2026: "make sure there is no spaces before or after the field data").
 */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

/** An account number as kept: spaces of any kind, dashes and invisible characters removed: "100-123 4567" → "1001234567". */
export function normalizeAccountNo(value: string): string {
  return value.replace(INVISIBLE, '').replace(/[\s-]+/g, '');
}

/** Spaces of any kind and invisible characters removed, letters in capitals: "eg38 0019 …" → "EG380019…". */
export function normalizeIban(value: string): string {
  return value.replace(INVISIBLE, '').replace(/\s+/g, '').toUpperCase();
}

/** A name as kept, e.g. the account holder's: invisible characters removed, no spaces before or after, runs of spaces as one. */
export function normalizeName(value: string): string {
  return value.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
}

/** An Egyptian IBAN (EG + 27 digits) whose check digits are right (ISO 13616, mod 97). */
export function isValidEgyptianIban(iban: string): boolean {
  if (!/^EG\d{27}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return rest === 1;
}

/** Only the last four characters shown: "•••• 3180". */
export function maskTail(value: string | null): string | null {
  return value ? `•••• ${value.slice(-4)}` : null;
}
