// The hiring steps (owner, 29 October 2026: "HR to shortlist, and the hiring manager has to select then hr will schedule
// for interview", then "HR Filteration and shortlisting - Manager view the shortlisted and accept or reject them - HR
// Screening and scheduling", "then there should be interview comment and status for HR and hiring manager", "then the
// candidate to be selected", "and start the job offer cycle"). Asked, he chose:
// 1. HR filters (the CV match, the flags) and shortlists, several at once; the hiring manager told once a batch, in the
//    app and by email ("One message per batch"; notification shortlist_review).
// 2. The hiring manager reviews the shortlist ("Tick several at once", on My Hiring, or on an applicant's page): Accept or
//    Reject, with a note; HR told once a batch (hiring_suggestion). It is kept as the hiring manager's suggestion
//    (recruitment-hiring.ts: at Shortlisted `next` is Accept, `reject` Reject), and a rejection is HR's to confirm ("HR
//    confirms": Reject with its reason and the email tick, as ever).
// 3. HR's screening call on an accepted applicant: passed or failed, with a note ("Screening call + result").
// 4. HR schedules the interview, or moves them to Interview: only a shortlisted applicant the hiring manager accepted (a
//    vacancy without a hiring manager asks no acceptance) whose screening call passed. A later round (at Interview or
//    Offer) asks nothing.
// 5. After an interview, HR and the hiring manager each give a scorecard as its interviewers do ("Score Card for each of
//    them"), even when not among its interviewers.
// 6. The candidate selected: Make offer, then the job offer's cycle as before (accepted: hired).
// Pure code: the API enforces these rules, the web shows them. Tested in apps/api/src/common/hiring-steps.spec.ts.

import type { CvListFacts } from './cv-analysis.js';
import type { HiringSuggestion } from './recruitment-hiring.js';
import { APPLICATION_STAGE_LABELS, type ApplicationStage, type RecruitmentUserRef } from './recruitment.js';

// ---------- the screening call ----------

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

// ---------- the hiring manager's review of the shortlist ----------

/** At Shortlisted, the hiring manager's suggestion is their review: Accept or Reject. */
export const REVIEW_LABELS: Record<HiringSuggestion, string> = { next: 'Accept', reject: 'Reject' };

/** Their review as HR reads it. */
export const REVIEWED_LABELS: Record<HiringSuggestion, string> = { next: 'Accepted by the hiring manager', reject: 'Rejected by the hiring manager' };

/** The words of the hiring manager's choice at a stage: their review at Shortlisted, else the next step or a rejection. */
export function suggestionLabel(kind: HiringSuggestion, stage: ApplicationStage): string {
  if (stage === 'shortlisted') return REVIEW_LABELS[kind];
  return kind === 'next' ? 'Next step' : 'Reject';
}

/** The hiring manager's choice as HR reads it on an applicant: "Accepted by the hiring manager", "Hiring manager suggests: Next step". */
export function suggestionShown(kind: HiringSuggestion, stage: ApplicationStage): string {
  if (stage === 'shortlisted') return REVIEWED_LABELS[kind];
  return `Hiring manager suggests: ${kind === 'next' ? 'Next step' : 'Reject'}`;
}

/** At most this many applicants in one batch (HR's shortlist, the hiring manager's review). */
export const HIRING_BATCH_MAX = 100;

/** What a batch did: each applicant done, or skipped with why (in the batch's order). */
export interface HiringBatchResult {
  done: { id: string; number: string; fullName: string }[];
  skipped: { id: string; number: string | null; fullName: string | null; reason: string }[];
}

// ---------- where an applicant stands ----------

/** What the rules read of an applicant. */
export interface HiringStepInput {
  stage: ApplicationStage;
  filteredOut?: boolean;
  /** Their vacancy has a hiring manager (else no acceptance is asked). */
  hasHiringManager: boolean;
  suggestion: HiringSuggestion | null;
  screeningCall: ScreeningCallResult | null;
}

/** Why HR's screening call can't be recorded yet; null when it can. */
export function screeningCallProblem(a: HiringStepInput): string | null {
  if (a.filteredOut) return 'They failed a must-have question and were filtered out: restore them first.';
  if (a.stage === 'applied') return 'Shortlist them first: the screening call comes once the hiring manager accepts them.';
  if (a.stage !== 'shortlisted') return `They are ${APPLICATION_STAGE_LABELS[a.stage].toLowerCase()}: the screening call is made at Shortlisted.`;
  if (a.hasHiringManager && a.suggestion === 'reject') return 'The hiring manager rejected them: reject them, or ask the hiring manager to accept them.';
  if (a.hasHiringManager && a.suggestion !== 'next') return 'Waiting for the hiring manager to accept them.';
  return null;
}

/**
 * Why an interview can't be scheduled yet (or they can't be moved to Interview); null when it can. Only from Applied or
 * Shortlisted: a later round asks nothing.
 */
