// The CV fit (owner, 25 October 2026, on the Marketing Manager vacancy, whose 18 applicants added from Suggested From
// Earlier CVs showed Match "No answers" and CV match "—": "aren't you supposed to match the candidate to the job based on
// the CV and ATS?"; asked, they chose "Full CV fit score"). Until then the CV match was the vacancy's key skills found in
// the CV ÷ those listed, none without key skills. Now each read CV is scored against the whole job, by rules only (no AI,
// as the CV reading is), out of 100:
// - Key skills, 35: found ÷ listed, as before; a skill of the dictionary (skills-dictionary.ts) found under any of its
//   other names too ("Facebook Ads" for "Meta Ads").
// - Title, 25: the best likeness (cv-analysis.ts titleLikeness, the rank words left out) of the vacancy's title (or its
//   job title's) to the CV's job titles, the latest counting in full and each earlier one 10% less (at least 60%); a
//   general CV's chosen position counts in full.
// - Experience, 20: the years (typed, else the CV's dates) against what the job asks, read from its requirements ("5+
//   years", "3–5 years", "at least 4 years", "خبرة ٥ سنوات"), else its other texts, else its screening questions' least,
//   else its grade's text (no grade states years today). Full inside the range; below it, the share of the least
//   (4 of 5 years: 80); above it, 4 less a year past the most, never below 70; "5+" has no most: twice the least, at
//   least 3 more (5+ is full up to 10).
// - Requirements, 15: the meaningful terms of the requirements and responsibilities (HTML stripped, English and Arabic
//   stop words and job-ad fillers left out, the dictionary's skills as one term with their other names, the key skills
//   left to their own part), the most named first, at most 20, found in the CV ÷ those listed.
// - Education, 5: the degree level the requirements name (the lowest when several: "Bachelor's or Master's" asks a
//   bachelor's), the CV's level at or above it in full, one below half; and a field when they name one ("a degree in
//   Marketing or Business"), found in the CV's education.
// - Agency background (owner, 27 October 2026: "i need a flag if the candidate is ex marketing agencies or not AND
//   reflectin the scoring"; he chose "Set per job" and "Yes or no"): as the vacancy says, required 20 or preferred 10 on
//   top of the 100 (the others then shrink to fit), not needed left out; 6 months or more at marketing agencies in all
//   (marketing-agencies.ts, HR's marks included) in full, less half, none 0.
// A part that can't be scored is left out and the others re-weighted to 100: no key skills listed, no job title found in
// the CV, no years asked or none known, fewer than 3 requirements terms, no education asked, agency background not
// needed or no work history read in the CV. The result is null only for
// a CV not read or without text; its percent null when nothing could be scored. Kept with its version (CV_FIT_VERSION):
// a fit of an earlier version is worked out again (CvReadingsService.refreshFits).
// Also here: the key skills suggested from a vacancy's texts (owner: "when a vacancy has no key skills, suggest them from
// its description for HR to confirm"), the other open positions a CV fits (owner, 25 October 2026: "and if it recomended
// to another position based on the CV": a badge at 60% and 10 points above this one's fit, the top 3 at 50%), and the
// breakdown in words. Pure code, tested in apps/api/src/common/cv-fit.spec.ts.

import { cvSkillsIn, EDUCATION_LEVEL_LABELS, EDUCATION_LEVELS, KEY_SKILLS_LIMITS, normalForMatch, textAmount, titleLikeness, type CvFacts, type EducationLevel } from './cv-analysis.js';
import { HIDDEN } from './developer.js';
import { AGENCY_BACKGROUND_DEFAULT, AGENCY_BACKGROUND_LABELS, AGENCY_FIT_WEIGHTS, agencyMonthsText, agencyScore, type AgencyBackground, type AgencyBackgroundWanted } from './marketing-agencies.js';
import { SKILLS_DICTIONARY, type DictionarySkill } from './skills-dictionary.js';

// ---------- the parts ----------

/** The fit's version, kept with it: one of an earlier version is worked out again (2: agency background, 27 October 2026). */
export const CV_FIT_VERSION = 2;

export const CV_FIT_PARTS = ['skills', 'title', 'experience', 'requirements', 'education', 'agency'] as const;
export type CvFitPartKey = (typeof CV_FIT_PARTS)[number];

/**
 * Each part's weight, 100 in all before those that can't be scored are left out; agency background's on top, as the
 * vacancy asks it (AGENCY_FIT_WEIGHTS: required 20, preferred 10, the weight here).
 */
export const CV_FIT_WEIGHTS: Readonly<Record<CvFitPartKey, number>> = { skills: 35, title: 25, experience: 20, requirements: 15, education: 5, agency: AGENCY_FIT_WEIGHTS.preferred };

export const CV_FIT_LABELS: Readonly<Record<CvFitPartKey, string>> = {
  skills: 'Key skills',
  title: 'Title',
  experience: 'Experience',
  requirements: 'Requirements',
  education: 'Education',
  agency: 'Agency background',
};

export const CV_FIT_LIMITS = {
  /** The requirements' terms counted, at most. */
  terms: 20,
  /** Fewer terms than this: the requirements part isn't scored. */
  minTerms: 3,
  /** Each earlier job's title counts this much less than the one after it (the latest in full)… */
  earlierTitleStep: 0.1,
  /** …but never less than this. */
  earlierTitleFloor: 0.6,
  /** Above the most years asked: this many points less a year… */
  overYearStep: 4,
  /** …never below this. */
  overYearsFloor: 70,
} as const;

/** Where the years a job asks were read: its requirements, its other texts, its screening questions, its grade's text. */
export type YearsSource = 'requirements' | 'description' | 'questions' | 'grade';

/** The years a job asks: at least `min`, at most `max` (null: no most, "5+"). */
export interface YearsWanted {
  min: number;
  max: number | null;
  from: YearsSource;
}

/** Where the CV's title most like the job's was: its latest job, an earlier one, or the position chosen (a general CV). */
export type FitTitleFrom = 'latest' | 'earlier' | 'position';

/**
 * A part of the fit: its score 0 to 100, its weight (its share of the percent once those not scored are left out, of
 * 100) and its detail in words, never naming the person's past titles (they are `matchedTitle`, which a developer never
 * reads: developer.ts). With what it found, by part.
 */
