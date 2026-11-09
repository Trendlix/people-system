import { APPLICATION_STAGE_LABELS, GOOD_MATCH_PERCENT, type ApplicationSource, type ApplicationStage } from '@trendlix/shared';
import { applicantsHref, columnSortText, GOOD_CV_MATCH_PERCENT, readApplicantsQuery, REJECTED_AT_REVIEW, sortDirOf, type ApplicantsQuery } from './recruitment';

// An applicants' list's two parts, kept apart (owner, 9 November 2026: "this part needs to be organized"; "diffrenitate
// between the filteration and hiring workflow"):
// - the hiring workflow: where people stand, the steps in their order (Applicants → Final Review → HR Screening →
//   Technical Interview → Offer → Hired), with All before them and, apart, those out of it (rejected at a review,
//   rejected, filtered out by a must-have);
// - the filters and the order: who is shown within the step (a match, a CV match, a source) and in what order.
// Picking a step keeps the filters; a filter keeps the step.

/** The workflow's steps, in their order: a person moves along them. */
export const WORKFLOW_STEPS = ['applied', 'review_2', 'screening', 'interview', 'offer', 'hired'] as const satisfies readonly ApplicationStage[];

/** One link of the workflow: its words, its count (null: not known here), where it goes and whether it is the one shown. */
export interface WorkflowLink {
  key: string;
  label: string;
  count: number | null;
  href: string;
  current: boolean;
}

export interface WorkflowNav {
  all: WorkflowLink;
  steps: WorkflowLink[];
  /** Those out of the workflow: rejected at a review, rejected, filtered out. */
  out: WorkflowLink[];
}

/** The counts of a vacancy's applicants: at each stage, rejected at a review, filtered out by a must-have. */
export interface WorkflowCounts {
  stages: Partial<Record<ApplicationStage, number>>;
  reviewRejected: number;
  filteredOut: number;
}

/** The workflow's links for the list at `base`, the other filters kept; counts when known (a vacancy's page). */
export function workflowNav(base: string, q: ApplicantsQuery, counts: WorkflowCounts | null): WorkflowNav {
  const inWorkflow = q.filtered === 'hide' && !q.reviewRejected;
  const stageLink = (s: ApplicationStage): WorkflowLink => ({
    key: s,
    label: APPLICATION_STAGE_LABELS[s],
    count: counts ? (counts.stages[s] ?? 0) : null,
    href: applicantsHref(base, { ...q, stage: s, filtered: 'hide', reviewRejected: false }),
    current: inWorkflow && q.stage === s,
  });
  const total = counts ? Object.values(counts.stages).reduce((a, b) => a + (b ?? 0), 0) + counts.reviewRejected - counts.filteredOut : null;
  return {
    all: {
      key: 'all',
      label: 'All',
      count: total,
      href: applicantsHref(base, { ...q, stage: '', filtered: 'hide', reviewRejected: false }),
      current: inWorkflow && !q.stage,
    },
    steps: WORKFLOW_STEPS.map(stageLink),
    out: [
      {
        key: 'review_rejected',
        label: REJECTED_AT_REVIEW,
        count: counts ? counts.reviewRejected : null,
        href: applicantsHref(base, { ...q, stage: '', filtered: 'hide', reviewRejected: true }),
        current: q.reviewRejected,
      },
      stageLink('rejected'),
      {
        key: 'filtered_out',
        label: 'Filtered out',
        count: counts ? counts.filteredOut : null,
        href: applicantsHref(base, { ...q, stage: '', filtered: 'only', reviewRejected: false }),
        current: q.filtered === 'only',
      },
    ],
  };
}

/** A filter or an order to pick: its words, where it goes, whether it is on. */
export interface RefineLink {
  key: string;
  label: string;
  href: string;
  on: boolean;
  /** A count beside it (a source's applicants). */
  count?: number;
}

export interface RefineNav {
  /** Show only: a match from 70%, a CV match from 50%. */
  only: RefineLink[];
  /** Where they came from: one at a time. */
  sources: RefineLink[];
  /** The order: best match (the screening questions), best CV match, most experience; a column's title clicked, said too. */
  sorts: RefineLink[];
  /** Back to no filter and the usual order, the step kept; null when nothing is set. */
  clear: string | null;
}

/** Whether a sort is the list's usual one: best match first. */
const bestFirst = (q: ApplicantsQuery) => q.sort === '' || (q.sort === 'match' && sortDirOf(q) === 'desc');

