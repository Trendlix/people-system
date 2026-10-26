import { shownDate } from '../common/date-only.js';

// An agreed last working day (owner, 26 October 2026: "let me add agreed on last working date only by admin and HR").
// HR or an Admin may agree a last day with the employee that replaces the one worked out from the notice. Pure code,
// tested; dates are YYYY-MM-DD.

/**
 * Why an agreed last working day can't be used, or null when it can: not before the day the notice was given, and not
 * after the day the employment ended (when it has). It may fall before or after the notice's own end. An ending whose
 * notice is paid instead of worked has no day to agree: the employee stops on the notice date.
 */
export function agreedLastDayProblem(e: { agreed: string; noticeGivenOn: string; employmentEnd: string | null; payInLieu: boolean }): string | null {
  if (e.payInLieu) return 'The notice is paid instead of worked, so the last working day is the notice date. Agree a last working day only when the notice is worked.';
  if (e.agreed < e.noticeGivenOn) return `The agreed last working day must be on or after the notice date, ${shownDate(e.noticeGivenOn)}.`;
  if (e.employmentEnd && e.agreed > e.employmentEnd) return `The employment already ended on ${shownDate(e.employmentEnd)}: the agreed last working day can't be after it.`;
  return null;
}

/** The ending's last working day: the agreed one when there is one, else the one worked out from the notice. */
export const lastDayOf = (noticeEnds: string, agreed: string | null): string => agreed ?? noticeEnds;