export interface CvFitPart {
  key: CvFitPartKey;
  label: string;
  score: number;
  weight: number;
  /** "4 of 6: Meta Ads, SEO, …; missing Google Ads"; "8 years; the job asks 5–8 years". */
  detail: string;
  /** Key skills and requirements: those found and not, and how many were listed. */
  found?: string[];
  missing?: string[];
  listed?: number;
  /** Title: the CV's title most like the job's (null: none like it), where it was, and how alike (0 to 1). */
  matchedTitle?: string | null;
  titleFrom?: FitTitleFrom | null;
  likeness?: number;
  /** Their words alike both ways (the rank words aside): "the same title". */
  sameTitle?: boolean;
  /** Experience: the years counted (typed, else the CV's dates: `fromCv`) and those asked. */
  years?: number;
  fromCv?: boolean;
  wanted?: YearsWanted;
  /** Education: the CV's level and the one asked, the fields asked, and whether the CV's education names one. */
  level?: EducationLevel | null;
  wantedLevel?: EducationLevel | null;
  fields?: string[];
  fieldMet?: boolean | null;
  /** Agency background: whether ex-agency, its months at marketing agencies, and what the vacancy asks. */
  exAgency?: boolean;
  agencyMonths?: number;
  agencyWanted?: AgencyBackgroundWanted;
}

/** A CV's fit for a job: the percent (null when nothing could be scored), the version, the parts scored. */
export interface CvFit {
  percent: number | null;
  version: number;
  parts: CvFitPart[];
}

// ---------- the inputs ----------

/** A vacancy as its fit is worked out. */
export interface FitVacancyInput {
  title: string;
  /** Its job title's own name, likened too (the vacancy's title may say more: "Marketing Manager (Remote)"). */
  jobTitle?: string | null;
  keySkills: readonly string[];
  /** HTML, as kept. */
  requirements?: string | null;
  responsibilities?: string | null;
  about?: string | null;
  /** The least years its screening questions ask (suggested-cvs.ts minYearsWanted); null: none. */
  minYears?: number | null;
  /** Its grade's description, read for years when it states them (no grade does today: G1 … G9 carry none). */
  gradeText?: string | null;
  /** What it asks of marketing agency background (27 October 2026); missing: preferred, the default. */
  agencyBackground?: AgencyBackgroundWanted | null;
}

/** A CV as its fit is worked out: its reading's text and facts, the years typed with it, a general CV's position. */
export interface FitCvInput {
  /** The reading's text; null: not read. */
  text: string | null;
  facts: CvFacts | null;
  yearsTyped?: number | null;
  /** A general CV's position (chosen, or written for Other), or that of the general CV an application came from. */
  position?: string | null;
  /** Its marketing agency background (marketing-agencies.ts agencyBackgroundOf, HR's marks included); null: not told. */
  agency?: AgencyBackground | null;
}

// ---------- normalising ----------

/** An HTML text as words: tags out (a block's end a new line), the common entities read. */
export function htmlText(html: string | null | undefined): string {
  if (!html) return '';
  const code = (n: number) => (Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ' ');
  return html
    .replace(/<\s*(?:br|\/?p|\/?li|\/?div|\/?h[1-6]|\/?tr|\/?ul|\/?ol)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d: string) => code(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => code(parseInt(h, 16)))
    .replace(/&amp;/gi, '&')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n[\s]*/g, '\n')
    .trim();
}

const isArabicWord = (w: string) => /[؀-ۿ]/.test(w);

/**
 * A word as terms are compared, lightly stemmed: in English its plural's s off ("campaigns" is "campaign", "agencies"
 * "agency"), then -ing, -ment or -ed, a final e and a doubled last letter ("reporting" is "report", "management" and
 * "managed" are "manag", "planning" is "plan"); in Arabic the article ("التسويق" is "تسويق"). Both sides alike, so a
 * requirement's "report" is found in a CV's "reporting".
 */
export function termStem(word: string): string {
  if (isArabicWord(word)) {
    const m = /^(?:وال|بال|فال|كال|لل|ال)(.{3,})$/u.exec(word);
    return m ? m[1] : word;
  }
  let w = word;
  if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && /(?:ches|shes|sses|xes)$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !/(?:ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (!/^[a-z]+$/.test(w)) return w;
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 6 && w.endsWith('ment')) w = w.slice(0, -4);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
  if (w.length > 3 && /([b-df-hj-np-tv-z])\1$/.test(w)) w = w.slice(0, -1);
  return w;
}

/** The dictionary's skills by each of their names, as compared. */
const DICTIONARY_BY_NAME: ReadonlyMap<string, DictionarySkill> = new Map(SKILLS_DICTIONARY.flatMap((s) => [s.name, ...(s.aliases ?? [])].map((n) => [normalForMatch(n), s] as const)));

/** A skill's ways of writing, as compared: itself, and for a dictionary skill its name and other names (never a loose one alone). */
function needlesOf(skill: string): string[] {
  const own = normalForMatch(skill);
  const entry = DICTIONARY_BY_NAME.get(own);
  const loose = new Set((entry?.loose ?? []).map(normalForMatch));
  const all = entry ? [entry.name, ...(entry.aliases ?? [])].map(normalForMatch).filter((n) => n && !loose.has(n)) : [];
  return [...new Set([own, ...all].filter(Boolean))];
}

/** Whether a prepared text (" its words ") names one of the needles, whole words. */
const names = (hay: string, needles: readonly string[]) => needles.some((n) => hay.includes(` ${n} `));

// ---------- the key skills found ----------

/**
 * Which key skills a text names, and which not, each in its order (cv-analysis.ts cvSkillsFound's rule: whole words, any
 * case and punctuation, Arabic too), a skill of the dictionary under any of its other names too.
 */
export function keySkillsFound(text: string, skills: readonly string[]): { found: string[]; missing: string[] } {
  const hay = ` ${normalForMatch(text)} `;
  const found: string[] = [];
  const missing: string[] = [];
  for (const s of skills) (names(hay, needlesOf(s)) ? found : missing).push(s);
  return { found, missing };
}

// ---------- the years a job asks ----------

/** Numbers as words, English and Arabic (as compared: ة as ه), for "five years", "خمس سنوات". */
const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  واحد: 1,
  واحده: 1,
  اثنين: 2,
  اثنان: 2,
  ثلاث: 3,
  ثلاثه: 3,
  اربع: 4,
  اربعه: 4,
  خمس: 5,
  خمسه: 5,
  ست: 6,
  سته: 6,
  سبع: 7,
  سبعه: 7,
  ثمان: 8,
  ثماني: 8,
  ثمانيه: 8,
  تسع: 9,
  تسعه: 9,
  عشر: 10,
  عشره: 10,
};
const NUMBER_WORD = new RegExp(`(?<![\\p{L}\\p{N}])(?:${Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length).join('|')})(?![\\p{L}\\p{N}])`, 'gu');

