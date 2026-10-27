// Marketing agency background (owner, 27 October 2026: "when opening a job, can the OCR detect if his previous works are
// in agency?", then "i need a flag if the candidate is ex marketing agencies or not AND reflectin the scoring"). Asked, he
// chose:
// - "Name words + your list": a past employer counts as a marketing agency when its name says so (Agency, Advertising,
//   Creative, Studio, Media, Digital, PR, وكالة, دعاية, إعلان …), never a travel, recruitment, real estate, insurance,
//   shipping or news agency; or when HR marked it so (an agency, or not one, kept by its name: AgencyMark), which wins;
// - "Show agency years": each job of the CV's work history marked agency or not, and the CV flagged "Ex-agency" with
//   its months at marketing agencies;
// - in the CV fit ("Set per job", "Yes or no"): each vacancy says whether agency background is required (weight 20),
//   preferred (10, the default) or not needed (left out); 6 months or more at marketing agencies in all score in full,
//   less half, none 0 (cv-fit.ts agency part).
// Rules only, no AI, as the CV reading is: the work history is cv-analysis.ts's (a job per line with dates under the
// experience heading), so a CV whose jobs weren't read has no agency background to tell (null), never "not ex-agency".
// Pure code, tested in apps/api/src/common/marketing-agencies.spec.ts.

import type { CvWorkEntry } from './cv-analysis.js';

/** What a vacancy asks of agency background: required, preferred (the default) or not needed. */
export const AGENCY_BACKGROUNDS = ['required', 'preferred', 'not_needed'] as const;
export type AgencyBackgroundWanted = (typeof AGENCY_BACKGROUNDS)[number];
export const AGENCY_BACKGROUND_LABELS: Record<AgencyBackgroundWanted, string> = { required: 'Required', preferred: 'Preferred', not_needed: 'Not needed' };
export const AGENCY_BACKGROUND_DEFAULT: AgencyBackgroundWanted = 'preferred';

/** Its weight in the CV fit (out of the other parts' 100, which then shrink to fit): none when not needed. */
export const AGENCY_FIT_WEIGHTS: Readonly<Record<AgencyBackgroundWanted, number>> = { required: 20, preferred: 10, not_needed: 0 };

/** From this many months at marketing agencies in all, the agency part scores in full; fewer (more than none), half. */
export const AGENCY_FULL_MONTHS = 6;

/** The flag's words. */
export const EX_AGENCY_LABEL = 'Ex-agency';

/**
 * Words that make a company name a marketing agency's, whole words in any case: English, and Arabic (their letters as
 * the CV reading compares them: alef, taa marbuta and alef maqsura plain).
 */
const AGENCY_WORDS = [
  'agency',
  'agencies',
  'advertising',
  'advertisers',
  'adv',
  'creative',
  'creatives',
  'communications',
  'communication',
  'comms',
  'branding',
  'brands',
  'studio',
  'studios',
  'media',
  'digital',
  'marketing',
  'pr',
  'public relations',
  'interactive',
  'productions',
  'production house',
  'content',
  'activation',
  'activations',
  'influencer',
  'influencers',
  'social media',
  'وكاله',
  'دعايه',
  'اعلان',
  'اعلانات',
  'الاعلان',
  'الاعلانات',
  'تسويق',
  'للتسويق',
  'التسويق',
  'ميديا',
  'استوديو',
  'ستوديو',
  'علاقات عامه',
];

/** Words that make an "agency" any other kind: travel, recruitment, real estate, insurance, shipping, news, a car dealer's. */
const NOT_AGENCY_WORDS = [
  'travel',
  'travels',
  'tourism',
  'tours',
  'recruitment',
  'recruiting',
  'employment',
  'staffing',
  'manpower',
  'real estate',
  'realestate',
  'realty',
  'property',
  'properties',
  'insurance',
  'shipping',
  'freight',
  'logistics',
  'customs',
  'news',
  'press agency',
  'cars',
  'motors',
  'automotive',
  'سفر',
  'سياحه',
  'للسياحه',
  'توظيف',
  'عقارات',
  'عقاري',
  'العقارات',
  'تامين',
  'شحن',
  'انباء',
  'الانباء',
  'سيارات',
];

