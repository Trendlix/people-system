import { HIRING_BATCH_MAX, isHiringSuggestion, SUGGESTION_NOTE_MAX, type ApplicationListItem, type HiringBatchResult, type HiringSuggestion } from '@trendlix/shared';

// The hiring steps on the site (owner, 29 October 2026: "HR Filteration and shortlisting - Manager view the shortlisted
// and accept or reject them"; asked, "Tick several at once"; packages/shared hiring-steps.ts): HR ticks applicants at
// Applied on a vacancy's list and shortlists them together; the hiring manager ticks their shortlist on My Hiring and
// accepts or rejects them together, with a note. The ticks, the forms read, and what a result says. Pure code (relative
// imports), tested in shortlist.test.ts; the API checks everything again.

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

// ---------- HR's shortlist ----------

/** Whether HR may tick an applicant on a vacancy's list to shortlist: at Applied, not filtered out. */
export const shortlistable = (a: Pick<ApplicationListItem, 'stage' | 'filteredOut'>): boolean => a.stage === 'applied' && !a.filteredOut;

/** What is wrong with a batch the form can see: none ticked, or too many. */
export function batchProblem(ids: readonly string[], verb: 'shortlist' | 'accept or reject'): string | null {
  if (!ids.length) return `Tick at least one applicant to ${verb}.`;
  if (ids.length > HIRING_BATCH_MAX) return `${verb === 'shortlist' ? 'Shortlist' : 'Accept or reject'} at most ${HIRING_BATCH_MAX} applicants at a time.`;
  return null;
}

/** "Shortlist (3)". */
export const shortlistLabel = (n: number) => `Shortlist (${n})`;

// ---------- the hiring manager's review ----------

export interface ReviewBody {
  applicationIds: string[];
  decision: HiringSuggestion;
  note: string | null;
}

/** The review form read: the applicants ticked, Accept (`next`) or Reject (the button pressed), and the note. */
export function reviewForm(fd: FormData): { body: ReviewBody | null; errors: string[] } {
  const applicationIds = [...new Set(fd.getAll('applicationIds').filter((v): v is string => typeof v === 'string' && v !== ''))];
  const decision = fd.get('decision');
  const raw = fd.get('note');
  const note = typeof raw === 'string' ? raw.trim() : '';
  const errors: string[] = [];
  const problem = batchProblem(applicationIds, 'accept or reject');
  if (problem) errors.push(problem);
  if (!isHiringSuggestion(decision)) errors.push('Choose Accept or Reject.');
  if (note.length > SUGGESTION_NOTE_MAX) errors.push(`Keep the note to ${SUGGESTION_NOTE_MAX} characters or fewer.`);
  if (errors.length) return { body: null, errors };
  return { body: { applicationIds, decision: decision as HiringSuggestion, note: note || null }, errors: [] };
}

/** "Accept (2)", "Reject (2)". */
export const reviewLabel = (decision: HiringSuggestion, n: number) => `${decision === 'next' ? 'Accept' : 'Reject'} (${n})`;

/** Their review so far as My Hiring shows it: a badge's words, its tone, and what it means on hover. */
export function reviewBadge(suggestion: HiringSuggestion | null): { label: string; className: string; title: string } {
  if (suggestion === 'next') return { label: 'Accepted', className: 'bg-ok-soft text-ok', title: 'You accepted them: HR makes the screening call next.' };
  if (suggestion === 'reject') return { label: 'Rejected', className: 'bg-warn-soft text-warn', title: 'You rejected them: HR confirms the rejection.' };
  return { label: 'To review', className: 'bg-canvas text-muted', title: 'Accept or reject them.' };
}

// ---------- what a batch did ----------

/** "they are shortlisted already": a reason in a sentence's brackets. */
const bracketed = (reason: string): string => reason.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase());

/** "Sara Ali (they are shortlisted already)"; one the caller may not see by their reason alone. */
export const skippedText = (s: HiringBatchResult['skipped'][number]): string => `${s.fullName ?? s.number ?? 'One applicant'} (${bracketed(s.reason)})`;

/**
 * What a batch says once done: "Shortlisted 3; 2 skipped: Sara Ali (they are shortlisted already), …", the first `shown`
 * skipped named and how many more.
 */
export function batchDoneText(verb: 'Shortlisted' | 'Accepted' | 'Rejected', result: HiringBatchResult, shown = 5): string {
  const head = `${verb} ${result.done.length}`;
  const skipped = result.skipped;
  if (!skipped.length) return `${head}.`;
  const named = skipped.slice(0, shown).map(skippedText).join(', ');
  const more = skipped.length > shown ? `, and ${skipped.length - shown} more` : '';
  return `${head}; ${skipped.length} skipped: ${named}${more}.`;
}

/** What the hiring manager's review says once done; a rejection is HR's to confirm ("HR confirms"). */
export function reviewDoneText(decision: HiringSuggestion, result: HiringBatchResult): string {
  const text = batchDoneText(decision === 'next' ? 'Accepted' : 'Rejected', result);
  if (!result.done.length) return text;
  return `${text} ${decision === 'next' ? 'HR makes the screening call next.' : 'HR confirms each rejection.'}`;
}