/** A job's text as its years are read: plain digits, lower case, Arabic plain, numbers in words as digits, one kind of dash. */
function yearsForm(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[–—−]/g, '-')
    // two years in a word: سنتين, سنتان, عامين
    .replace(/(?<!\p{L})(?:سنتين|سنتان|عامين|عامان)(?!\p{L})/gu, '2 سنوات')
    .replace(NUMBER_WORD, (w) => String(NUMBER_WORDS[w]))
    .replace(/[ \t]+/g, ' ');
}

const N = '(?<![\\d.])(\\d{1,2}(?:\\.\\d)?)(?![\\d])';
const Y = '(?:years?|yrs?|سنوات|سنين|سنه|اعوام|عام)(?![\\p{L}])';
/** The ways a text asks years, each read as a least and a most, in the order tried (a range before its "5 years"). */
const YEARS_RULES: { re: RegExp; read: (m: RegExpExecArray) => { min: number; max: number | null } }[] = [
  // "3-5 years", "3 to 5 years", "from 3 to 5 years", "من ٣ الى ٥ سنوات", "between 3 and 5 years"
  { re: new RegExp(`(?:between\\s+)?${N}\\s*(?:-|to|and|الي|حتي|او|~)\\s*${N}\\s*\\+?\\s*${Y}`, 'gu'), read: (m) => ({ min: Number(m[1]), max: Number(m[2]) }) },
  // "at least 4 years", "minimum of 3 years", "no less than 2 years", "over 5 years", "لا تقل عن ٣ سنوات"
  {
    re: new RegExp(`(?:at\\s+least|minimum(?:\\s+of)?|min\\.?|no\\s+less\\s+than|not\\s+less\\s+than|over|more\\s+than|in\\s+excess\\s+of|ما\\s+لا\\s+يقل\\s+عن|لا\\s+تقل\\s+عن|لا\\s+يقل\\s+عن|علي\\s+الاقل|اكثر\\s+من)\\s*${N}\\s*\\+?\\s*${Y}`, 'gu'),
    read: (m) => ({ min: Number(m[1]), max: null }),
  },
  // "up to 3 years", "no more than 2 years", "لا تزيد عن سنتين"
  { re: new RegExp(`(?:up\\s+to|maximum(?:\\s+of)?|max\\.?|no\\s+more\\s+than|less\\s+than|لا\\s+تزيد\\s+عن|لا\\s+يزيد\\s+عن)\\s*${N}\\s*${Y}`, 'gu'), read: (m) => ({ min: 0, max: Number(m[1]) }) },
  // "5+ years", "5 years+", "5 years or more", "٥ سنوات فأكثر", and "5 years of experience", "خبرة ٥ سنوات"
  { re: new RegExp(`${N}\\s*\\+?\\s*${Y}`, 'gu'), read: (m) => ({ min: Number(m[1]), max: null }) },
];

/** Years that aren't experience: an age ("aged 25-35 years", "years old"), a contract's or a course's length. */
const NOT_EXPERIENCE_BEFORE = /(?<![\p{L}])(?:age|ages|aged|عمر|العمر|السن|سن)(?![\p{L}])[^\n]{0,12}$/u;
const NOT_EXPERIENCE_AFTER = /^[\s-]*(?:old|of\s+age|contract|degree|program|programme|diploma|course|warranty|عقد|عمر)(?![\p{L}])/u;
/** Words of experience: outside the requirements, a line's years count only beside one ("10 years in business" doesn't). */
const EXPERIENCE_WORD = /(?<![\p{L}])(?:experience|experienced|exp|track record|background|خبره|خبرات|الخبره)(?![\p{L}])/u;

/**
 * The years a text asks: the mention with the largest least (a range before an open one on a tie); null when none.
 * `strict` (a job's texts but its requirements): only on a line that speaks of experience.
 */
export function yearsWantedIn(text: string, strict = false): { min: number; max: number | null } | null {
  const t = yearsForm(text);
  if (!t.trim()) return null;
  let best: { min: number; max: number | null } | null = null;
  const taken: [number, number][] = [];
  for (const rule of YEARS_RULES) {
    const re = new RegExp(rule.re.source, rule.re.flags);
    for (let m = re.exec(t); m; m = re.exec(t)) {
      const start = m.index;
      const end = start + m[0].length;
      if (taken.some(([a, b]) => start < b && end > a)) continue;
      taken.push([start, end]);
      if (NOT_EXPERIENCE_BEFORE.test(t.slice(Math.max(0, start - 30), start)) || NOT_EXPERIENCE_AFTER.test(t.slice(end, end + 25))) continue;
      if (strict) {
        const lineStart = t.lastIndexOf('\n', start) + 1;
        const lineEnd = t.indexOf('\n', end);
        if (!EXPERIENCE_WORD.test(t.slice(lineStart, lineEnd < 0 ? t.length : lineEnd))) continue;
      }
      const w = rule.read(m);
      if (!(w.min >= 0 && w.min <= 40) || (w.max !== null && !(w.max >= w.min && w.max <= 50 && w.max > 0))) continue;
      if (!best || w.min > best.min || (w.min === best.min && best.max === null && w.max !== null)) best = w;
    }
  }
  return best;
}

/** The years a job asks: its requirements, else its other texts, else its screening questions' least, else its grade's text. */
export function yearsWantedOf(v: Pick<FitVacancyInput, 'requirements' | 'responsibilities' | 'about' | 'minYears' | 'gradeText'>): YearsWanted | null {
  const req = yearsWantedIn(htmlText(v.requirements));
  if (req) return { ...req, from: 'requirements' };
  const other = yearsWantedIn(`${htmlText(v.responsibilities)}\n${htmlText(v.about)}`, true);
  if (other) return { ...other, from: 'description' };
  if (typeof v.minYears === 'number' && v.minYears > 0) return { min: v.minYears, max: null, from: 'questions' };
  const grade = yearsWantedIn(v.gradeText ?? '');
  return grade ? { ...grade, from: 'grade' } : null;
}

/**
 * The years' score, 0 to 100: full from the least to the most; below the least, the share of it (4 of 5: 80); above the
 * most, 4 points less a year, never below 70. With no most ("5+"), the most is twice the least, at least 3 more.
 */
export function yearsScore(years: number, w: { min: number; max: number | null }): number {
  if (years < w.min) return Math.max(0, Math.round((100 * years) / w.min));
  const upper = w.max ?? Math.max(2 * w.min, w.min + 3);
  if (years <= upper) return 100;
  return Math.max(CV_FIT_LIMITS.overYearsFloor, Math.round(100 - CV_FIT_LIMITS.overYearStep * (years - upper)));
}

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''));

