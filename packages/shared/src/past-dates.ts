// Requests on days gone by (owner, 5 November 2026: "for now and till the end of the year allow the HR to enter leaves
// and request with past dates"; asked who, "Every employee's requests"): until 31 December 2026 (Cairo), anyone may ask
// for leave, a work from home day, an official duty or a compensatory day off on days gone by, as HR records them. The
// notice for days still to come stays as it is. HR may record annual leave before the six months after joining were
// served too (owner, 11 November 2026, moving leave from the old system: "override it for HR till the end of the year
// only"; leaves.ts leaveRequestProblems). From 1 January 2027 the rules are as before, by themselves.

/** The last day days gone by may be asked for (YYYY-MM-DD, Cairo). */
export const PAST_DATES_OPEN_UNTIL = '2026-12-31';

/** Whether days gone by may be asked for on `today` (YYYY-MM-DD, Cairo). */
export const pastDatesOpen = (today: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(today) && today <= PAST_DATES_OPEN_UNTIL;

/** Whether `date` is a day gone by that may be asked for on `today`: before today, while days gone by are open. */
export const pastDateAllowed = (date: string, today: string): boolean => pastDatesOpen(today) && date < today;
