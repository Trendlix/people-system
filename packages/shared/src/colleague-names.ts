// Colleagues by their display names (owner, 31 October 2026: "for employees, make them see their coleagues display names,
// not full names - in any part or process in app and website"). An employee (any account without HR, Finance, the CEO,
// Admin or the Super Admin among its roles; a manager too) sees every other person by their display name: the profile's
// Display name when HR set one ("Hazem Magdy"), else the first two names of the full name, a particle kept with the
// name after it ("Mohamed Al Araby", "Salma Ahmed", "عبد الرحمن محمد"); in Arabic the first two names of the Arabic full
// name. Their own name stays as it is. The API swaps every colleague's full name in its answers for the display name,
// in English and in Arabic, wherever it is (a name field, a list, a notification's text), and the phone pushes the same
// (apps/api colleague-names.interceptor.ts, notifications.service.ts); HR, Finance, the CEO, Admin and the Super Admin
// see full names as before. Pure.

/** The roles that see people's full names. */
export const FULL_NAME_ROLES = ['hr', 'finance', 'ceo', 'admin', 'super_admin'] as const;

/** Whether an account with these roles sees people's full names (else colleagues' display names). */
export const seesFullNames = (roles: readonly string[]): boolean => roles.some((r) => (FULL_NAME_ROLES as readonly string[]).includes(r));

/** Words that belong with the name after them: "Abdel Aziz", "Al Araby", "Abd El Rahman", "عبد العزيز", "أبو بكر". */
const PARTICLES = new Set(['al', 'el', 'abd', 'abdel', 'abdal', 'abdul', 'abdol', 'abo', 'abu', 'abou', 'bin', 'ben', 'عبد', 'أبو', 'ابو', 'بن', 'ال']);
/** Words that belong with the name before them: "Nour Eldin", "Salah El Din", "نور الدين", "عبد الله". */
const SUFFIXES = new Set(['eldin', 'eddin', 'eldeen', 'el-din', 'din', 'deen', 'dein', 'allah', 'الدين', 'الله']);

/**
 * The short name of a full name: its first two names, each with a particle before it joined to it and an "El Din"
 * after it. "Mohamed Hassan Mohamed Hassan Elagah" → "Mohamed Hassan"; "Mohamed Al Araby Mohamed Ali" → "Mohamed Al
 * Araby"; "Abdel Rahman Ali Saad" → "Abdel Rahman Ali"; "Nour El Din Samir Adel" → "Nour El Din Samir"; a name of two
 * words or fewer as it is.
 */
export function shortName(full: string): string {
  const words = full.trim().split(/\s+/).filter(Boolean);
  const low = (i: number) => (words[i] ?? '').toLowerCase();
  const names: string[] = [];
  let i = 0;
  while (names.length < 2 && i < words.length) {
    let name = words[i++];
    while (PARTICLES.has(name.split(' ').at(-1)!.toLowerCase()) && i < words.length) name += ` ${words[i++]}`;
    // "El Din", "Al Allah" after it, as two words or one
    if ((low(i) === 'el' || low(i) === 'al') && SUFFIXES.has(low(i + 1))) name += ` ${words[i++]} ${words[i++]}`;
    else if (SUFFIXES.has(low(i))) name += ` ${words[i++]}`;
    names.push(name);
  }
  return names.join(' ');
}

/** A person as these rules read them. */
export interface NamedPerson {
  id: string;
  fullNameEn: string;
  fullNameAr?: string | null;
  /** The profile's Display name ("Hazem Magdy"); null or empty: the short name of the full name. */
  displayName?: string | null;
}

/** A person's display names: English, and Arabic (null without an Arabic full name). */
export function displayNamesOf(p: NamedPerson): { en: string; ar: string | null } {
  const ar = p.fullNameAr?.trim() ? shortName(p.fullNameAr) : null;
  return { en: p.displayName?.trim() || shortName(p.fullNameEn), ar };
}

const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const spaced = (s: string) => s.trim().replace(/\s+/g, ' ');

/**
 * What swaps colleagues' full names for their display names in a text, for the person `selfId` (their own name stays):
 * each full name, English or Arabic, as a whole name (not inside a longer word), the longest first, so a full name that
 * begins another isn't swapped inside it. Two people with the same full name: the first's display name.
 */
export function colleagueNameSwap(people: readonly NamedPerson[], selfId: string | null | undefined): (text: string) => string {
  const swaps = new Map<string, string>();
  const add = (full: string | null | undefined, shown: string | null) => {
    const key = full ? spaced(full) : '';
    if (key && shown && key !== shown && !swaps.has(key)) swaps.set(key, shown);
  };
  for (const p of people) {
    if (p.id === selfId) continue;
    const shown = displayNamesOf(p);
    add(p.fullNameEn, shown.en);
    add(p.fullNameAr, shown.ar);
  }
  if (!swaps.size) return (text) => text;
  const names = [...swaps.keys()].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${names.map(escaped).join('|')})(?![\\p{L}\\p{N}])`, 'gu');
  return (text) => (text.length < 3 ? text : text.replace(pattern, (m) => swaps.get(m) ?? m));
}

/** Whether a value is a plain object (from JSON or an object literal), to walk; anything else is left as it is. */
const plain = (v: object) => {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/** An answer with every text in it swapped by `swap` (colleagueNameSwap): its strings, in arrays and plain objects at any depth. */
export function withColleagueNames(body: unknown, swap: (text: string) => string): unknown {
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return swap(value);
    if (Array.isArray(value)) return value.map(walk);
    if (value === null || typeof value !== 'object' || !plain(value)) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = walk(v);
    return out;
  };
  return walk(body);
}
