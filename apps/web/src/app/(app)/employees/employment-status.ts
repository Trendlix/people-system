import { CHOSEN_STATUSES, INTERNSHIP_AGREEMENT, isTrainingType, LABELS, STANDING_LABELS, type ChosenStatus, type EmployeeStatus } from '@trendlix/shared';

// How the employment form shows the status. HR chooses only Active or On leave; Probation and Notice period are the
// system's (owner's decision, 16 October 2026), and an ended employment's follows why it ended. A new intern's shows as
// Intern, with no probation (19 October 2026). Pure code, so it is tested on its own.

export type StatusField =
  /** A select of these statuses, sent with the form. */
  | { kind: 'choose'; options: readonly ChosenStatus[] }
  /** Shown read-only and not sent: the system (or the end reason) sets it. */
  | { kind: 'shown'; value: string; hint: string };

/** What the system shows instead of a status HR can't choose, and why. */
const SET_BY_SYSTEM: Partial<Record<EmployeeStatus, string>> = {
  probation: 'Set by the system: it becomes Active with Confirm probation on the Employment tab.',
  notice_period: 'Set by the approved ending: it follows the ending.',
};

export function isChosenStatus(status: string): status is ChosenStatus {
  return (CHOSEN_STATUSES as readonly string[]).includes(status);
}

/**
 * The status field of the employment being changed, or of a new one (`employment` left out), whose type is chosen in the
 * same form (`type`).
 */
export function statusField(employment?: { status: EmployeeStatus; endDate: string | null }, type?: string): StatusField {
  // a new employment: Probation while the worked-out probation runs, else Active; an intern's has none
  if (!employment && isTrainingType(type)) {
    return { kind: 'shown', value: 'Set by the system', hint: `${STANDING_LABELS[type]} while the ${INTERNSHIP_AGREEMENT} runs: no probation.` };
  }
  if (!employment) return { kind: 'shown', value: 'Set by the system', hint: 'Probation until the probation end (Active for a rehire).' };
  if (employment.endDate) return { kind: 'shown', value: LABELS.status[employment.status], hint: 'Follows why the employment ended.' };
  if (isChosenStatus(employment.status)) return { kind: 'choose', options: CHOSEN_STATUSES };
  return { kind: 'shown', value: LABELS.status[employment.status], hint: SET_BY_SYSTEM[employment.status] ?? 'Set by the system.' };
}
