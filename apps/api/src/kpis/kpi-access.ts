import { decidesConfidentialStage, kpiPast, kpiScored, kpiShownToEmployee, type KpiAction, type KpiDeadlines } from '@trendlix/shared';
import { actsAs } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import type { ConfidentialView } from '../employees/confidential.service.js';

// Who sees a KPI scorecard and who takes each of its steps (owner, 21 October 2026: "Self, manager, HR, sign-off"; the
// brief: "The manager is the approver in charge … For C-level people the CEO scores, and HR never sees them"). Pure code;
// the rules themselves are packages/shared kpis.ts.
// - The employee: their own, always; they rate themself, and see the manager's scoring and HR's calibration from the
//   sign-off on, when they sign "I've read it".
// - The scorer kept on it when it opened: the manager in charge (direct manager, team lead, department head), HR when
//   nobody is in charge, the CEO for a C-level person, a Super Admin for the CEO's own. They see the self-rating once
//   it is sent, score (saving at any time from the opening, sending once the self-rating is sent or its day has gone
//   by), and sign as the manager.
// - HR sees every scorecard but a C-level person's and calibrates after a manager's scoring; the CEO and a Super Admin
//   see every one (C-level too), and HR's step of a C-level person's is the CEO's (there is none: the CEO scores it).
// Nobody takes a step of their own scorecard but the employee's.
// A practice scorecard (owner, 22 October 2026: "Practice scorecards"; packages/shared kpi-practice.ts): HR (never a
// C-level person's) and a Super Admin see it; the people in it, signed in themselves, never do. A Super Admin viewing as
// someone sees it as that person would see a real one, and with Act as them on takes their step as them; in one's own
// session nobody takes its steps as themself: its starter or a Super Admin stands in for each person (kpiStandsIn).

/** The caller: their session, their own employee profile (none: null), and the C-level people. */
export interface KpiCaller {
  user: SessionUser;
  employeeId: string | null;
  confidential: ConfidentialView;
}

/** What the access is worked out from: its scorer (KPI_SCORERS) and status (KPI_STATUSES) as kept. */
export interface KpiParties {
  employeeId: string;
  scorer: string;
  managerId: string | null;
  status: string;
  selfSubmittedAt?: Date | string | null;
  employeeSignedAt?: Date | string | null;
  managerSignedAt?: Date | string | null;
  /** A practice scorecard (22 October 2026); left out: a real one. */
  practice?: boolean;
}

export const isOwnScorecard = (card: Pick<KpiParties, 'employeeId'>, caller: KpiCaller) => caller.employeeId !== null && caller.employeeId === card.employeeId;

const isConfidentialCard = (card: Pick<KpiParties, 'employeeId'>, caller: KpiCaller) => caller.confidential.all.has(card.employeeId);

/** HR, the CEO and a Super Admin see every scorecard (HR not a C-level person's). */
export const seesEveryScorecard = (user: SessionUser) => actsAs(user.roles, ['hr']) || user.roles.includes('ceo') || user.roles.includes('super_admin');

/** Whether the caller scores the scorecard (and signs it as the manager): never their own. */
export function isScorer(card: Pick<KpiParties, 'employeeId' | 'scorer' | 'managerId'>, caller: KpiCaller): boolean {
  if (isOwnScorecard(card, caller)) return false;
  switch (card.scorer) {
    case 'manager':
      return caller.employeeId !== null && card.managerId === caller.employeeId;
    case 'hr':
      return actsAs(caller.user.roles, ['hr']) && !isConfidentialCard(card, caller);
    case 'ceo':
      return caller.user.roles.includes('ceo');
    case 'super_admin':
      return caller.user.roles.includes('super_admin');
    default:
      return false;
  }
}

/** Who sees a scorecard: its employee, its scorer, HR (not a C-level person's), the CEO and a Super Admin. */
export function seesScorecard(card: KpiParties, caller: KpiCaller): boolean {
  if (isOwnScorecard(card, caller) || isScorer(card, caller)) return true;
  return seesEveryScorecard(caller.user) && !caller.confidential.hidden.has(card.employeeId);
}

/**
 * Who sees a practice scorecard: a Super Admin, HR (not a C-level person's); and, while a Super Admin views as someone,
 * whoever would see it were it real (the employee, their scorer), so they see the screens those people will see.
 */
export function seesPractice(card: KpiParties, caller: KpiCaller): boolean {
  if (caller.user.roles.includes('super_admin')) return true;
  if (actsAs(caller.user.roles, ['hr']) && !caller.confidential.hidden.has(card.employeeId)) return true;
  return !!caller.user.viewAs && seesScorecard(card, caller);
}

/** Who sees a scorecard, a real one or a practice one. */
export const sees = (card: KpiParties, caller: KpiCaller): boolean => (card.practice ? seesPractice(card, caller) : seesScorecard(card, caller));

/**
 * Whether the caller's own steps count on it: always on a real one; on a practice one only while a Super Admin views as
 * someone (as that person). In one's own session a practice scorecard's steps are stood in for (kpiStandsIn).
 */
export const takesOwnSteps = (card: Pick<KpiParties, 'practice'>, caller: KpiCaller): boolean => !card.practice || !!caller.user.viewAs;

/** Whether the caller takes HR's calibration of it now: HR (a C-level person's, the CEO or HR with Super Admin), never their own. */
export function calibrates(card: KpiParties, caller: KpiCaller): boolean {
  if (card.status !== 'hr' || isOwnScorecard(card, caller)) return false;
  return isConfidentialCard(card, caller) ? decidesConfidentialStage(caller.user, ['hr']) : actsAs(caller.user.roles, ['hr']);
}

/** What the caller may do on it now. */
export function kpiCan(card: KpiParties, caller: KpiCaller) {
  const own = isOwnScorecard(card, caller);
  const scorer = isScorer(card, caller);
  return {
    selfRate: own && card.status === 'self_rating',
    score: scorer && (card.status === 'self_rating' || card.status === 'manager'),
    calibrate: calibrates(card, caller),
    signAsEmployee: own && card.status === 'sign_off' && !card.employeeSignedAt,
    signAsManager: scorer && card.status === 'sign_off' && !card.managerSignedAt,
  };
}

/**
 * The step waiting for the caller now: their self-rating or their signature; the scoring (once the self-rating is sent,
 * or its day has gone by on `today`); HR's calibration; the manager's signature. Null: nothing waits for them.
 */
export function kpiActionFor(card: KpiParties, caller: KpiCaller, deadlines: KpiDeadlines, today: string): KpiAction | null {
  const can = kpiCan(card, caller);
  if (can.selfRate) return 'self_rate';
  if (can.signAsEmployee || can.signAsManager) return 'sign';
  if (can.calibrate) return 'calibrate';
  if (can.score && (card.status === 'manager' || kpiPast(deadlines.selfRating, today))) return 'score';
  return null;
}

/** What of the scorecard the caller sees: the self-rating, the manager's scoring and HR's calibration. */
export function kpiShown(card: KpiParties, caller: KpiCaller): { self: boolean; manager: boolean } {
  const own = isOwnScorecard(card, caller);
  if (own) return { self: true, manager: kpiShownToEmployee(card.status) };
  // the self-rating once sent; the scoring for its scorer always (their own picks), for the others once it is sent
  const selfSent = !!card.selfSubmittedAt;
  if (isScorer(card, caller)) return { self: selfSent, manager: true };
  return { self: selfSent, manager: kpiScored(card.status) };
}