/** The years asked in words: "5–8 years", "5+ years", "up to 3 years", "2 years". */
export function yearsWantedText(w: { min: number; max: number | null }): string {
  if (w.max === null) return `${num(w.min)}+ years`;
  if (w.min === 0) return `up to ${num(w.max)} ${w.max === 1 ? 'year' : 'years'}`;
  if (w.min === w.max) return `${num(w.min)} ${w.min === 1 ? 'year' : 'years'}`;
  return `${num(w.min)}–${num(w.max)} years`;
}

/** The years asked, short: "5–8", "5+", "≤ 3". */
const wantedShort = (w: { min: number; max: number | null }) => (w.max === null ? `${num(w.min)}+` : w.min === 0 ? `≤ ${num(w.max)}` : w.min === w.max ? num(w.min) : `${num(w.min)}–${num(w.max)}`);

// ---------- the requirements' terms ----------

/** Words that say nothing of the job: English and Arabic (as compared), the fillers of job ads and the soft skills every CV names. */
const STOP_WORDS: ReadonlySet<string> = new Set(
  [
    // English
    'a about above across after again against all also always am an and any are around as at be because been before being below between both but by can could did do does doing done down during each either else etc even ever every few for from further get gets getting give given go going had has have having he her here hers him his how however i if in into is it its itself just keep least less like made make makes making many may me might more most much must my need needed needs no nor not now of off often on once one only or other others our ours out over own per please rather same shall she should since so some such than that the their theirs them then there these they this those through thus to too toward towards under until up upon us use used uses using very via was we well were what when where whether which while who whom whose why will with within without would yet you your yours',
    // the fillers of job ads
    'ability able abilities according accordance accurate accurately achieve activities additional advanced apply applicant applicants area areas assigned assist assisting attention basic best candidate candidates closely company daily day deadline deadlines demonstrated desired detail details different duties duty effective effectively efficient efficiently ensure ensuring environment equivalent excellent existing experience experienced expertise familiar familiarity field fields following full functional good great handle handling high highly ideal ideally including include includes independently job jobs key knowledge large level manner member members minimum multiple ongoing optional overall part position positive possess preferably preferred previous proficiency proficient proven qualification qualifications related relevant required requirement requirements responsibilities responsibility responsible role roles similar skill skilled skills solid strong successful successfully support supporting task tasks time timely track record understanding various verbal work working works written year years month months week weeks new plus least',
    // the verbs every job ad uses
    'run help provide take carry conduct perform deliver drive oversee maintain prepare involve hands hand',
    // the education's words: the education part reads them
    'degree bachelor bachelors master masters diploma graduate graduates graduated university faculty college phd doctorate mba bsc',
    // the soft skills every CV names
    'communication communications communicate interpersonal teamwork motivated self starter attitude pressure fast paced oriented organized organised organizational organisational multitask multitasking problem solving solver punctual commitment committed eager willing willingness passion passionate',
    // Arabic
    'في من على علي الى إلى الي عن مع او أو و ثم ان أن إن لا ما هذا هذه ذلك تلك التي الذي الذين كل بعض غير بين عند حتى حتي قد لقد كان كانت يكون تكون هو هي هم نحن انت لدى لدي لديه لديها مثل ضمن خلال حول اي أي اكثر أكثر اقل أقل جيد جيدة جيده ممتاز ممتازة ممتازه القدرة القدره قدرة قدره مهارات مهارة مهاره المهارات خبرة خبره الخبرة الخبره سنوات سنة سنه عام اعوام العمل عمل فريق الفريق المطلوبة المطلوبه المطلوب مطلوب يفضل يجب معرفة معرفه المعرفة المعرفه اجادة اجاده إجادة الوظيفة الوظيفه المسؤوليات المهام مهام المؤهلات مؤهل بكالوريوس ليسانس شهادة شهاده',
  ]
    .join(' ')
    .split(/\s+/)
    .map(normalForMatch)
    .filter(Boolean),
);
/** The stop words as stems: "responsibilities" and "responsibility" alike. */
const STOP_STEMS: ReadonlySet<string> = new Set([...STOP_WORDS].map(termStem));

/** A requirements' term: as first written (as compared), and how it is found in a CV (its stem, or a skill's names). */
export interface FitTerm {
  term: string;
  /** A single word's stem; null for a dictionary skill (found by its names). */
  stem: string | null;
  needles: string[];
}

/**
 * The meaningful terms of a job's requirements and responsibilities (HTML stripped): the dictionary's skills named there
 * (one term each, found by any of their names), then the other words but the stop words, numbers and words of fewer than
 * 3 letters, each once (as its stem); the key skills and their words left to their own part. The most named first (then
 * the first named), the skills before the words, at most 20.
 */
export function requirementTerms(v: Pick<FitVacancyInput, 'requirements' | 'responsibilities' | 'keySkills'>): FitTerm[] {
  const text = [htmlText(v.requirements), htmlText(v.responsibilities)].filter(Boolean).join('\n');
  if (!text) return [];
  const hay = ` ${normalForMatch(text)} `;
  const keyNeedles = new Set(v.keySkills.flatMap(needlesOf));
  const keyWords = new Set([...keyNeedles].flatMap((n) => n.split(' ')).map(termStem));
  const countOf = (needle: string) => hay.split(` ${needle} `).length - 1;
  const named = cvSkillsIn(text).map((name, order) => ({ name, order, needles: needlesOf(name) }));
  const skills = named
    .filter((s) => !s.needles.some((n) => keyNeedles.has(n)))
    // its most written name counted ("DaVinci Resolve" holds "DaVinci": never twice)
    .map((s) => ({ ...s, count: Math.max(0, ...s.needles.map(countOf)) }))
    .sort((a, b) => b.count - a.count || a.order - b.order);
  const skillWords = new Set(named.flatMap((s) => s.needles).flatMap((n) => n.split(' ')));
  const words = new Map<string, { term: string; count: number; at: number }>();
  hay
    .trim()
    .split(' ')
    .forEach((w, at) => {
      if (!w || /^\d+$/.test(w) || [...w].length < 3 || STOP_WORDS.has(w) || skillWords.has(w)) return;
      const stem = termStem(w);
      if (STOP_STEMS.has(stem) || keyWords.has(stem) || stem.length < 3) return;
      const seen = words.get(stem);
      if (seen) seen.count++;
      else words.set(stem, { term: w, count: 1, at });
    });
  const ranked = [...words.entries()].sort((a, b) => b[1].count - a[1].count || a[1].at - b[1].at);
  return [
    ...skills.map((s): FitTerm => ({ term: s.name, stem: null, needles: s.needles })),
    ...ranked.map(([stem, w]): FitTerm => ({ term: w.term, stem, needles: [w.term] })),
  ].slice(0, CV_FIT_LIMITS.terms);
}

// ---------- the education a job asks ----------

