import { PAY_CHANGE_LABELS } from '@trendlix/shared';
import type { AttendanceCorrectionView } from '../../../../lib/correction-types';
import { formatDate } from '../../../../lib/format';
import type { PendingRaise, RaiseRequest } from '../../../../lib/raise-types';
import { appItemHref } from '../../../../lib/surface';
import type { LeaveRequestView, PermissionRequestView, ReimbursementClaimView } from '../../../../lib/types';
import { correctionDayText, correctionKindName } from '../../../(app)/attendance/corrections/corrections';
import { formatEgp } from '../../../(app)/employees/[id]/contracts/salary';
import { daysText, periodText } from '../../../(app)/leave/list';
import { isPermission, mergeRequests, permissionWhenText } from '../../../(app)/leave/permissions';
import { effectiveFromText, reasonText } from '../../../(app)/raise-requests/list';
import { currentAmount } from '../../../(app)/reimbursements/list';

// The phone pages' To Approve (owner, 20 October 2026: the employee app, "managers and team leads approve from the
// phone"): what waits for the caller, in sections as My Team and Approvals have them: leave and permission, the claims,
// the attendance corrections, the raise requests at HR's step (HR's, or the CEO's for a C-level person), and the raises
// with the CEO. The lists are the API's (each "waiting" read answers for the caller alone); each row opens the item's
// page under To Approve, with the decision form. Pure code, tested; relative imports, as vitest doesn't know "@/".

export interface WaitingRow {
  key: string;
  href: string;
  /** Who it is for. */
  name: string;
  /** What and when, in a line. */
  line: string;
}

export interface WaitingSection {
  key: 'leave' | 'reimbursement' | 'correction' | 'raise' | 'pay-raise';
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
  claims?: List<ReimbursementClaimView>;
  corrections?: List<AttendanceCorrectionView>;
  raiseRequests?: List<RaiseRequest>;
  payRaises?: List<PendingRaise>;
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
  return sections;
}

/** How many wait in all, in the sections read. */
export const waitingTotal = (sections: readonly WaitingSection[]) => sections.reduce((n, s) => n + s.rows.length, 0);
