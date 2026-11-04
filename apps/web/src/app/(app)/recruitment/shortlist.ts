import {
  HIRING_BATCH_MAX,
  isDecisionStep,
  STEP_OUTCOMES_OF,
  takesStep,
  type ApplicationListItem,
  type ApplicationStage,
  type DecisionStep,
  type HiringBatchResult,
  type StepOutcome,
  type TreeCaller,
  type VacancyView,
} from '@trendlix/shared';
import { decisionOf, type DecisionBody } from './tree';

// The batches on the site (owner, 29 October 2026: "Tick several at once"; the recruitment tree, 3 November 2026:
// "Recrutment tree"; packages/shared recruitment-tree.ts): on a vacancy's list HR ticks applicants at Applicants and sends
// them to Review 1 together, or ticks those at one step they decide and decides them together; on My Hiring the
// recruiter's manager (Review 2) and the hiring manager (Final Review) tick theirs and pass or reject them together, with
// the reasons and the feedback. The ticks, the forms read, and what a result says. Pure code (relative imports), tested
// in shortlist.test.ts; the API checks everything again.

// ---------- the ticks ----------

/** One ticked or not. */
export function ticked(selected: ReadonlySet<string>, id: string, on: boolean): Set<string> {
  const next = new Set(selected);
  if (on) next.add(id);
  else next.delete(id);
  return next;
}

/** All of them ticked, or none ("Select all"). */
export const tickedAll = (ids: readonly string[], on: boolean): Set<string> => new Set(on ? ids : []);

/** How "Select all" stands: all ticked, some (shown half ticked) or none. */
export function allTicks(selected: ReadonlySet<string>, ids: readonly string[]): 'all' | 'some' | 'none' {
  const n = ids.filter((id) => selected.has(id)).length;
  return n === 0 ? 'none' : n === ids.length ? 'all' : 'some';
}

/** Those ticked that the list still shows, in its order (the list is read again after each batch). */
export const tickedIds = (ids: readonly string[], selected: ReadonlySet<string>): string[] => ids.filter((id) => selected.has(id));

// ---------- who ticks what on a vacancy's list ----------

/** The caller as the tree's rules know them on a vacancy (who they are against its recruiter, their manager, its hiring manager). */
export function vacancyCaller(v: Pick<VacancyView, 'viewer' | 'recruiter' | 'recruiterManager' | 'hiringManager'>, me: { employeeId: string | null; superAdmin: boolean }): TreeCaller {
  const is = (person: { id: string } | null | undefined) => !!person && !!me.employeeId && person.id === me.employeeId;
  return {
    manages: v.viewer === 'manages',
    superAdmin: me.superAdmin,
    isRecruiter: is(v.recruiter),
    isRecruiterManager: is(v.recruiterManager),
    isHiringManager: is(v.hiringManager),
    hasRecruiter: !!v.recruiter,
    hasRecruiterManager: !!v.recruiterManager,
    hasHiringManager: !!v.hiringManager,
  };
}

/** Whether a row may be ticked: not filtered out, at Applicants (HR sends them on) or at a step the caller decides. */
export function tickable(a: Pick<ApplicationListItem, 'stage' | 'filteredOut'>, caller: TreeCaller): boolean {
  if (a.filteredOut) return false;
  if (a.stage === 'applied') return caller.manages || caller.superAdmin;
  return isDecisionStep(a.stage) && takesStep(a.stage, caller);
}

/** The one stage of those ticked, or null when they are at more than one (or none is ticked). */
export function sharedStage(chosen: readonly string[], stageOf: Readonly<Record<string, ApplicationStage>>): ApplicationStage | null {
  const stages = new Set(chosen.map((id) => stageOf[id]));
  return stages.size === 1 ? ([...stages][0] ?? null) : null;
}

/** What is wrong with a batch the form can see: none ticked, or too many. */
export function batchProblem(ids: readonly string[], verb: 'send to Review 1' | 'decide'): string | null {
  if (!ids.length) return `Tick at least one applicant to ${verb}.`;
  if (ids.length > HIRING_BATCH_MAX) return `${verb === 'decide' ? 'Decide' : 'Send'} at most ${HIRING_BATCH_MAX} applicants at a time.`;
  return null;
}

/** "Send to Review 1 (3)". */
export const sendLabel = (n: number) => `Send to Review 1 (${n})`;

// ---------- a step decided for several ----------

export interface BatchDecisionBody extends Omit<DecisionBody, 'email'> {
  applicationIds: string[];
  stage: DecisionStep;
}

/** The batch's decision form read: the applicants ticked, their step, the outcome (the button pressed), the reasons, the feedback. */
export function batchDecisionForm(fd: FormData): { body: BatchDecisionBody | null; errors: string[] } {
  const applicationIds = [...new Set(fd.getAll('applicationIds').filter((v): v is string => typeof v === 'string' && v !== ''))];
  const stage = fd.get('stage');
  const errors: string[] = [];
  const problem = batchProblem(applicationIds, 'decide');
  if (problem) errors.push(problem);
  if (!isDecisionStep(stage)) errors.push('Tick applicants at one step to decide them together.');
  const { body, errors: more } = decisionOf(fd);
  errors.push(...more);
  if (!body || errors.length || !isDecisionStep(stage)) return { body: null, errors };
  if (!STEP_OUTCOMES_OF[stage].includes(body.outcome)) return { body: null, errors: ['Choose the outcome.'] };
  return { body: { applicationIds, stage, outcome: body.outcome, reasons: body.reasons, feedback: body.feedback }, errors: [] };
}

const DONE_VERBS: Record<StepOutcome, string> = {
  passed: 'Passed',
  accepted: 'Accepted',
  rejected: 'Rejected',
  unreachable: 'Marked unreachable',
  pending: 'Marked pending',
  declined: 'Marked declined',
};

const BUTTONS: Record<StepOutcome, string> = {
  passed: 'Pass',
  accepted: 'Accept',
  rejected: 'Reject',
  unreachable: 'Unreachable',
  pending: 'Pending',
  declined: 'Declined',
};

/** "Pass (3)", "Reject (3)", "Unreachable (3)": an outcome's button for those ticked. */
export const outcomeLabel = (outcome: StepOutcome, n: number) => `${BUTTONS[outcome]} (${n})`;

// ---------- what a batch did ----------

/** "they are at Review 1 already": a reason in a sentence's brackets. */
const bracketed = (reason: string): string => reason.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase());

/** "Sara Ali (they are at Review 1 already)"; one the caller may not see by their reason alone. */
export const skippedText = (s: HiringBatchResult['skipped'][number]): string => `${s.fullName ?? s.number ?? 'One applicant'} (${bracketed(s.reason)})`;

/**
 * What a batch says once done: "Sent to Review 1: 3; 2 skipped: Sara Ali (they are at Review 1 already), …", the first
 * `shown` skipped named and how many more.
 */
export function batchDoneText(verb: string, result: HiringBatchResult, shown = 5): string {
  const head = `${verb}: ${result.done.length}`;
  const skipped = result.skipped;
  if (!skipped.length) return `${head}.`;
  const named = skipped.slice(0, shown).map(skippedText).join(', ');
  const more = skipped.length > shown ? `, and ${skipped.length - shown} more` : '';
  return `${head}; ${skipped.length} skipped: ${named}${more}.`;
}

/** What a step decided for several says once done. */
export const decideDoneText = (outcome: StepOutcome, result: HiringBatchResult): string => batchDoneText(DONE_VERBS[outcome], result);
