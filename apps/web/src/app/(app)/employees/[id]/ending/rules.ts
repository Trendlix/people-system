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
 * Training completed's last working day, as the API sets it: the agreement's end date; recorded after that day (the work
 * went on), the day recorded (the notice date). `recordedOn`: YYYY-MM-DD, or null while not (properly) typed.
 */
export function trainingLastDay(agreementEnd: string, recordedOn: string | null): string {
  return recordedOn && recordedOn > agreementEnd ? recordedOn : agreementEnd;
}
