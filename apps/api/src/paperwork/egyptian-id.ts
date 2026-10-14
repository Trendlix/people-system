import { isDateOnly, todayInCairo } from '../common/date-only.js';
import { birthDateFromNationalId } from '../employees/checks.js';
import { latinDigits, normalizeArabic } from './arabic-text.js';

// Reads the text of an Egyptian national ID card (بطاقة تحقيق الشخصية), as the OCR service returns it, into
// suggestions for the identity and profile forms. Only what is found with confidence is suggested; anything unclear
// is left out, and HR checks every value against the card before saving.
//
// Front: the header (جمهورية مصر العربية / بطاقة تحقيق الشخصية), the first name on one line and the rest of the
// name on the next, two address lines, then the 14-digit national ID; a small printed code may also appear.
// Back: the national ID again, profession, gender, religion, marital status, the issue date,
// "البطاقة سارية حتى <date>" (the expiry) and the civil registry office that issued it.
//
// A scan cut a little short (up to ~3 mm, often at the top) loses or cuts through a line. A line the top or bottom
// edge of the picture runs through reads as something else, as surely as a whole one (a cut number reads as another,
// well-formed number), so it is never used; and the name and address are then counted up from the national ID,
// never down from the edge of the picture. A field that can't be found that way stays empty: never another value.

export interface IdCardSuggestions {
  nationalId?: string;
  fullNameAr?: string;
  addressAr?: string;
  dateOfBirth?: string;
  gender?: 'male' | 'female';
  issueDate?: string;
  expiryDate?: string;
  printedNo?: string;
  issuingOffice?: string;
}

/** A date printed on the card, as YYYY-MM-DD; month-only dates (2020/07) are on the 1st. */
export interface CardDate {
  ymd: string;
  monthOnly: boolean;
}

// The front's header (جمهورية مصر العربية / بطاقة تحقيق الشخصية), normalised (see arabic-text.ts). A line holding two
// of its words together, or nothing else, is the header: one word alone is not, as in "شارع الجمهورية".
const HEADER_PHRASES = ['جمهوريه مصر', 'مصر العربيه', 'بطاقه تحقيق', 'تحقيق الشخصيه'];
const HEADER_WORDS = new Set(['جمهوريه', 'مصر', 'العربيه', 'بطاقه', 'تحقيق', 'الشخصيه']);

const LETTERS = /[ء-غف-ي]/g; // Arabic letters, without tatweel and diacritics
const ANY_DIGIT = /[0-9٠-٩۰-۹]/;
const DIGIT = /[0-9٠-٩۰-۹]/g;
const LATIN_LETTER = /[A-Za-z]/;
// a date: 2 or 3 numbers joined by / - or . (2025/7/11, 11-07-2025, 2020/07, 07/2020), not inside a longer number
const DATE = /(?<!\d)(\d{1,4})\s*[/\-.]\s*(\d{1,4})(?:\s*[/\-.]\s*(\d{1,4}))?(?!\d)/g;

/** A line read from one side of the card; `cut` when the top or bottom edge of the picture runs through it. */
export interface CardLine {
  text: string;
  cut?: boolean;
  /** How sure the reader was (0–1), when known. */
  confidence?: number;
  /** Where the line lies across the card, as shares of its width (0 = left edge), when known. */
  left?: number;
  right?: number;
}

// The front's calligraphic heading is drawn, not printed: the reader makes words of it, with little certainty (about
// 0.5, where printed lines read at 0.85 and above). Lines read with less certainty than this are not names or addresses.
const SURE = 0.6;
// The name and the address are printed on the right of the front; the photo, the date under it and the card's code are
// on the left. A line ending in the left part of the card is not part of them.
const RIGHT_PART = 0.55;

/** One side of the card as read: its text (no positions known), or its lines in reading order. */
export type CardSide = string | CardLine[] | null;

/** Everything the card's text gives, from the front, the back, or both (either may be missing). */
export function readIdCard(front: CardSide, back: CardSide, today = todayInCairo()): IdCardSuggestions {
  return readIdCardWithNotes(front, back, today).suggestions;
}

