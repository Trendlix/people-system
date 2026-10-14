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

/** Spaces removed, letters in capitals: "eg38 0019 …" → "EG380019…". */
export function normalizeIban(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
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
