// Deleting an applicant, or a vacancy people applied to (owner, 25 October 2026, on a closed vacancy with one rejected
// applicant: "i want to delete this"; asked, "Vacancy alone - applicant alone - superadmin only"). A Super Admin deletes
// one application on its own, with what hangs off it (its steps, interviews, screening comments, CV and its preview,
// draft job offers, the suggestions it closed); or a vacancy with every application on it, the vacancy's number typed to
// confirm. An application stays on record when someone was hired from it, when a job offer was sent to them (a document
// on record), or while an interview is still to come (cancelled first, so the invitations go out as cancelled). If any
// application of a vacancy stays, the vacancy stays too, each one named. The candidate profile goes with its last record:
// it stays while it has another application, a general CV or a link to an employee.
// Pure code: the API enforces these rules (recruitment-deletes.service.ts), the web shows them. Tested in
// apps/api/src/common/recruitment-deletes.spec.ts.

import { cairoClock } from './check-in.js';
import type { VacancyStatus } from './recruitment.js';

// ---------- why one stays ----------

export const DELETE_REFUSAL_KINDS = ['hired', 'offer_sent', 'interview_upcoming'] as const;
export type DeleteRefusalKind = (typeof DELETE_REFUSAL_KINDS)[number];

/** Why an application can't be deleted: on its own page ("text"), and as a line of a vacancy's refusal ("short"). */
export interface DeleteRefusal {
  kind: DeleteRefusalKind;
  /** "An offer was sent to them, so the application stays on record." */
  text: string;
  /** "APP-2026-0005: an offer was sent" */
  short: string;
}

/** What an application is checked with before it is deleted. */
export interface DeletableApplication {
  number: string;
  stage: string;
  /** The profile made from its accepted offer. */
  employeeId: string | null;
  offers: readonly { number: string; status: string; sentAt: Date | string | null; hiredAt: Date | string | null }[];
  interviews: readonly { status: string; startsAt: Date | string; minutes: number }[];
  /** Onboarding checklists opened from it (each one an employment's: someone hired). */
  onboarding: number;
}

/** A job offer that went to the candidate: sent, answered, or withdrawn after it was sent. A draft never sent goes with the application. */
export const offerWentOut = (o: { status: string; sentAt: Date | string | null }): boolean =>
  o.sentAt !== null || o.status === 'sent' || o.status === 'accepted' || o.status === 'declined';

/** An interview still to come: scheduled (not cancelled, done or a no-show) and not over yet. */
export const interviewUpcoming = (i: { status: string; startsAt: Date | string; minutes: number }, now: Date): boolean =>
  i.status === 'scheduled' && new Date(i.startsAt).getTime() + i.minutes * 60_000 > now.getTime();

const DAY_EN = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** An interview's moment in words, in Cairo: "Sunday 2 November 2026 at 10:30 AM". */
export const interviewWhen = (startsAt: Date | string): string => `${DAY_EN.format(new Date(startsAt)).replace(',', '')} at ${cairoClock(startsAt)}`;

/**
 * Why the application stays, or null when it can be deleted: someone hired from it (its stage, the profile made, an
 * onboarding checklist or an offer turned into a hire), a job offer sent to them, or an interview still to come (the
 * earliest named).
 */
export function applicationDeleteRefusal(a: DeletableApplication, now: Date): DeleteRefusal | null {
  if (a.stage === 'hired' || a.employeeId !== null || a.onboarding > 0 || a.offers.some((o) => o.hiredAt !== null)) {
    return { kind: 'hired', text: 'They were hired from it, so the application stays on record.', short: `${a.number}: they were hired from it` };
  }
  const sent = a.offers.find(offerWentOut);
  if (sent) {
    return { kind: 'offer_sent', text: 'An offer was sent to them, so the application stays on record.', short: `${a.number}: an offer was sent (${sent.number})` };
  }
  const next = a.interviews
    .filter((i) => interviewUpcoming(i, now))
    .sort((x, y) => new Date(x.startsAt).getTime() - new Date(y.startsAt).getTime())[0];
  if (next) {
    const when = interviewWhen(next.startsAt);
    return {
      kind: 'interview_upcoming',
      text: `Cancel the interview on ${when} first, so the invitations go out as cancelled.`,
      short: `${a.number}: an interview on ${when} is still to come`,
    };
  }
  return null;
}

/** A vacancy's refusal: the applications that stay, one line each. */
export const vacancyDeleteRefusal = (lines: readonly string[]): string =>
  `${lines.length === 1 ? 'One application stays on record' : `${lines.length} applications stay on record`}, so the vacancy stays: ${lines.join('; ')}.`;

// ---------- confirming a vacancy's delete ----------

/** The vacancy's number typed to confirm (?confirm=VAC-2026-0001): its case and the spaces around it don't matter. */
export const vacancyConfirmed = (typed: string | null | undefined, number: string): boolean => (typed ?? '').trim().toUpperCase() === number.toUpperCase();

/** What the API says when the number wasn't typed, or not right. */
export const vacancyConfirmText = (number: string, applications: number): string =>
  `Type ${number} to confirm: ${applications === 1 ? 'its application is' : `its ${applications} applications are`} deleted with it.`;

// ---------- the API's answers ----------

/** GET /recruitment/applications/:id/deletion: what deleting it takes with it, or why it stays (a Super Admin only). */
export interface ApplicationDeletion {
  id: string;
  number: string;
  vacancy: { id: string; number: string; title: string };
  /** Why it stays, in words; null: it can be deleted. */
  refusal: string | null;
  /** What goes with it. */
  interviews: number;
  comments: number;
  /** Its CV, and the Word CV's PDF preview kept for the CV window. */
  files: number;
  /** Job offers drafted to them and never sent. */
  draftOffers: number;
  /** Their candidate profile: deleted too when nothing else is left, else it stays. Null without one. */
  candidate: { id: string; code: string; goes: boolean } | null;
}

/** GET /recruitment/vacancies/:id/deletion: what deleting it takes with it, or why it stays (a Super Admin only). */
export interface VacancyDeletion {
  id: string;
  number: string;
  title: string;
  status: VacancyStatus;
  applications: number;
  /** The applications that stay, one line each ("APP-2026-0005: an offer was sent (OFF-2026-0002)"); empty: it can be deleted. */
  refusals: string[];
  /** Candidate profiles deleted with them, nothing else being left. */
  candidates: number;
  /** Its number must be typed to confirm (?confirm=): when it has applications. */
  confirm: boolean;
}
