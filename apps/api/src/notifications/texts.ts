import { cairoClock, timeOfDayText, type NotificationKind } from '@trendlix/shared';
import { shownDate } from '../common/date-only.js';
import { monthName } from '../payroll/months.js';
import type { NotificationInput } from './notifications.service.js';

// What each notification says (owner, 20 October 2026: "Push notifications: yes (decisions, things waiting for someone,
// a check-in reminder)"; apps/mobile/README.md, Phase 4). Short and general, as a locked phone may show them: who and
// when, never a salary, an amount, a reason or a comment. Dates DD/MM/YYYY, times on the 12-hour clock. Pure, tested.

/** The kinds of request decided as leave is (the direct manager or the person in charge, then HR). */
export type LeaveLikeKind = 'leave' | 'permission' | 'correction';

const NAMES: Record<LeaveLikeKind | 'reimbursement', { waiting: string; noun: string }> = {
  leave: { waiting: 'A leave request is waiting for you', noun: 'Leave request' },
  permission: { waiting: 'A permission request is waiting for you', noun: 'Permission request' },
  correction: { waiting: 'An attendance correction is waiting for you', noun: 'Attendance correction' },
  reimbursement: { waiting: 'A reimbursement claim is waiting for you', noun: 'Reimbursement claim' },
};

/** A leave's days: "22/10/2026–23/10/2026", one day "22/10/2026", a half day "22/10/2026 (half day)". */
export function daysText(startDate: string, endDate: string, halfDay = false): string {
  if (startDate === endDate) return `${shownDate(startDate)}${halfDay ? ' (half day)' : ''}`;
  return `${shownDate(startDate)}–${shownDate(endDate)}`;
}

/** Someone's request waits for the decision of the one in charge of its step: "Mona Adel, 22/10/2026–23/10/2026". */
export function waitingText(kind: LeaveLikeKind | 'reimbursement', name: string, when: string, link: string): NotificationInput {
  return { kind: `${kind}_waiting`, title: NAMES[kind].waiting, body: `${name}, ${when}`, link };
}

/** The employee's own request decided: "Leave request approved", with its days. */
export function decidedText(kind: LeaveLikeKind, decision: 'approved' | 'rejected', when: string, link: string): NotificationInput {
  return { kind: `${kind}_decided`, title: `${NAMES[kind].noun} ${decision}`, body: when, link };
}

/** HR cancelled the employee's approved leave or permission. */
export function cancelledByHrText(kind: 'leave' | 'permission', when: string, link: string): NotificationInput {
  return { kind: `${kind}_decided`, title: kind === 'leave' ? 'Leave cancelled by HR' : 'Permission cancelled by HR', body: when, link };
}

/** The employee's claim approved by Finance (to be paid with a month's payroll), or rejected at a step. */
export function claimDecidedText(decision: { approved: true; payMonth: string } | { approved: false; expenseDate: string }, link: string): NotificationInput {
  return decision.approved
    ? { kind: 'reimbursement_decided', title: 'Reimbursement claim approved', body: `To be paid with the ${monthName(decision.payMonth.slice(0, 7))} payroll`, link }
    : { kind: 'reimbursement_decided', title: 'Reimbursement claim rejected', body: `Your claim of ${shownDate(decision.expenseDate)}`, link };
}

/** The employee's claim paid with a month's payroll, once it is marked paid. */
export function claimPaidText(month: string, link: string): NotificationInput {
  return { kind: 'reimbursement_paid', title: 'Reimbursement paid', body: `Paid with the ${monthName(month)} payroll`, link };
}

/** A raise request waits for HR's step (the CEO's for a C-level person). */
export function raiseRequestWaitingText(name: string, link: string): NotificationInput {
  return { kind: 'raise_request_waiting', title: 'A raise request is waiting for you', body: name, link };
}

/** A raise waits for the CEO's decision. */
export function payRaiseWaitingText(name: string, link: string): NotificationInput {
  return { kind: 'pay_raise_waiting', title: 'A raise is waiting for your approval', body: name, link };
}

/** The CEO's decision on a raise, for HR, who prepares it for signing (or changes it). */
export function payRaiseDecidedText(decision: 'approved' | 'rejected' | 'returned', name: string, link: string): NotificationInput {
  const title = decision === 'returned' ? 'Raise returned to HR by the CEO' : `Raise ${decision} by the CEO`;
  return { kind: 'pay_raise_decided', title, body: name, link };
}

/** The employee's payslip, once the month's payroll is marked paid: "Your October 2026 payslip is ready". */
export function payslipText(month: string, paidOn: string | null, link: string): NotificationInput {
  return { kind: 'payslip_issued', title: `Your ${monthName(month)} payslip is ready`, body: paidOn ? `Paid on ${shownDate(paidOn)}` : 'Open it in your payslips', link };
}

/**
 * A home location waits for the decision of the one in charge of its step (owner, 20 October 2026: "then approved by the
 * HR and CEO"): "Mona Adel, asked on 20/10/2026". Never the point, the label or a comment.
 */
export function homeWaitingText(name: string, askedOn: string, link: string): NotificationInput {
  return { kind: 'home_location_waiting', title: 'A home location is waiting for you', body: `${name}, asked on ${shownDate(askedOn)}`, link };
}

/**
 * The employee's home location decided at a step: approved at the first step (by HR, or the CEO for a C-level person's:
 * `firstStep`, as the pages name it), now with the CEO; approved, in force; or rejected (never the comment).
 */
export function homeDecidedText(outcome: 'first_step' | 'approved' | 'rejected', askedOn: string, link: string, firstStep = 'HR'): NotificationInput {
  const request = `Your request of ${shownDate(askedOn)}`;
  if (outcome === 'first_step') return { kind: 'home_location_decided', title: `Home location approved by ${firstStep}`, body: `${request} is with the CEO now`, link };
  return { kind: 'home_location_decided', title: `Home location ${outcome}`, body: request, link };
}

/** "You haven't checked in", from the shift's start every 10 minutes for 2 hours (owner, 20 October 2026). */
export function checkInReminderText(shiftStart: string, link: string): NotificationInput {
  return { kind: 'check_in_reminder', title: 'You haven’t checked in', body: `Your shift started at ${timeOfDayText(shiftStart)}. Check in now.`, link };
}

/** "Still checked in?", once the day's hours stop counting. */
export function checkOutReminderText(checkedInAt: Date | string, link: string): NotificationInput {
  return { kind: 'check_out_reminder', title: 'Still checked in?', body: `You checked in at ${cairoClock(checkedInAt)}. Check out when you leave.`, link };
}

/** The kinds the texts above make, for the tests. */
export const TEXT_KINDS: readonly NotificationKind[] = [
  'leave_waiting',
  'leave_decided',
  'permission_waiting',
  'permission_decided',
  'correction_waiting',
  'correction_decided',
  'reimbursement_waiting',
  'reimbursement_decided',
  'reimbursement_paid',
  'raise_request_waiting',
  'pay_raise_waiting',
  'pay_raise_decided',
  'payslip_issued',
  'home_location_waiting',
  'home_location_decided',
  'check_in_reminder',
  'check_out_reminder',
];
