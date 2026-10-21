import { PAY_CHANGE_LABELS, type KpiScorecardSummary } from '@trendlix/shared';
import type { AttendanceCorrectionView } from '../../../../lib/correction-types';
import { formatDate } from '../../../../lib/format';
import type { HomeLocationView } from '../../../../lib/home-location-types';
import type { PendingRaise, RaiseRequest } from '../../../../lib/raise-types';
import { appItemHref } from '../../../../lib/surface';
import type { LeaveRequestView, PermissionRequestView, ReimbursementClaimView } from '../../../../lib/types';
import { correctionDayText, correctionKindName } from '../../../(app)/attendance/corrections/corrections';
import { formatEgp } from '../../../(app)/employees/[id]/contracts/salary';
import { homeWhatText } from '../../../(app)/home-locations/home-locations';
import { actionButton, waitingLine } from '../../../(app)/kpis/scorecard';
import { daysText, periodText } from '../../../(app)/leave/list';
import { isPermission, mergeRequests, permissionWhenText } from '../../../(app)/leave/permissions';
import { effectiveFromText, reasonText } from '../../../(app)/raise-requests/list';
import { currentAmount } from '../../../(app)/reimbursements/list';
import { wfhDayText } from '../../../(app)/attendance/wfh/wfh';
import type { WfhRequestView } from '../../../../lib/wfh-types';

// The phone pages' To Approve (owner, 20 October 2026: the employee app, "managers and team leads approve from the
// phone"): what waits for the caller, in sections as My Team and Approvals have them: leave and permission, the claims,
// the attendance corrections, the raise requests at HR's step (HR's, or the CEO's for a C-level person), and the raises
// with the CEO. The lists are the API's (each "waiting" read answers for the caller alone); each row opens the item's
// page under To Approve, with the decision form. Pure code, tested; relative imports, as vitest doesn't know "@/". Home
// locations at HR's step or the CEO's (owner, 20 October 2026: "then approved by the HR and CEO"), for those who decide
// them. KPI scorecards (owner, 21 October 2026: "Self, manager, HR, sign-off") waiting for the caller's step on someone
// else's: the manager's scoring and sign-off, HR's calibration. Work from home requests (owner, 21 October 2026:
// "Manager, then HR") at the approver's step or HR's (a C-level person's HR step the CEO's).

export interface WaitingRow {
  key: string;
  href: string;
  /** Who it is for. */
  name: string;
  /** What and when, in a line. */
  line: string;
  /** What the row's badge says; none: Decide. */
  action?: string;
}

export interface WaitingSection {
  key: 'leave' | 'wfh' | 'reimbursement' | 'correction' | 'raise' | 'pay-raise' | 'home' | 'kpi';
  /** Title Case. */
  title: string;
  rows: WaitingRow[];
  /** The section's list couldn't be read: said, in place of its rows. */
  failed: boolean;
}

type List<T> = readonly T[] | null;

/**
 * The sections with something waiting (or whose list couldn't be read: `null`), in the order they are decided most
 * often; a list not read at all (`undefined`: not the caller's to decide) is left out.
 */
