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
// More since 24 October 2026 (owner: "is the pulled data all what can be pulled from the uploaded cv?"; "CV years in list
// + more rules"): the work history with the latest title and company, the education details, the dictionary's skills,
// the certifications and the city (see "more facts by the rules" below); and the years as the lists show them.
// Pure code, tested in apps/api/src/common/cv-analysis.spec.ts.

import { SKILLS_DICTIONARY, type DictionarySkill } from './skills-dictionary.js';

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
  return cvSkillsMatcher(text)(skills);
}

/**
 * cvSkillsFound with the text made ready once (24 October 2026, the suggested CVs: one CV checked against every open
 * vacancy's key skills): the matcher answers for any list of skills.
 */
export function cvSkillsMatcher(text: string): (skills: readonly string[]) => { found: string[]; missing: string[] } {
  const hay = ` ${normalForMatch(text)} `;
  return (skills) => {
    const found: string[] = [];
    const missing: string[] = [];
    for (const skill of skills) {
      const needle = normalForMatch(skill);
      if (needle && hay.includes(` ${needle} `)) found.push(skill);
      else missing.push(skill);
    }
    return { found, missing };
  };
}

/**
 * A job title's words as titles are compared (24 October 2026, the suggested CVs: "Video Editor before"): as skills are
 * matched (lower case, plain digits and Arabic), without the words of rank or kind ("Senior", "Junior", "Lead", "Intern",
 * "of", "and" …) and a plural's s ("Editors" is "editor"); each once.
 */
export function titleWords(title: string | null | undefined): string[] {
  const words = normalForMatch(title ?? '')
    .split(' ')
    .filter((w) => w && !TITLE_STOP_WORDS.has(w))
    .map((w) => (w.length > 3 && /[a-z]s$/.test(w) && !w.endsWith('ss') ? w.slice(0, -1) : w));
  return [...new Set(words)];
}

const TITLE_STOP_WORDS = new Set([
  'and',
  'of',
  'the',
  'for',
  'in',
  'at',
  'to',
  'a',
  'an',
  'senior',
  'junior',
  'sr',
  'jr',
  'lead',
  'principal',
  'head',
  'chief',
  'assistant',
  'associate',
  'intern',
  'internship',
  'trainee',
  'freelance',
  'freelancer',
  'part',
  'full',
  'time',
  'mid',
  'level',
  'i',
  'ii',
  'iii',
]);

/**
 * How much an earlier title resembles a job's (24 October 2026): the share of the job's words the earlier title has, 0
 * to 1 ("Senior Video Editor" for "Video Editor": 1; "Video Producer": 0.5); 0 when the job's title has no words.
 */
