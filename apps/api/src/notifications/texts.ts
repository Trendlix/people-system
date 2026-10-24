import { cairoClock, kpiMonthName, kpiMonthOnly, timeOfDayText, type KpiReminder, type NotificationKind } from '@trendlix/shared';
import { shownDate } from '../common/date-only.js';
import { monthName } from '../payroll/months.js';
import type { NotificationInput } from './notifications.service.js';

// What each notification says (owner, 20 October 2026: "Push notifications: yes (decisions, things waiting for someone,
// a check-in reminder)"; apps/mobile/README.md, Phase 4). Short and general, as a locked phone may show them: who and
// when, never a salary, an amount, a reason or a comment. Dates DD/MM/YYYY, times on the 12-hour clock. Pure, tested.

/**
 * The kinds of request decided as leave is (the direct manager or the person in charge, then HR), working from home
 * among them (owner, 21 October 2026: "Manager, then HR").
 */
export type LeaveLikeKind = 'leave' | 'permission' | 'correction' | 'wfh' | 'od';

const NAMES: Record<LeaveLikeKind | 'reimbursement', { waiting: string; noun: string }> = {
  leave: { waiting: 'A leave request is waiting for you', noun: 'Leave request' },
  permission: { waiting: 'A permission request is waiting for you', noun: 'Permission request' },
  correction: { waiting: 'An attendance correction is waiting for you', noun: 'Attendance correction' },
  wfh: { waiting: 'A work from home request is waiting for you', noun: 'Work from home request' },
  // official duty (owner, 23 October 2026: "Manager, then HR")
  od: { waiting: 'An official duty request is waiting for you', noun: 'Official duty request' },
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

const CANCELLED_BY_HR: Record<'leave' | 'permission' | 'wfh' | 'od', string> = {
  leave: 'Leave cancelled by HR',
  permission: 'Permission cancelled by HR',
  wfh: 'Work from home day cancelled by HR',
  od: 'Official duty cancelled by HR',
};

/** HR cancelled the employee's approved leave, permission or work from home day. */
export function cancelledByHrText(kind: 'leave' | 'permission' | 'wfh' | 'od', when: string, link: string): NotificationInput {
  return { kind: `${kind}_decided`, title: CANCELLED_BY_HR[kind], body: when, link };
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

/** What each type of requested check-in location is called in a notice (24 October 2026: "Home Location - Remote Site - Client Location"). */
const PLACE_NOUNS: Record<string, { a: string; noun: string }> = {
  home: { a: 'A home location', noun: 'Home location' },
  remote_site: { a: 'A remote site', noun: 'Remote site' },
  client: { a: 'A client location', noun: 'Client location' },
};
const placeNoun = (type: string | null | undefined) => PLACE_NOUNS[type ?? 'home'] ?? PLACE_NOUNS.home;

/**
 * A home location waits for the decision of the one in charge of its step (owner, 20 October 2026: "then approved by the
 * HR and CEO"): "Mona Adel, asked on 20/10/2026". Never the point, the label or a comment. A remote site or a client
 * location (24 October 2026) by its type's name.
 */
export function homeWaitingText(name: string, askedOn: string, link: string, type: string = 'home'): NotificationInput {
  return { kind: 'home_location_waiting', title: `${placeNoun(type).a} is waiting for you`, body: `${name}, asked on ${shownDate(askedOn)}`, link };
}

/**
 * The employee's home location decided at a step: approved at the first step (by HR, or the CEO for a C-level person's:
 * `firstStep`, as the pages name it), now with the CEO; approved, in force; or rejected (never the comment). A remote
 * site or a client location (24 October 2026) by its type's name.
 */
export function homeDecidedText(outcome: 'first_step' | 'approved' | 'rejected', askedOn: string, link: string, firstStep = 'HR', type: string = 'home'): NotificationInput {
  const request = `Your request of ${shownDate(askedOn)}`;
  const noun = placeNoun(type).noun;
  if (outcome === 'first_step') return { kind: 'home_location_decided', title: `${noun} approved by ${firstStep}`, body: `${request} is with the CEO now`, link };
  return { kind: 'home_location_decided', title: `${noun} ${outcome}`, body: request, link };
}

/**
 * A check-in location's end coming (owner, 24 October 2026: "allow the HR to add an end date"; told 7 days before an end
 * that is a date): the employee's own ("Your remote site ends on 31/10/2026"), or HR's of someone's or of a client
 * location ("Remote site of Mona Adel ends on 31/10/2026", "Client location Acme ends on 31/10/2026"). Never the point.
 */
export function checkInLocationEndingText(type: string, endsOn: string, link: string, of: { person?: string; place?: string } = {}): NotificationInput {
  const noun = placeNoun(type).noun;
  const title = of.place ? `${noun} ${of.place} ends soon` : of.person ? `${noun} of ${of.person} ends soon` : `Your ${noun.toLowerCase()} ends soon`;
  return { kind: 'check_in_location_ending', title, body: `Its last day is ${shownDate(endsOn)}. Ask HR to extend it if it is still needed.`, link };
}

/** "You haven't checked in", from the shift's start every 10 minutes for 2 hours (owner, 20 October 2026). */
export function checkInReminderText(shiftStart: string, link: string): NotificationInput {
  return { kind: 'check_in_reminder', title: 'You haven’t checked in', body: `Your shift started at ${timeOfDayText(shiftStart)}. Check in now.`, link };
}

/** "Still checked in?", once the day's hours stop counting. */
export function checkOutReminderText(checkedInAt: Date | string, link: string): NotificationInput {
  return { kind: 'check_out_reminder', title: 'Still checked in?', body: `You checked in at ${cairoClock(checkedInAt)}. Check out when you leave.`, link };
}

// ---------- KPIs (owner, 21 October 2026: "Self, manager, HR, sign-off") ----------
// No score in them (the brief: "The texts are short: no scores in the push, just "Your October KPI is ready to sign"").

/** The employee's scorecard opened for their self-rating: "Your October KPI is open", "Rate yourself by 03/11/2026". */
export function kpiOpenText(month: string, deadline: string, link: string): NotificationInput {
  return { kind: 'kpi_self_rating', title: `Your ${kpiMonthOnly(month)} KPI is open`, body: `Rate yourself by ${shownDate(deadline)}`, link };
}

/** A scorecard waiting for its scoring or HR's calibration: "A KPI scorecard is waiting for you", "Mona Adel, October 2026". */
export function kpiWaitingText(name: string, month: string, link: string): NotificationInput {
  return { kind: 'kpi_waiting', title: 'A KPI scorecard is waiting for you', body: `${name}, ${kpiMonthName(month)}`, link };
}

/** The employee's scorecard ready to sign: "Your October KPI is ready to sign", "Sign by 10/11/2026". */
export function kpiReadyToSignText(month: string, deadline: string, link: string): NotificationInput {
  return { kind: 'kpi_ready_to_sign', title: `Your ${kpiMonthOnly(month)} KPI is ready to sign`, body: `Sign by ${shownDate(deadline)}`, link };
}

/** The manager's side of the sign-off: "A KPI scorecard is ready for you to sign", "Mona Adel, October 2026". */
export function kpiManagerSignText(name: string, month: string, link: string): NotificationInput {
  return { kind: 'kpi_waiting', title: 'A KPI scorecard is ready for you to sign', body: `${name}, ${kpiMonthName(month)}`, link };
}

/**
 * The reminder the day before a step's deadline (the brief: "one reminder the day before each deadline"), one a person:
 * the employee's own ("Your October KPI: rate yourself by tomorrow"), or the scorecards waiting for them ("3 KPI
 * scorecards to score by tomorrow").
 */
export function kpiReminderText(
  step: KpiReminder,
  who: { own: true; month: string } | { own: false; count: number },
  deadline: string,
  link: string,
): NotificationInput {
  const due = `Due ${shownDate(deadline)}`;
  if (who.own) {
    const month = kpiMonthOnly(who.month);
    return step === 'self_rating'
      ? { kind: 'kpi_self_rating', title: `Your ${month} KPI: rate yourself by tomorrow`, body: due, link }
      : { kind: 'kpi_ready_to_sign', title: `Your ${month} KPI: sign it by tomorrow`, body: due, link };
  }
  const what = step === 'hr' ? 'calibrate' : step === 'sign_off' ? 'sign' : 'score';
  const n = who.count;
  return { kind: 'kpi_waiting', title: `${n === 1 ? 'A KPI scorecard' : `${n} KPI scorecards`} to ${what} by tomorrow`, body: due, link };
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
  'kpi_self_rating',
  'kpi_waiting',
  'kpi_ready_to_sign',
  'wfh_waiting',
  'wfh_decided',
  'od_waiting',
  'od_decided',
];

// ---------- custody (Assets, step 3, 21 October 2026) ----------

const items = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`;

/** The employee received assets on a custody record (the brief: "You received 3 items: CUS-0042"). */
export function custodyHandoverText(count: number, code: string, dueDate: string | null, link: string): NotificationInput {
  return { kind: 'custody_handover', title: `You received ${items(count)}: ${code}`, body: dueDate ? `To return by ${shownDate(dueDate)}` : 'A long-term assignment', link };
}

/** Items of the employee's custody received back; `left`: how many are still with them. */
export function custodyReturnText(count: number, code: string, left: number, link: string): NotificationInput {
  return { kind: 'custody_return', title: `${items(count)} received back: ${code}`, body: left ? `${items(left)} still with you` : 'All items are back', link };
}

/** A shoot's return is overdue: to the employee (`name` null), and to the custodians with their name. */
export function custodyOverdueText(code: string, dueDate: string, name: string | null, link: string): NotificationInput {
  return { kind: 'custody_overdue', title: `Return overdue: ${code}`, body: name ? `${name}, due ${shownDate(dueDate)}` : `It was due ${shownDate(dueDate)}`, link };
}

/** A record's signed copy still not attached 3 days after the handover, to the custodians. */
export function custodyUnsignedText(code: string, name: string, outOn: string, link: string): NotificationInput {
  return { kind: 'custody_unsigned', title: `Signed copy not attached: ${code}`, body: `${name}, handed over ${shownDate(outOn)}`, link };
}
