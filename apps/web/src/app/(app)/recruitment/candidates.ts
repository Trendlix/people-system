import {
  APPLICATION_STAGE_LABELS,
  applicationsBadge,
  CANDIDATE_MATCH_KIND_LABELS,
  employeeBadge,
  GENERAL_CV_STATUS_LABELS,
  type CandidateBadge,
  type CandidateListItem,
  type CandidateRef,
  type CandidateSummary,
  type CandidateTimelineItem,
  type PossibleMatchView,
} from '@trendlix/shared';
import { minYearsOf } from './recruitment';

// Candidate profiles on the site (owner, 22 October 2026: "how to make like a profile for each candidate to store
// history and prevent duplication? even if the same candidate applied for 2 jobs"; "Email or mobile"; "Link and show
// rehire"; "HR decides from suggested match"; packages/shared candidates.ts): the addresses, the Candidates list's
// search, the lists' badges, where a candidate's latest application stands, the possible matches' other side and which
// of two is kept on a merge, and the timeline by day. Pure code, tested in candidates.test.ts; the API checks again.

export const CANDIDATES_PATH = '/recruitment/candidates';
export const CANDIDATE_MATCHES_PATH = '/recruitment/candidates/matches';

export const candidateHref = (id: string) => `${CANDIDATES_PATH}/${encodeURIComponent(id)}`;

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? '')).trim();

/**
 * The Candidates list's search and Min. experience filter (24 October 2026: "CV years in list + more rules": the years
 * typed, else the CV's estimate), as the address carries them.
 */
export interface CandidatesQuery {
  q: string;
  minYears: number | null;
}

export const readCandidatesQuery = (query: Record<string, string | string[] | undefined>): CandidatesQuery => ({ q: one(query.q).slice(0, 100), minYears: minYearsOf(query.minYears) });

export function candidatesApiPath(f: { q: string; minYears?: number | null }): string {
  const params = new URLSearchParams();
  if (f.q) params.set('q', f.q);
  if (f.minYears !== null && f.minYears !== undefined) params.set('minYears', String(f.minYears));
  const s = params.toString().replace(/\+/g, '%20');
  return s ? `/recruitment/candidates?${s}` : '/recruitment/candidates';
}

/** An applicant's badges on a list or a card: "2 applications" or "Applied before", and "Former employee". */
export function candidateBadges(c: CandidateBadge | null | undefined): string[] {
  if (!c) return [];
  return [applicationsBadge(c), employeeBadge(c.employee)].filter((x): x is string => !!x);
}

/** Where a candidate's latest application (or general CV) stands, in words: "Shortlisted", "Filtered out", "General CV: New". */
export function latestText(latest: CandidateListItem['latest']): string {
  if (!latest) return '—';
  if (latest.kind === 'general_cv') return `General CV: ${latest.generalStatus ? GENERAL_CV_STATUS_LABELS[latest.generalStatus] : '—'}`;
  if (latest.filteredOut) return 'Filtered out';
  return latest.stage ? APPLICATION_STAGE_LABELS[latest.stage] : '—';
}

/** A possible match's other candidate, seen from one of the two. */
export const otherOf = (m: PossibleMatchView, selfId: string): CandidateSummary => (m.candidates[0].id === selfId ? m.candidates[1] : m.candidates[0]);

/** The number of a code: CAN-0042 → 42. */
const codeNumber = (code: string): number => Number(code.replace(/^\D+/, '')) || 0;

/**
 * Which of two candidates is kept when HR confirms a match: the older (the lower code), so a profile's code stays the one
 * HR has known longest; the other is merged into it.
 */
export function mergeOrder<T extends CandidateRef>(a: T, b: T): { kept: T; merged: T } {
  return codeNumber(a.code) <= codeNumber(b.code) ? { kept: a, merged: b } : { kept: b, merged: a };
}

/** "Possible duplicate · Same mobile", "Suggested match · Same LinkedIn · Same name". */
export const matchLine = (m: PossibleMatchView): string => `${CANDIDATE_MATCH_KIND_LABELS[m.kind]} · ${m.why}`;

/** The possible matches' count for the tab, with the duplicates first: "3" or "3, 1 duplicate". */
export function matchesCountText(duplicates: number, suggested: number): string {
  const total = duplicates + suggested;
  if (!duplicates) return String(total);
  return `${total}, ${duplicates} ${duplicates === 1 ? 'duplicate' : 'duplicates'}`;
}

/** A merge's code as typed ("can-42", " CAN-0042 "): CAN-0042; null when it isn't one. */
export function codeTyped(text: string): string | null {
  const m = /^\s*can-?\s*(\d{1,8})\s*$/i.exec(text);
  return m ? `CAN-${m[1].padStart(4, '0')}` : null;
}

/** The timeline by the day in Cairo, the newest day first, each day's items as they came (newest first). */
export function timelineByDay(items: readonly CandidateTimelineItem[]): { day: string; items: CandidateTimelineItem[] }[] {
  const out: { day: string; items: CandidateTimelineItem[] }[] = [];
  const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  for (const item of [...items].sort((x, y) => y.at.localeCompare(x.at))) {
    const day = dayOf(item.at);
    const last = out.at(-1);
    if (last && last.day === day) last.items.push(item);
    else out.push({ day, items: [item] });
  }
  return out;
}
