import { permissionClock } from '@trendlix/shared';
import type { AnnualLeaveBalance, LeaveBalances, LeaveTypeBalance, LeaveTypeView, PermissionMonthView } from '../../../lib/types';
import { daysNumber } from '../leave/list';

// The figures at the top of My Requests and its Other leave cards (the owner's design, Figma "PeopleTrendlix", 30
// October 2026): the annual leave's days available with the share of the year's days still there, a ring and a bar;
// what is left of each other type, large, with what it is of; and this month's permission hours left. From what the page
// already reads (GET /me/leave/balances, /leave/types, /me/permissions/allowance). Pure code, tested; relative imports.

/**
 * The share of the year's annual leave still available, 0 to 1: the days available out of the entitlement with what was
 * carried in and HR's adjustments (none to have: 0).
 */
export function annualShareLeft(a: Pick<AnnualLeaveBalance, 'entitlement' | 'carriedIn' | 'adjustments' | 'available'>): number {
  const total = a.entitlement + a.carriedIn + a.adjustments;
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(1, a.available / total));
}

/** "90%". */
export const percentText = (share: number) => `${Math.round(share * 100)}%`;

/**
 * The other types the cards show, as the balance card listed them: not the annual leave itself (the figure above); a
 * type off for new requests only once used.
 */
export function otherLeaveTypes(balances: Pick<LeaveBalances, 'types'>, types?: readonly LeaveTypeView[] | null): LeaveTypeBalance[] {
  return balances.types.filter((t) => {
    const type = types?.find((x) => x.id === t.typeId);
    return type?.balance !== 'annual' && (type?.active !== false || t.used > 0);
  });
}

const timesWord = (n: number) => (n === 1 ? 'time' : 'times');

/**
 * An other type's card figure, large, and what it is of: the days left of its own a year ("6", "of 7 days left this
 * year"), the times left in service for one taken so many times ("2", "of 3 times left in service"), or for one without
 * a limit the days used this year ("0", "days used this year"). The same as typeLeftText says in a line.
 */
export function otherLeaveFigure(
  b: Pick<LeaveTypeBalance, 'left' | 'used' | 'timesInService' | 'daysPerYear'>,
  type?: Pick<LeaveTypeView, 'daysPerYear' | 'maxTimesInService'> | null,
): { value: string; note: string } {
  if (b.left !== null) {
    // the year's own number, a share in the year someone joins or leaves (26 October 2026)
    const yearly = b.daysPerYear !== undefined ? b.daysPerYear : (type?.daysPerYear ?? null);
    return {
      value: daysNumber(b.left),
      note: yearly !== null ? `of ${daysNumber(yearly)} ${yearly === 1 ? 'day' : 'days'} left this year` : `${b.left === 1 ? 'day' : 'days'} left this year`,
    };
  }
  if (type?.maxTimesInService != null) {
    const max = type.maxTimesInService;
    const left = Math.max(0, max - b.timesInService);
    return {
      value: String(left),
      note: `of ${max} ${timesWord(max)} left in service`,
    };
  }
  return {
    value: daysNumber(b.used),
    note: `${b.used === 1 ? 'day' : 'days'} used this year`,
  };
}

/**
 * The permission figure: this month's hours left as a clock ("3:30") and what of ("of 4:00 hours this month"); off when
 * Leave Setup gives no hours.
 */
export function permissionFigure(m: Pick<PermissionMonthView, 'hoursPerMonth' | 'left'>): { value: string; note: string; off: boolean } {
  if (!(m.hoursPerMonth > 0)) return { value: 'Off', note: 'No permission hours a month', off: true };
  return {
    value: permissionClock(m.left),
    note: `of ${permissionClock(m.hoursPerMonth)} hours this month`,
    off: false,
  };
}