export function titleLikeness(jobTitle: string | null | undefined, earlier: string | null | undefined): number {
  const job = titleWords(jobTitle);
  if (!job.length) return 0;
  const had = new Set(titleWords(earlier));
  return job.filter((w) => had.has(w)).length / job.length;
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

/**
 * The facts' version, kept with them (24 October 2026: the work history, education details, skills, certifications and
 * city added): facts of an earlier version are worked out again from the CV's kept text (CvReadingsService.refreshFacts).
 */
export const CV_FACTS_VERSION = 2;

/**
 * A job of the CV's work history (24 October 2026). Its title and company as written, each null when the rules weren't
 * sure which was which (missing is better than wrong); the names say "past" for the developer masking (developer.ts),
 * as a title alone ("title") is a vacancy's too.
 */
export interface CvWorkEntry {
  pastTitle: string | null;
  pastCompany: string | null;
  /** "2019-03", or "2019" when the CV gives the year alone. */
  from: string | null;
  /** As `from`; null when `current`. */
  to: string | null;
  /** Until now ("Present", "الآن"). */
  current: boolean;
}

/** A school or university of the CV's education (24 October 2026), each part null when not found. */
export interface CvEducationEntry {
  /** "Helwan University", "Faculty of Fine Arts, Helwan University", "جامعة القاهرة". */
  institution: string | null;
  /** The degree as written: "Bachelor of Fine Arts". */
  degree: string | null;
  graduationYear: number | null;
}

/** What the rules found in a CV's text. */
export interface CvFacts {
  /** CV_FACTS_VERSION when worked out; 1 for facts kept before 24 October 2026. */
  version: number;
  emails: string[];
  phones: string[];
  linkedin: string | null;
  /** Other links: portfolios (Behance, Dribbble, GitHub, Vimeo, YouTube …) and websites. */
  links: string[];
  /** The months of experience the date ranges add up to (overlaps merged); null when it has none. */
  experienceMonths: number | null;
  education: EducationLevel | null;
  languages: string[];
  // 24 October 2026 (owner: "is the pulled data all what can be pulled from the uploaded cv?"; "CV years in list + more
  // rules"): empty in facts kept before (version 1) until they are worked out again
  /** The latest job's title and company (the work history's newest end, or "present"). */
  latestTitle: string | null;
  latestCompany: string | null;
  /** The jobs under the CV's experience heading, latest first, at most 10. */
  workHistory: CvWorkEntry[];
  /** The schools and universities under its education heading, as the CV lists them, at most 5. */
  educationDetails: CvEducationEntry[];
  /** The dictionary's skills it names (skills-dictionary.ts), in the order found, at most 30. */
  cvSkills: string[];
  /** The lines under its certifications or courses heading, at most 10. */
  certifications: string[];
  /** Where the person lives: the first Egyptian city or governorate near the top ("Cairo"), or "Dubai, UAE". */
  city: string | null;
}

// ---------- the years, in the lists (24 October 2026) ----------

/** The Min. experience filter's choices, in years (any: none chosen). */
export const MIN_YEARS_CHOICES = [1, 2, 3, 5, 8, 10] as const;

/** The CV's months as the lists show them, in whole years: under a year 0 ("< 1 y"), else to the nearest year. */
export const cvYears = (months: number): number => (months < 12 ? 0 : Math.round(months / 12));

/**
 * The CV's months at least for `minYears` and more, as cvYears rounds them (3+ years: 30 months, "≈ 3 y"): what the
 * API's filter asks of the CV's estimate.
 */
export function cvMonthsAtLeast(minYears: number): number {
  const years = Math.ceil(minYears);
  if (years <= 0) return 0;
  return years === 1 ? 12 : years * 12 - 6;
}

/**
 * The years a list shows (owner, 24 October 2026: "why isn't the experience pulled off the CV?"): those the person typed
 * when given, else the CV's estimate; null with neither.
 */
export function experienceOf(typed: number | null, cvMonths: number | null): { years: number; fromCv: boolean } | null {
  if (typed !== null) return { years: typed, fromCv: false };
  if (cvMonths !== null) return { years: cvYears(cvMonths), fromCv: true };
  return null;
}

/** Whether a person has at least `minYears`, by the same rule: the typed years when given, else the CV's. */
export function meetsMinYears(typed: number | null, cvMonths: number | null, minYears: number): boolean {
  if (typed !== null) return typed >= minYears;
  return cvMonths !== null && cvMonths >= cvMonthsAtLeast(minYears);
}

/** Months to sort by, most first: the typed years' months when given, else the CV's; null with neither. */
export const experienceSortMonths = (typed: number | null, cvMonths: number | null): number | null => (typed !== null ? typed * 12 : cvMonths);

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

// ---------- more facts by the rules (24 October 2026) ----------
// The owner, 24 October 2026, on the General CVs list: "why isn't the experience pulled off the CV? is the pulled data
// all what can be pulled from the uploaded cv?"; chose "CV years in list + more rules", still no AI. Each rule here is
// best-effort: a CV's layout is its person's own, so a rule takes only what it is sure of and leaves the rest empty
// (missing is better than wrong).
// - The work history: under an experience heading, each line with a date range (as experienceMonths reads them) is a
//   job, its title and company on that line ("Title – Company", "Title at Company", "Company | Title", "Title, Company")
//   or on the lines next to it (two lines, or the line before and the one after). Which is the title and which the
//   company is told by their words (editor, designer, manager, مصمم … against studio, agency, company, شركة …), else by
//   the pattern's usual order on one line; on two lines neither saying, the job is left out. Latest first, at most 10;
//   the latest title and company are the newest end's (or "present").
// - The education details: under the education heading, each school's or university's name ("… University",
//   "Faculty of …", "جامعة …", "كلية …"), the degree as written and the graduation year (a range's end, or a year alone;
//   none while still studying). The level stays educationLevel's.
// - The skills: the dictionary's (skills-dictionary.ts), anywhere in the CV, found as a vacancy's key skills are (whole
//   words, any case), in the order found, at most 30.
// - The certifications: the lines under a certifications or courses heading, at most 10 (a line starting in lower case
//   joined to the one before, as a line wrapped).
// - The city: the first Egyptian city or governorate in the CV's top (before its first heading) or its contact section,
//   never in a university's name ("Cairo University", "جامعة عين شمس"); else a city with its country ("Dubai, UAE").
// Known limits: a heading the rules don't know (or an OCR misspelling of one) hides its section; a two-column CV whose
// columns pdf.js reads line by line (rather than one column after the other) mixes its lines, so little is found in it.

/**
 * A CV's line as shown (digits plain, Arabic marks, tatweel and direction marks dropped) and as compared (`key`: Latin
 * letters in lower case; alef, taa marbuta and alef maqsura plain): the same length, so what is found in one is cut from
 * the other.
 */
interface CvLine {
  shown: string;
  key: string;
}

const keyOf = (s: string): string =>
  s
    .replace(/[A-Z]/g, (c) => c.toLowerCase())
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');

const lineOf = (shown: string): CvLine => ({ shown, key: keyOf(shown) });

function cvLines(text: string): CvLine[] {
  return plainDigits(text)
    .replace(/[ً-ٰٟـ\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .split(/\r?\n|\r|\f/)
    .map((l) => lineOf(l.replace(/\t/g, '    ').replace(/[\u00a0\u2000-\u200b\u202f]/g, ' ').trim()));
}

/** Spans of a line, by where `re` (global) matches its key. */
function spansIn(key: string, re: RegExp): { index: number; length: number }[] {
  return [...key.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))].filter((m) => m[0].length > 0).map((m) => ({ index: m.index, length: m[0].length }));
}

/** A line with these spans blanked out (a space each), in both its forms. */
function cut(line: CvLine, spans: readonly { index: number; length: number }[]): CvLine {
  let { shown, key } = line;
  for (const s of [...spans].sort((a, b) => b.index - a.index)) {
    shown = `${shown.slice(0, s.index)} ${shown.slice(s.index + s.length)}`;
    key = `${key.slice(0, s.index)} ${key.slice(s.index + s.length)}`;
  }
  return { shown, key };
}

/** A line split where `re` (global) matches its key (`once`: at the first match only). */
function splitLine(line: CvLine, re: RegExp, once = false): CvLine[] {
  const spans = spansIn(line.key, re);
  const at = once ? spans.slice(0, 1) : spans;
  const out: CvLine[] = [];
  let from = 0;
  for (const s of at) {
    out.push({ shown: line.shown.slice(from, s.index), key: line.key.slice(from, s.index) });
    from = s.index + s.length;
  }
  out.push({ shown: line.shown.slice(from), key: line.key.slice(from) });
  return out;
}

/** Trimmed at both ends of the separators, brackets and bullets left around it; empty brackets and extra spaces gone. */
function tidyLine(line: CvLine): CvLine {
  const shown = line.shown.replace(/[([{]\s*[)\]}]/g, (m) => ' '.repeat(m.length));
  const key = keyOf(shown);
  const start = key.search(/[^\s,،|•·●▪◦○■□►▸➢➤✓✔:;\-–—/\\*>)\]}]/u);
  if (start < 0) return { shown: '', key: '' };
  const tail = key.slice(start).search(/[\s,،|•·●▪◦○■□►▸➢➤✓✔:;\-–—/\\*(\[{]*$/u);
  const end = tail < 0 ? key.length : start + tail;
  const squeeze = (s: string) => s.slice(start, end).replace(/\s+/g, ' ').trim();
  return { shown: squeeze(shown), key: squeeze(key) };
}

const words = (s: string): number => (s.trim() ? s.trim().split(/\s+/).length : 0);
const hasLetter = (s: string): boolean => /\p{L}/u.test(s);
const isArabicText = (s: string): boolean => /[؀-ۿ]/.test(s);

const BULLET_START = /^\s*(?:[•·●▪◦○■□►▸➢➤✓✔*>]|[-–—](?=\s)|\d{1,2}[.)](?=\s))/u;

// ---------- the CV's sections ----------

type CvSection = 'top' | 'work' | 'education' | 'certifications' | 'skills' | 'languages' | 'contact' | 'other';

/** The headings the rules know, as compared (lower case; ة as ه, أ as ا, ى as ي). */
const SECTION_PHRASES: [Exclude<CvSection, 'top'>, string][] = [
  [
    'work',
    'experience|experiences|work experience|working experience|professional experience|relevant experience|job experience|employment|employment history|work history|career history|career|professional background|internships?|الخبرات|الخبره|الخبره العمليه|الخبرات العمليه|الخبره المهنيه|الخبرات المهنيه|الخبرات السابقه|الخبرات الوظيفيه|الوظائف السابقه|سجل العمل',
  ],
  [
    'education',
    'education|educational background|academic background|academic qualifications?|academics?|qualifications?|studies|التعليم|المؤهلات|المؤهل|المؤهل الدراسي|المؤهلات الدراسيه|المؤهل العلمي|المؤهلات العلميه|الدراسه|التحصيل الدراسي',
  ],
  [
    'certifications',
    'certifications?|certificates?|courses?|training|trainings|training courses|licenses?|licences?|licenses and certifications|workshops?|الشهادات|الدورات|الدورات التدريبيه|التدريب|الكورسات',
  ],
  ['skills', 'skills|technical skills|soft skills|hard skills|key skills|core skills|software|software skills|computer skills|tools|expertise|competencies|المهارات|المهارات التقنيه|المهارات الشخصيه|البرامج'],
  ['languages', 'languages?|language skills|اللغات|اللغه'],
  [
    'contact',
    'contact|contacts|contact me|contact info|contact information|contact details|personal info|personal information|personal details|personal data|details|info|البيانات الشخصيه|المعلومات الشخصيه|معلومات شخصيه|بيانات التواصل|معلومات التواصل|التواصل',
  ],
  [
    'other',
    'summary|professional summary|profile|professional profile|personal profile|about|about me|objective|career objective|projects|selected projects|portfolio|references|interests|hobbies|achievements|awards|honors|honours|volunteering|volunteer experience|volunteer work|activities|extracurricular activities|publications|نبذه|نبذه عني|الملخص|الهدف|الهدف الوظيفي|المشاريع|الهوايات|المراجع|الانجازات|الجوائز|الانشطه|العمل التطوعي',
  ],
];

const ANY_PHRASE = SECTION_PHRASES.map(([, p]) => p).join('|');
const JOINED = `(?:\\s*(?:&|and|/|,|،|\\+|-|–|و)\\s*(?:${ANY_PHRASE}))*`;
const SECTION_HEADINGS = SECTION_PHRASES.map(([section, p]) => ({ section, whole: new RegExp(`^(?:${p})${JOINED}$`, 'u'), inline: new RegExp(`^\\s*(?:${p})${JOINED}\\s*:`, 'u') }));

/** A line's heading (letter-spaced ones too: "E X P E R I E N C E"), or with "Heading: …" what follows it. */
function headingOf(line: CvLine): { section: Exclude<CvSection, 'top'>; rest: CvLine | null } | null {
  let h = line.key;
  if (h.length > 80) return null;
  if (/^(?:\p{L}\s+){2,}\p{L}$/u.test(h)) h = h.split(/\s{2,}/).map((w) => w.replace(/\s+/g, '')).join(' ');
  const bare = h.replace(/^[^\p{L}]+/u, '').replace(/[^\p{L}]+$/u, '').replace(/\s+/g, ' ').trim();
  if (bare && bare.length <= 45) for (const s of SECTION_HEADINGS) if (s.whole.test(bare)) return { section: s.section, rest: null };
  // "Certifications: Meta Blueprint, Google Ads": the heading, and the rest as its first line
  for (const s of SECTION_HEADINGS) {
    const m = s.inline.exec(line.key);
    if (m && line.key.length > m[0].length) {
      const rest = tidyLine({ shown: line.shown.slice(m[0].length), key: line.key.slice(m[0].length) });
      if (rest.shown) return { section: s.section, rest };
    }
  }
  return null;
}

/** A CV's line with the section it is in; a heading's own line marked (`heading`). */
interface CvItem {
  section: CvSection;
  line: CvLine;
  heading: boolean;
}

function cvItems(lines: readonly CvLine[]): CvItem[] {
  const out: CvItem[] = [];
  let section: CvSection = 'top';
  for (const line of lines) {
    if (!line.shown) continue;
    const h = headingOf(line);
    if (!h) {
      out.push({ section, line, heading: false });
      continue;
    }
    section = h.section;
    out.push({ section, line, heading: true });
    if (h.rest) out.push({ section, line: h.rest, heading: false });
  }
  return out;
}

// ---------- the date ranges, with where they are ----------

interface RangeFound {
  index: number;
  length: number;
  start: number;
  /** The end as a month count (now's when "present"). */
  end: number;
  /** To sort by: a year alone as its December. */
  sortEnd: number;
  from: string;
  to: string | null;
  current: boolean;
}

/** A point as a month count and as kept ("2019-03", or "2019" for a year alone). */
function pointOf(m: RegExpExecArray, at: number): { months: number; text: string; month: boolean } | null {
  const months = monthOf(m, at);
  if (months === null) return null;
  const year = Math.floor(months / 12);
  const month = !m[at + 6];
  return { months, month, text: month ? `${year}-${String((months % 12) + 1).padStart(2, '0')}` : String(year) };
}

/** The date ranges in a line's key that could be a job's (as experienceMonths takes them). */
function rangesIn(key: string, current: number): RangeFound[] {
  const out: RangeFound[] = [];
  const re = new RegExp(RANGE.source, RANGE.flags);
  for (let m = re.exec(key); m; m = re.exec(key)) {
    const a = pointOf(m, 1);
    const isNow = !!m[15];
    const b = isNow ? null : pointOf(m, 8);
    if (!a || (!isNow && !b)) continue;
    const end = isNow ? current : b!.months;
    if (Math.floor(a.months / 12) < 1960 || end > current + 1 || end < a.months || end - a.months > 50 * 12) continue;
    const sortEnd = isNow ? current : b!.month ? b!.months : b!.months + 11;
    out.push({ index: m.index, length: m[0].length, start: a.months, end: Math.min(end, current), sortEnd: Math.min(sortEnd, current), from: a.text, to: isNow ? null : b!.text, current: isNow });
  }
  return out;
}

// ---------- places ----------

/** Egypt's cities and governorates, the more particular first: the name kept, and how CVs write it (as compared). */
const EGYPT_PLACES: [string, string[]][] = [
  ['New Cairo', ['new cairo', 'fifth settlement', '5th settlement', 'tagamoa', 'el tagamoa', 'القاهره الجديده', 'التجمع الخامس', 'التجمع']],
  ['Nasr City', ['nasr city', 'madinet nasr', 'مدينه نصر']],
  ['Heliopolis', ['heliopolis', 'masr el gedida', 'مصر الجديده']],
  ['Maadi', ['maadi', 'el maadi', 'المعادي']],
  ['Zamalek', ['zamalek', 'الزمالك']],
  ['Mohandessin', ['mohandessin', 'mohandeseen', 'المهندسين']],
  ['Dokki', ['dokki', 'الدقي']],
  ['Haram', ['haram', 'el haram', 'الهرم']],
  ['Shubra', ['shubra', 'shoubra', 'شبرا']],
  ['Ain Shams', ['ain shams', 'عين شمس']],
  ['Mokattam', ['mokattam', 'المقطم']],
  ['Helwan', ['helwan', 'حلوان']],
  // not "Rehab", "Shorouk", "Alex" or "Faisal" alone: first names too
  ['El Rehab', ['el rehab', 'rehab city', 'الرحاب']],
  ['Madinaty', ['madinaty', 'مدينتي']],
  ['El Shorouk', ['el shorouk', 'shorouk city', 'الشروق']],
  ['El Obour', ['obour', 'el obour', 'العبور']],
  ['6th of October', ['6th of october', '6th october', '6 october', '6 of october', 'sixth of october', 'october city', '6 اكتوبر', 'السادس من اكتوبر']],
  ['Sheikh Zayed', ['sheikh zayed', 'shiekh zayed', 'el sheikh zayed', 'الشيخ زايد']],
  ['10th of Ramadan', ['10th of ramadan', '10th ramadan', 'العاشر من رمضان']],
  ['Cairo', ['cairo', 'القاهره']],
  ['Giza', ['giza', 'الجيزه']],
  ['Alexandria', ['alexandria', 'الاسكندريه', 'اسكندريه']],
  ['Port Said', ['port said', 'بورسعيد', 'بور سعيد']],
  ['Suez', ['suez', 'السويس']],
  ['Ismailia', ['ismailia', 'الاسماعيليه']],
  ['Damietta', ['damietta', 'دمياط']],
  ['Mansoura', ['mansoura', 'المنصوره']],
  ['Tanta', ['tanta', 'طنطا']],
  ['Zagazig', ['zagazig', 'الزقازيق']],
  ['Qalyubia', ['qalyubia', 'qaliubiya', 'القليوبيه']],
  ['Sharqia', ['sharqia', 'sharkia', 'الشرقيه']],
  ['Dakahlia', ['dakahlia', 'الدقهليه']],
  ['Gharbia', ['gharbia', 'الغربيه']],
  ['Monufia', ['monufia', 'menoufia', 'المنوفيه']],
  ['Beheira', ['beheira', 'البحيره']],
  ['Kafr El Sheikh', ['kafr el sheikh', 'kafr elsheikh', 'كفر الشيخ']],
  ['Faiyum', ['faiyum', 'fayoum', 'الفيوم']],
  ['Beni Suef', ['beni suef', 'بني سويف']],
  ['Minya', ['minya', 'el minya', 'المنيا']],
  ['Asyut', ['asyut', 'assiut', 'اسيوط']],
  ['Sohag', ['sohag', 'سوهاج']],
  ['Qena', ['qena', 'قنا']],
  ['Luxor', ['luxor', 'الاقصر']],
  ['Aswan', ['aswan', 'اسوان']],
  ['Hurghada', ['hurghada', 'الغردقه']],
  ['Sharm El Sheikh', ['sharm el sheikh', 'sharm', 'شرم الشيخ']],
  ['Marsa Matrouh', ['marsa matrouh', 'matrouh', 'مرسي مطروح', 'مطروح']],
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');

/** Each Egyptian place's ways of writing as a pattern: whole words; an Arabic one with و or ب before it too ("بالقاهرة"). */
const EGYPT_PLACE_RES: { name: string; re: RegExp }[] = EGYPT_PLACES.map(([name, forms]) => ({
  name,
  re: new RegExp(forms.map((f) => (isArabicText(f) ? `(?<!\\p{L})[وب]?${escapeRe(f)}(?!\\p{L})` : `(?<![\\p{L}\\p{N}])${escapeRe(f)}(?![\\p{L}\\p{N}])`)).join('|'), 'u'),
}));

const COUNTRIES = 'egypt|uae|u\\.a\\.e\\.?|united arab emirates|saudi arabia|ksa|k\\.s\\.a\\.?|qatar|kuwait|bahrain|oman|jordan|lebanon|iraq|morocco|tunisia|uk|united kingdom|usa|u\\.s\\.a\\.?|united states|germany|france|canada|turkey|مصر|الامارات|السعوديه|قطر|الكويت|البحرين|عمان|الاردن|لبنان';
const OTHER_CITIES = 'dubai|abu dhabi|sharjah|riyadh|jeddah|dammam|doha|manama|muscat|amman|beirut|london|berlin|paris|istanbul|toronto|دبي|ابوظبي|ابو ظبي|الرياض|جده|الدوحه';
const WORK_MODES = 'remote|remotely|hybrid|on[\\s-]?site|onsite|عن بعد';
const ALL_PLACES = [...EGYPT_PLACES.flatMap(([, forms]) => forms).map(escapeRe), COUNTRIES, OTHER_CITIES, WORK_MODES].join('|');
/** A part that names only places ("Cairo, Egypt", "Remote"): a job's location, neither its title nor its company. */
const PLACE_ONLY = new RegExp(`^(?:(?:el\\s+|ال)?(?:${ALL_PLACES})(?:[\\s,،\\-–/]+|$))+$`, 'u');
const isPlace = (key: string): boolean => PLACE_ONLY.test(key.trim());

const EMPLOYMENT_KIND = /^(?:full[\s-]?time|part[\s-]?time|internship|contract|contractor|temporary|seasonal|permanent|دوام كامل|دوام جزئي)$/u;
const DURATION = /\(?\s*\d+\+?\s*(?:years?|yrs?|months?|mos?|سنوات|سنه|سنين|اعوام|عام|شهور|اشهر|شهر)(?:\s*(?:and|,|،|و)?\s*\d+\s*(?:months?|mos?|شهور|اشهر|شهر))?\s*\)?/gu;
const isDuration = (key: string): boolean => !!key.trim() && !key.replace(DURATION, ' ').replace(/[\s()·.,-]/g, '');

// ---------- the work history ----------

/** Words of a job title, as compared: a part with one is the title. */
const TITLE_WORD = new RegExp(
  [
    '(?<![\\p{L}])(?:editor|editors|designer|manager|director|specialist|executive|coordinator|officer|assistant|associate|intern|trainee|engineer|developer|programmer|analyst|consultant|accountant|auditor|producer|writer|copywriter|photographer|videographer|cinematographer|animator|artist|illustrator|lead|head|supervisor|representative|agent|administrator|admin|receptionist|secretary|planner|strategist|buyer|creator|marketer|technician|operator|teacher|instructor|tutor|lecturer|researcher|architect|founder|co-founder|cofounder|ceo|cto|cfo|coo|cmo|president|vp|freelancer|freelance|colorist|colourist|journalist|reporter|presenter|moderator|translator|recruiter|generalist|controller|cashier|clerk|advisor|adviser|expert|volunteer|ambassador|storyteller|retoucher|modeler|modeller|motion designer)(?![\\p{L}])',
    '(?<![\\p{L}])(?:ال)?(?:مدير|مصمم|مونتير|محرر|مهندس|محاسب|مساعد|منسق|اخصائي|مطور|مبرمج|كاتب|مصور|متدرب|مسؤول|مسئول|رئيس|مشرف|منتج|مخرج|موظف|مندوب|سكرتير|مستشار|محلل|مترجم|معلم|مدرس|فني|مسوق|صانع محتوي|خبير)(?:ه|ين|ون)?(?![\\p{L}])',
  ].join('|'),
  'u',
);

/**
 * Words of a company's name, as compared: a part with one and no title's word is the company ("Bright Studio", "شركة
 * النيل"). The weak ones ("Nile Media", "Orbit Creative") only in a name written as one, every word capitalised, as
 * "worked on social media posts" is a description.
 */
const COMPANY_WORD = new RegExp(
  [
    '(?<![\\p{L}])(?:company|co|ltd|limited|llc|inc|corp|corporation|group|agency|studio|studios|holding|holdings|bank|consulting|consultancy|consultants|partners|enterprise|enterprises|industries|foundation|organization|organisation|ngo|hospital|hotel|hotels|university|school|academy|institute|ventures|self-employed|self employed)(?![\\p{L}])',
    '&',
    '(?<![\\p{L}])(?:ال)?(?:شركه|مؤسسه|وكاله|استوديو|ستوديو|مجموعه|بنك|مصنع|مكتب|جريده|قناه|مستشفي|فندق|جامعه|مدرسه|اكاديميه|معهد|مركز)(?![\\p{L}])',
  ].join('|'),
  'u',
);
const COMPANY_WEAK_WORD =
  /(?<![\p{L}])(?:media|films|pictures|creative|creatives|digital|communications|events|interactive|production|productions|solutions|systems|technologies|technology|tech|international|network|lab|labs|advertising|publishing|press|tv|channel|radio|magazine|newspaper|ecommerce|e-commerce)(?![\p{L}])/u;

const NAME_JOINERS = new Set(['&', '+', '-', '–', 'and', 'of', 'for', 'the', 'de', 'el', 'al']);

/** Every Latin word capitalised (but "of", "&" …): written as a name is. */
const capitalised = (part: CvLine): boolean => {
  const t = part.shown.trim();
  return !!t && !isArabicText(t) && t.split(/\s+/).every((w) => NAME_JOINERS.has(w.toLowerCase()) || /^[\p{Lu}\d("“']/u.test(w));
};

type RoleKind = 'title' | 'company' | 'unknown';
const kindOf = (part: CvLine): RoleKind =>
  TITLE_WORD.test(part.key) ? 'title' : COMPANY_WORD.test(part.key) || (COMPANY_WEAK_WORD.test(part.key) && capitalised(part)) ? 'company' : 'unknown';

const DICTIONARY_NAMES = new Set(SKILLS_DICTIONARY.flatMap((s) => [s.name, ...(s.aliases ?? [])]).map((n) => normalForMatch(n)));

/**
 * A line on its own, with neither a title's nor a company's word, that still looks like a name, so it may be a job's
 * other part: in Latin letters, 2 to 6 words each capitalised (but "of", "&" …), not a skill ("Photoshop"). An Arabic
 * one can't be told from a description, and is left out.
 */
function nameLike(part: CvLine): boolean {
  const n = words(part.shown);
  return n >= 2 && n <= 6 && !DICTIONARY_NAMES.has(normalForMatch(part.shown)) && capitalised(part);
}

/** How a job's line separates its title and company, in the order tried; `titleFirst`: the pattern's usual order. */
const ROLE_SEPARATORS: { re: RegExp; titleFirst: boolean; decisive: boolean; once: boolean }[] = [
  // "Title at Company", "Title @ Company", "مصمم لدى شركة …", "مصمم في شركة …", "مصمم بشركة …": the order is the pattern's own
  { re: /\s+(?:at|@)\s+|\s+@(?=\S)|\s+لدي\s+|\s+(?:في\s+|ب)(?=(?:ال)?(?:شركه|مؤسسه|وكاله|استوديو|ستوديو|مجموعه|بنك|مصنع|مكتب|جريده|قناه|مستشفي|فندق|مركز)(?!\p{L}))/gu, titleFirst: true, decisive: true, once: true },
  // "Company | Title" (the order the brief names; their words decide first), an OCR's pipe read as l, I or !
  { re: /\s*\|\s*|\s+[li!]\s+/gu, titleFirst: false, decisive: false, once: false },
  // "Title – Company", "Title · Company"
  { re: /\s+[-–—]+\s+|\s*[–—]\s*|\s+[•·●]\s+/gu, titleFirst: true, decisive: false, once: false },
  // "Title, Company"
  { re: /\s*[,،]\s*/gu, titleFirst: true, decisive: false, once: false },
  // columns apart on one line
  { re: /\s{3,}/gu, titleFirst: true, decisive: false, once: false },
];

/** A part of a job's line kept: not a place, an employment kind or a duration. */
function keptPart(part: CvLine): CvLine | null {
  // "(Cairo)", "(Remote)", "(Full-time)" after a name
  const t = tidyLine(cut(part, spansIn(part.key, /\(([^()]*)\)/gu).filter((s) => {
    const inner = part.key.slice(s.index + 1, s.index + s.length - 1).trim();
    return isPlace(inner) || EMPLOYMENT_KIND.test(inner) || isDuration(inner);
  })));
  if (!t.shown || !hasLetter(t.shown) || isPlace(t.key) || EMPLOYMENT_KIND.test(t.key) || isDuration(t.key)) return null;
  return t;
}

/** A job's line in parts: its title and company apart, or one part (`decisive`: "at" says which is which). */
function roleParts(line: CvLine): { parts: CvLine[]; titleFirst: boolean; decisive: boolean } {
  let current = tidyLine(line);
  for (const sep of ROLE_SEPARATORS) {
    if (!current.shown) break;
    const pieces = splitLine(current, sep.re, sep.once).map(keptPart).filter((p): p is CvLine => !!p);
    if (pieces.length >= 2) {
      // "Title at Company in Cairo": the company's own separators may follow
      const parts = pieces.slice(0, 2).map((p) => roleParts(p).parts[0] ?? p);
      return { parts, titleFirst: sep.titleFirst, decisive: sep.decisive };
    }
    if (pieces.length === 1) current = pieces[0];
  }
  const kept = current.shown ? keptPart(current) : null;
  return { parts: kept ? [kept] : [], titleFirst: true, decisive: false };
}

/** A title or a company as kept: short as a name is (at most 80 characters, 10 words); null when it isn't one. */
function roleValue(part: CvLine | null | undefined): string | null {
  if (!part) return null;
  const t = tidyLine(part).shown;
  if (!t || t.length < 2 || t.length > 80 || words(t) > 10 || !hasLetter(t)) return null;
  return t;
}

/**
 * Two parts as title and company: by their words, else the pattern's order when `byOrder` (one line), else unsure
 * (null). Two lines (`byOrder` false): the part without a title's or company's word taken only when nameLike.
 */
function titleAndCompany(a: CvLine, b: CvLine, titleFirst: boolean, decisive: boolean, byOrder: boolean): { title: CvLine | null; company: CvLine | null } | null {
  if (decisive) return titleFirst ? { title: a, company: b } : { title: b, company: a };
  const ka = kindOf(a);
  const kb = kindOf(b);
  const sure = (part: CvLine, kind: RoleKind) => (kind !== 'unknown' || byOrder || nameLike(part) ? part : null);
  if (ka === 'title' && kb !== 'title') return { title: a, company: sure(b, kb) };
  if (kb === 'title' && ka !== 'title') return { title: b, company: sure(a, ka) };
  if (ka === 'company' && kb !== 'company') return { title: sure(b, kb), company: a };
  if (kb === 'company' && ka !== 'company') return { title: sure(a, ka), company: b };
  // both a title's (two roles named) or both a company's: the first as it is, the other unsure
  if (ka === 'title') return { title: titleFirst ? a : b, company: null };
  if (ka === 'company') return null;
  return byOrder ? (titleFirst ? { title: a, company: b } : { title: b, company: a }) : null;
}

/** A line that could hold a job's title or company: short, not a description's bullet or sentence. */
function roleLike(line: CvLine): boolean {
  const t = line.shown.trim();
  if (!t || BULLET_START.test(t) || t.length > 80 || words(t) > 10 || !hasLetter(t)) return false;
  if (/[.!?؟]$/.test(t) && !/(?<![\p{L}])(?:co|inc|ltd|corp|llc)\.$/iu.test(t)) return false;
  return true;
}

interface Job extends CvWorkEntry {
  start: number;
  sortEnd: number;
  order: number;
}

/** The work history: the jobs under the experience headings, latest first (the newest end, "present" first), at most 10. */
function workHistoryOf(items: readonly CvItem[], current: number): CvWorkEntry[] {
  const used = new Set<number>();
  const jobs: Job[] = [];
  const free = (j: number): boolean => {
    const it = items[j];
    return !!it && !used.has(j) && !it.heading && it.section === 'work' && roleLike(it.line) && !rangesIn(it.line.key, current).length && !isPlace(tidyLine(it.line).key) && !isDuration(it.line.key);
  };
  /** A neighbour's line as one part (none when it holds a title and a company of its own, or nothing). */
  const single = (j: number): CvLine | null => {
    const r = roleParts(items[j].line);
    return r.parts.length === 1 ? r.parts[0] : null;
  };
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.section !== 'work' || it.heading) continue;
    const ranges = rangesIn(it.line.key, current);
    if (!ranges.length) continue;
    const r = ranges[0];
    const withoutDates = cut(it.line, ranges);
    const rest = tidyLine(cut(withoutDates, spansIn(withoutDates.key, DURATION)));
    // a description's sentence with dates in it ("• Ran a campaign from Jan 2023 – Mar 2023 for …"), not a job's line
    if (words(rest.shown) > (BULLET_START.test(it.line.shown) ? 6 : 12)) continue;
    used.add(i);
    let title: CvLine | null = null;
    let company: CvLine | null = null;
    const parts = roleParts(rest);
    if (parts.parts.length === 2) {
      const tc = titleAndCompany(parts.parts[0], parts.parts[1], parts.titleFirst, parts.decisive, true);
      title = tc?.title ?? null;
      company = tc?.company ?? null;
    } else if (parts.parts.length === 1) {
      // the date's line names one: the other on the line before it, or after it
      const p = parts.parts[0];
      const kind = kindOf(p);
      const near = [i - 1, i + 1].filter(free).map((j) => ({ j, part: single(j) })).filter((n): n is { j: number; part: CvLine } => !!n.part);
      if (kind === 'title') {
        title = p;
        const n = near.find((x) => kindOf(x.part) === 'company') ?? near.find((x) => kindOf(x.part) === 'unknown' && nameLike(x.part));
        if (n) {
          company = n.part;
          used.add(n.j);
        }
      } else if (kind === 'company' || nameLike(p)) {
        const n = near.find((x) => kindOf(x.part) === 'title') ?? (kind === 'unknown' ? near.find((x) => kindOf(x.part) === 'company') : undefined);
        if (n && kindOf(n.part) === 'title') {
          title = n.part;
          company = p;
          used.add(n.j);
        } else if (n) {
          title = p;
          company = n.part;
          used.add(n.j);
        } else if (kind === 'company') company = p;
      }
    } else {
      // the dates alone on their line: the job on the line or two before it, else after it
      for (const [one, two] of [
        [i - 1, i - 2],
        [i + 1, i + 2],
      ]) {
        if (!free(one)) continue;
        const first = roleParts(items[one].line);
        if (first.parts.length === 2) {
          const tc = titleAndCompany(first.parts[0], first.parts[1], first.titleFirst, first.decisive, true);
          title = tc?.title ?? null;
          company = tc?.company ?? null;
          used.add(one);
          break;
        }
        const a = first.parts[0];
        if (!a) continue;
        const b = free(two) ? single(two) : null;
        // in the CV's order: the line further from the dates first when before them
        const tc = b ? (one < i ? titleAndCompany(b, a, true, false, false) : titleAndCompany(a, b, true, false, false)) : null;
        if (tc && (tc.title || tc.company)) {
          title = tc.title;
          company = tc.company;
          used.add(one);
          if (tc.title === b || tc.company === b) used.add(two);
        } else {
          const kind = kindOf(a);
          if (kind === 'title') title = a;
          else if (kind === 'company') company = a;
          else continue;
          used.add(one);
        }
        break;
      }
    }
    const pastTitle = roleValue(title);
    const pastCompany = roleValue(company);
    if (!pastTitle && !pastCompany) continue;
    jobs.push({ pastTitle, pastCompany, from: r.from, to: r.to, current: r.current, start: r.start, sortEnd: r.sortEnd, order: jobs.length });
  }
  return jobs
    .sort((a, b) => b.sortEnd - a.sortEnd || b.start - a.start || a.order - b.order)
    .slice(0, 10)
    .map(({ pastTitle, pastCompany, from, to, current: now }) => ({ pastTitle, pastCompany, from, to, current: now }));
}

// ---------- the education details ----------

const INSTITUTION_KINDS: [string, RegExp][] = [
  ['university', /(?<![\p{L}])(?:university|universite|universität|(?:ال)?جامعه)(?![\p{L}])/u],
  ['faculty', /(?<![\p{L}])(?:faculty|college|(?:ال)?كليه)(?![\p{L}])/u],
  ['institute', /(?<![\p{L}])(?:institute|academy|polytechnic|conservatory|(?:ال)?معهد|(?:ال)?اكاديميه)(?![\p{L}])/u],
  ['school', /(?<![\p{L}])(?:school|(?:ال)?مدرسه)(?![\p{L}])/u],
];
const INSTITUTION_ANY = new RegExp(INSTITUTION_KINDS.map(([, re]) => re.source).join('|'), 'u');
const DEGREE_WORD =
  /(?<![\p{L}])(?:bachelor'?s?|b\.\s?sc\.?|bsc|b\.\s?a\.|ba(?=\s+(?:in|of)\s)|b\.\s?eng\.?|beng|b\.\s?com\.?|bcom|llb|master'?s?|m\.\s?sc\.?|msc|m\.\s?a\.|ma(?=\s+(?:in|of)\s)|mba|m\.\s?eng\.?|meng|ph\.?\s?d\.?|doctorate|diploma|associate degree|high school|secondary school|thanaweya|degree|بكالوريوس|ليسانس|ماجستير|دكتوراه|دبلوم|الثانويه العامه|ثانويه)(?![\p{L}])/u;
/** Words about the year or the grade, left out of the degree and institution: "Class of", "GPA 3.4", "تقدير جيد جدا". */
const EDUCATION_NOISE = /(?<![\p{L}])(?:class of|expected|graduated(?: in)?|graduation(?: year)?|grad\.?|gpa\s*[:\-]?\s*[\d.\/]+|grade\s*[:\-]?.*$|سنه التخرج|دفعه|تخرج|تقدير\s.*$)(?![\p{L}])/gu;
const LONE_YEAR = /(?<!\d)(?:19[6-9]\d|20\d\d)(?!\d)/g;
/** A label before a colon ("Degree: …", "University: …"): no part of the degree or the school's name. */
const EDUCATION_LABEL = /^(?:degree|qualification|university|institution|school|college|faculty|major|minor|specialization|specialisation|field of study|المؤهل|الجامعه|الكليه|التخصص)$/u;

interface EducationLine {
  institutions: { kind: string; text: string }[];
  degree: string | null;
  year: number | null;
  studying: boolean;
}

/** A segment with both a degree and a school: the degree before "from" or "at" (or before an Arabic "جامعة …"), the school after. */
function degreeAndSchool(seg: CvLine): { degree: CvLine; school: CvLine | null } {
  const connector = splitLine(seg, /\s+(?:from|at)\s+/gu, true);
  if (connector.length === 2 && DEGREE_WORD.test(connector[0].key) && INSTITUTION_ANY.test(connector[1].key)) return { degree: connector[0], school: connector[1] };
  // the school's word leading its name: "… جامعة القاهرة", "… University of Cairo", "… Faculty of Arts"
  const lead = /(?<![\p{L}])(?:(?:ال)?(?:جامعه|كليه|معهد|اكاديميه|مدرسه)|(?:university|faculty|college|institute|academy|school)\s+(?:of|for)\s)/u.exec(seg.key);
  if (lead && lead.index > 0) {
    const degree = tidyLine({ shown: seg.shown.slice(0, lead.index).replace(/\s+(?:من|في|ب)\s*$/u, ''), key: seg.key.slice(0, lead.index).replace(/\s+(?:من|في|ب)\s*$/u, '') });
    const school = tidyLine({ shown: seg.shown.slice(lead.index), key: seg.key.slice(lead.index) });
    if (DEGREE_WORD.test(degree.key)) return { degree, school };
  }
  return { degree: seg, school: null };
}

function educationLineOf(line: CvLine, current: number): EducationLine {
  const ranges = rangesIn(line.key, current);
  const years = [...ranges.map((r) => (r.current ? null : Number(r.to!.slice(0, 4)))), ...[...line.key.matchAll(LONE_YEAR)].map((m) => Number(m[0]))].filter(
    (y): y is number => y !== null && y <= Math.floor(current / 12) + 6,
  );
  const studying = ranges.some((r) => r.current);
  let rest = cut(line, ranges);
  rest = cut(rest, spansIn(rest.key, LONE_YEAR));
  rest = cut(rest, spansIn(rest.key, EDUCATION_NOISE));
  const out: EducationLine = { institutions: [], degree: null, year: studying || !years.length ? null : Math.max(...years), studying };
  /** The segment just before was the degree: one after it with no school's or degree's word is its subject ("BSc, Computer Science"). */
  let afterDegree = false;
  for (const raw of splitLine(rest, /\s*[,،|•·;:]\s*|\s+[-–—]\s+|\s*[–—]\s*|\s{3,}/gu)) {
    const seg = tidyLine(raw);
    if (!seg.shown || !hasLetter(seg.shown) || EDUCATION_LABEL.test(seg.key)) continue;
    const isSchool = INSTITUTION_ANY.test(seg.key);
    const isDegree = DEGREE_WORD.test(seg.key);
    if (isDegree) {
      const { degree, school } = isSchool ? degreeAndSchool(seg) : { degree: seg, school: null };
      if (!out.degree) out.degree = degree.shown;
      if (school) out.institutions.push({ kind: INSTITUTION_KINDS.find(([, re]) => re.test(school.key))?.[0] ?? 'school', text: school.shown });
      afterDegree = !school && out.degree === degree.shown;
      continue;
    }
    if (isSchool) out.institutions.push({ kind: INSTITUTION_KINDS.find(([, re]) => re.test(seg.key))?.[0] ?? 'school', text: seg.shown });
    else if (afterDegree && out.degree && !isPlace(seg.key) && words(seg.shown) <= 6) out.degree = `${out.degree}${isArabicText(seg.shown) ? '، ' : ', '}${seg.shown}`;
    afterDegree = false;
  }
  return out;
}

/** A degree or an institution as kept: at most 100 characters and 14 words; null otherwise. */
const educationValue = (s: string | null): string | null => (s && hasLetter(s) && s.length <= 100 && words(s) <= 14 ? s : null);

/** Whether two names are of one school: a faculty (or college) and its university. */
const oneSchool = (a: string, b: string): boolean => a !== b && [a, b].includes('faculty') && [a, b].includes('university');

/** The schools and universities under the education headings, as the CV lists them, at most 5. */
function educationDetailsOf(items: readonly CvItem[], current: number): CvEducationEntry[] {
  type Draft = { schools: { kind: string; text: string }[]; degree: string | null; year: number | null };
  const drafts: Draft[] = [];
  let cur: Draft | null = null;
  for (const it of items) {
    if (it.section !== 'education' || it.heading) continue;
    const e = educationLineOf(it.line, current);
    const named = e.institutions.length > 0 || e.degree !== null;
    if (!named && e.year === null) continue;
    // a second degree, or another school (but a faculty and its university: one), is the next one's
    const next = !cur || (e.degree !== null && cur.degree !== null) || e.institutions.some((s) => cur!.schools.some((c) => !oneSchool(c.kind, s.kind))) || (!named && cur.year !== null);
    if (next) {
      cur = { schools: [], degree: null, year: null };
      drafts.push(cur);
    }
    cur!.schools.push(...e.institutions);
    cur!.degree ??= e.degree;
    if (e.year !== null) cur!.year = Math.max(cur!.year ?? 0, e.year);
  }
  return drafts
    .map((d) => {
      const texts = unique(d.schools.map((s) => s.text));
      return { institution: educationValue(texts.length ? texts.join(texts.some(isArabicText) ? '، ' : ', ') : null), degree: educationValue(d.degree), graduationYear: d.year };
    })
    .filter((d) => d.institution || d.degree)
    .slice(0, 5);
}

// ---------- the skills, the certifications, the city ----------

/** The dictionary's skills a text names (whole words, any case and punctuation), in the order found, at most 30. */
export function cvSkillsIn(text: string, dictionary: readonly DictionarySkill[] = SKILLS_DICTIONARY): string[] {
  const lines = text.split(/\r?\n|\r|\f/).map(normalForMatch);
  const hay = ` ${lines.join(' ')} `;
  const found: { name: string; at: number }[] = [];
  for (const skill of dictionary) {
    let at = Infinity;
    const loose = (skill.loose ?? []).map(normalForMatch).filter(Boolean);
    for (const name of [skill.name, ...(skill.aliases ?? [])]) {
      const needle = normalForMatch(name);
      // a loose name (its own name too: "Word") is looked for below only
      const i = needle && !loose.includes(needle) ? hay.indexOf(` ${needle} `) : -1;
      if (i >= 0 && i < at) at = i;
    }
    // a word too common alone ("Word"): only on a line naming its company ("MS Office: Word, Excel")
    if (loose.length && skill.looseWith?.length) {
      const withWords = skill.looseWith.map(normalForMatch).filter(Boolean);
      let offset = 0;
      for (const line of lines) {
        const l = ` ${line} `;
        if (withWords.some((w) => l.includes(` ${w} `))) {
          for (const w of loose) {
            const i = l.indexOf(` ${w} `);
            if (i >= 0 && offset + i < at) at = offset + i;
          }
        }
        offset += line.length + 1;
      }
    }
    if (at < Infinity) found.push({ name: skill.name, at });
  }
  return found
    .sort((a, b) => a.at - b.at)
    .slice(0, 30)
    .map((f) => f.name);
}

/** The lines under the certifications or courses headings, at most 10 (a line starting in lower case is the one before's, wrapped). */
function certificationsOf(items: readonly CvItem[], current: number): string[] {
  const out: string[] = [];
  for (const it of items) {
    if (it.section !== 'certifications' || it.heading) continue;
    const bulleted = BULLET_START.test(it.line.shown);
    const t = tidyLine(it.line).shown;
    if ((t.match(/\p{L}/gu) ?? []).length < 3) continue;
    // a date alone, or a range alone: the line before's
    if (!hasLetter(cut(it.line, rangesIn(it.line.key, current)).shown.replace(LONE_YEAR, '').replace(new RegExp(MONTH_WORDS, 'giu'), ''))) continue;
    if (out.length && !bulleted && /^[a-z(&]/.test(t)) out[out.length - 1] = `${out[out.length - 1]} ${t}`.slice(0, 120).trim();
    else out.push(t.slice(0, 120).trim());
  }
  return out.slice(0, 10);
}

/** Emails and links, left out of a line before a place is looked for in it. */
const NOT_PLACES = new RegExp(`${EMAIL.source}|${URL_LIKE.source}`, 'gi');
const CITY_AND_COUNTRY =
  /(?:^|[|•·,،]\s*|\s{2,}|:\s*)([A-Z][A-Za-z'’.-]+(?: [A-Z][A-Za-z'’.-]+){0,2}),\s*(UAE|U\.A\.E\.?|United Arab Emirates|Saudi Arabia|KSA|K\.S\.A\.?|Qatar|Kuwait|Bahrain|Oman|Jordan|Lebanon|Iraq|Morocco|Tunisia|UK|United Kingdom|USA|U\.S\.A\.?|United States|Germany|France|Canada|Turkey|Egypt)(?![A-Za-z])/;
const NOT_A_CITY = /(?<![\p{L}])(?:street|st|road|rd|avenue|ave|building|bldg|floor|apt|apartment|block|district|university|faculty|college|institute|academy|school)(?![\p{L}])/iu;

/** Where the person lives: the first Egyptian city or governorate in the CV's top or contact section, else a city with its country. */
function cityOf(items: readonly CvItem[]): string | null {
  const scope = items.filter((it, i) => !it.heading && ((it.section === 'top' && i < 25) || it.section === 'contact'));
  for (const it of scope) {
    const line = cut(it.line, spansIn(it.line.key, NOT_PLACES));
    // the earliest place named in the line (the longest when two start together), never in a university's name
    let best: { name: string; index: number; length: number } | null = null;
    for (const p of EGYPT_PLACE_RES) {
      for (const m of line.key.matchAll(new RegExp(p.re.source, 'gu'))) {
        const segment = splitLine(line, /[,،|•·;]|\s[-–—]\s/gu).find((s, k, all) => {
          const start = all.slice(0, k).reduce((n, x) => n + x.key.length + 1, 0);
          return m.index >= start && m.index < start + s.key.length + 1;
        });
        if (segment && INSTITUTION_ANY.test(segment.key)) continue;
        if (!best || m.index < best.index || (m.index === best.index && m[0].length > best.length)) best = { name: p.name, index: m.index, length: m[0].length };
        break;
      }
    }
    if (best) return best.name;
    const cc = CITY_AND_COUNTRY.exec(line.shown);
    if (cc && !NOT_A_CITY.test(cc[1])) return `${cc[1]}, ${cc[2]}`;
  }
  return null;
}

/** What the rules find besides the contacts, years, level and languages (24 October 2026). */
function moreFactsOf(
  text: string,
  now: Date,
): Pick<CvFacts, 'latestTitle' | 'latestCompany' | 'workHistory' | 'educationDetails' | 'cvSkills' | 'certifications' | 'city'> {
  const current = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const items = cvItems(cvLines(text));
  const workHistory = workHistoryOf(items, current);
  return {
    latestTitle: workHistory[0]?.pastTitle ?? null,
    latestCompany: workHistory[0]?.pastCompany ?? null,
    workHistory,
    educationDetails: educationDetailsOf(items, current),
    cvSkills: cvSkillsIn(text),
    certifications: certificationsOf(items, current),
    city: cityOf(items),
  };
}

// ---------- all of it ----------

/** What the rules find in a CV's text (`now`: the month "present" means). */
export function cvFacts(text: string, now: Date = new Date()): CvFacts {
  const plain = plainDigits(text);
  const emails = emailsOf(plain);
  const { linkedin, links } = linksOf(plain, emails);
  return {
    version: CV_FACTS_VERSION,
    emails,
    phones: phonesOf(plain.replace(EMAIL, ' ')),
    linkedin,
    links,
    experienceMonths: experienceMonths(text, now),
    education: educationLevel(text),
    languages: languagesOf(text),
    ...moreFactsOf(text, now),
  };
}

const POINT_KEPT = /^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/;

/**
 * Facts as kept (JSON), read back safely: anything missing or of another kind as none. Facts kept before 24 October 2026
 * (version 1) read with the work history, education details, skills, certifications and city empty.
 */
export function cvFactsOf(value: unknown): CvFacts | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const strings = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
  const text = (x: unknown) => (typeof x === 'string' && x.trim() ? x : null);
  const objects = (x: unknown) => (Array.isArray(x) ? x.filter((o): o is Record<string, unknown> => !!o && typeof o === 'object' && !Array.isArray(o)) : []);
  const point = (x: unknown) => (typeof x === 'string' && POINT_KEPT.test(x) ? x : null);
  return {
    version: typeof v.version === 'number' && Number.isInteger(v.version) && v.version > 0 ? v.version : 1,
    emails: strings(v.emails),
    phones: strings(v.phones),
    linkedin: typeof v.linkedin === 'string' ? v.linkedin : null,
    links: strings(v.links),
    experienceMonths: typeof v.experienceMonths === 'number' ? v.experienceMonths : null,
    education: (EDUCATION_LEVELS as readonly string[]).includes(v.education as string) ? (v.education as EducationLevel) : null,
    languages: strings(v.languages),
    latestTitle: text(v.latestTitle),
    latestCompany: text(v.latestCompany),
    workHistory: objects(v.workHistory)
      .map((w): CvWorkEntry => ({ pastTitle: text(w.pastTitle), pastCompany: text(w.pastCompany), from: point(w.from), to: w.current === true ? null : point(w.to), current: w.current === true }))
      .filter((w) => w.pastTitle || w.pastCompany)
      .slice(0, 10),
    educationDetails: objects(v.educationDetails)
      .map((e): CvEducationEntry => ({
        institution: text(e.institution),
        degree: text(e.degree),
        graduationYear: typeof e.graduationYear === 'number' && Number.isInteger(e.graduationYear) ? e.graduationYear : null,
      }))
      .filter((e) => e.institution || e.degree)
      .slice(0, 5),
    cvSkills: strings(v.cvSkills).slice(0, 30),
    certifications: strings(v.certifications).slice(0, 10),
    city: text(v.city),
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
  // 24 October 2026: more found by the rules (CvFacts); a developer's masked (developer.ts) but for the skills
  latestTitle: string | null;
  latestCompany: string | null;
  workHistory: CvWorkEntry[];
  educationDetails: CvEducationEntry[];
  /** The dictionary's skills the CV names (not the vacancy's key skills: `skills`). */
  cvSkills: string[];
  certifications: string[];
  city: string | null;
}

/**
 * What a list shows of a CV's reading (24 October 2026): its status ("Reading…"), the months its dates add up to (the
 * Experience column's "≈ 4 y · CV" when no years were typed) and the latest job (the "Latest role" column).
 */
export interface CvListFacts {
  status: CvReadingStatus;
  experienceMonths: number | null;
  latestTitle: string | null;
  latestCompany: string | null;
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