/** The levels a job's text names, as compared (the lowest named is the least asked). */
const LEVEL_RULES: [EducationLevel, RegExp][] = [
  ['high_school', /(?<![\p{L}])(?:high school|secondary school|thanaweya)(?![\p{L}])|ثانويه/u],
  ['diploma', /(?<![\p{L}])(?:diploma|associate degree)(?![\p{L}])|دبلوم|مؤهل متوسط/u],
  ['bachelor', /(?<![\p{L}])(?:bachelor|bachelors|bachelor s|bsc|b sc|ba|b a|beng|bcom|university degree|college degree|graduate of|graduated from|university graduate|undergraduate degree)(?![\p{L}])|بكالوريوس|ليسانس|مؤهل عالي|خريج/u],
  ['master', /(?<![\p{L}])(?:master|masters|master s|msc|m sc|mba|meng)(?![\p{L}])|ماجستير/u],
  ['doctorate', /(?<![\p{L}])(?:phd|ph d|doctorate)(?![\p{L}])|دكتوراه/u],
];

/**
 * "a degree in Marketing, Business or a related field", "Bachelor of Commerce", "بكالوريوس تجارة": the fields after it,
 * read on the line in lower case with its commas (Arabic plain: ة as ه, أ as ا).
 */
const FIELD_LEAD =
  /(?<![\p{L}])(?:degree|bachelor'?s?|master'?s?|b\.?\s?sc\.?|b\.a\.|m\.?\s?sc\.?|mba|diploma|graduate[ds]?|major(?:ing)?|speciali[sz]ation)\s+(?:degree\s+)?(?:in|of|from)\s+(?:the\s+)?(?:faculty\s+of\s+|field\s+of\s+)?([^\n.;()]+)|(?:بكالوريوس|ليسانس|خريج|كليه|مؤهل عالي)\s+(?:في\s+)?([^\n.;()]+)/u;
const FIELD_END = /(?<![\p{L}])(?:or\s+(?:a\s+|any\s+)?(?:related|relevant|similar|equivalent)|is\s+a\s+plus|preferred|required|with|او\s+ما\s+يعادل|يفضل)(?![\p{L}])/u;
const FIELD_SPLIT = /[,،/&]|(?<![\p{L}])(?:or|and|او)(?![\p{L}])/u;
const FIELD_NOISE = new Set(['a', 'an', 'the', 'any', 'related', 'relevant', 'field', 'fields', 'similar', 'equivalent', 'discipline', 'area', 'من', 'او', 'ما', 'يعادل', 'مجال', 'في']);

/** What education a job asks: the lowest level its requirements name and the fields after a degree's words; null: none. */
export function educationWantedIn(text: string): { level: EducationLevel | null; fields: string[] } | null {
  let level: EducationLevel | null = null;
  const fields: string[] = [];
  for (const raw of text.split('\n')) {
    const line = normalForMatch(raw);
    if (!line) continue;
    for (const [l, re] of LEVEL_RULES) {
      if (re.test(line) && (level === null || EDUCATION_LEVELS.indexOf(l) < EDUCATION_LEVELS.indexOf(level))) level = l;
    }
    const lower = raw.toLowerCase().replace(/[’‘]/g, "'").replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
    const m = FIELD_LEAD.exec(lower);
    const rest = m?.[1] ?? m?.[2];
    if (!rest) continue;
    for (const part of rest.split(FIELD_END)[0].split(FIELD_SPLIT)) {
      const words = normalForMatch(part)
        .split(' ')
        .filter((w) => w && !FIELD_NOISE.has(w) && !/^\d+$/.test(w));
      if (words.length && words.length <= 4 && !words.every((w) => STOP_WORDS.has(w))) fields.push(words.join(' '));
    }
  }
  const unique = [...new Set(fields)].slice(0, 5);
  return level || unique.length ? { level, fields: unique } : null;
}

// ---------- prepared once ----------

/** A job ready to score CVs against: its titles, key skills, years asked, terms and education asked. */
export interface FitJob {
  titles: string[];
  keySkills: { skill: string; needles: string[] }[];
  years: YearsWanted | null;
  terms: FitTerm[];
  education: { level: EducationLevel | null; fields: string[] } | null;
  agencyWanted: AgencyBackgroundWanted;
}

export function prepareFitJob(v: FitVacancyInput): FitJob {
  return {
    titles: [...new Set([v.title, v.jobTitle].map((t) => t?.trim() ?? '').filter(Boolean))],
    keySkills: v.keySkills.map((skill) => ({ skill, needles: needlesOf(skill) })),
    years: yearsWantedOf(v),
    terms: requirementTerms(v),
    education: educationWantedIn(htmlText(v.requirements)),
    agencyWanted: v.agencyBackground ?? AGENCY_BACKGROUND_DEFAULT,
  };
}

/** A CV ready to be scored: its words (" … "), their stems, its facts, its years, its titles and its education's words. */
export interface FitCv {
  hay: string;
  stems: ReadonlySet<string>;
  years: { years: number; fromCv: boolean } | null;
  titles: { title: string; from: FitTitleFrom; factor: number }[];
  level: EducationLevel | null;
  /** The stems of the words of its education's degrees and schools ("Bachelor of Commerce, Faculty of Commerce"). */
  educationStems: ReadonlySet<string>;
  /** Its marketing agency background; null: not told (no work history read). */
  agency: AgencyBackground | null;
}

/** A CV ready to be scored; null when it isn't read or has no text. */
export function prepareFitCv(cv: FitCvInput): FitCv | null {
  if (!cv.text || !textAmount(cv.text)) return null;
  const words = normalForMatch(cv.text);
  const f = cv.facts;
  const typed = typeof cv.yearsTyped === 'number' && Number.isFinite(cv.yearsTyped) ? cv.yearsTyped : null;
  const months = f?.experienceMonths ?? null;
  const titles: FitCv['titles'] = [];
  const history = (f?.workHistory ?? []).map((w) => w.pastTitle);
  if (f?.latestTitle && !history.includes(f.latestTitle)) history.unshift(f.latestTitle);
  history.forEach((title, i) => {
    if (title) titles.push({ title, from: i === 0 ? 'latest' : 'earlier', factor: Math.max(CV_FIT_LIMITS.earlierTitleFloor, 1 - CV_FIT_LIMITS.earlierTitleStep * i) });
  });
  if (cv.position?.trim()) titles.push({ title: cv.position.trim(), from: 'position', factor: 1 });
  const education = (f?.educationDetails ?? []).map((e) => [e.degree, e.institution].filter(Boolean).join(' ')).join(' ');
  return {
    hay: ` ${words} `,
    stems: new Set(words.split(' ').filter(Boolean).map(termStem)),
    years: typed !== null ? { years: typed, fromCv: false } : months !== null ? { years: months / 12, fromCv: true } : null,
    titles,
    level: f?.education ?? null,
    educationStems: new Set(normalForMatch(education).split(' ').filter(Boolean).map(termStem)),
    agency: cv.agency ?? null,
  };
}

