import {
  CV_READING_METHOD_LABELS,
  CV_READING_STATUS_LABELS,
  cvYears,
  EDUCATION_LEVEL_LABELS,
  type CvEducationEntry,
  type CvListFacts,
  type CvReadingView,
  type CvTextView,
  type CvWorkEntry,
} from '@trendlix/shared';
import { formatDate } from '../../../lib/format';

// The "From the CV" card's words (owner, 22 October 2026: "make the OCR egine reads the CV and analyse it. is that
// applicable?"; "Built-in rules only"; packages/shared cv-analysis.ts): the reading's status, what the rules found, the
// key skills found and not, the CV's text and finding words in it. Pure code (relative imports), tested in
// cv-reading.test.ts; the API decides who sees the text (never a developer: phones and emails).
// More since 24 October 2026 (owner, on the General CVs list: "why isn't the experience pulled off the CV? is the pulled
// data all what can be pulled from the uploaded cv?"; chose "CV years in list + more rules"): the lists' Experience
// column falls back to the CV's estimate ("≈ 4 y · CV") and gains a Latest role column; the card shows the latest
// title and company, the city, the education details, the work history, the dictionary's skills and the certifications.

export const CV_CARD_NOTE = "Found by simple rules in the CV's text; check the CV itself.";

export const applicantCvTextApiPath = (id: string) => `/recruitment/applications/${encodeURIComponent(id)}/cv-text`;
export const generalCvTextApiPath = (id: string) => `/recruitment/general-cvs/${encodeURIComponent(id)}/cv-text`;

/** The reading's status in words: "Read 22/10/2026 · The PDF's own text", "Reading the CV…", "No text found in the CV". */
export function readingStatusText(r: Pick<CvReadingView, 'status' | 'method' | 'readAt'>): string {
  if (r.status === 'pending') return `${CV_READING_STATUS_LABELS.pending} Refresh the page in a minute or two to see what it found.`;
  if (r.status !== 'read') return CV_READING_STATUS_LABELS[r.status];
  const read = r.readAt ? `${CV_READING_STATUS_LABELS.read} ${formatDate(r.readAt)}` : CV_READING_STATUS_LABELS.read;
  return r.method ? `${read} · ${CV_READING_METHOD_LABELS[r.method]}` : read;
}

/**
 * What the rules found, as label and text ("—" for what they didn't): the latest role, the years, the city, the level
 * and the languages. An API from before 24 October 2026 sends no latest role or city: "—".
 */
export function readingFacts(
  r: Pick<CvReadingView, 'experience' | 'education' | 'languages'> & Partial<Pick<CvReadingView, 'latestTitle' | 'latestCompany' | 'city'>>,
): { label: string; value: string }[] {
  return [
    { label: 'Latest role', value: latestRoleText(r.latestTitle, r.latestCompany) ?? '—' },
    { label: 'Experience', value: r.experience ?? '—' },
    { label: 'City', value: r.city ?? '—' },
    { label: 'Education', value: r.education ? EDUCATION_LEVEL_LABELS[r.education] : '—' },
    { label: 'Languages', value: r.languages.length ? r.languages.join(', ') : '—' },
  ];
}

// ---------- the lists' Experience and Latest role (24 October 2026) ----------

/** The tooltip on an estimate from the CV. */
export const FROM_CV_DATES = 'From the dates in the CV';

/** An Experience cell: its text, whether it is the CV's estimate (shown muted, with FROM_CV_DATES), its tooltip. */
export interface ExperienceCell {
  text: string;
  fromCv: boolean;
  title: string | null;
}

/**
 * The Experience column (owner, 24 October 2026: "why isn't the experience pulled off the CV?"): the years the person
 * typed ("3 y"), else the CV's estimate in whole years ("≈ 4 y · CV", "< 1 y · CV" under a year), else "—", or
 * "Reading…" while the CV is being read. An API from before it sends no `fromCv`: the typed years or "—" as before.
 */
export function experienceCell(typed: number | null | undefined, fromCv: CvListFacts | null | undefined): ExperienceCell {
  if (typed !== null && typed !== undefined) return { text: `${typed} y`, fromCv: false, title: null };
  const months = fromCv?.experienceMonths ?? null;
  if (months !== null) return { text: months < 12 ? '< 1 y · CV' : `≈ ${cvYears(months)} y · CV`, fromCv: true, title: FROM_CV_DATES };
  if (fromCv?.status === 'pending') return { text: 'Reading…', fromCv: true, title: CV_READING_STATUS_LABELS.pending };
  return { text: '—', fromCv: false, title: null };
}

/** A job as a line: "Senior Video Editor · Bright Studio", one alone when the other wasn't found; null with neither. */
export function latestRoleText(title: string | null | undefined, company: string | null | undefined): string | null {
  const parts = [title, company].filter((p): p is string => !!p && !!p.trim());
  return parts.length ? parts.join(' · ') : null;
}

