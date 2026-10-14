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

/** Everything the card's text gives, from the front, the back, or both (either may be missing). */
export function readIdCard(front: string | null, back: string | null, today = todayInCairo()): IdCardSuggestions {
  const frontLines = linesOf(front);
  const backLines = linesOf(back);
  const out: IdCardSuggestions = {};

  const nationalId = pickNationalId(frontLines, backLines, today);
  if (nationalId) {
    out.nationalId = nationalId;
    out.dateOfBirth = birthDateFromNationalId(nationalId)!;
  }
  Object.assign(out, readNameAndAddress(frontLines));

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
  return out;
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

function readNameAndAddress(lines: string[]): Pick<IdCardSuggestions, 'fullNameAr' | 'addressAr'> {
  // The national ID ends the name and address block; the printed code and header are not part of it.
  const idLine = lines.findIndex((l) => (l.match(DIGIT)?.length ?? 0) >= 12);
  const block = (idLine >= 0 ? lines.slice(0, idLine) : lines).filter((l) => !isHeader(l) && letterCount(l) >= 2);
  const [first, rest] = block;
  if (!first || !rest || !isNameLine(first) || !isNameLine(rest)) return {};

  const out: Pick<IdCardSuggestions, 'fullNameAr' | 'addressAr'> = {};
  const name = `${lettersOnly(first)} ${lettersOnly(rest)}`;
  const words = name.split(' ').length;
  if (words >= 3 && words <= 8) out.fullNameAr = name;

  // the address lines lie between the name and the national ID; without the ID their end is unknown
  if (idLine >= 0) {
    const address = block.slice(2).filter((l) => !LATIN_LETTER.test(l)).map(addressText).filter(Boolean);
    if (address.length >= 1 && address.length <= 3) out.addressAr = address.join('، ');
  }
  return out;
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
  const same = datesIn(lines[at]).filter(valid);
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
    .flatMap((l, i) => (expiryLines.includes(i) ? [] : datesIn(l)))
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

// ---------- helpers ----------

function linesOf(text: string | null): string[] {
  return (text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/** The value when there is exactly one. */
function only<T>(values: T[]): T | undefined {
  return values.length === 1 ? values[0] : undefined;
}
