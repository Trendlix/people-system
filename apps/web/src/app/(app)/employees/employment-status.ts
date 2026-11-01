import { CHOSEN_STATUSES, LABELS, type ChosenStatus, type EmployeeStatus } from '@trendlix/shared';

// How the employment form shows the status. HR chooses only Active or On leave; Probation and Notice period are the
// system's (owner's decision, 16 October 2026), and an ended employment's follows why it ended. Pure code, so it is
// tested on its own.

export type StatusField =
  /** A select of these statuses, sent with the form. */
  | { kind: 'choose'; options: readonly ChosenStatus[] }
  /** Shown read-only and not sent: the system (or the end reason) sets it. */
  | { kind: 'shown'; value: string };

export function isChosenStatus(status: string): status is ChosenStatus {
  return (CHOSEN_STATUSES as readonly string[]).includes(status);
}

/** The status field of the employment being changed, or of a new one (`employment` left out). */
export function statusField(employment?: { status: EmployeeStatus; endDate: string | null }): StatusField {
  if (!employment) return { kind: 'shown', value: 'Set by the system' };
  if (!employment.endDate && isChosenStatus(employment.status)) return { kind: 'choose', options: CHOSEN_STATUSES };
  return { kind: 'shown', value: LABELS.status[employment.status] };
}
