import {
  effectiveFromProblem,
  RAISE_DECISIONS,
  RAISE_FIGURE_KINDS,
  RAISE_REASON_CHOICES,
  RAISE_WAYS,
  raisedGross,
  raiseFigureProblem,
  type RaiseDecision,
  type RaiseFigure,
  type RaiseFigureKind,
  type RaiseReasonChoice,
  type RaiseWay,
} from '@trendlix/shared';
import { dateFrom } from '../../../lib/form-data';
import { monthsFrom } from '../employees/contract-body';
import { parseAmount } from '../employees/[id]/contracts/salary';

// The forms of raise requests and their decisions (owner, 17 October 2026: "requesting a raise should have a drop list
// reason first ( Annual Raise - Performance Raise - Counter Offer Raise - etc..) then add requester comment, suggest raise
// amount or percentage, then the approver to Approve - Approve with another raise amount or percentge - Reject, and add
// a comment"), read as the API takes them: the request (the reason from the list, the month it is asked from, the
// comment, the raise suggested),
// HR's decision on it (approve as suggested, with another raise, or reject; with the way and effective date of the raise
// it prepares), and the CEO's on the raise (approve as it reached them, with another raise, reject, or return to HR).
// The comment is required on each. Pure code, tested; relative imports, as vitest doesn't know the @/ paths.

const text = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();

const isIn = <T extends string>(list: readonly T[], value: string): value is T => (list as readonly string[]).includes(value);

/**
 * A raise typed as a number: an amount as the pay fields take one (commas between thousands), a percent with a point
 * only (a decimal comma would read as thousands: refused), with or without "%". Too many decimals stay a number, for the
 * problem to say so; anything else is NaN.
 */
export function figureValue(kind: RaiseFigureKind, typed: string): number {
  const s = typed.trim().replace(/%$/, '').trim();
  if (kind === 'percent' && /[,،]/.test(s)) return Number.NaN;
  const n = parseAmount(s);
  if (n === null) return Number.NaN;
  if (Number.isNaN(n) && /^\d+\.\d+$/.test(s.replace(/,/g, ''))) return Number(s.replace(/,/g, ''));
  return n;
}

/**
 * The raise typed (fields figureKind and figureValue): an amount in EGP or a percent, of the kinds the caller may use (a
 * single kind needs no choice). Null when left empty: a mistake when `required`.
 */
export function figureFrom(fd: FormData, errors: string[], kinds: readonly RaiseFigureKind[] = RAISE_FIGURE_KINDS, required = false): RaiseFigure | null {
  const typed = text(fd, 'figureValue');
  const chosen = text(fd, 'figureKind');
  const kind = isIn(kinds, chosen) ? chosen : kinds.length === 1 ? kinds[0] : null;
  if (typed === '') {
    if (required) errors.push(kind === 'percent' ? 'Enter the raise as a percent of the gross, e.g. 10.' : 'Enter the raise as an amount in EGP or a percent of the gross.');
    return null;
  }
  if (!kind) {
    errors.push(kinds.length === 1 ? 'Enter the raise as a percent of the gross, e.g. 10.' : 'Choose whether the raise is an amount in EGP or a percent.');
    return null;
  }
  const value = figureValue(kind, typed);
  const problem = raiseFigureProblem({ kind, value });
  if (problem) {
    errors.push(problem);
    return null;
  }
  return { kind, value };
}

/**
 * The gross a raise typed comes to on `gross` (the pay in force), for the preview beside the field: null while it isn't
 * a valid raise yet, or without the gross (for those who don't see salaries).
 */
export function previewGross(gross: number | null | undefined, kind: RaiseFigureKind, typed: string): number | null {
  if (gross === null || gross === undefined || typed.trim() === '') return null;
  const value = figureValue(kind, typed);
  if (raiseFigureProblem({ kind, value })) return null;
  return raisedGross(gross, { kind, value });
}

/**
 * The request form as the API takes it: the reason from the list, the month the raise is asked from (Effective from, 17
 * October 2026: its 1st, this month or a later one; `today` is Cairo's), the comment, and the raise suggested if any.
 */
