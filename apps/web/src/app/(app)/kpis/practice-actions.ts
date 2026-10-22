'use server';

// Practice KPI scorecards (owner, 22 October 2026: "Practice scorecards": "I or HR start a practice scorecard for any
// employee and month, from a draft or published template"; "Every step can be done by me"; "deletes in one click"):
// starting one, each step its starter (or a Super Admin) stands in for (the self-rating, the scoring, HR's calibration,
// the sign-off on either side), and deleting one or all (a Super Admin only: owner's decision, 15 October 2026). Each
// forwards to the API's practice routes, which check the session, who may stand in and where the scorecard is, so
// calling these directly can't bypass that. A step stood in for while viewing as someone isn't one: then the scorecard's
// own forms (actions.ts) take it as that person.
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import type { KpiPracticeChoices, KpiPracticeDeleted, KpiScorecardView } from '@trendlix/shared';
import { ApiError, apiGet, apiSend } from '@/lib/api';
import { KPI_API, KPI_PATHS } from '@/lib/kpi-paths';
import { deleteRefusal } from '@/lib/session';
import { afterAction } from '@/lib/surface';
import type { FormState } from '@/lib/types';
import { practiceDoneHref, startBody, type PracticeDone } from './practice';
import { calibrateBody, picksBody, signBody, type CalibrationMetric, type FormMetric } from './scorecard';

const UUID = /^[0-9a-f-]{36}$/i;

const NOT_FOUND = 'This practice scorecard could not be found. Please reload the page.';

/** The API's messages, with its dates (YYYY-MM-DD) as the screens show them (DD/MM/YYYY). */
const asShown = (messages: string[]) => messages.map((m) => m.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3/$2/$1'));

/** Sends a step; once done, the scorecard's page saying so. One that moved on meanwhile (409) opens as it stands now. */
async function send(id: string, path: string, body: unknown, done: PracticeDone, fd: FormData): Promise<FormState> {
  if (!UUID.test(id)) return { errors: [NOT_FOUND] };
  try {
    await apiSend('POST', path, body);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) redirect(afterAction(fd, practiceDoneHref(id, 'moved')));
    if (err instanceof ApiError) return { errors: asShown(err.messages) };
    throw err;
  }
  refresh();
  redirect(afterAction(fd, practiceDoneHref(id, done)));
}

/**
 * Starts a practice scorecard (POST /kpis/practice): whom, which month and which version, checked first against the
 * choices the form was given (read again here); then its page.
 */
export async function startPractice(_prev: FormState, fd: FormData): Promise<FormState> {
  let choices: KpiPracticeChoices;
  try {
    choices = await apiGet<KpiPracticeChoices>(KPI_API.practiceChoices);
  } catch (err) {
    if (err instanceof ApiError) return { errors: asShown(err.messages) };
    throw err;
  }
  const { body, errors } = startBody(fd, choices.people);
  if (!body) return { errors };
  let made: KpiScorecardView | undefined;
  try {
    made = await apiSend<KpiScorecardView>('POST', KPI_API.practice, body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: asShown(err.messages) };
    throw err;
  }
  refresh();
  if (!made?.id) return { message: 'Practice scorecard started.' };
  redirect(practiceDoneHref(made.id, 'started'));
}

/** The self-rating (…/self) or the scoring (…/score), stood in for: a pick and a comment per metric, saved or sent. */
export async function practicePicks(id: string, step: 'self' | 'score', metrics: FormMetric[], _prev: FormState, fd: FormData): Promise<FormState> {
  const { body, errors } = picksBody(fd, metrics);
  if (!body) return { errors };
  // the manager scores with comments (owner's brief, 21 October 2026), as the API asks, a practice one too
  if (step === 'score' && body.submit && !body.comment) return { errors: ['Write your comments: how the month went and the areas of focus.'] };
  const path = step === 'self' ? KPI_API.practiceSelf(id) : KPI_API.practiceScore(id);
  const done: PracticeDone = step === 'self' ? (body.submit ? 'self_sent' : 'self_saved') : body.submit ? 'score_sent' : 'score_saved';
  return send(id, path, body, done, fd);
}

/** HR's calibration, stood in for: the picks changed from the manager's, each with its reason. */
export async function practiceCalibrate(id: string, metrics: CalibrationMetric[], _prev: FormState, fd: FormData): Promise<FormState> {
  const { body, errors } = calibrateBody(fd, metrics);
  if (!body) return { errors };
  return send(id, KPI_API.practiceCalibrate(id), body, 'calibrated', fd);
}

/** The sign-off, stood in for on the employee's side or the manager's: "I've read it", with an optional comment. */
export async function practiceSign(id: string, as: 'employee' | 'manager', _prev: FormState, fd: FormData): Promise<FormState> {
  const { body, errors } = signBody(fd);
  if (!body) return { errors };
  return send(id, KPI_API.practiceSign(id), { ...body, as }, 'signed', fd);
}

/** Deletes one practice scorecard (a Super Admin only; the API never deletes a real one); then the Practice list. */
export async function deletePractice(id: string): Promise<FormState> {
  const refusal = await deleteRefusal();
  if (refusal) return { errors: refusal };
  if (!UUID.test(id)) return { errors: [NOT_FOUND] };
  try {
    await apiSend('DELETE', KPI_API.practiceCard(id));
  } catch (err) {
    if (err instanceof ApiError) return { errors: asShown(err.messages) };
    throw err;
  }
  refresh();
  redirect(`${KPI_PATHS.practice}?deleted=1`);
}

/** "Delete all practice scorecards" (a Super Admin only): every one, or only the caller's ("Only mine"). */
export async function deleteAllPractice(_prev: FormState, fd: FormData): Promise<FormState> {
  const refusal = await deleteRefusal();
  if (refusal) return { errors: refusal };
  const mine = fd.get('mine') === '1';
  let result: KpiPracticeDeleted | undefined;
  try {
    result = await apiSend<KpiPracticeDeleted>('DELETE', KPI_API.practiceAll(mine));
  } catch (err) {
    if (err instanceof ApiError) return { errors: asShown(err.messages) };
    throw err;
  }
  refresh();
  redirect(`${KPI_PATHS.practice}?deleted=${result?.deleted ?? 0}`);
}