/** A company name as compared: Latin letters in lower case, Arabic letters plain, everything else one space. */
export function companyKey(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const hasWord = (key: string, words: readonly string[]) => words.some((w) => new RegExp(`(?:^| )${w}(?: |$)`).test(key));

/** HR's marks (AgencyMark), by company key: true an agency, false not one. */
export type AgencyMarks = ReadonlyMap<string, boolean>;

/** Why a company counts as a marketing agency or not: its name's words, HR's mark, or nothing said (not one). */
export type AgencyBy = 'name' | 'mark' | null;

/** Whether a company is a marketing agency: HR's mark when there is one, else its name's words; and by what. */
export function agencyOfCompany(name: string | null | undefined, marks: AgencyMarks = new Map()): { agency: boolean; by: AgencyBy } {
  const key = name ? companyKey(name) : '';
  if (!key) return { agency: false, by: null };
  const marked = marks.get(key);
  if (marked !== undefined) return { agency: marked, by: 'mark' };
  if (hasWord(key, NOT_AGENCY_WORDS)) return { agency: false, by: null };
  return hasWord(key, AGENCY_WORDS) ? { agency: true, by: 'name' } : { agency: false, by: null };
}

/**
 * A job of the work history marked: its company (named `pastCompany`, as the work history's, so a developer never reads
 * it: developer.ts), an agency's or not, by what, and its months (null: its dates not read).
 */
export interface AgencyJob {
  pastCompany: string | null;
  agency: boolean;
  by: AgencyBy;
  months: number | null;
}

/** A CV's marketing agency background: whether ex-agency, its months at agencies (each month once), each job marked. */
export interface AgencyBackground {
  exAgency: boolean;
  months: number;
  jobs: AgencyJob[];
}

/** A month as a number (year × 12 + month − 1) from "2019-03", or "2019" (its January as a start, its December as an end). */
function monthNumber(value: string | null, end: boolean): number | null {
  if (!value) return null;
  const m = /^(\d{4})(?:-(\d{2}))?$/.exec(value);
  if (!m) return null;
  const month = m[2] ? Number(m[2]) : end ? 12 : 1;
  return Number(m[1]) * 12 + month - 1;
}

/**
 * A CV's marketing agency background from its work history (`asOf`: the month "present" means, YYYY-MM): each job marked
 * by its company (agencyOfCompany), the months of the agency jobs counted once where they overlap; null without a work
 * history read (nothing to tell).
 */
export function agencyBackgroundOf(workHistory: readonly CvWorkEntry[] | null | undefined, asOf: string, marks: AgencyMarks = new Map()): AgencyBackground | null {
  const jobs = (workHistory ?? []).filter((w) => w.pastTitle || w.pastCompany);
  if (!jobs.length) return null;
  const now = monthNumber(asOf.slice(0, 7), true);
  const covered = new Set<number>();
  const marked = jobs.map((w): AgencyJob => {
    const { agency, by } = agencyOfCompany(w.pastCompany, marks);
    const from = monthNumber(w.from, false);
    const to = w.current ? now : monthNumber(w.to, true);
    const months = from !== null && to !== null && to >= from ? to - from + 1 : null;
    if (agency && from !== null && to !== null) for (let n = from; n <= to; n++) covered.add(n);
    return { pastCompany: w.pastCompany, agency, by, months };
  });
  return { exAgency: marked.some((j) => j.agency), months: covered.size, jobs: marked };
}

/** The agency part's score: 6 months or more in all, 100; less (an agency job, its months short or not read), 50; none, 0. */
export function agencyScore(b: Pick<AgencyBackground, 'exAgency' | 'months'>): number {
  if (!b.exAgency) return 0;
  return b.months >= AGENCY_FULL_MONTHS ? 100 : 50;
}

/** Months in words: "3 y 4 m", "8 m", "1 y". */
export function agencyMonthsText(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (!y) return `${m} m`;
  return m ? `${y} y ${m} m` : `${y} y`;
}

/** The flag in words: "Ex-agency · 3 y 4 m", "Ex-agency" (its months not read), null when not ex-agency. */
export function exAgencyText(b: Pick<AgencyBackground, 'exAgency' | 'months'> | null | undefined): string | null {
  if (!b?.exAgency) return null;
  return b.months > 0 ? `${EX_AGENCY_LABEL} · ${agencyMonthsText(b.months)}` : EX_AGENCY_LABEL;
}
