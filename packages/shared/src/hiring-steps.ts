// The hiring steps of 29 October 2026 (owner: "HR to shortlist, and the hiring manager has to select then hr will
// schedule for interview"), replaced by the recruitment tree on 3 November 2026 (recruitment-tree.ts: Applicants,
// Review 1, Review 2, Final Review, HR Screening, Technical Interview, Offer). What stays here:
// - HR's screening call of before (passed or failed with a note), kept on the applications that had one, to read.
// - The hiring manager's suggestion's words (at the Technical Interview and the Offer: the next step or a rejection).
// - The batches (several applicants at once: HR's Send to Review 1, a review's decisions; at most 100) and their
//   messages: the reviewer told once a batch, in the app and by email ("One message per batch"), HR told once a batch of
//   the hiring manager's Final Review.
// - The reviews waiting for someone on My Hiring: the recruiter's manager's Review 2, the hiring manager's Final Review.
// Pure code: the API enforces these rules, the web shows them. Tested in apps/api/src/common/hiring-steps.spec.ts.

import type { CvListFacts } from './cv-analysis.js';
import type { HiringSuggestion } from './recruitment-hiring.js';
import type { ApplicationStage, RecruitmentUserRef } from './recruitment.js';
import type { ReviewStage } from './recruitment-tree.js';

// ---------- the screening call of before the tree ----------

export const SCREENING_CALL_RESULTS = ['passed', 'failed'] as const;
export type ScreeningCallResult = (typeof SCREENING_CALL_RESULTS)[number];
export const SCREENING_CALL_LABELS: Record<ScreeningCallResult, string> = { passed: 'Passed', failed: 'Failed' };
export const isScreeningCallResult = (value: unknown): value is ScreeningCallResult => (SCREENING_CALL_RESULTS as readonly unknown[]).includes(value);
export const SCREENING_CALL_NOTE_MAX = 1000;

/** HR's screening call on an applicant, as shown. */
export interface ScreeningCallView {
  result: ScreeningCallResult;
  note: string | null;
  by: RecruitmentUserRef | null;
  at: string;
}

// ---------- the hiring manager's suggestion ----------

/** The words of the hiring manager's choice at a stage: the next step or a rejection. */
export function suggestionLabel(kind: HiringSuggestion, _stage?: ApplicationStage): string {
  return kind === 'next' ? 'Next step' : 'Reject';
}

/** The hiring manager's choice as HR reads it on an applicant: "Hiring manager suggests: Next step". */
export function suggestionShown(kind: HiringSuggestion, _stage?: ApplicationStage): string {
  return `Hiring manager suggests: ${kind === 'next' ? 'Next step' : 'Reject'}`;
}

// ---------- the batches ----------

/** At most this many applicants in one batch (HR's Send to Review 1, a review's decisions). */
export const HIRING_BATCH_MAX = 100;

/** What a batch did: each applicant done, or skipped with why (in the batch's order). */
export interface HiringBatchResult {
  done: { id: string; number: string; fullName: string }[];
  skipped: { id: string; number: string | null; fullName: string | null; reason: string }[];
}

// ---------- the messages ----------

const people = (n: number) => `${n} ${n === 1 ? 'applicant' : 'applicants'}`;

/** Names in a line: the first `max`, and how many more. */
export function namesLine(names: readonly string[], max = 5): string {
  const shown = names.slice(0, max).join(', ');
  return names.length > max ? `${shown} and ${names.length - max} more` : shown;
}

/** The review a batch waits for, in words. */
const REVIEW_WORDS: Record<ReviewStage, string> = { review_1: 'Review 1', review_2: 'Review 2', final_review: 'your final review' };

/** The reviewer's message once a batch reaches their review (the app's notification, the email's subject). */
export function reviewWaitingNotice(job: string, names: readonly string[], stage: ReviewStage): { title: string; body: string } {
  const which = stage === 'final_review' ? REVIEW_WORDS.final_review : `your ${REVIEW_WORDS[stage]}`;
  return { title: `${people(names.length)} for ${job} wait for ${which}: pass or reject them`, body: namesLine(names) };
}

/** The values of the reviewer's email's fields (owner, 1 November 2026; email-templates.ts shortlist_review). */
export function reviewTemplateValues(job: string, names: readonly string[], link: string): Record<string, string> {
  return { job, count: people(names.length), names: names.map((x) => `- ${x}`).join('\n'), link };
}

/** The reviewer's email: who, and where to review them. */
export function reviewWaitingEmail(job: string, names: readonly string[], link: string, stage: ReviewStage): { subject: string; text: string } {
  const n = reviewWaitingNotice(job, names, stage);
  return {
    subject: n.title,
    text: [`${people(names.length)} for ${job} wait for ${stage === 'final_review' ? 'your final review' : `your ${REVIEW_WORDS[stage]}`}:`, '', ...names.map((x) => `- ${x}`), '', `Please pass or reject them on My Hiring: ${link}`].join('\n'),
  };
}

/** HR's message once a reviewer decided a batch: "Final Review of Video Editor: 3 passed, 1 rejected". */
export function reviewDoneNotice(job: string, stageLabel: string, passed: number, rejected: number): { title: string; body: string } {
  const parts = [passed ? `${passed} passed` : null, rejected ? `${rejected} rejected` : null].filter(Boolean).join(', ');
  return { title: `${stageLabel} of ${job}: ${parts || 'nothing changed'}`, body: job };
}

// ---------- My Hiring's reviews waiting ----------

/** An applicant waiting for the caller's review on My Hiring, to pass or reject. */
export interface ReviewApplicant {
  id: string;
  number: string;
  fullName: string;
  /** The review they wait for: Review 2 (the recruiter's manager's) or the Final Review (the hiring manager's). */
  stage: ReviewStage;
  /** The screening questions' match % and the CV match % (null: none). */
  matchPercent: number | null;
  cvMatchPercent: number | null;
  /** What the CV says (experience, latest role, the Ex-agency and Skipper flags). */
  fromCv: CvListFacts | null;
  /** The years they typed, if asked. */
  yearsTyped: number | null;
  /** When they reached this review (ISO), when known. */
  since: string | null;
}

/** A vacancy's applicants waiting for the caller's review on My Hiring. */
export interface ReviewGroup {
  vacancy: { id: string; number: string; title: string };
  applicants: ReviewApplicant[];
}