export function interviewGateProblem(a: HiringStepInput): string | null {
  if (a.stage === 'applied') return a.hasHiringManager ? 'Shortlist them first: the hiring manager accepts them, then HR’s screening call.' : 'Shortlist them first, then make the screening call.';
  if (a.stage !== 'shortlisted') return null;
  if (a.hasHiringManager && a.suggestion === 'reject') return 'The hiring manager rejected them: reject them, or ask the hiring manager to accept them.';
  if (a.hasHiringManager && a.suggestion !== 'next') return 'Waiting for the hiring manager to accept them.';
  if (a.screeningCall === 'failed') return 'They failed the screening call.';
  if (a.screeningCall !== 'passed') return 'Make the screening call first: only those who pass it are interviewed.';
  return null;
}

/** Where a shortlisted applicant stands in the steps, for a badge. */
export const HIRING_STEPS = ['to_review', 'manager_rejected', 'call_due', 'call_failed', 'ready'] as const;
export type HiringStep = (typeof HIRING_STEPS)[number];
export const HIRING_STEP_LABELS: Record<HiringStep, string> = {
  to_review: 'Waiting for the manager',
  manager_rejected: 'Rejected by the manager',
  call_due: 'Screening call due',
  call_failed: 'Failed the screening call',
  ready: 'Ready to interview',
};
/** Each badge's tone: warn (HR to act on a no), accent (HR to act), ok (ready), muted (waiting for someone else). */
export const HIRING_STEP_TONES: Record<HiringStep, 'warn' | 'accent' | 'ok' | 'muted'> = {
  to_review: 'muted',
  manager_rejected: 'warn',
  call_due: 'accent',
  call_failed: 'warn',
  ready: 'ok',
};

/** Where a shortlisted applicant stands; null at any other stage (or filtered out). */
export function hiringStepOf(a: HiringStepInput): HiringStep | null {
  if (a.stage !== 'shortlisted' || a.filteredOut) return null;
  if (a.hasHiringManager && a.suggestion === 'reject') return 'manager_rejected';
  if (a.hasHiringManager && a.suggestion !== 'next') return 'to_review';
  if (a.screeningCall === 'failed') return 'call_failed';
  if (a.screeningCall === 'passed') return 'ready';
  return 'call_due';
}

// ---------- the messages ----------

const people = (n: number) => `${n} ${n === 1 ? 'applicant' : 'applicants'}`;

/** Names in a line: the first `max`, and how many more. */
export function namesLine(names: readonly string[], max = 5): string {
  const shown = names.slice(0, max).join(', ');
  return names.length > max ? `${shown} and ${names.length - max} more` : shown;
}

/** The hiring manager's message once a batch is shortlisted (the app's notification, the email's subject). */
export function shortlistNotice(job: string, names: readonly string[]): { title: string; body: string } {
  return { title: `${people(names.length)} shortlisted for ${job}: please accept or reject them`, body: namesLine(names) };
}

/** The hiring manager's email: who, and where to review them. */
export function shortlistEmail(job: string, names: readonly string[], link: string): { subject: string; text: string } {
  const n = shortlistNotice(job, names);
  return {
    subject: n.title,
    text: [`HR shortlisted ${people(names.length)} for ${job}:`, '', ...names.map((x) => `- ${x}`), '', `Please accept or reject them on My Hiring: ${link}`].join('\n'),
  };
}

/** HR's message once the hiring manager reviewed a batch: "Hiring manager reviewed the shortlist: 3 accepted, 1 rejected". */
export function reviewNotice(job: string, accepted: number, rejected: number): { title: string; body: string } {
  const parts = [accepted ? `${accepted} accepted` : null, rejected ? `${rejected} rejected` : null].filter(Boolean).join(', ');
  return { title: `Hiring manager reviewed the shortlist: ${parts || 'nothing changed'}`, body: job };
}

// ---------- My Hiring's shortlist to review ----------

/** A shortlisted applicant on the hiring manager's My Hiring, to accept or reject. */
export interface ReviewApplicant {
  id: string;
  number: string;
  fullName: string;
  /** The screening questions' match % and the CV match % (null: none). */
  matchPercent: number | null;
  cvMatchPercent: number | null;
  /** What the CV says (experience, latest role, the Ex-agency and Skipper flags). */
  fromCv: CvListFacts | null;
  /** The years they typed, if asked. */
  yearsTyped: number | null;
  /** Their review so far (null: not yet) and its note. */
  suggestion: HiringSuggestion | null;
  note: string | null;
  /** When they were shortlisted (ISO), when known. */
  shortlistedAt: string | null;
}

/** A vacancy's shortlist on My Hiring. */
export interface ReviewGroup {
  vacancy: { id: string; number: string; title: string };
  applicants: ReviewApplicant[];
}