// ---------- the score ----------

/** A list in words, the first `n` and "…" for the rest. */
const listed = (items: readonly string[], n: number) => `${items.slice(0, n).join(', ')}${items.length > n ? ', …' : ''}`;

const foundDetail = (found: readonly string[], missing: readonly string[], what = '') =>
  `${found.length} of ${found.length + missing.length}${what}${found.length ? `: ${listed(found, 4)}` : ''}${missing.length ? `; missing ${listed(missing, 3)}` : ''}`;

/**
 * How alike, in a word: the same (their words alike both ways, the rank words aside: "Senior Video Editor" for "Video
 * Editor"), close (half the job's words or more: "Digital Marketing Manager" for "Marketing Manager"), partly, not.
 */
export function likenessWord(likeness: number, same = false): 'same' | 'close' | 'partly' | 'not close' {
  if (same && likeness >= 0.999) return 'same';
  if (likeness >= 0.5) return 'close';
  if (likeness > 0) return 'partly';
  return 'not close';
}

const FROM_TEXT: Record<FitTitleFrom, string> = { latest: 'the latest job', earlier: 'an earlier job', position: 'the position they chose' };

type Scored = Omit<CvFitPart, 'weight'>;

function skillsPart(job: FitJob, cv: FitCv): Scored | null {
  if (!job.keySkills.length) return null;
  const found = job.keySkills.filter((k) => names(cv.hay, k.needles)).map((k) => k.skill);
  const missing = job.keySkills.filter((k) => !found.includes(k.skill)).map((k) => k.skill);
  return { key: 'skills', label: CV_FIT_LABELS.skills, score: Math.round((100 * found.length) / job.keySkills.length), detail: foundDetail(found, missing), found, missing, listed: job.keySkills.length };
}

function titlePart(job: FitJob, cv: FitCv): Scored | null {
  if (!cv.titles.length || !job.titles.length) return null;
  let best: { title: string; from: FitTitleFrom; factor: number; likeness: number; same: boolean; score: number } | null = null;
  for (const t of cv.titles) {
    for (const jt of job.titles) {
      const likeness = titleLikeness(jt, t.title);
      const score = likeness * t.factor;
      if (!best || score > best.score) best = { ...t, likeness, same: likeness >= 0.999 && titleLikeness(t.title, jt) >= 0.999, score };
    }
  }
  if (!best || best.score <= 0) return { key: 'title', label: CV_FIT_LABELS.title, score: 0, detail: 'No job title in the CV like the job’s', matchedTitle: null, titleFrom: null, likeness: 0 };
  const word = likenessWord(best.likeness, best.same);
  const said = word === 'same' ? 'The same title' : word === 'close' ? 'Close to the job’s title' : 'Partly like the job’s title';
  const counted = best.factor < 1 ? `, counted at ${Math.round(best.factor * 100)}% as an older job` : '';
  return {
    key: 'title',
    label: CV_FIT_LABELS.title,
    score: Math.round(best.score * 100),
    detail: `${said}: ${FROM_TEXT[best.from]}${counted}`,
    matchedTitle: best.title,
    titleFrom: best.from,
    likeness: Math.round(best.likeness * 100) / 100,
    sameTitle: best.same,
  };
}

/** The years in words: "8 years", "≈ 8 years (the CV's dates)", "less than a year". */
function yearsText(y: { years: number; fromCv: boolean }): string {
  if (y.fromCv) {
    const shown = y.years < 1 ? 'less than a year' : `≈ ${Math.round(y.years)} ${Math.round(y.years) === 1 ? 'year' : 'years'}`;
    return `${shown} (from the CV’s dates)`;
  }
  return `${num(y.years)} ${y.years === 1 ? 'year' : 'years'}`;
}

function experiencePart(job: FitJob, cv: FitCv): Scored | null {
  if (!job.years || !cv.years) return null;
  return {
    key: 'experience',
    label: CV_FIT_LABELS.experience,
    score: yearsScore(cv.years.years, job.years),
    detail: `${yearsText(cv.years)}; the job asks ${yearsWantedText(job.years)}`,
    years: Math.round(cv.years.years * 10) / 10,
    fromCv: cv.years.fromCv,
    wanted: job.years,
  };
}

function requirementsPart(job: FitJob, cv: FitCv): Scored | null {
  if (job.terms.length < CV_FIT_LIMITS.minTerms) return null;
  const isFound = (t: FitTerm) => (t.stem ? cv.stems.has(t.stem) : names(cv.hay, t.needles));
  const found = job.terms.filter(isFound).map((t) => t.term);
  const missing = job.terms.filter((t) => !isFound(t)).map((t) => t.term);
  return { key: 'requirements', label: CV_FIT_LABELS.requirements, score: Math.round((100 * found.length) / job.terms.length), detail: foundDetail(found, missing, ' terms'), found, missing, listed: job.terms.length };
}

const LEVEL_ASKED: Record<EducationLevel, string> = {
  high_school: 'high school',
  diploma: 'a diploma',
  bachelor: 'a bachelor’s degree',
  master: 'a master’s degree',
  doctorate: 'a doctorate',
};

function educationPart(job: FitJob, cv: FitCv): Scored | null {
  const e = job.education;
  if (!e) return null;
  const said: string[] = [];
  let levelScore: number | null = null;
  if (e.level) {
    const gap = cv.level ? EDUCATION_LEVELS.indexOf(e.level) - EDUCATION_LEVELS.indexOf(cv.level) : null;
    levelScore = gap === null ? 0 : gap <= 0 ? 100 : gap === 1 ? 50 : 0;
    said.push(`${cv.level ? EDUCATION_LEVEL_LABELS[cv.level] : 'No degree found'}; the job asks ${LEVEL_ASKED[e.level]}`);
  }
  let fieldMet: boolean | null = null;
  if (e.fields.length) {
    // a field is the CV's when each of its words is among its education's (any plural)
    fieldMet = e.fields.some((f) => f.split(' ').every((w) => cv.educationStems.has(termStem(w))));
    said.push(`the field ${fieldMet ? 'matches' : 'isn’t in the CV’s education'} (${e.fields.join(' or ')})`);
  }
  const fieldScore = fieldMet === null ? null : fieldMet ? 100 : 0;
  // both asked: the level 60%, the field 40%
  const score = levelScore !== null && fieldScore !== null ? Math.round(0.6 * levelScore + 0.4 * fieldScore) : (levelScore ?? fieldScore ?? 0);
  const detail = said.join('; ');
  return { key: 'education', label: CV_FIT_LABELS.education, score, detail: detail.charAt(0).toUpperCase() + detail.slice(1), level: cv.level, wantedLevel: e.level, fields: e.fields, fieldMet };
}