/** As readIdCard, with notes for HR about what was left out and why. */
export function readIdCardWithNotes(front: CardSide, back: CardSide, today = todayInCairo()): { suggestions: IdCardSuggestions; notes: string[] } {
  const frontAll = sideLines(front);
  const backAll = sideLines(back);
  // a line the edge of the picture cuts through is not used for anything
  const frontKept = frontAll.filter((l) => !l.cut);
  const frontLines = frontKept.map((l) => l.text);
  const backLines = backAll.filter((l) => !l.cut).map((l) => l.text);
  const topCut = frontAll.length > 0 && frontAll[0].cut === true;
  const out: IdCardSuggestions = {};
  const notes: string[] = [];

  const nationalId = pickNationalId(frontLines, backLines, today);
  if (nationalId) {
    out.nationalId = nationalId;
    out.dateOfBirth = birthDateFromNationalId(nationalId)!;
  } else if ([...frontAll, ...backAll].some((l) => l.cut && (l.text.match(DIGIT)?.length ?? 0) >= 12)) {
    notes.push(
      'The national ID number is at the edge of the picture, which cuts through it, so it was not taken. Type it in from the card, or scan the card again with some space around it.',
    );
  } else if ([...frontAll, ...backAll].some((l) => isNumberRow(l))) {
    // the number is there, but not all of it was read: the zeros on the card are small dots the reader can miss
    notes.push(
      'The national ID number could not be read completely: its zeros are printed as small dots, which the reader can miss. Type it in from the card.',
    );
  }
  Object.assign(out, readNameAndAddress(frontKept, topCut));

  const gender = readGender(backLines);
  if (gender) out.gender = gender;

  const expiry = readExpiry(backLines);
  if (expiry.date) out.expiryDate = expiry.date;
  const issueDate = readIssueDate(backLines, expiry.lines, out.expiryDate, out.dateOfBirth, today);
  if (issueDate) out.issueDate = issueDate;

  const office = readIssuingOffice(backLines);
  if (office) out.issuingOffice = office;

  const printedNo = only(unique([...frontLines, ...backLines].flatMap(printedCodesIn)));
  if (printedNo) out.printedNo = printedNo;
  return { suggestions: out, notes };
}

// ---------- national ID ----------

/**
 * The national IDs in a line: Arabic-Indic digits converted, groups split by spaces or dashes joined, and only
 * 14-digit numbers starting with 2 or 3 whose birth date is a real day, not in the future.
 */
export function nationalIdsIn(line: string, today = todayInCairo()): string[] {
  const found: string[] = [];
  for (const cluster of latinDigits(line).match(/\d+(?:[\s.-]+\d+)*/g) ?? []) {
    const groups = cluster.split(/[\s.-]+/);
    for (let i = 0; i < groups.length; i++) {
      let joined = '';
      for (let j = i; j < groups.length && joined.length < 14; j++) {
        joined += groups[j];
        if (joined.length === 14 && isNationalId(joined, today)) found.push(joined);
      }
    }
  }
  return unique(found);
}

function isNationalId(digits: string, today: string): boolean {
  const born = birthDateFromNationalId(digits);
  return born !== null && born <= today;
}

/** The ID both sides agree on, or the one side's only ID. Nothing when they disagree. */
function pickNationalId(front: string[], back: string[], today: string): string | undefined {
  const f = unique(front.flatMap((l) => nationalIdsIn(l, today)));
  const b = unique(back.flatMap((l) => nationalIdsIn(l, today)));
  const both = f.filter((id) => b.includes(id));
  if (both.length) return only(both);
  if (f.length && b.length) return undefined;
  return only(f.length ? f : b);
}

// ---------- front: name and address ----------

/**
 * The name (first name on one line, the rest on the next) and the address (two lines), read from the confident lines
 * on the right of the front. Counted up from the national ID's row whenever it is found, even when the number itself
 * was misread: the address is the two lines above it and the name the two above those — so a heading read as words,
 * or lines lost at the top, never shift the name into the address. Without that row, the name is the first two lines
 * (unless the top was cut) and the address unknown.
 */
function readNameAndAddress(all: CardLine[], topCut = false): Pick<IdCardSuggestions, 'fullNameAr' | 'addressAr'> {
  const anchor = numberRowIndex(all);
  const above = anchor >= 0 ? all.slice(0, anchor) : all;
  const block = above
    .filter((l) => (l.confidence ?? 1) >= SURE && (l.right ?? 1) >= RIGHT_PART && !isHeader(l.text) && letterCount(l.text) >= 2)
    .map((l) => l.text);
  const out: Pick<IdCardSuggestions, 'fullNameAr' | 'addressAr'> = {};

  if (anchor >= 0) {
    const address = block.length >= 2 ? addressOf(block.slice(-2)) : undefined;
    if (address) out.addressAr = address;
    const name = block.length >= 4 ? nameOf(block[block.length - 4], block[block.length - 3]) : undefined;
    if (name) out.fullNameAr = name;
    return out;
  }
  if (topCut) return out; // without the number to count from, lines lost above leave nothing certain
  const [first, rest] = block;
  const name = first && rest ? nameOf(first, rest) : undefined;
  if (name) out.fullNameAr = name;
  return out;
}

