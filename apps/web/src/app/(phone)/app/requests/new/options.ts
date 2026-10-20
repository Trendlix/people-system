import { underLabourLaw } from '@trendlix/shared';
import { APP_PATHS } from '../../../../../lib/surface';
import type { PermissionMonthView } from '../../../../../lib/types';
import { asksPermission } from '../../../../(app)/leave/permissions';

// What the phone pages offer to ask for (owner, 20 October 2026: the employee app, "apply for their requests"), on Home
// and on New Request, as the site offers each: leave under the labour law (not a freelancer or an unpaid intern),
// permission too while Leave Setup gives hours a month, a reimbursement for anyone with a profile, a correction during
// an employment, and a raise when they may ask for one now (for themself, or a manager for a direct report). The forms
// check again, and the API checks everything. Pure code, tested; relative imports, as vitest doesn't know "@/".

export type AskKind = 'leave' | 'permission' | 'reimbursement' | 'correction' | 'raise';

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
  reimbursement: { key: 'reimbursement', href: APP_PATHS.newReimbursement, label: 'Reimbursement', text: 'An expense you paid for the company, with a photo of the receipt.' },
  correction: { key: 'correction', href: APP_PATHS.newCorrection, label: 'Correction', text: 'A day of your attendance that isn’t right: a check-in or check-out forgotten.' },
  raise: { key: 'raise', href: APP_PATHS.newRaise, label: 'Raise', text: 'A raise for yourself, or for a direct report, with a reason.' },
};

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
}): AskOption[] {
  const e = p.employment;
  const keys: AskKind[] = [];
  if (e && underLabourLaw(e.employmentType)) keys.push('leave');
  if (asksPermission(e, p.permissionMonth)) keys.push('permission');
  keys.push('reimbursement');
  if (e) keys.push('correction');
  if (p.asksRaise) keys.push('raise');
  return keys.map((k) => OPTIONS[k]);
}