const WANTS: Record<AgencyBackgroundWanted, string> = { required: 'requires it', preferred: 'prefers it', not_needed: 'doesn’t need it' };

/** Agency background (27 October 2026): as the vacancy asks it, the CV's months at marketing agencies, yes or no. */
function agencyPart(job: FitJob, cv: FitCv): Scored | null {
  if (job.agencyWanted === 'not_needed' || !cv.agency) return null;
  const a = cv.agency;
  const said = !a.exAgency ? 'No marketing agency in the work history' : a.months > 0 ? `Ex-agency: ${agencyMonthsText(a.months)} at marketing agencies` : 'Ex-agency: its months not read';
  return {
    key: 'agency',
    label: CV_FIT_LABELS.agency,
    score: agencyScore(a),
    detail: `${said}; the job ${WANTS[job.agencyWanted]} (${AGENCY_BACKGROUND_LABELS[job.agencyWanted].toLowerCase()})`,
    exAgency: a.exAgency,
    agencyMonths: a.months,
    agencyWanted: job.agencyWanted,
  };
}

/** A part's weight for a job: agency background's as the vacancy asks it, the others' their own. */
const weightOf = (key: CvFitPartKey, job: FitJob) => (key === 'agency' ? AGENCY_FIT_WEIGHTS[job.agencyWanted] : CV_FIT_WEIGHTS[key]);

/** A prepared CV's fit for a prepared job (null: the CV not read, or without text). */
export function cvFitOf(job: FitJob, cv: FitCv | null): CvFit | null {
  if (!cv) return null;
  const scored = [skillsPart(job, cv), titlePart(job, cv), experiencePart(job, cv), requirementsPart(job, cv), educationPart(job, cv), agencyPart(job, cv)].filter((p): p is Scored => !!p);
  const total = scored.reduce((n, p) => n + weightOf(p.key, job), 0);
  if (!total) return { percent: null, version: CV_FIT_VERSION, parts: [] };
  const percent = Math.round(scored.reduce((n, p) => n + p.score * weightOf(p.key, job), 0) / total);
  return { percent, version: CV_FIT_VERSION, parts: scored.map((p) => ({ ...p, weight: Math.round((1000 * weightOf(p.key, job)) / total) / 10 })) };
}

/** A CV's fit for a vacancy, prepared on the spot (prepare each once when scoring many). */
export const cvFit = (v: FitVacancyInput, cv: FitCvInput): CvFit | null => cvFitOf(prepareFitJob(v), prepareFitCv(cv));

/** A fit as kept (JSON), read back safely; null when it isn't one. */
export function cvFitFrom(value: unknown): CvFit | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.parts)) return null;
  const parts = v.parts.filter((p): p is CvFitPart => !!p && typeof p === 'object' && (CV_FIT_PARTS as readonly unknown[]).includes((p as CvFitPart).key) && typeof (p as CvFitPart).score === 'number');
  return { percent: typeof v.percent === 'number' ? v.percent : null, version: typeof v.version === 'number' ? v.version : 0, parts };
}

// ---------- the key skills suggested ----------

/** A person's word at a title's end, as the craft it names: "Video Editor" suggests "Video editing". */
const CRAFT_OF: Readonly<Record<string, string | null>> = {
  editor: 'editing',
  designer: 'design',
  developer: 'development',
  programmer: 'programming',
  writer: 'writing',
  copywriter: 'copywriting',
  photographer: 'photography',
  videographer: 'videography',
  animator: 'animation',
  illustrator: 'illustration',
  marketer: 'marketing',
  accountant: 'accounting',
  translator: 'translation',
  producer: 'production',
  buyer: 'buying',
  planner: 'planning',
  engineer: 'engineering',
  analyst: 'analysis',
  strategist: 'strategy',
  // the words of a role, which name no craft
  manager: null,
  specialist: null,
  executive: null,
  officer: null,
  coordinator: null,
  director: null,
  supervisor: null,
  representative: null,
  agent: null,
  administrator: null,
  consultant: null,
  expert: null,
  associate: null,
  assistant: null,
  lead: null,
  head: null,
  senior: null,
  junior: null,
  intern: null,
  trainee: null,
  of: null,
  and: null,
  the: null,
};

