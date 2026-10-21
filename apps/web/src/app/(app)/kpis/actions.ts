'use server';

// The KPI scorecard's steps (owner, 21 October 2026: "Self, manager, HR, sign-off"): the employee's self-rating and the
// scorer's scoring (a pick and an optional comment per metric, saved for later or sent), HR's calibration (only the
// picks changed from the manager's, each with its reason), the sign-off by both ("I've read it", with an optional
// comment), and HR's "Open this month's scorecards now". Each forwards to the API, which checks who may take the step
// and when, so calling these directly can't bypass that. Once done, the scorecard's page says so: the site's, or the
// phone pages' for a form sent from them (owner, 20 October 2026: the employee app; lib/surface.ts afterAction).
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import type { KpiOpenResult } from '@trendlix/shared';
import { ApiError, apiSend } from '@/lib/api';
import { KPI_API } from '@/lib/kpi-paths';
import { afterAction } from '@/lib/surface';
import type { FormState } from '@/lib/types';
import { calibrateBody, openedText, picksBody, scorecardDoneHref, signBody, type CalibrationMetric, type FormMetric, type ScorecardDone } from './scorecard';

/** The API's messages, with its dates (YYYY-MM-DD) as the screens show them (DD/MM/YYYY). */
const asShown = (messages: string[]) => messages.map((m) => m.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3/$2/$1'));

/**
 * Sends a step to the API; once done, the scorecard's page with what was done (`done`). One that moved on meanwhile (the
 * API's 409: taken by someone else, the deadline passed, final) opens as it stands now, saying so; any other refusal
 * comes back as the form's errors.
 */
async function send(id: string, path: string, body: unknown, done: ScorecardDone, fd: FormData): Promise<FormState> {
  try {
    await apiSend('POST', path, body);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) redirect(afterAction(fd, scorecardDoneHref(id, 'moved')));
    if (err instanceof ApiError) return { errors: asShown(err.messages) };
    throw err;
  }
  // the lists and the counts in the sidebar change with it
  refresh();
  redirect(afterAction(fd, scorecardDoneHref(id, done)));
}

/**
 * The employee's self-rating (POST …/self) or the scorer's scoring (POST …/score): a pick and a comment per metric of
 * `metrics`, the step's comment, saved (Save) or sent (Send: every metric picked).
 */
export async function savePicks(id: string, step: 'self' | 'score', metrics: FormMetric[], _prev: FormState, fd: FormData): Promise<FormState> {
  const { body, errors } = picksBody(fd, metrics);
  if (!body) return { errors };
  // the manager scores with comments (owner's brief, 21 October 2026: "The manager scores with comments"), as the API asks
  if (step === 'score' && body.submit && !body.comment) return { errors: ['Write your comments: how the month went and the areas of focus.'] };
  const path = step === 'self' ? KPI_API.self(id) : KPI_API.score(id);
  const done: ScorecardDone = step === 'self' ? (body.submit ? 'self_sent' : 'self_saved') : body.submit ? 'score_sent' : 'score_saved';
  return send(id, path, body, done, fd);
}

/** HR's calibration (POST …/calibrate): the picks changed from the manager's (in `metrics`), each with its reason. */
export async function calibrate(id: string, metrics: CalibrationMetric[], _prev: FormState, fd: FormData): Promise<FormState> {
  const { body, errors } = calibrateBody(fd, metrics);
  if (!body) return { errors };
  return send(id, KPI_API.calibrate(id), body, 'calibrated', fd);
}

/** The sign-off (POST …/sign), the employee's or the manager's side: "I've read it", with an optional comment. */
export async function sign(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const { body, errors } = signBody(fd);
  if (!body) return { errors };
  return send(id, KPI_API.sign(id), body, 'signed', fd);
}

/** HR opens last month's scorecards now (POST /kpis/open), rather than waiting for the 1st: says how many opened. */
export async function openScorecards(): Promise<FormState> {
  let result: KpiOpenResult | undefined;
  try {
    result = await apiSend<KpiOpenResult>('POST', KPI_API.open);
  } catch (err) {
    if (err instanceof ApiError) return { errors: asShown(err.messages) };
    throw err;
  }
  refresh();
  return { message: result ? openedText(result) : 'Done.' };
}
