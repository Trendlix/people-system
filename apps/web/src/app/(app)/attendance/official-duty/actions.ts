'use server';

// Official duty (owner, 23 October 2026: "Official duty (OD) requests"; asked, "Manager, then HR", "Ahead or up to 3
// days after"): asking for one (the employee's own), HR recording one for someone (owner, 26 October 2026: "HR records
// it"; approved at once, past the 3-day limit with a warning) and what its days would meet (for HR's form, live), the
// employee cancelling theirs while it is being decided, HR cancelling an approved one with a comment, and each
// approver's decision (approve, or reject with a comment). Each
// forwards to the API, which checks the days, the timing, the hours, the overlaps, who decides each stage and that
// nobody decides their own, so calling these directly can't bypass that. Once sent, the request's page opens: the
// site's, or the phone pages' for a form sent from them (lib/surface.ts).
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import type { LeaveStage } from '@trendlix/shared';
import { ApiError, apiFetch, apiSend, messagesOf } from '@/lib/api';
import type { OdCheck, OdRequestView } from '@/lib/od-types';
import { afterAction } from '@/lib/surface';
import type { FormState } from '@/lib/types';
import { leaveDecisionBody } from '../../leave/list';
import { shownMessage } from '../../leave/permissions';
import { MY_OD_HREF, OD_PATH, odCancelBody, odCheckPath, odDoneHref, odForm, odRecordForm, typedOdValues, type OdWhen } from './od';

const shown = (messages: string[]) => messages.map(shownMessage);

/** The employee asks for an official duty (POST /me/official-duty); refused with every reason, kept with what was typed. */
export async function sendOd(_prev: FormState, fd: FormData): Promise<FormState> {
  const values = typedOdValues(fd);
  const { body, errors } = odForm(fd);
  if (!body) return { errors, values };
  let made: OdRequestView | undefined;
  try {
    made = await apiSend<OdRequestView>('POST', '/me/official-duty', body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: shown(err.messages), values };
    throw err;
  }
  // My Requests and the approver's count in the sidebar now have it
  refresh();
  redirect(afterAction(fd, made?.id ? odDoneHref(made.id, 'sent') : MY_OD_HREF));
}

/** HR records official duty for someone (POST /official-duty, with the employee): approved at once. */
export async function recordOd(_prev: FormState, fd: FormData): Promise<FormState> {
  const values = typedOdValues(fd);
  const { body, errors } = odRecordForm(fd);
  if (!body) return { errors, values };
  let made: OdRequestView | undefined;
  try {
    made = await apiSend<OdRequestView>('POST', '/official-duty', body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: shown(err.messages), values };
    throw err;
  }
  refresh();
  redirect(made?.id ? odDoneHref(made.id, 'recorded') : OD_PATH);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What HR recording official duty for someone would meet (GET /official-duty/check): what refuses it and what it would
 * be recorded past, for the form to show as the days are chosen.
 */
export async function checkOdDays(employeeId: string, when: OdWhen): Promise<{ check: OdCheck } | { errors: string[] }> {
  const times = when.fullDay || (TIME.test(when.fromTime ?? '') && TIME.test(when.toTime ?? ''));
  if (!UUID.test(employeeId) || !DAY.test(when.startDate) || !DAY.test(when.endDate) || !times) return { errors: [] };
  let res: Response;
  try {
    res = await apiFetch(odCheckPath(employeeId, when));
  } catch (err) {
    if (err instanceof ApiError) return { errors: shown(err.messages) };
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (!res.ok) return { errors: shown(await messagesOf(res)) };
  try {
    const check = (await res.json()) as OdCheck;
    return { check: { ...check, problems: shown(check.problems), warnings: shown(check.warnings) } };
  } catch {
    return { errors: ['The server sent an answer that could not be read.'] };
  }
}

/** The employee cancels their request while it is being decided (POST /me/official-duty/:id/cancel). `fd`: where it was sent from. */
export async function cancelMyOd(id: string, _prev?: FormState, fd?: FormData): Promise<FormState> {
  try {
    await apiSend('POST', `/me/official-duty/${encodeURIComponent(id)}/cancel`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) redirect(afterAction(fd, odDoneHref(id, 'moved')));
    if (err instanceof ApiError) return { errors: shown(err.messages) };
    throw err;
  }
  refresh();
  redirect(afterAction(fd, odDoneHref(id, 'cancelled')));
}

/** HR cancels an approved official duty (POST /official-duty/:id/cancel), with a comment the employee sees. */
export async function cancelOdByHr(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const values = { comment: String(fd.get('comment') ?? '') };
  const { body, errors } = odCancelBody(fd);
  if (!body) return { errors, values };
  try {
    await apiSend('POST', `/official-duty/${encodeURIComponent(id)}/cancel`, body);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) redirect(afterAction(fd, odDoneHref(id, 'moved')));
    if (err instanceof ApiError) return { errors: shown(err.messages), values };
    throw err;
  }
  refresh();
  redirect(afterAction(fd, odDoneHref(id, 'cancelled')));
}

/**
 * An approver's decision on a request waiting for them (POST /official-duty/:id/decide): approve, or reject with a
 * comment. One that moved on meanwhile is refused (409): the page then shows where it stands, and says so.
 */
export async function decideOd(id: string, stage: LeaveStage, _prev: FormState, fd: FormData): Promise<FormState> {
  const values = { decision: String(fd.get('decision') ?? ''), comment: String(fd.get('comment') ?? '') };
  const { body, errors } = leaveDecisionBody(fd);
  if (!body) return { errors, values };
  try {
    await apiSend('POST', `/official-duty/${encodeURIComponent(id)}/decide`, body);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) redirect(afterAction(fd, odDoneHref(id, 'moved')));
    if (err instanceof ApiError) return { errors: shown(err.messages), values };
    throw err;
  }
  // the lists and the counts in the sidebar change with it
  refresh();
  redirect(afterAction(fd, odDoneHref(id, `${stage}_${body.decision}`)));
}
