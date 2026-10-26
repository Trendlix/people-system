// An employee asks to resign (owner, 26 October 2026: "but the employee has to request resignation and then the HR
// generates the document"). Before this only HR recorded a resignation, on the profile (Employment → End employment →
// Resignation). Now the employee sends "Resign" from My Requests: a short reason, a preferred last working day if they
// have one, and a signed letter if they have one. HR (the CEO for a C-level person) is told and the direct manager is
// told and sees it, but decides nothing. HR presses "Record the resignation", which opens the End employment form with
// the resignation, the day it was sent as the notice received on and the reason filled in; saving it is the ending as
// before (its resignation document generated from it, the labour office certification, the CEO's approval, HR
// completing it), and the request is then Recorded. The employee may withdraw it until it is recorded; HR may return it
// with a reason (a mistaken request), and the employee may send it again. Pure: the API enforces these and the web shows
// the same checks live. Dates are YYYY-MM-DD.

import { underLabourLaw } from './index.js';
import { isTrainingType } from './employment-types.js';

/** Where a request stands: sent (waiting for HR), recorded as an ending, withdrawn by the employee, returned by HR. */
export const RESIGNATION_REQUEST_STATUSES = ['sent', 'recorded', 'withdrawn', 'returned'] as const;
export type ResignationRequestStatus = (typeof RESIGNATION_REQUEST_STATUSES)[number];

export const RESIGNATION_REQUEST_STATUS_LABELS: Record<ResignationRequestStatus, string> = {
  sent: 'Sent',
  recorded: 'Recorded',
  withdrawn: 'Withdrawn',
  returned: 'Returned',
};

/** What the screens call it. */
export const RESIGNATION_REQUEST_LABEL = 'Resignation request';

/** The longest reason the API takes: a short one. */
export const RESIGNATION_REASON_MAX = 300;

/** The signed letter: a PDF or a photo, at most this many MB (it passes through the web app, which Vercel limits to 4.5 MB). */
export const RESIGNATION_LETTER_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
export const RESIGNATION_LETTER_MAX_MB = 4;

/** The checkbox on the form (owner's wording, 26 October 2026). */
export const RESIGNATION_CONFIRMATION = 'I understand a resignation counts once certified at the labour office (Decree 187/2025).';

/** The farthest ahead a preferred last working day may be: a year. */
export const RESIGNATION_PREFERRED_DAY_MAX_DAYS = 366;

/** Why someone can't resign this way: the resignation rule is the labour law's (Art. 156), which a freelancer and an intern are outside. */
export const RESIGNATION_NOT_UNDER_LAW = 'A resignation request is for employment under the labour law. A freelancer or an intern is ended by HR instead: ask HR.';

/**
 * Whether the resignation rule applies to an employment: one under the labour law (all but freelance and the unpaid
 * internship, whose agreement ends with Training completed instead).
 */
export const resignationOffered = (employmentType: string): boolean => underLabourLaw(employmentType) && !isTrainingType(employmentType);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (s: unknown): s is string => typeof s === 'string' && DATE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const plusDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** A preferred last working day's problem (on or after today, within a year), or null. `today`: YYYY-MM-DD, Cairo. */
export function preferredDayProblem(day: string | null | undefined, today: string): string | null {
  if (day === null || day === undefined || day === '') return null;
  if (!isDate(day)) return 'Enter a real date for your preferred last working day, or leave it empty.';
  if (day < today) return 'Your preferred last working day must be today or later.';
  if (day > plusDays(today, RESIGNATION_PREFERRED_DAY_MAX_DAYS)) return 'Your preferred last working day is more than a year away. Choose a nearer day, or leave it empty.';
  return null;
}

/** Everything wrong with a request as typed, in the order to fix it (none: it can be sent). */
export function resignationProblems(typed: { reason: string; preferredLastDay?: string | null; confirmed: boolean }, today: string): string[] {
  const problems: string[] = [];
  const reason = typed.reason.trim();
  if (!reason) problems.push('Enter your reason for resigning.');
  else if (reason.length > RESIGNATION_REASON_MAX) problems.push(`The reason can be at most ${RESIGNATION_REASON_MAX} characters.`);
  const day = preferredDayProblem(typed.preferredLastDay, today);
  if (day) problems.push(day);
  if (!typed.confirmed) problems.push('Tick the box to say you understand a resignation counts once certified at the labour office.');
  return problems;
}

/** "3 months", "1 day": a notice as a sentence names it. */
export function noticeSentence(amount: number, unit: string): string {
  const unitText = unit === 'working_days' ? 'working day' : unit.replace(/s$/, '');
  return `${amount} ${unitText}${amount === 1 ? '' : 's'}`;
}

/** Whether a request can still be withdrawn by its employee: until it is recorded (or already gone). */
export const canWithdrawResignation = (status: string): boolean => status === 'sent';
