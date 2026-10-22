// A CV read and analysed by simple rules (owner, 22 October 2026: "make the OCR egine reads the CV and analyse it. is
// that applicable?"; asked, "Built-in rules only": no AI). Its text (a PDF's own, a scan's through the OCR service, a
// Word file's) is looked through for:
// - its contacts: emails, phones (Egyptian and international), LinkedIn and portfolio links;
// - the years of experience, estimated from the date ranges in it ("Jan 2019 – Mar 2022", "2018 - Present", "٢٠٢٠ -
//   الآن"), overlaps merged, the education's left out where a heading or the line says so;
// - the highest education level named (doctorate > master > bachelor > diploma > high school);
// - the languages named (in a "Languages" section when it has one);
// - a vacancy's key skills, each found or not: whole words, any case, any punctuation ("Premiere Pro" is found in
//   "Adobe Premiere Pro" and "premiere-pro"), Arabic too. The CV match % is those found ÷ those listed.
// What they find is a hint for HR, never a decision: the stage and "filtered out" stay the screening questions'.
// Pure code, tested in apps/api/src/common/cv-analysis.spec.ts.

// ---------- the reading ----------

export const CV_READING_STATUSES = ['pending', 'read', 'no_text', 'failed'] as const;
export type CvReadingStatus = (typeof CV_READING_STATUSES)[number];

export const CV_READING_STATUS_LABELS: Record<CvReadingStatus, string> = {
  pending: 'Reading the CV…',
  read: 'Read',
  no_text: 'No text found in the CV',
  failed: 'The CV could not be read',
};

export const CV_READING_METHODS = ['pdf', 'docx', 'ocr_en', 'ocr_ar'] as const;
export type CvReadingMethod = (typeof CV_READING_METHODS)[number];

export const CV_READING_METHOD_LABELS: Record<CvReadingMethod, string> = {
  pdf: 'The PDF’s own text',
  docx: 'The Word file’s text',
  ocr_en: 'Read from the scan (English)',
  ocr_ar: 'Read from the scan (Arabic)',
};

export const CV_READING_LIMITS = {
  /** The text kept, in characters. */
  chars: 60_000,
  /** A PDF's pages read for its own text. */
  pdfPages: 5,
  /** Under this many letters and digits, a PDF's own text is a scan's: the OCR service reads it. */
  minTextChars: 50,
  /** Tries before a reading is given up as failed. */
  attempts: 3,
} as const;

// ---------- the vacancy's key skills ----------

export const KEY_SKILLS_LIMITS = { max: 20, length: 60 } as const;

/**
 * Key skills as typed: a list, or text with commas or new lines; each trimmed and single-spaced, empty ones dropped,
 * and a skill typed twice (any case) kept once, in the order typed.
 */
export function keySkillsOf(input: unknown): string[] {
  const parts = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[,،\n]/) : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const skill = typeof p === 'string' ? p.trim().replace(/\s+/g, ' ') : '';
    const key = skill.toLowerCase();
    if (!skill || seen.has(key)) continue;
    seen.add(key);
    out.push(skill);
  }
  return out;
}

/** What is wrong with a vacancy's key skills, in words (none: they may be saved). */
export function keySkillsProblems(skills: readonly string[]): string[] {
  const L = KEY_SKILLS_LIMITS;
  const problems: string[] = [];
  if (skills.length > L.max) problems.push(`List at most ${L.max} key skills.`);
  const long = skills.find((s) => s.length > L.length);
  if (long) problems.push(`Keep each key skill to ${L.length} characters or fewer ("${long.slice(0, 20)}…").`);
  if (skills.some((s) => !normalForMatch(s))) problems.push('Each key skill needs letters or digits.');
  return problems;
}

// ---------- normalising ----------

const ARABIC_DIGITS = /[٠-٩]/g;
const PERSIAN_DIGITS = /[۰-۹]/g;