/** A title's own core term, in sentence case: "Digital Marketing Manager" → "Digital marketing", "Video Editor" → "Video editing". */
export function titleCoreTerm(title: string): string | null {
  const words = title
    .replace(/\([^)]*\)/g, ' ')
    .split(/[\s/&,–—-]+/)
    .filter(Boolean);
  const kept: string[] = [];
  for (const w of words) {
    const key = w.toLowerCase().replace(/[^\p{L}\p{N}+#]/gu, '');
    if (!key) continue;
    if (key in CRAFT_OF) {
      const craft = CRAFT_OF[key];
      if (craft) kept.push(craft);
      continue;
    }
    kept.push(w);
  }
  if (!kept.length) return null;
  const shown = kept.map((w, i) => (/^[\p{Lu}\d+#.]{2,}$/u.test(w) ? w : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join(' ');
  return shown.length <= KEY_SKILLS_LIMITS.length ? shown : null;
}

/**
 * Key skills suggested for a vacancy (owner, 25 October 2026: "suggest them from its description for HR to confirm"):
 * the dictionary's skills its title, requirements, responsibilities and about name (those in its title first, then the
 * most named, then the first named), with the title's own core term after those of its title; at most 20. HR removes or
 * adds to them before saving: nothing is saved without HR.
 */
export function suggestKeySkills(v: Pick<FitVacancyInput, 'title' | 'jobTitle' | 'requirements' | 'responsibilities' | 'about'>, limit: number = KEY_SKILLS_LIMITS.max): string[] {
  const titles = [v.title, v.jobTitle ?? ''].filter(Boolean).join('\n');
  const text = [titles, htmlText(v.requirements), htmlText(v.responsibilities), htmlText(v.about)].filter(Boolean).join('\n');
  const hay = ` ${normalForMatch(text)} `;
  const titleHay = ` ${normalForMatch(titles)} `;
  const ranked = cvSkillsIn(text)
    .map((name, order) => {
      const needles = needlesOf(name);
      return { name, order, inTitle: names(titleHay, needles), count: Math.max(0, ...needles.map((x) => hay.split(` ${x} `).length - 1)) };
    })
    .sort((a, b) => Number(b.inTitle) - Number(a.inTitle) || b.count - a.count || a.order - b.order);
  const core = titleCoreTerm(v.title) ?? (v.jobTitle ? titleCoreTerm(v.jobTitle) : null);
  const order = [...ranked.filter((r) => r.inTitle).map((r) => r.name), ...(core ? [core] : []), ...ranked.filter((r) => !r.inTitle).map((r) => r.name)];
  // each once, whichever way it is written ("Content writing" from the title and from the dictionary)
  const out: string[] = [];
  const taken = new Set<string>();
  for (const s of order) {
    const needles = needlesOf(s);
    if (!needles.length || needles.some((n) => taken.has(n))) continue;
    for (const n of needles) taken.add(n);
    out.push(s);
  }
  return out.slice(0, Math.max(0, limit));
}

// ---------- other open positions (25 October 2026) ----------

/**
 * The owner, 25 October 2026, while the fit was being built: "and if it recomended to another position based on the
 * CV". The same fit, against every other open vacancy (published and taking applications; never a C-level one, a draft,
 * one on hold or closed), for those Suggested From Earlier CVs could suggest for it (suggested-cvs.ts: the same people
 * and CVs, the same fit): a badge on the applicant ("Better fit: Media Buyer 82%") when one is 60% or more and 10 points
 * above this application's fit; the top 3 at 50% or more on the CV window and the candidate's page.
 */
export const OPEN_POSITION_RULES = {
  /** Listed (the section, the General CVs' "Best open position") from this fit… */
  shownMin: 50,
  /** …this many at most, best first. */
  shown: 3,
  /** The badge on an applicant: at least this fit… */
  badgeMin: 60,
  /** …and this many points above the fit of the vacancy they applied for. */
  badgeLead: 10,
} as const;

/** An open vacancy a CV fits. */
export interface OpenPositionFit {
  vacancy: { id: string; number: string; title: string };
  percent: number;
  /** The fit's parts (the breakdown on hover); null when a list leaves them out. */
  fit: CvFit | null;
  /** "Add to this vacancy" (HR, the CEO, a Super Admin: Suggested From Earlier CVs' add), when they may. */
  can: { add: boolean };
  /** The CV it is the fit of (an applicant's or a general CV's): the one "Add to this vacancy" adds them from. */
  record?: { kind: 'application' | 'general_cv'; id: string };
}

/** The open positions shown: 50% or more, the best first (then by title), the top 3. */
export function openPositionsShown<T extends { percent: number; vacancy: { title: string } }>(fits: readonly T[]): T[] {
  return fits
    .filter((f) => f.percent >= OPEN_POSITION_RULES.shownMin)
    .sort((a, b) => b.percent - a.percent || a.vacancy.title.localeCompare(b.vacancy.title))
    .slice(0, OPEN_POSITION_RULES.shown);
}

/** The badge's position: the best open one at 60% or more and 10 points above `own` (the applied-for fit; none: 0); null: none. */
export function betterFitOf<T extends { percent: number; vacancy: { title: string } }>(own: number | null | undefined, fits: readonly T[]): T | null {
  const best = [...fits].sort((a, b) => b.percent - a.percent || a.vacancy.title.localeCompare(b.vacancy.title))[0];
  if (!best) return null;
  return best.percent >= OPEN_POSITION_RULES.badgeMin && best.percent >= (own ?? 0) + OPEN_POSITION_RULES.badgeLead ? best : null;
}

/** An applicant's badge: the better fit, and the others shown on hover. */
export interface BetterFitBadge {
  vacancy: { id: string; number: string; title: string };
  percent: number;
  /** The other open positions shown (50% or more, the top 3), the badge's own among them. */
  others: { vacancy: { id: string; number: string; title: string }; percent: number }[];
}

/** The badge's words: "Better fit: Media Buyer 82%". */
export const betterFitText = (b: Pick<BetterFitBadge, 'vacancy' | 'percent'>): string => `Better fit: ${b.vacancy.title} ${b.percent}%`;

/** Its hover: "Media Buyer 82% · Content Writer 64%". */
export const betterFitTitle = (b: Pick<BetterFitBadge, 'others'>): string => b.others.map((o) => `${o.vacancy.title} ${o.percent}%`).join(' · ');

// ---------- the breakdown in words ----------

/** The CV's title as shown, unless hidden (a developer's "••••"). */
const shownTitle = (p: CvFitPart) => (p.matchedTitle && p.matchedTitle !== HIDDEN ? p.matchedTitle : null);

/**
 * A part, short, as the hover's line puts it: "Key skills 4 of 6", "Title close (Digital Marketing Manager)", "8 y vs
 * 5–8", "Requirements 12 of 20 terms", "Education ✓".
 */
export function cvFitPartShort(p: CvFitPart): string {
  if (p.key === 'skills') return `Key skills ${p.found?.length ?? 0} of ${p.listed ?? 0}`;
  if (p.key === 'title') {
    const t = shownTitle(p);
    return `Title ${likenessWord(p.likeness ?? 0, p.sameTitle)}${t ? ` (${t})` : ''}`;
  }
  if (p.key === 'experience') {
    const y = p.years ?? 0;
    const years = p.fromCv ? (y < 1 ? '< 1 y' : `≈ ${Math.round(y)} y`) : `${num(y)} y`;
    return p.wanted ? `${years} vs ${wantedShort(p.wanted)}` : years;
  }
  if (p.key === 'requirements') return `Requirements ${p.found?.length ?? 0} of ${p.listed ?? 0} terms`;
  // agency background (27 October 2026): "Ex-agency 3 y 4 m", "Not ex-agency"
  if (p.key === 'agency') return p.exAgency ? `Ex-agency${p.agencyMonths ? ` ${agencyMonthsText(p.agencyMonths)}` : ''}` : 'Not ex-agency';
  return `Education ${p.score >= 100 ? '✓' : p.score <= 0 ? '✗' : 'partly'}`;
}

/** The whole breakdown on a line: "Key skills 4 of 6 · Title close (…) · 8 y vs 5–8 · Requirements 12 of 20 terms · Education ✓". */
export function cvFitLine(fit: CvFit | null | undefined): string {
  if (!fit) return 'The CV isn’t read yet';
  if (!fit.parts.length) return 'Nothing to score: no key skills, years or requirements listed, and no job title found in the CV';
  return fit.parts.map(cvFitPartShort).join(' · ');
}

/** A part as the CV Fit section shows it: its detail, with the CV's title named first when shown. */
export function cvFitPartDetail(p: CvFitPart): string {
  const t = p.key === 'title' ? shownTitle(p) : null;
  return t ? `${t} · ${p.detail}` : p.detail;
}
