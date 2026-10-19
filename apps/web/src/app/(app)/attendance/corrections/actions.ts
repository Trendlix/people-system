'use server';

// Attendance corrections (owner, 19 October 2026: "Attendance corrections with approval ("I forgot to check out")"):
// asking for one (the employee's own), HR correcting a day directly (approved at once), cancelling one while it is being
// decided, and each approver's decision (approve, or reject with a comment). Each forwards to the API, which checks the
// day, the month's payroll, who decides each stage and that nobody decides their own, so calling these directly can't
// bypass that. Once sent, the correction's page opens.
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import type { LeaveStage } from '@trendlix/shared';
import { ApiError, apiSend } from '@/lib/api';
import type { AttendanceCorrectionView } from '@/lib/correction-types';
import type { FormState } from '@/lib/types';
import { leaveDecisionBody } from '../../leave/list';
import { shownMessage } from '../../leave/permissions';
import { correctionDoneHref, correctionForm, typedCorrectionValues } from './corrections';

const shown = (messages: string[]) => messages.map(shownMessage);

/** The employee asks to correct a day of theirs (POST /me/attendance/corrections). */
export async function askCorrection(_prev: FormState, fd: FormData): Promise<FormState> {
  const values = typedCorrectionValues(fd);
  const { body, errors } = correctionForm(fd);
  if (!body) return { errors, values };
  let made: AttendanceCorrectionView | undefined;
  try {
    made = await apiSend<AttendanceCorrectionView>('POST', '/me/attendance/corrections', body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: shown(err.messages), values };
    throw err;
  }
  // My Attendance, My Requests and the manager's count in the sidebar now have it
  refresh();
  redirect(made?.id ? correctionDoneHref(made.id, 'sent') : '/my-attendance');
}

/** HR corrects a person's day directly (POST /attendance/corrections, with the employee): approved at once. */
export async function recordCorrection(_prev: FormState, fd: FormData): Promise<FormState> {
  const values = typedCorrectionValues(fd);
  const employeeId = String(fd.get('employeeId') ?? '').trim();
  const { body, errors } = correctionForm(fd);
  if (!employeeId) errors.unshift('Choose the employee whose day it is.');
  if (!body || !employeeId) return { errors, values };
  let made: AttendanceCorrectionView | undefined;
  try {
    made = await apiSend<AttendanceCorrectionView>('POST', '/attendance/corrections', { employeeId, ...body });
  } catch (err) {
    if (err instanceof ApiError) return { errors: shown(err.messages), values };
    throw err;
  }
  refresh();
  redirect(made?.id ? correctionDoneHref(made.id, 'recorded') : `/attendance/${encodeURIComponent(employeeId)}`);
}

/** The employee cancels their correction while it is being decided (POST /me/attendance/corrections/:id/cancel). */
export async function cancelMyCorrection(id: string): Promise<FormState> {
  try {
    await apiSend('POST', `/me/attendance/corrections/${encodeURIComponent(id)}/cancel`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) redirect(correctionDoneHref(id, 'moved'));
    if (err instanceof ApiError) return { errors: shown(err.messages) };
    throw err;
  }
  refresh();
  redirect(correctionDoneHref(id, 'cancelled'));
}

/**
 * An approver's decision on a correction waiting for them (POST /attendance/corrections/:id/decide). One that moved on
 * meanwhile, or can't be applied now (the month's payroll with the CEO), is refused with why: shown on the form.
 */
export async function decideCorrection(id: string, stage: LeaveStage, _prev: FormState, fd: FormData): Promise<FormState> {
  const values = { decision: String(fd.get('decision') ?? ''), comment: String(fd.get('comment') ?? '') };
  const { body, errors } = leaveDecisionBody(fd);
  if (!body) return { errors, values };
  try {
    await apiSend('POST', `/attendance/corrections/${encodeURIComponent(id)}/decide`, body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: shown(err.messages), values };
    throw err;
  }
  // the lists and the counts in the sidebar change with it
  refresh();
  redirect(correctionDoneHref(id, `${stage}_${body.decision}`));
}
