// Searching a list by name (owner, 31 October 2026: "allow me to search by name too" on Leave, then on Daily Attendance:
// "allow me to search by name"): every word typed found in the person's English or Arabic name, or their code, whatever
// the case ("ahmed ali", "محمد", "EMP-0033"). Pure, tested; relative imports, as vitest doesn't know the @/ paths.

/** The longest search kept. */
export const SEARCH_MAX = 100;

/** A search from the address (?q=): its words, single-spaced, at most SEARCH_MAX characters; none when empty. */
export function searchOf(raw: string | string[] | undefined): string | undefined {
  const v = typeof raw === 'string' ? raw : '';
  const q = v.replace(/\s+/g, ' ').slice(0, SEARCH_MAX).trim();
  return q || undefined;
}

/** Whether a person has every word searched in their name (English or Arabic) or code. */
export function matchesSearch(person: { fullNameEn: string; fullNameAr?: string | null; employeeCode?: string | null }, q: string | undefined): boolean {
  const words = (q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = [person.fullNameEn, person.fullNameAr, person.employeeCode].filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => haystack.includes(w));
}
