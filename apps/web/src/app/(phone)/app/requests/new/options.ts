import { underLabourLaw } from '@trendlix/shared';
import { APP_PATHS } from '../../../../../lib/surface';
import type { PermissionMonthView } from '../../../../../lib/types';
import { asksPermission } from '../../../../(app)/leave/permissions';

// What the phone pages offer to ask for (owner, 20 October 2026: the employee app, "apply for their requests"), on Home
// and on New Request, as the site offers each: leave under the labour law (not a freelancer or an unpaid intern),
// permission too while Leave Setup gives hours a month, a reimbursement for anyone with a profile, a correction during
// an employment, and a raise when they may ask for one now (for themself, or a manager for a direct report). The forms
// check again, and the API checks everything. Pure code, tested; relative imports, as vitest doesn't know "@/". A home
// location for anyone with a profile (owner, 20 October 2026: "allow other users to request to add their home locations
// when working from home"; everyone may ask, for occasional days at home too). Working from home (owner, 21 October
// 2026: "think about how should we handle the working from home in out erp"): a day at home for someone expected at the
// office, offered when their allowance says so (an Office or Hybrid arrangement, asking not turned off in Leave Setup);
// Work from home, Outdoor and Indoor and outdoor never see it.

export type AskKind = 'leave' | 'permission' | 'wfh' | 'reimbursement' | 'correction' | 'raise' | 'home';

export interface AskOption {
  key: AskKind;
  href: string;
  label: string;
  /** What it is for, in a line. */
  text: string;
}

const OPTIONS: Record<AskKind, AskOption> = {
  leave: { key: 'leave', href: APP_PATHS.newLeave, label: 'Leave', text: 'Days off: annual, sick, casual and the other types HR set up.' },
  permission: { key: 'permission', href: APP_PATHS.newPermission, label: 'Permission', text: 'A few hours away from a working day, to come late or leave early.' },
  wfh: { key: 'wfh', href: APP_PATHS.newWfh, label: 'Work from home', text: 'A working day from home instead of the office, asked a day before.' },
  reimbursement: { key: 'reimbursement', href: APP_PATHS.newReimbursement, label: 'Reimbursement', text: 'An expense you paid for the company, with a photo of the receipt.' },
  correction: { key: 'correction', href: APP_PATHS.newCorrection, label: 'Correction', text: 'A day of your attendance that isn’t right: a check-in or check-out forgotten.' },
  raise: { key: 'raise', href: APP_PATHS.newRaise, label: 'Raise', text: 'A raise for yourself, or for a direct report, with a reason.' },
  home: { key: 'home', href: APP_PATHS.newHome, label: 'Home location', text: 'Your home, for the days you work from there: check-ins there show as Home.' },
};

/**
 * Whether working from home is offered (owner, 21 October 2026): their month as read says their arrangement needs it,
 * nothing refuses them, and Leave Setup gives days a month; not read (null), not offered.
 */
export const offersWfh = (allowance: { offered: boolean; refusal: string | null; daysPerMonth: number } | null | undefined): boolean =>
  !!allowance && allowance.offered && !allowance.refusal && allowance.daysPerMonth > 0;

/**
 * Whether a raise is offered: to someone who sees raise requests (owner, 20 October 2026: "raises not to be visible to
 * employee level for now", then "Hide from managers too"; seesRaiseRequests), when they may ask for themself now (the
 * API's canRequest), or to a manager, for a direct report (the form's picker offers whom they may).
 */
export const offersRaise = (p: { seesRaises: boolean; canRequest: boolean; manager: boolean }): boolean => p.seesRaises && (p.canRequest || p.manager);

export function askOptions(p: {
  /** Their current employment; none: only a reimbursement (and a raise, when the API says they may ask). */
  employment: { employmentType: string } | null | undefined;
  /** This month's permission hours as read; null when they couldn't be. */
  permissionMonth: Pick<PermissionMonthView, 'hoursPerMonth'> | null;
  /** Whether a raise may be asked for now: for themself (the API's canRequest), or a manager for a direct report. */
  asksRaise: boolean;
  /** Whether working from home may be asked for (offersWfh); left out: not offered. */
  asksWfh?: boolean;
}): AskOption[] {
  const e = p.employment;
  const keys: AskKind[] = [];
  if (e && underLabourLaw(e.employmentType)) keys.push('leave');
  if (asksPermission(e, p.permissionMonth)) keys.push('permission');
  if (e && p.asksWfh) keys.push('wfh');
  keys.push('reimbursement');
  if (e) keys.push('correction');
  if (p.asksRaise) keys.push('raise');
  keys.push('home');
  return keys.map((k) => OPTIONS[k]);
}
