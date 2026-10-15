// Every date on screen is DD/MM/YYYY and every time is 12-hour, e.g. 9:00 AM (owner's decision, 14 October 2026).
// The API sends and accepts dates as YYYY-MM-DD and times as HH:mm (24-hour); these helpers convert for display and entry.
// Moments (created at, updated at) are shown in Cairo time.

const ZONE = 'Africa/Cairo';
const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-10-14" or an ISO moment or a Date → "14/10/2026". Empty input → "". */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-');
    return `${d}/${m}/${y}`;
  }
  const parts = cairoParts(new Date(value));
  return parts ? `${parts.day}/${parts.month}/${parts.year}` : '';
}

/** "09:00" → "9:00 AM", "18:30" → "6:30 PM". Empty input → "". */
export function formatTime(hhmm: string | null | undefined): string {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
}

/** An ISO moment → "14/10/2026, 5:42 PM" in Cairo time. */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '';
  const parts = cairoParts(new Date(value));
  return parts ? `${parts.day}/${parts.month}/${parts.year}, ${formatTime(`${parts.hour}:${parts.minute}`)}` : '';
}

/**
 * What a person typed as a date → "YYYY-MM-DD". Accepts DD/MM/YYYY, also with "-" or "." and single digits
 * (1/2/2026). Returns "" for an empty field and null for anything that is not a real date.
 */
export function parseDate(input: string): string | null {
  const s = toLatinDigits(input).trim();
  if (s === '') return '';
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * What a person typed as a time → "HH:mm" (24-hour). Accepts "9:00 AM", "9 am", "09:30pm", "12:15 PM", and also
 * 24-hour "18:00". Returns "" for an empty field and null for anything else.
 */
export function parseTime(input: string): string | null {
  const s = toLatinDigits(input).trim().toLowerCase().replace(/\s+/g, ' ');
  if (s === '') return '';
  const m = /^(\d{1,2})(?::(\d{2}))? ?(am|pm|a\.m\.|p\.m\.)?$/.exec(s);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] === undefined ? 0 : Number(m[2]);
  const suffix = m[3]?.replace(/\./g, '');
  if (minute > 59) return null;
  if (suffix) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (suffix === 'pm' ? 12 : 0);
  } else if (m[2] === undefined || hour > 23) {
    return null; // "9" alone is ambiguous: ask for AM or PM
  }
  return `${pad(hour)}:${pad(minute)}`;
}

/** Arabic-Indic digits (٠-٩) typed on an Arabic keyboard become 0-9. */
function toLatinDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

function cairoParts(date: Date) {
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute };
}

/** Short words kept in lower case inside a title (not the first word). */
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'per', 'the', 'to', 'vs', 'with']);

/**
 * A name as a title or heading shows it, in Title Case (the screens' rule: titles and headings in Title Case, labels and
 * buttons in sentence case): "Social insurance print" → "Social Insurance Print". Words with capitals already (ID,
 * EGP) and words in Arabic are left as they are.
 */
export function titleCase(text: string): string {
  let first = true;
  // a hyphenated word is one word: only its first letter changes ("Full-time")
  return text.replace(/[A-Za-z][\w'’]*(?:-[A-Za-z][\w'’]*)*/g, (word, offset: number) => {
    const isFirst = first;
    first = false;
    // after an opening bracket or a dash between words a word starts afresh, e.g. "(Front and Back)"
    const starts = isFirst || /(?:[(–—:]|\s-)\s*$/.test(text.slice(0, offset));
    if (word !== word.toLowerCase()) return word;
    if (!starts && SMALL_WORDS.has(word)) return word;
    return word[0].toUpperCase() + word.slice(1);
  });
}
