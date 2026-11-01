'use server';

// The Employees list's bulk actions (owner, 1 November 2026: "i want to select and create bulk actions"): each forwards
// to the API, which checks the session, the role and each person again, so calling these directly bypasses nothing.
import type { BulkInviteResult, EmployeeBulkInput, EmployeeBulkResult } from '@trendlix/shared';
import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';

/** How many it was done for, and who was skipped with why; or why nothing was done. */
export interface BulkOutcome {
  errors?: string[];
  done?: number;
  skipped?: { name: string; reason: string }[];
}

async function call(request: () => Promise<BulkOutcome>): Promise<BulkOutcome> {
  try {
    return await request();
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
}

/** POST /employees/bulk: hold, release, manager, department, shift, check-in from anywhere, message. */
export async function runBulk(input: EmployeeBulkInput): Promise<BulkOutcome> {
  return call(async () => {
    const r = (await apiSend<EmployeeBulkResult>('POST', '/employees/bulk', input))!;
    refresh();
    return { done: r.done.length, skipped: r.skipped.map((s) => ({ name: s.name, reason: s.reason })) };
  });
}

/** POST /employees/access/invitations: the sign-in invitations. */
export async function inviteChosen(employeeIds: string[]): Promise<BulkOutcome> {
  return call(async () => {
    const r = (await apiSend<BulkInviteResult>('POST', '/employees/access/invitations', { employeeIds }))!;
    refresh();
    return { done: r.sent, skipped: r.skipped.map((s) => ({ name: s.fullNameEn, reason: s.reason })) };
  });
}

/** POST /attendance/check-in-exemptions: one reason and one period for all (all kept, or none). */
export async function exemptChosen(input: { employeeIds: string[]; reason: string; startDate: string | null; endDate: string | null }): Promise<BulkOutcome> {
  return call(async () => {
    await apiSend('POST', '/attendance/check-in-exemptions', {
      employeeIds: input.employeeIds,
      reason: input.reason,
      ...(input.startDate ? { startDate: input.startDate } : { ownStart: true }),
      ...(input.endDate && { endDate: input.endDate }),
    });
    refresh();
    return { done: input.employeeIds.length, skipped: [] };
  });
}
