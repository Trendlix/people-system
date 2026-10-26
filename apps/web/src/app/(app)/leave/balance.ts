import { isLeaveDays, type Role } from '@trendlix/shared';
import { formatDate } from '../../../lib/format';
import { hasRole } from '../../../lib/roles';
import type { AnnualLeaveBalance, LeaveTypeBalance, LeaveTypeView } from '../../../lib/types';
import { daysNumber, daysText } from './list';

// The leave balances (owner, 18 October 2026: "can you apply the leaves according to the law?"): the annual balance of a
// calendar year (Art. 124: by service, age and disability, pro rata in a first year and usable once six months were
// served), with what was carried in by the Year Closing and HR's adjustments, what is taken, booked and being decided,
// and what is available; and what is left of the other types (casual leave's 7 a year, a child's birth 3 times in
// service …). Shown on My Requests, the employee's dashboard and the Employment tab of a profile (HR, the CEO, Finance,
// the employee and their manager), where HR adjusts a balance with a reason. Pure code, tested; relative imports, as
// vitest doesn't know the @/ paths.

type WithRoles = { roles: readonly Role[] };

/** HR, the CEO and Finance see anyone's balance on their profile; the employee their own, a manager their reports'. */
export function seesLeaveBalance(user: WithRoles & { employeeId?: string | null }, profile: { id: string; isSelf?: boolean }, managesThem: boolean): boolean {
  return hasRole(user, 'hr', 'ceo', 'finance') || profile.isSelf === true || profile.id === user.employeeId || managesThem;
}

/** One figure of the annual balance, as its card shows it. */
export interface BalanceFigure {
  key: keyof AnnualLeaveBalance;
  label: string;
  value: string;
  note: string | null;
}

/** "+2", "−1.5", "0": an adjustment or a carry, with its sign. */
export const signedDays = (n: number) => (n > 0 ? `+${daysNumber(n)}` : n < 0 ? `−${daysNumber(-n)}` : '0');

/**
 * The annual balance's figures, in the order they add up: the year's entitlement (from when it may be used, in a first
 * year), what was carried in, HR's adjustments, then the days taken, booked and waiting, and what is available.
 */
export function annualFigures(a: AnnualLeaveBalance, year: number): BalanceFigure[] {
  const jan1 = `${year}-01-01`;
  return [
    { key: 'entitlement', label: `Entitlement ${year}`, value: daysNumber(a.entitlement), note: a.usableFrom > jan1 ? `Usable from ${formatDate(a.usableFrom)}` : null },
    { key: 'carriedIn', label: 'Carried in', value: signedDays(a.carriedIn), note: a.carriedIn ? `From before ${year}` : null },
    { key: 'adjustments', label: 'Adjusted by HR', value: signedDays(a.adjustments), note: null },
    { key: 'taken', label: 'Taken', value: daysNumber(a.taken), note: null },
    { key: 'booked', label: 'Booked', value: daysNumber(a.booked), note: a.booked ? 'Approved, to come' : null },
    { key: 'pending', label: 'Waiting', value: daysNumber(a.pending), note: a.pending ? 'Being decided' : null },
    { key: 'available', label: 'Available', value: daysNumber(a.available), note: null },
  ];
}

/** The big figure of the card: "18.5 days available", and how it comes about in a line. */
export function availableText(a: AnnualLeaveBalance): string {
  return `${daysText(a.available)} available`;
}

const timesText = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

/**
 * What is left of another type, as the list under the annual balance says it: the days left of its own a year ("5 days
 * left of 7"), the times left in service for one taken so many times ("2 of 3 times left"), or the days used this year
 * for one without a limit ("3 days used"; "None used").
 */
export function typeLeftText(b: LeaveTypeBalance, type?: Pick<LeaveTypeView, 'daysPerYear' | 'maxTimesInService' | 'balance'> | null): string {
  if (b.left !== null) {
    // the year's own number, a share in the year someone joins or leaves (26 October 2026)
    const yearly = b.daysPerYear !== undefined ? b.daysPerYear : (type?.daysPerYear ?? null);
    return yearly !== null ? `${daysText(b.left)} left of ${daysNumber(yearly)} this year` : `${daysText(b.left)} left this year`;
  }
  if (type?.maxTimesInService != null) {
    const left = Math.max(0, type.maxTimesInService - b.timesInService);
    return left === 0 ? `Taken ${timesText(type.maxTimesInService)}: none left in service` : `${left} of ${type.maxTimesInService} ${type.maxTimesInService === 1 ? 'time' : 'times'} left in service`;
  }
  return b.used > 0 ? `${daysText(b.used)} used this year` : 'None used this year';
}

// ---------- HR's adjustment ----------

/** What POST /employees/:id/leave/adjustments takes. */
export interface AdjustmentBody {
  year: number;
  days: number;
  reason: string;
}

/** The most an adjustment may change a balance by, either way. */
export const ADJUSTMENT_MAX = 366;
export const ADJUSTMENT_REASON_MAX = 500;

const latin = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/٫/g, '.');

/** Days as typed for an adjustment: "+2", "-1.5", "2", "−3"; NaN when not whole or half days; null when empty. */
export function adjustmentDays(raw: string): number | null {
  const s = latin(raw).trim().replace(/^[−–]/, '-').replace(/^\+/, '');
  if (s === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  const n = Number(s);
  return isLeaveDays(n) ? n + 0 : NaN;
}

/**
 * HR's adjustment as the API takes it, and what is wrong with it: more days (+2) or fewer (−1.5), in whole or half days,
 * not 0 and at most ADJUSTMENT_MAX either way; and the reason, which the log keeps.
 */
export function adjustmentBody(fd: FormData, year: number): { body: AdjustmentBody | null; errors: string[] } {
  const errors: string[] = [];
  const days = adjustmentDays(String(fd.get('days') ?? ''));
  if (days === null || Number.isNaN(days) || days === 0 || Math.abs(days) > ADJUSTMENT_MAX) {
    errors.push(`Enter the days to add (e.g. 2) or take off (e.g. -1.5), in whole or half days, up to ${ADJUSTMENT_MAX}.`);
  }
  const reason = String(fd.get('reason') ?? '').trim();
  if (!reason) errors.push('Write the reason for the adjustment: it is kept with it.');
  else if (reason.length > ADJUSTMENT_REASON_MAX) errors.push(`Keep the reason to ${ADJUSTMENT_REASON_MAX} characters; it has ${reason.length}.`);
  return errors.length ? { body: null, errors } : { body: { year, days: days!, reason }, errors };
}

/** The year a balance is shown for: the address's (?leaveYear=2027) when it is a year near today's, else this year. */
export function balanceYear(asked: string | string[] | undefined, today: string): number {
  const typed = Array.isArray(asked) ? asked[0] : asked;
  const now = Number(today.slice(0, 4));
  const year = /^\d{4}$/.test(typed ?? '') ? Number(typed) : NaN;
  return year >= 2000 && year <= now + 1 ? year : now;
}
