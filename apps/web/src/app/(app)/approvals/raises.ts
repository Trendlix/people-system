import { PAY_CHANGE_LABELS, RAISE_REASON_LABELS, payDifference, type LawRates, type Role } from '@trendlix/shared';
import { formatDate, formatDateTime } from '../../../lib/format';
import type { PendingRaise } from '../../../lib/raise-types';
import { hasRole } from '../../../lib/roles';
import { formatEgp } from '../employees/[id]/contracts/salary';
import { changeText, fromToText } from '../employees/[id]/salary-history/salary-history';
import { figuresNote } from '../raise-requests/list';
import type { FiguresFor } from '../raise-requests/request-forms';
import { shownCode } from '../../../lib/hidden';

// Pay raises waiting for the CEO, on Approvals (owner's decisions, 16 October 2026: "HR, then the CEO"): a raise HR
// entered and sent (an amendment or a new contract, effective the 1st of a month), or a renewal with new pay, which
// counts as a raise. The CEO alone approves it, returns it to HR with a reason, or declines it with a reason; HR follows
// them here until then. Since 19 October 2026 the CEO decides each on Raise Requests too, with the same form
// (decisionFigures). Pure code, tested; relative imports, as vitest doesn't know the @/ paths.

type WithRoles = { roles: readonly Role[] };

/** The changes of pay waiting for the CEO (GET /raises/pending). */
export const PENDING_RAISES = '/raises/pending';

/** HR and the CEO see the pay raises waiting for the CEO. The API checks this again. */
export function followsRaises(user: WithRoles): boolean {
  return hasRole(user, 'hr', 'ceo');
}

/** Only the CEO approves, returns or declines a raise. The API checks this again. */
export function decidesRaises(user: WithRoles): boolean {
  return hasRole(user, 'ceo');
}

/** A pending raise as its card shows it. */
export interface PendingRaiseView {
  /** "Amendment", "New contract", "Renewal". */
  kind: string;
  /** "CON-2026-0001-A1 · version 3"; "Version 3" when the number is hidden (a developer's: 23 October 2026). */
  reference: string;
  /** "From 01/11/2026", or its term; null when its dates are hidden (a developer's). */
  effective: string | null;
  gross: string;
  /** "+EGP 2,500.00 (+25%)"; null without the pay before it. */
  change: string | null;
  allowances: string;
  total: string;
  /** By the hour: the rate from → to, and the minimum a month from → to (27 October 2026). */
  hourly: string | null;
  reason: string | null;
  promotion: string | null;
  sentAt: string | null;
  /** The CEO's question before approving. */
  confirmApprove: string;
}

/** The pay it changes from (the version before) and to, the change, why, the promotion and when HR sent it. */
export function pendingRaiseView(r: PendingRaise): PendingRaiseView {
  const before = r.previous;
  const gross = r.grossSalary ?? 0;
  const grossBefore = before?.grossSalary ?? null;
  const rateBefore = before?.hourlyRate ?? null;
  const promotion = r.raise && [r.raise.newJobTitle?.titleEn, r.raise.newGrade && `grade ${r.raise.newGrade.code}`].filter(Boolean).join(', ');
  const rate =
    r.payBasis === 'hourly' && r.hourlyRate !== null
      ? `${rateBefore !== null && rateBefore !== r.hourlyRate ? `${formatEgp(rateBefore)} → ` : ''}${formatEgp(r.hourlyRate)} an hour; the gross is the monthly estimate`
      : null;
  // the minimum a month by the hour (owner, 27 October 2026: "can i add rate per hour with a minimum monthly payment?"):
  // a new one is new pay, so the CEO sees it change
  const minimum = r.hourlyMinimum ?? null;
  const minimumBefore = before?.payBasis === 'hourly' ? (before.hourlyMinimum ?? null) : null;
  const minimumText =
    r.payBasis !== 'hourly' || (minimum === null && minimumBefore === null)
      ? null
      : minimum === null
        ? `no minimum a month (was ${formatEgp(minimumBefore!)})`
        : `minimum ${minimumBefore !== null && minimumBefore !== minimum ? `${formatEgp(minimumBefore)} → ` : ''}${formatEgp(minimum)} a month`;
  const hourly = [rate, minimumText].filter(Boolean).join(' · ') || null;
  const name = r.employee.fullNameEn;
  return {
    kind: PAY_CHANGE_LABELS[r.change] ?? r.change,
    reference: shownCode(r.number) ? `${r.number} · version ${r.version}` : `Version ${r.version}`,
    effective: !r.startDate ? null : r.endDate && r.change !== 'amendment' ? `${formatDate(r.startDate)} – ${formatDate(r.endDate)}` : `From ${formatDate(r.startDate)}`,
    gross: fromToText(grossBefore, gross),
    change: grossBefore !== null ? changeText(payDifference(grossBefore, gross)) : null,
    allowances: fromToText(before?.allowancesTotal ?? null, r.allowancesTotal ?? 0),
    total: fromToText(before?.totalSalary ?? null, r.totalSalary ?? gross),
    hourly,
    reason: r.raise ? (RAISE_REASON_LABELS[r.raise.reason] ?? r.raise.reason) : null,
    promotion: promotion || null,
    sentAt: r.raise?.sentAt ? formatDateTime(r.raise.sentAt) : null,
    confirmApprove: `Approve ${name}'s new pay, ${formatEgp(gross)} a month${r.startDate ? ` from ${formatDate(r.startDate)}` : ''}? HR then has ${shownCode(r.number) ?? 'it'} signed.`,
  };
}

/**
 * What the CEO's other raise is worked out from (17 October 2026), on Approvals and Raise Requests alike: the pay before
 * it (its gross, rate, hours and allowances), with the raise's own allowances and hours after it, the year's rates and
 * who sees the figures; null when the API sends no pay before it (one from before, or someone who doesn't see salaries).
 */
export function decisionFigures(r: PendingRaise, rates: readonly LawRates[]): FiguresFor | null {
  const before = r.previous;
  if (!before || before.grossSalary === null || !before.allowances) return null;
  return {
    pay: { payBasis: r.payBasis, grossSalary: before.grossSalary, hourlyRate: before.hourlyRate, hoursPerWeek: before.hoursPerWeek ?? r.hoursPerWeek, allowances: before.allowances },
    allowancesAfter: r.allowances,
    hoursAfter: r.hoursPerWeek,
    rates,
    // a developer gets no contract dates (owner, 22 October 2026: "Hide per-person details"): this year's rates then
    year: r.startDate ? Number(r.startDate.slice(0, 4)) : new Date().getFullYear(),
    note: figuresNote(false),
  };
}

/** "1 raise", "3 raises", waiting. */
export const raisesLabel = (n: number) => `${n} ${n === 1 ? 'raise' : 'raises'}`;