export function requestBody(fd: FormData, kinds: readonly RaiseFigureKind[], errors: string[], today: string) {
  const reason = text(fd, 'raiseReason');
  const raiseReason: RaiseReasonChoice | null = isIn(RAISE_REASON_CHOICES, reason) ? reason : null;
  if (!raiseReason) errors.push('Choose why the raise is asked for.');
  const effectiveFrom = text(fd, 'effectiveFrom');
  const effectiveProblem = effectiveFrom ? effectiveFromProblem(effectiveFrom, today) : 'Choose the month the raise is to take effect from.';
  if (effectiveProblem) errors.push(effectiveProblem);
  const comment = text(fd, 'comment');
  if (!comment) errors.push('Write a comment: what the raise is for.');
  const figure = figureFrom(fd, errors, kinds);
  return {
    ...(raiseReason && { raiseReason }),
    ...(!effectiveProblem && { effectiveFrom }),
    comment,
    ...(figure?.kind === 'amount' && { suggestedIncrease: figure.value }),
    ...(figure?.kind === 'percent' && { suggestedPercent: figure.value }),
  };
}

/** A figure as the decisions take it. */
const decided = (f: RaiseFigure | null) => ({
  ...(f?.kind === 'amount' && { increaseAmount: f.value }),
  ...(f?.kind === 'percent' && { increasePercent: f.value }),
});

/**
 * HR's decision on a request: reject it with the comment; or approve it, as suggested or with another raise (the
 * figure), with the comment, how the raise is made (the way), from when (the effective date, typed DD/MM/YYYY) and, for a
 * new contract, its length if not the usual. `suggested`: whether the request suggests a raise, without which it is
 * approved with another raise only.
 */
export function hrDecisionBody(
  fd: FormData,
  errors: string[],
  suggested = true,
): { decision: RaiseDecision | null; body: { comment: string; decision?: 'approve' | 'approve_other'; way?: RaiseWay; effectiveDate?: string; durationMonths?: number; increaseAmount?: number; increasePercent?: number } } {
  const typed = text(fd, 'decision');
  const decision = isIn(RAISE_DECISIONS, typed) ? typed : null;
  if (!decision) errors.push('Choose approve, approve with another raise or reject.');
  if (decision === 'approve' && !suggested) errors.push('This request suggests no raise: approve it with another raise, and set the raise.');
  const comment = text(fd, 'comment');
  if (!comment) errors.push('Write your comment on the decision.');
  if (decision !== 'approve' && decision !== 'approve_other') return { decision, body: { comment } };

  const figure = decision === 'approve_other' ? figureFrom(fd, errors, RAISE_FIGURE_KINDS, true) : null;
  const wayTyped = text(fd, 'way');
  const way = isIn(RAISE_WAYS, wayTyped) ? wayTyped : null;
  if (!way) errors.push('Choose how the raise is made: an amendment to the contract in force, or a new contract.');
  let effectiveDate = '';
  if (text(fd, 'effectiveDate') === '') errors.push('Enter the date the raise takes effect, the 1st of a month, e.g. 01/12/2026.');
  else effectiveDate = dateFrom(fd, 'effectiveDate', 'date the raise takes effect', errors);
  const durationMonths = way === 'contract' ? monthsFrom(fd, 'durationMonths', 'length', 60, errors) : undefined;
  if (durationMonths === 0) errors.push('A fixed term runs for 1 to 60 months.');
  return {
    decision,
    body: { decision, comment, ...(way && { way }), effectiveDate, ...(durationMonths !== undefined && { durationMonths }), ...decided(figure) },
  };
}

/** What the CEO may do with a raise: the three decisions, or send it back to HR. */
export type CeoChoice = RaiseDecision | 'return';

/**
 * The CEO's decision on a raise: approve it as it reached them, approve it with another raise (the figure, over the pay
 * before it), reject it (`decision`), or return it to HR (the secondary button, `intent`); always with the comment.
 * `path`: the API's step (approve, decline, return).
 */
export function ceoDecisionBody(fd: FormData, errors: string[]): { choice: CeoChoice | null; path: 'approve' | 'decline' | 'return' | null; body: { comment: string; increaseAmount?: number; increasePercent?: number } } {
  const typed = text(fd, 'intent') === 'return' ? 'return' : text(fd, 'decision');
  const choice: CeoChoice | null = typed === 'return' || isIn(RAISE_DECISIONS, typed) ? (typed as CeoChoice) : null;
  if (!choice) errors.push('Choose approve, approve with another raise, reject or return to HR.');
  const comment = text(fd, 'comment');
  if (!comment) errors.push(choice === 'return' ? 'Write what HR should change: it goes back to HR with your comment.' : 'Write your comment on the decision.');
  const figure = choice === 'approve_other' ? figureFrom(fd, errors, RAISE_FIGURE_KINDS, true) : null;
  const path = choice === 'reject' ? 'decline' : choice === 'return' ? 'return' : choice ? 'approve' : null;
  return { choice, path, body: { comment, ...decided(figure) } };
}