/** The Latest role column's text of a list's row: its CV's latest job; null when none was found. */
export const latestRoleOf = (fromCv: CvListFacts | null | undefined): string | null => latestRoleText(fromCv?.latestTitle, fromCv?.latestCompany);

// ---------- the card's work history, education and more (24 October 2026) ----------

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A point as kept ("2019-03", "2019") in words: "Mar 2019", "2019". */
function pointText(point: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(point);
  if (!m) return point;
  return `${MONTH_SHORT[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** A job's period: "Mar 2019 – Dec 2021", "Jan 2022 – Present", "2018 – 2020"; null without dates. */
export function periodText(job: Pick<CvWorkEntry, 'from' | 'to' | 'current'>): string | null {
  const end = job.current ? 'Present' : job.to ? pointText(job.to) : null;
  const start = job.from ? pointText(job.from) : null;
  if (start && end) return `${start} – ${end}`;
  return start ?? end;
}

/** A school or university in a line: "Bachelor of Fine Arts · Helwan University · 2018"; null with nothing found. */
export function educationText(e: CvEducationEntry): string | null {
  const parts = [e.degree, e.institution, e.graduationYear === null ? null : String(e.graduationYear)].filter((p): p is string => !!p && !!p.trim());
  return parts.length ? parts.join(' · ') : null;
}

/**
 * The work history's fold: "Work History (3 roles)"; with those at marketing agencies (27 October 2026: "Show agency
 * years"), "Work History (3 roles, 2 at agencies)".
 */
export function workHistoryHeading(count: number, atAgencies = 0): string {
  const agencies = atAgencies > 0 ? `, ${atAgencies} at ${atAgencies === 1 ? 'an agency' : 'agencies'}` : '';
  return `Work History (${count} ${count === 1 ? 'role' : 'roles'}${agencies})`;
}

/** What else the card shows, each list empty when none was found (or the API is from before 24 October 2026). */
export function moreFromCv(r: Partial<Pick<CvReadingView, 'workHistory' | 'educationDetails' | 'cvSkills' | 'certifications'>>): {
  workHistory: CvWorkEntry[];
  education: string[];
  skills: string[];
  certifications: string[];
} {
  return {
    workHistory: (r.workHistory ?? []).filter((w) => w.pastTitle || w.pastCompany),
    education: (r.educationDetails ?? []).map(educationText).filter((t): t is string => !!t),
    skills: r.cvSkills ?? [],
    certifications: (r.certifications ?? []).filter((c) => !!c.trim()),
  };
}

/** Beside the CV match %: "2 of 4 key skills"; nothing when the vacancy lists none (or for a general CV). */
export function skillsCountText(skills: CvReadingView['skills']): string | null {
  if (!skills) return null;
  const listed = skills.found.length + skills.missing.length;
  return `${skills.found.length} of ${listed} key ${listed === 1 ? 'skill' : 'skills'}`;
}

/** The links found in the CV: the LinkedIn profile first, then the portfolio and other links. */
export const linksFound = (t: Pick<CvTextView, 'cvLinkedin' | 'cvLinks'>): string[] => [...(t.cvLinkedin ? [t.cvLinkedin] : []), ...t.cvLinks];

/** A link shown short: without https:// and www. */
export const shortLink = (url: string) => url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');

/** Why the CV's text isn't shown, in words. */
export function cvTextMissing(loaded: { kind: 'unavailable' } | { kind: 'forbidden' } | { kind: 'failed'; messages: string[] }): string {
  if (loaded.kind === 'forbidden') return "The CV's text and the contacts in it aren't shown to your role.";
  if (loaded.kind === 'unavailable') return "The CV's text isn't available yet.";
  return `The CV's text could not be loaded. ${loaded.messages.join(' ')}`.trim();
}

const FIND_SHORTEST = 2;
const MOST_MARKS = 1000;

/**
 * The text cut where `query` is found (any case, Arabic too), for marking on the page: at most 1,000 marks, the rest
 * plain. A query shorter than 2 characters marks nothing.
 */
export function findParts(text: string, query: string): { parts: { text: string; hit: boolean }[]; count: number } {
  const q = query.trim();
  if (q.length < FIND_SHORTEST) return { parts: [{ text, hit: false }], count: 0 };
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'giu');
  const parts: { text: string; hit: boolean }[] = [];
  let count = 0;
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (!m[0]) continue;
    count += 1;
    if (count > MOST_MARKS) continue;
    if (m.index > at) parts.push({ text: text.slice(at, m.index), hit: false });
    parts.push({ text: m[0], hit: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false });
  return { parts, count };
}

/** How many were found, in words. */
export const foundText = (count: number) => (count === 0 ? 'Not found' : count === 1 ? 'Found once' : `Found ${count.toLocaleString('en-US')} times`);