export function waitingSections(from: {
  leave?: List<LeaveRequestView>;
  permissions?: List<PermissionRequestView>;
  /** Work from home requests waiting for the caller (21 October 2026). */
  wfh?: List<WfhRequestView>;
  claims?: List<ReimbursementClaimView>;
  corrections?: List<AttendanceCorrectionView>;
  raiseRequests?: List<RaiseRequest>;
  payRaises?: List<PendingRaise>;
  homes?: List<HomeLocationView>;
  /** Other people's scorecards waiting for the caller (not their own: those are on Home and My Requests). */
  kpis?: List<KpiScorecardSummary>;
}): WaitingSection[] {
  const sections: WaitingSection[] = [];
  const add = (key: WaitingSection['key'], title: string, failed: boolean, rows: WaitingRow[]) => {
    if (failed || rows.length) sections.push({ key, title, rows, failed });
  };
  if (from.leave !== undefined || from.permissions !== undefined) {
    const requests = mergeRequests(from.leave ?? [], from.permissions ?? []);
    add(
      'leave',
      'Leave and Permission',
      from.leave === null || from.permissions === null,
      requests.map((r) =>
        isPermission(r)
          ? { key: `permission:${r.id}`, href: appItemHref('approve', 'permission', r.id), name: r.employee.fullNameEn, line: `Permission · ${permissionWhenText(r)}` }
          : { key: `leave:${r.id}`, href: appItemHref('approve', 'leave', r.id), name: r.employee.fullNameEn, line: `${r.type.nameEn} · ${periodText(r)} · ${daysText(r.days)}` },
      ),
    );
  }
  if (from.wfh !== undefined) {
    add(
      'wfh',
      'Work From Home',
      from.wfh === null,
      (from.wfh ?? []).map((r) => ({
        key: `wfh:${r.id}`,
        href: appItemHref('approve', 'wfh', r.id),
        name: r.employee.fullNameEn,
        line: `Work from home · ${wfhDayText(r)}`,
      })),
    );
  }
  if (from.claims !== undefined) {
    add(
      'reimbursement',
      'Reimbursements',
      from.claims === null,
      (from.claims ?? []).map((c) => ({
        key: `claim:${c.id}`,
        href: appItemHref('approve', 'reimbursement', c.id),
        name: c.employee.fullNameEn,
        line: `${c.type.nameEn} · ${formatDate(c.expenseDate)} · ${formatEgp(currentAmount(c))}`,
      })),
    );
  }
  if (from.corrections !== undefined) {
    add(
      'correction',
      'Attendance Corrections',
      from.corrections === null,
      (from.corrections ?? []).map((c) => ({
        key: `correction:${c.id}`,
        href: appItemHref('approve', 'correction', c.id),
        name: c.employee.fullNameEn,
        line: `${correctionDayText(c)} · ${correctionKindName(c.correctionKind)}`,
      })),
    );
  }
  if (from.raiseRequests !== undefined) {
    add(
      'raise',
      'Raise Requests',
      from.raiseRequests === null,
      (from.raiseRequests ?? []).map((r) => ({
        key: `raise:${r.id}`,
        href: appItemHref('approve', 'raise', r.id),
        name: r.employee.fullNameEn,
        line: [reasonText(r) ?? 'Raise request', `effective from ${effectiveFromText(r)}`].join(' · '),
      })),
    );
  }
  if (from.payRaises !== undefined) {
    add(
      'pay-raise',
      'Pay Raises',
      from.payRaises === null,
      (from.payRaises ?? []).map((r) => ({
        key: `pay-raise:${r.id}`,
        href: appItemHref('approve', 'pay-raise', r.id),
        name: r.employee.fullNameEn,
        line: [PAY_CHANGE_LABELS[r.change] ?? r.change, `from ${formatDate(r.startDate)}`, r.grossSalary !== null ? `gross ${formatEgp(r.grossSalary)}` : null].filter(Boolean).join(' · '),
      })),
    );
  }
  if (from.homes !== undefined) {
    add(
      'home',
      'Home Locations',
      from.homes === null,
      (from.homes ?? []).map((h) => ({
        key: `home:${h.id}`,
        href: appItemHref('approve', 'home', h.id),
        name: h.employee.fullNameEn,
        line: `${h.stage === 'ceo' ? 'The CEO’s step' : 'HR’s step'} · ${homeWhatText(h)}`,
      })),
    );
  }
  if (from.kpis !== undefined) {
    add(
      'kpi',
      'KPI Scorecards',
      from.kpis === null,
      (from.kpis ?? []).map((s) => ({
        key: `kpi:${s.id}`,
        href: appItemHref('approve', 'kpi', s.id),
        name: s.employee.fullNameEn,
        // "October 2026 · Score by 06/11/2026"
        line: waitingLine(s),
        action: actionButton(s),
      })),
    );
  }
  return sections;
}

/** How many wait in all, in the sections read. */
export const waitingTotal = (sections: readonly WaitingSection[]) => sections.reduce((n, s) => n + s.rows.length, 0);