/** A row holding a long number and no words: the national ID's row, read in full or not. */
function isNumberRow(line: CardLine): boolean {
  return (line.text.match(DIGIT)?.length ?? 0) >= 8 && letterCount(line.text) === 0 && !LATIN_LETTER.test(line.text) && (line.right ?? 1) >= RIGHT_PART;
}

/** Where the national ID's row is among the front's lines: the row with the most digits; -1 when there is none. */
function numberRowIndex(lines: CardLine[]): number {
  let best = -1;
  let most = 0;
  lines.forEach((l, i) => {
    const digits = l.text.match(DIGIT)?.length ?? 0;
    if (isNumberRow(l) && digits >= most) [best, most] = [i, digits];
  });
  return best;
}

/** The full name from its two lines, when both are name lines and it has 3 to 8 words. */
function nameOf(first: string, rest: string): string | undefined {
  if (!isNameLine(first) || !isNameLine(rest)) return undefined;
  const name = `${lettersOnly(first)} ${lettersOnly(rest)}`;
  const words = name.split(' ').length;
  return words >= 3 && words <= 8 ? name : undefined;
}

/** One to three address lines, joined with "، ". */
function addressOf(lines: string[]): string | undefined {
  const address = lines.filter((l) => !LATIN_LETTER.test(l)).map(addressText).filter(Boolean);
  return address.length >= 1 && address.length <= 3 ? address.join('، ') : undefined;
}

function isHeader(line: string): boolean {
  const text = normalizeArabic(lettersOnly(line));
  return HEADER_PHRASES.some((p) => text.includes(p)) || (text !== '' && text.split(' ').every((w) => HEADER_WORDS.has(w)));
}

/** A line of a name: Arabic words only (stray marks aside), no digits or Latin letters, at most five words. */
function isNameLine(line: string): boolean {
  if (ANY_DIGIT.test(line) || LATIN_LETTER.test(line)) return false;
  const words = lettersOnly(line).split(' ').filter(Boolean);
  return words.length >= 1 && words.length <= 5;
}

