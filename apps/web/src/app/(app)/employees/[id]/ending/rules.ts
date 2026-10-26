import { isTrainingType, type EmployeeStatus, type EmploymentType } from '@trendlix/shared';
import type { EndingRule } from '../../../../../lib/types';

// Which ways of ending the current employment the End employment form offers, and an internship agreement's last working
// day. Training completed (owner, 19 October 2026: "or can be only renewed 1 time, after that it should be converted to
// a full time contract"): an intern's internship agreement ends with its term, so its way is Training completed, never
// Non-renewal (no non-renewal notice, no Art. 154), and Probation is never theirs (an agreement has none). Pure code,
// tested; relative imports for the tests.

/**
 * The rules HR can choose: the active ones; Probation only while on probation, never for an intern; Non-renewal only
 * with a signed fixed-term contract (`fixed`), never for an intern's agreement; Training completed only for that.
 */
export function endingRulesFor(
  rules: readonly EndingRule[],
  e: { status: EmployeeStatus | string; employmentType: EmploymentType | string },
  fixed: boolean,
): EndingRule[] {
  const training = isTrainingType(e.employmentType);
  return rules.filter(
    (r) =>
      r.active &&
      (r.key !== 'probation' || (e.status === 'probation' && !training)) &&
      (r.key !== 'non_renewal' || (fixed && !training)) &&
      (r.key !== 'training_completed' || training),
  );
}

/**
 * The last working day as the ending's views show it. Agreed (owner, 26 October 2026: "let me add agreed on last working
 * date only by admin and HR"): "Notice ends 26/01/2027 · agreed last working day 30/11/2026", both days; else the day
 * alone. `show` formats a YYYY-MM-DD day (formatDate on screen).
 */
export function lastDayText(e: { lastWorkingDay: string; noticeEndsOn?: string | null; lastDayAgreed?: boolean }, show: (ymd: string) => string): string {
  if (!e.lastDayAgreed) return show(e.lastWorkingDay);
  return e.noticeEndsOn
    ? `Notice ends ${show(e.noticeEndsOn)} · agreed last working day ${show(e.lastWorkingDay)}`
    : `Agreed last working day ${show(e.lastWorkingDay)}`;
}

/** The hint under the "Agreed last working day" field, with the day worked out from the notice (null: not known yet). */
export function agreedLastDayHint(workedOut: string | null, approximate: boolean, show: (ymd: string) => string): string {
  const use = workedOut ? `Leave it empty to use the notice: ${approximate ? 'about ' : ''}${show(workedOut)}.` : 'Leave it empty to use the notice.';
  return `${use} Set it when you agreed a different last day with them.`;
}

/**
 * Why an agreed last working day typed can't be used, or null: before the notice day (the API checks the same). Both are
 * YYYY-MM-DD, or null while empty or not (properly) typed, which is nothing to check.
 */
export function agreedLastDayProblem(agreed: string | null, given: string | null, show: (ymd: string) => string): string | null {
  if (agreed && given && agreed < given) return `The agreed last working day must be on or after the notice date, ${show(given)}.`;
  return null;
}

/**
 * Training completed's last working day, as the API sets it: the agreement's end date; recorded after that day (the work
 * went on), the day recorded (the notice date). `recordedOn`: YYYY-MM-DD, or null while not (properly) typed.
 */
export function trainingLastDay(agreementEnd: string, recordedOn: string | null): string {
  return recordedOn && recordedOn > agreementEnd ? recordedOn : agreementEnd;
}
