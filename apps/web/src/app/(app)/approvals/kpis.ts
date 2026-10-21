import { KPI_ACTION_LABELS, KPI_STATUS_LABELS, kpiMonthName, type KpiScorecardSummary, type Role } from '@trendlix/shared';
import { formatDate } from '../../../lib/format';
import { KPI_PATHS } from '../../../lib/kpi-paths';
import { hasRole } from '../../../lib/roles';

// The KPI scorecards on Approvals (owner, 21 October 2026: "The KPI items waiting for someone are counted in the sidebar
// and on Approvals"): those waiting for the user to score, calibrate or sign as the manager, never their own (to rate
// themself or sign, on My KPIs), each opening the scorecard. For HR, the CEO, Admin and the Super Admin, who see
// Approvals; a manager has theirs on Team KPIs. Pure code, tested; relative imports, as vitest doesn't know the @/ paths.

/** Who has the KPI Scorecards section: those who see Approvals (HR, the CEO, Admin; a Super Admin counts as an Admin). */
export const seesKpiApprovals = (user: { roles: readonly Role[] }): boolean => hasRole(user, 'hr', 'ceo', 'admin');

/** A scorecard waiting for the user, as its row on Approvals says it. */
export interface KpiApprovalRow {
  id: string;
  person: string;
  employeeCode: string;
  jobTitle: string | null;
  /** "September 2026". */
  month: string;
  /** The step it is at: "With the manager", "With HR", "Sign-off". */
  step: string;
  /** DD/MM/YYYY; null once final. */
  deadline: string | null;
  /** "Score", "Calibrate", "Sign". */
  action: string;
  href: string;
  confidential: boolean;
}

/**
 * The rows of what waits for the user (GET /kpis/scorecards/waiting, the nearest deadline first, as it came): those with
 * something for them to do, less their own scorecard.
 */
export function kpiApprovalRows(waiting: readonly KpiScorecardSummary[], user: { employeeId?: string | null }): KpiApprovalRow[] {
  return waiting
    .filter((s) => s.action !== null && !(user.employeeId && s.employee.id === user.employeeId))
    .map((s) => ({
      id: s.id,
      person: s.employee.fullNameEn,
      employeeCode: s.employee.employeeCode,
      jobTitle: s.jobTitle,
      month: kpiMonthName(s.month),
      step: KPI_STATUS_LABELS[s.status] ?? s.status,
      deadline: s.deadline ? formatDate(s.deadline) : null,
      action: (s.action && KPI_ACTION_LABELS[s.action]) ?? 'Open',
      href: KPI_PATHS.scorecard(s.id),
      confidential: s.confidential,
    }));
}

/** "1 KPI scorecard", "3 KPI scorecards". */
export const kpiScorecardsLabel = (n: number): string => `${n} KPI ${n === 1 ? 'scorecard' : 'scorecards'}`;