/** Arabic letters and single spaces only; Persian forms of ي and ك become the Arabic ones. */
function lettersOnly(line: string): string {
  return line
    .replace(/ی/g, 'ي')
    .replace(/ک/g, 'ك')
    .replace(/[^ء-غف-ي\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** An address line as printed, without OCR noise: letters, digits, spaces and - / . , ، only. */
function addressText(line: string): string {
  return line
    .replace(/ی/g, 'ي')
    .replace(/ک/g, 'ك')
    .replace(/[^ء-غف-ي0-9٠-٩۰-۹\s\-/.,،]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-/.,،]+|[\s\-/.,،]+$/g, '');
}

function letterCount(line: string): number {
  return line.match(LETTERS)?.length ?? 0;
}

// ---------- back: gender, dates, issuing office ----------

/** ذكر → male, أنثى → female; only from the words on the card, never from the ID digits. */
function readGender(lines: string[]): 'male' | 'female' | undefined {
  const text = normalizeArabic(lines.join('\n'));
  const male = hasWord(text, 'ذكر');
  const female = hasWord(text, 'انثي');
  if (male === female) return undefined;
  return male ? 'male' : 'female';
}

function hasWord(text: string, word: string): boolean {
  return new RegExp(`(^|[^\\u0621-\\u064a])${word}($|[^\\u0621-\\u064a])`).test(text);
}

/** The date after "البطاقة سارية حتى", on the same line or (a full date only) on the next. */
function readExpiry(lines: string[]): { date?: string; lines: number[] } {
  const at = lines.findIndex((l) => normalizeArabic(l).includes('ساريه'));
  if (at < 0) return { lines: [] };
  const valid = (d: CardDate) => d.ymd >= '2000-01-01';
  // the reader sometimes drops the slashes: 2030/12/01 comes back as 20301201
  const same = [...datesIn(lines[at]), ...compactDatesIn(lines[at], 8)].filter(valid);
  if (same.length) return { date: (same.find((d) => !d.monthOnly) ?? same[0]).ymd, lines: [at] };
  const next = datesIn(lines[at + 1] ?? '').filter((d) => valid(d) && !d.monthOnly);
  if (next.length) return { date: next[0].ymd, lines: [at, at + 1] };
  return { lines: [at] };
}

/**
 * The issue date: the one other date on the back (usually month and year, e.g. 2020/07), in the past and before the
 * expiry. Nothing when there are several.
 */
function readIssueDate(
  lines: string[],
  expiryLines: number[],
  expiry: string | undefined,
  born: string | undefined,
  today: string,
): string | undefined {
  const dates = lines
    .flatMap((l, i) => (expiryLines.includes(i) ? [] : [...datesIn(l), ...compactDatesIn(l, 6)]))
    .filter((d) => d.ymd >= '1990-01-01' && d.ymd <= today && d.ymd !== born && (!expiry || d.ymd < expiry));
  const months = unique(dates.filter((d) => d.monthOnly).map((d) => d.ymd));
  if (months.length) return only(months);
  return only(unique(dates.map((d) => d.ymd)));
}

/** The line naming the civil registry office (سجل مدني …), from those words on, without dates or numbers. */
function readIssuingOffice(lines: string[]): string | undefined {
  const line = lines.find((l) => normalizeArabic(l).includes('سجل مدني'));
  if (!line) return undefined;
  const text = addressText(line.replace(DATE, ' ').replace(DIGIT, ' ').replace(/[A-Za-z]+/g, ' '));
  const from = text.indexOf('سجل');
  const office = from >= 0 ? addressText(text.slice(from)) : '';
  return office.split(' ').length >= 3 ? office : undefined;
}

/** A printed card code: two capital Latin letters and seven digits (e.g. FA1234567). */
function printedCodesIn(line: string): string[] {
  return [...latinDigits(line).matchAll(/(?<![A-Za-z0-9])([A-Z]{2}) ?(\d{7})(?![A-Za-z0-9])/g)].map((m) => m[1] + m[2]);
}

// ---------- dates ----------

/** The dates in a line: YYYY/MM/DD, DD/MM/YYYY, YYYY/MM or MM/YYYY, in any digits, with / - or . between. */
export function datesIn(line: string): CardDate[] {
  const out: CardDate[] = [];
  for (const m of latinDigits(line).matchAll(DATE)) {
    const date = cardDate(m.slice(1).filter((p): p is string => p !== undefined));
    if (date) out.push(date);
  }
  return out;
}

function cardDate(parts: string[]): CardDate | null {
  const pad = (n: string) => n.padStart(2, '0');
  const lengths = parts.map((p) => (p.length === 4 ? 'Y' : p.length <= 2 ? 'n' : '?')).join('');
  let ymd: string;
  let monthOnly = false;
  if (lengths === 'Ynn') ymd = `${parts[0]}-${pad(parts[1])}-${pad(parts[2])}`;
  else if (lengths === 'nnY') ymd = `${parts[2]}-${pad(parts[1])}-${pad(parts[0])}`;
  else if (lengths === 'Yn') [ymd, monthOnly] = [`${parts[0]}-${pad(parts[1])}-01`, true];
  else if (lengths === 'nY') [ymd, monthOnly] = [`${parts[1]}-${pad(parts[0])}-01`, true];
  else return null;
  const year = Number(ymd.slice(0, 4));
  return year >= 1900 && year <= 2100 && isDateOnly(ymd) ? { ymd, monthOnly } : null;
}

/**
 * Dates read without their slashes, as a group of digits on its own: 8 digits as YYYYMMDD (or DDMMYYYY), 6 as YYYYMM
 * (or MMYYYY), month-only on the 1st. A group of any other length is not taken for a date.
 */
function compactDatesIn(line: string, length: 6 | 8): CardDate[] {
  const out: CardDate[] = [];
  for (const [group] of latinDigits(line).matchAll(/(?<!\d)\d+(?!\d)/g)) {
    if (group.length !== length) continue;
    const parts = length === 8 ? [[group.slice(0, 4), group.slice(4, 6), group.slice(6)], [group.slice(0, 2), group.slice(2, 4), group.slice(4)]] : [[group.slice(0, 4), group.slice(4)], [group.slice(0, 2), group.slice(2)]];
    for (const p of parts) {
      const date = cardDate(p);
      if (date) out.push(date);
    }
  }
  return out;
}

// ---------- helpers ----------

function sideLines(side: CardSide): CardLine[] {
  if (Array.isArray(side)) return side.map((l) => ({ ...l, text: l.text.trim(), cut: l.cut === true })).filter((l) => l.text);
  return (side ?? '')
    .split(/\r?\n/)
    .map((l) => ({ text: l.trim(), cut: false }))
    .filter((l) => l.text);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/** The value when there is exactly one. */
function only<T>(values: T[]): T | undefined {
  return values.length === 1 ? values[0] : undefined;
}