/** The filters and the order of a vacancy's list at `base`, the step kept; `sources` its applicants by where they came from. */
export function refineNav(base: string, q: ApplicantsQuery, sources: readonly { source: ApplicationSource; label: string; count: number }[]): RefineNav {
  const href = (next: Partial<ApplicantsQuery>) => applicantsHref(base, { ...q, ...next });
  const cvFirst = q.sort === 'cv' && sortDirOf(q) === 'desc';
  const yearsFirst = q.sort === 'years' && sortDirOf(q) === 'desc';
  const byColumn = !bestFirst(q) && !cvFirst && !yearsFirst;
  const set = q.minMatch !== null || q.minCvMatch !== null || q.source !== '' || q.minYears !== null || q.skill !== '' || q.verdict !== '' || q.hold !== '' || q.q !== '' || !bestFirst(q);
  return {
    only: [
      { key: 'match', label: `Match ≥ ${GOOD_MATCH_PERCENT}%`, href: href({ minMatch: q.minMatch === null ? GOOD_MATCH_PERCENT : null }), on: q.minMatch !== null },
      { key: 'cv', label: `CV match ≥ ${GOOD_CV_MATCH_PERCENT}%`, href: href({ minCvMatch: q.minCvMatch === null ? GOOD_CV_MATCH_PERCENT : null }), on: q.minCvMatch !== null },
    ],
    sources: sources.map((s) => ({ key: s.source, label: s.label, count: s.count, href: href({ source: q.source === s.source ? '' : s.source }), on: q.source === s.source })),
    sorts: [
      { key: 'best', label: 'Best match', href: href({ sort: '', dir: '' }), on: bestFirst(q) },
      { key: 'cv', label: 'Best CV match', href: href({ sort: 'cv', dir: '' }), on: cvFirst },
      { key: 'years', label: 'Most experience', href: href({ sort: 'years', dir: '' }), on: yearsFirst },
      // a column's title clicked (28 October 2026): said here, the title clicked again changes it
      ...(byColumn ? [{ key: 'column', label: columnSortText(q), href: href({}), on: true }] : []),
    ],
    clear: set ? href({ minMatch: null, minCvMatch: null, source: '', minYears: null, skill: '', verdict: '', hold: '', q: '', sort: '', dir: '' }) : null,
  };
}

// ---------- a vacancy's long parts, closed at first (owner, 9 November 2026: "make them collapsable") ----------

/** Apply Links, closed: how many links, and that it is on the careers site while open. */
export const applyLinksHint = (links: number, onCareersSite: boolean): string =>
  `${links} ${links === 1 ? 'link' : 'links'} to copy, one for each channel${onCareersSite ? ' · listed on the careers site' : ''}`;

/** On the Careers Page, closed: the parts it has, or that it has none yet. */
export function careersTextHint(v: { about: string | null; responsibilities: string | null; requirements: string | null }): string {
  const parts = [v.about && 'About the role', v.responsibilities && 'Responsibilities', v.requirements && 'Requirements'].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No text yet';
}

// ---------- an applicant's step: Previous and Next (owner, 9 November 2026: "allow me to switch between the CVs in the same level of the workflow") ----------

/** A list's step in words: a step's name, Rejected at review, Filtered out, or All. */
export const levelLabel = (q: Pick<ApplicantsQuery, 'stage' | 'filtered' | 'reviewRejected'>): string =>
  q.reviewRejected ? REJECTED_AT_REVIEW : q.filtered === 'only' ? 'Filtered out' : q.stage ? APPLICATION_STAGE_LABELS[q.stage] : 'All';

/** The list an applicant was opened from, read back: its filters (none: the usual list). */
export function fromQuery(from: string | null): ApplicantsQuery {
  const url = new URL(from ?? '/', 'https://people.invalid');
  return readApplicantsQuery(Object.fromEntries(url.searchParams));
}

/**
 * The lists Previous and Next go through, the first that has the applicant: the step of the list it was opened from, the
 * same filters and order; else (opened from All, or moved since) its own step, those filters kept. A rejected one may
 * have been rejected at a review, kept off Rejected: that list is tried too. Always its own vacancy's.
 */
export function siblingQueries(from: string | null, a: { vacancyId: string; stage: ApplicationStage; filteredOut: boolean }): ApplicantsQuery[] {
  const q0 = { ...fromQuery(from), vacancyId: a.vacancyId };
  const atLevel = q0.reviewRejected || q0.filtered === 'only' || q0.stage !== '';
  const own: ApplicantsQuery[] = a.filteredOut
    ? [{ ...q0, stage: '', filtered: 'only', reviewRejected: false }]
    : a.stage === 'rejected'
      ? [
          { ...q0, stage: 'rejected', filtered: 'hide', reviewRejected: false },
          { ...q0, stage: '', filtered: 'hide', reviewRejected: true },
        ]
      : [{ ...q0, stage: a.stage, filtered: 'hide', reviewRejected: false }];
  const all = atLevel ? [q0, ...own] : own;
  return all.filter((q, i) => all.findIndex((o) => o.stage === q.stage && o.filtered === q.filtered && o.reviewRejected === q.reviewRejected) === i);
}

/** Where an applicant is in its step's list: the one before and after, and its place ("3 of 18"). Null when not in it. */
export interface Siblings {
  prev: string | null;
  next: string | null;
  index: number;
  total: number;
}

export function siblingsIn(ids: readonly string[], id: string): Siblings | null {
  const i = ids.indexOf(id);
  if (i < 0) return null;
  return { prev: i > 0 ? ids[i - 1] : null, next: i < ids.length - 1 ? ids[i + 1] : null, index: i + 1, total: ids.length };
}