/** Arabic-Indic and Persian digits as 0-9, the compatibility forms (full-width letters) as plain ones. */
function plainDigits(text: string): string {
  return text
    .normalize('NFKC')
    .replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(PERSIAN_DIGITS, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** Arabic as compared: alef forms as ا, taa marbuta as ه, alef maqsura as ي, without tatweel and diacritics. */
function plainArabic(text: string): string {
  return text
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');
}

/** Skills written with signs, kept apart from a lone letter: C++, C#, F#, .NET. */
const SIGNED: [RegExp, string][] = [
  [/c\+\+/g, ' cplusplus '],
  [/c#/g, ' csharp '],
  [/f#/g, ' fsharp '],
  [/\.net\b/g, ' dotnet '],
];

/** A text as skills are matched in it: lower case, plain digits and Arabic, words separated by single spaces. */
function normalForMatch(text: string): string {
  let t = plainArabic(plainDigits(text).toLowerCase());
  for (const [re, word] of SIGNED) t = t.replace(re, word);
  return t
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// ---------- the key skills found ----------

/** Which of the key skills the text names (whole words, any case and punctuation), and which not, each in its order. */
export function cvSkillsFound(text: string, skills: readonly string[]): { found: string[]; missing: string[] } {
  const hay = ` ${normalForMatch(text)} `;
  const found: string[] = [];
  const missing: string[] = [];
  for (const skill of skills) {
    const needle = normalForMatch(skill);
    if (needle && hay.includes(` ${needle} `)) found.push(skill);
    else missing.push(skill);
  }
  return { found, missing };
}

/** The CV match %: the key skills found ÷ those listed, rounded; null when none are listed. */
export const cvMatchPercent = (found: number, listed: number): number | null => (listed > 0 ? Math.round((found / listed) * 100) : null);

// ---------- what the CV says ----------

export const EDUCATION_LEVELS = ['high_school', 'diploma', 'bachelor', 'master', 'doctorate'] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];

export const EDUCATION_LEVEL_LABELS: Record<EducationLevel, string> = {
  high_school: 'High school',
  diploma: 'Diploma',
  bachelor: 'Bachelor',
  master: 'Master',
  doctorate: 'Doctorate',
};

/** What the rules found in a CV's text. */
export interface CvFacts {
  emails: string[];
  phones: string[];
  linkedin: string | null;
  /** Other links: portfolios (Behance, Dribbble, GitHub, Vimeo, YouTube …) and websites. */
  links: string[];
  /** The months of experience the date ranges add up to (overlaps merged); null when it has none. */
  experienceMonths: number | null;
  education: EducationLevel | null;
  languages: string[];
}

/** "About 4 years (from the dates in the CV)"; null without dates. */
export function experienceText(months: number | null): string | null {
  if (months === null) return null;
  if (months < 12) return 'Less than a year (from the dates in the CV)';
  const years = Math.round(months / 12);
  return `About ${years} ${years === 1 ? 'year' : 'years'} (from the dates in the CV)`;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function emailsOf(text: string): string[] {
  return unique((text.match(EMAIL) ?? []).map((e) => e.toLowerCase().replace(/\.+$/, ''))).slice(0, 5);
}

/** A phone as kept: + and its digits (an Egyptian one with +20). */
function phoneOf(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, '');
  const plus = digits.startsWith('+') || digits.startsWith('00');
  const d = digits.replace(/^\+|^00/, '').replace(/\+/g, '');
  if (!plus && /^01[0125]\d{8}$/.test(d)) return `+2${d}`;
  if (plus && /^201[0125]\d{8}$/.test(d)) return `+${d}`;
  if (plus && d.length >= 8 && d.length <= 15 && !/^20/.test(d)) return `+${d}`;
  if (plus && /^20\d{8,10}$/.test(d)) return `+${d}`;
  return null;
}

function phonesOf(text: string): string[] {
  const candidates = text.match(/(?:\+|00)?\d[\d\s().-]{6,18}\d/g) ?? [];
  return unique(candidates.map(phoneOf).filter((p): p is string => !!p)).slice(0, 5);
}

const URL_LIKE = /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[^\s,;)>"']*)?/gi;

function linksOf(text: string, emails: readonly string[]): { linkedin: string | null; links: string[] } {
  const domains = new Set(emails.map((e) => e.split('@')[1]));
  let linkedin: string | null = null;
  const links: string[] = [];
  for (const raw of text.match(URL_LIKE) ?? []) {
    const link = raw.replace(/[.)]+$/, '');
    const bare = link.replace(/^https?:\/\//i, '').replace(/^www\./i, '').toLowerCase();
    const host = bare.split('/')[0];
    if (domains.has(host) || /^\d/.test(host) || !/[a-z]/.test(host)) continue;
    // a file name or a word with a dot is not a link: a known site, a path, or http(s):// it must have
    if (!/^https?:\/\//i.test(link) && !link.includes('/') && !/^www\./i.test(link) && !KNOWN_SITES.test(host)) continue;
    const whole = /^https?:\/\//i.test(link) ? link : `https://${link}`;
    if (/(^|\.)linkedin\.com$/.test(host)) {
      if (!linkedin && /\/in\//i.test(bare)) linkedin = whole;
      continue;
    }
    if (!links.includes(whole)) links.push(whole);
  }
  return { linkedin, links: links.slice(0, 5) };
}

const KNOWN_SITES = /(^|\.)(behance\.net|dribbble\.com|github\.com|gitlab\.com|vimeo\.com|youtube\.com|youtu\.be|instagram\.com|artstation\.com|notion\.site|wixsite\.com|medium\.com|linkedin\.com)$/;

// ---------- the years ----------

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  // Arabic, as Egypt names them, and the Levant's
  يناير: 1, فبراير: 2, مارس: 3, ابريل: 4, مايو: 5, يونيو: 6, يوليو: 7, اغسطس: 8, سبتمبر: 9, اكتوبر: 10, نوفمبر: 11, ديسمبر: 12,
  'كانون الثاني': 1, شباط: 2, اذار: 3, نيسان: 4, ايار: 5, حزيران: 6, تموز: 7, اب: 8, ايلول: 9, 'تشرين الاول': 10, 'تشرين الثاني': 11, 'كانون الاول': 12,
};

const MONTH_WORDS = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join('|');

/** A point in time as written: "Jan 2019", "01/2019", "2019/01", "2019". */
const POINT = `(?:(?:(${MONTH_WORDS})\\.?,?\\s*(\\d{4}))|(?:(\\d{1,2})\\s*[/.-]\\s*(\\d{4}))|(?:(\\d{4})\\s*[/.-]\\s*(\\d{1,2})(?!\\d))|(\\d{4}))`;
const NOW_WORDS = 'present|current|currently|now|today|to date|till date|ongoing|حتي الان|الي الان|حتي الآن|الي الآن|الان|الآن|حاليا|حاليًا|للان';
const RANGE = new RegExp(`${POINT}\\s*(?:-|–|—|to|till|until|through|الي|حتي|ـ)\\s*(?:${POINT}|(${NOW_WORDS}))`, 'giu');

/** The end of a word, in any script (\b knows only Latin letters). */
const END = '(?=$|[^\\p{L}\\p{N}])';
const heading = (words: string) => new RegExp(`^(?:${words})${END}`, 'iu');

const EDUCATION_HEADING = heading('education|academic|qualifications?|studies|certifications?|courses|training|التعليم|المؤهلات|المؤهل|المؤهل الدراسي|الدراسه|الشهادات|الدورات');
const WORK_HEADING = heading('experience|work experience|professional experience|employment|work history|career|الخبرات|الخبره|الخبره العمليه|الخبرات العمليه|الوظائف السابقه');
const OTHER_HEADING = heading('skills|languages|projects|references|interests|summary|profile|المهارات|اللغات|المشاريع');
const EDUCATION_LINE = /\b(?:university|faculty|college|school|bachelor|b\.?sc|b\.?a\b|master|m\.?sc|mba|phd|diploma|graduat\w*|degree)\b|جامعه|كليه|مدرسه|بكالوريوس|ليسانس|ماجستير|دكتوراه|دبلوم|تخرج/i;

/** A point as a month count (year × 12 + month − 1); `end`: a year alone stands for its start month too (2018 – 2020 is 2 years). */
function monthOf(m: RegExpExecArray, at: number): number | null {
  const [mw, y1, mn, y2, y3, mn3, y4] = m.slice(at, at + 7);
  let year: number;
  let month = 1;
  if (mw && y1) {
    year = Number(y1);
    month = MONTHS[mw.toLowerCase()] ?? 1;
  } else if (mn && y2) {
    year = Number(y2);
    month = Number(mn);
  } else if (y3 && mn3) {
    year = Number(y3);
    month = Number(mn3);
  } else if (y4) {
    year = Number(y4);
  } else return null;
  if (month < 1 || month > 12) return null;
  return year * 12 + month - 1;
}

/** The months of experience the CV's date ranges add up to, overlaps merged; null without any. */
export function experienceMonths(text: string, now: Date = new Date()): number | null {
  const current = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const lines = plainArabic(plainDigits(text)).split(/\n+/);
  const ranges: [number, number][] = [];
  let section: 'work' | 'education' | 'other' | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    const heading = line.replace(/[:：\-–—]+$/, '').trim();
    if (heading.length <= 40) {
      if (EDUCATION_HEADING.test(heading)) section = 'education';
      else if (WORK_HEADING.test(heading)) section = 'work';
      else if (OTHER_HEADING.test(heading)) section = 'other';
    }
    if (section === 'education' || EDUCATION_LINE.test(line)) continue;
    RANGE.lastIndex = 0;
    for (let m = RANGE.exec(line); m; m = RANGE.exec(line)) {
      const start = monthOf(m, 1);
      const end = m[15] ? current : monthOf(m, 8);
      if (start === null || end === null) continue;
      const startYear = Math.floor(start / 12);
      if (startYear < 1960 || end > current + 1 || end < start || end - start > 50 * 12) continue;
      ranges.push([start, Math.min(end, current)]);
    }
  }
  if (!ranges.length) return null;
  ranges.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [s, e] = ranges[0];
  for (const [rs, re] of ranges.slice(1)) {
    if (rs <= e) e = Math.max(e, re);
    else {
      total += e - s;
      [s, e] = [rs, re];
    }
  }
  total += e - s;
  return Math.min(total, 50 * 12);
}

// ---------- education and languages ----------

const EDUCATION_RULES: [EducationLevel, RegExp][] = [
  ['doctorate', /\b(ph\.?\s?d|doctorate|doctor of philosophy|dba)\b|دكتوراه/i],
  ['master', /\b(master'?s?|m\.?\s?sc|mba|m\.?\s?eng|m\.?a\.(?=\s)|ma in)\b|ماجستير/i],
  ['bachelor', /\b(bachelor'?s?|b\.?\s?sc|b\.?\s?eng|b\.?\s?com|bcom|llb|b\.a\.(?=\s)|ba in|ba of|undergraduate degree)\b|بكالوريوس|ليسانس/i],
  ['diploma', /\b(diploma|associate degree)\b|دبلوم/i],
  ['high_school', /\b(high school|secondary school|secondary education|thanaweya)\b|ثانويه|الثانويه العامه/i],
];

/** The highest education level the CV names; null when none. */
export function educationLevel(text: string): EducationLevel | null {
  const t = plainArabic(text);
  for (const [level, re] of EDUCATION_RULES) if (re.test(t)) return level;
  return null;
}

const LANGUAGES: [string, RegExp][] = [
  ['English', /\benglish\b|الانجليزيه|انجليزي|الانكليزيه/i],
  ['Arabic', /\barabic\b|العربيه|عربي/i],
  ['French', /\bfrench\b|الفرنسيه|فرنسي/i],
  ['German', /\bgerman\b|الالمانيه|الماني/i],
  ['Spanish', /\bspanish\b|الاسبانيه|اسباني/i],
  ['Italian', /\bitalian\b|الايطاليه|ايطالي/i],
  ['Russian', /\brussian\b|الروسيه/i],
  ['Turkish', /\bturkish\b|التركيه/i],
  ['Chinese', /\b(chinese|mandarin)\b|الصينيه/i],
  ['Japanese', /\bjapanese\b|اليابانيه/i],
  ['Korean', /\bkorean\b|الكوريه/i],
  ['Portuguese', /\bportuguese\b|البرتغاليه/i],
  ['Dutch', /\bdutch\b|الهولنديه/i],
  ['Hindi', /\bhindi\b|الهنديه/i],
  ['Urdu', /\burdu\b|الارديه/i],
  ['Persian', /\b(persian|farsi)\b|الفارسيه/i],
  ['Hebrew', /\bhebrew\b|العبريه/i],
];

const LANGUAGES_HEADING = heading('languages?|language skills|اللغات|اللغه');

/** The languages the CV names: within its "Languages" section when it has one, else anywhere. */
export function languagesOf(text: string): string[] {
  const lines = plainArabic(text).split(/\n+/).map((l) => l.trim());
  const at = lines.findIndex((l) => l.length <= 40 && LANGUAGES_HEADING.test(l.replace(/[:：\-–—]+$/, '').trim()));
  let scope = lines.join('\n');
  if (at >= 0) {
    const rest: string[] = [];
    for (const line of lines.slice(at + 1)) {
      if (line.length <= 40 && (EDUCATION_HEADING.test(line) || WORK_HEADING.test(line) || OTHER_HEADING.test(line))) break;
      rest.push(line);
    }
    // the heading's own line may name them too ("Languages: English, Arabic")
    scope = [lines[at], ...rest].join('\n');
  }
  return LANGUAGES.filter(([, re]) => re.test(scope)).map(([name]) => name);
}

// ---------- all of it ----------

/** What the rules find in a CV's text (`now`: the month "present" means). */
export function cvFacts(text: string, now: Date = new Date()): CvFacts {
  const plain = plainDigits(text);
  const emails = emailsOf(plain);
  const { linkedin, links } = linksOf(plain, emails);
  return {
    emails,
    phones: phonesOf(plain.replace(EMAIL, ' ')),
    linkedin,
    links,
    experienceMonths: experienceMonths(text, now),
    education: educationLevel(text),
    languages: languagesOf(text),
  };
}

/** Facts as kept (JSON), read back safely: anything missing or of another kind as none. */
export function cvFactsOf(value: unknown): CvFacts | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const strings = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
  return {
    emails: strings(v.emails),
    phones: strings(v.phones),
    linkedin: typeof v.linkedin === 'string' ? v.linkedin : null,
    links: strings(v.links),
    experienceMonths: typeof v.experienceMonths === 'number' ? v.experienceMonths : null,
    education: (EDUCATION_LEVELS as readonly string[]).includes(v.education as string) ? (v.education as EducationLevel) : null,
    languages: strings(v.languages),
  };
}

/** Whether a text is mostly Arabic letters (an OCR read in English that should be read again in Arabic). */
export function mostlyArabic(text: string): boolean {
  const arabic = (text.match(/[؀-ۿ]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return arabic > 0 && arabic >= latin;
}

/** Letters and digits in a text: how much a PDF's own text holds (a scan's holds next to none). */
export const textAmount = (text: string): number => (text.match(/[\p{L}\p{N}]/gu) ?? []).length;

function unique<T>(list: readonly T[]): T[] {
  return [...new Set(list)];
}

// ---------- what the pages show ----------

/** A CV's reading as an application's or a general CV's page shows it; its text and contacts come apart (cvText route). */
export interface CvReadingView {
  status: CvReadingStatus;
  method: CvReadingMethod | null;
  readAt: string | null;
  /** "About 4 years (from the dates in the CV)"; null without dates. */
  experience: string | null;
  education: EducationLevel | null;
  languages: string[];
  /** For an application: the vacancy's key skills found and not; none for a general CV. */
  skills: { found: string[]; missing: string[] } | null;
  /** The CV match %; null when the vacancy lists no key skills or the CV isn't read. */
  cvMatchPercent: number | null;
}

/** GET …/cv-text: the CV's text and the contacts found in it (never for a developer: phones and emails). */
export interface CvTextView {
  status: CvReadingStatus;
  cvText: string | null;
  cvEmails: string[];
  cvPhones: string[];
  cvLinkedin: string | null;
  cvLinks: string[];
}
