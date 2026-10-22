import { CV_READING_METHOD_LABELS, CV_READING_STATUS_LABELS, EDUCATION_LEVEL_LABELS, type CvReadingView, type CvTextView } from '@trendlix/shared';
import { formatDate } from '../../../lib/format';

// The "From the CV" card's words (owner, 22 October 2026: "make the OCR egine reads the CV and analyse it. is that
// applicable?"; "Built-in rules only"; packages/shared cv-analysis.ts): the reading's status, what the rules found, the
// key skills found and not, the CV's text and finding words in it. Pure code (relative imports), tested in
// cv-reading.test.ts; the API decides who sees the text (never a developer: phones and emails).

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

/** What the rules found, as label and text ("—" for what they didn't). */
export function readingFacts(r: Pick<CvReadingView, 'experience' | 'education' | 'languages'>): { label: string; value: string }[] {
  return [
    { label: 'Experience', value: r.experience ?? '—' },
    { label: 'Education', value: r.education ? EDUCATION_LEVEL_LABELS[r.education] : '—' },
    { label: 'Languages', value: r.languages.length ? r.languages.join(', ') : '—' },
  ];
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
