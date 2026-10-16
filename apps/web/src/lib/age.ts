// A person's age from their date of birth (owner's request, 17 October 2026: "add the age in the employee basic data").
// Worked out each time it is shown, so it is never stored and never out of date. Pure code, tested.

/**
 * Whole years from `dateOfBirth` to `today` (both YYYY-MM-DD, today in Cairo): one more on each birthday. Someone
 * born on 29 February turns a year older on 1 March in a year without one. Null without a date of birth, or for one
 * after today.
 */
export function ageOn(dateOfBirth: string | null | undefined, today: string): number | null {
  const born = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfBirth ?? '');
  const now = /^(\d{4})-(\d{2})-(\d{2})/.exec(today);
  if (!born || !now) return null;
  const [by, bm, bd] = born.slice(1).map(Number);
  const [ny, nm, nd] = now.slice(1).map(Number);
  const age = ny - by - (nm < bm || (nm === bm && nd < bd) ? 1 : 0);
  return age >= 0 ? age : null;
}

/** "31 years", "1 year". */
export const ageText = (age: number) => `${age} ${age === 1 ? 'year' : 'years'}`;
