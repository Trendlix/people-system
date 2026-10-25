'use server';

// "Find a time" and "Check this time" in the interview form (owner, 25 October 2026: "is it better for each interviewer
// to add his available interviews timeslots?"; asked, "Hours + calendar" and "HR only"): each forwarded to the API, which
// checks the session, that the caller schedules interviews (HR, a Super Admin), and every value again, so calling these
// directly bypasses nothing. They read only: nothing is saved, and a refusal comes back as words, never thrown.
import type { AvailabilityInput, AvailabilityView, TimeCheckInput, TimeCheckView } from '@trendlix/shared';
import { ApiError, apiSend } from '@/lib/api';

export type FindResult = { view: AvailabilityView; errors?: undefined } | { view?: undefined; errors: string[] };
export type CheckResult = { check: TimeCheckView; errors?: undefined } | { check?: undefined; errors: string[] };

const NOT_YET = 'Not available yet: the server doesn’t find free times yet. Please try again after its next update.';

/** The API's refusal in words: an API from before "Find a time" (404) said plainly. */
function refusal(err: unknown): string[] {
  if (!(err instanceof ApiError)) throw err;
  return err.status === 404 ? [NOT_YET] : err.messages;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** POST /recruitment/availability: the times every chosen interviewer is free, grouped by day. */
export async function findTimes(input: AvailabilityInput): Promise<FindResult> {
  const body: AvailabilityInput = {
    interviewerIds: strings(input?.interviewerIds),
    minutes: Number(input?.minutes),
    kind: input?.kind,
    from: String(input?.from ?? ''),
    to: String(input?.to ?? ''),
    ...(typeof input?.interviewId === 'string' && input.interviewId && { interviewId: input.interviewId }),
  };
  try {
    const view = await apiSend<AvailabilityView>('POST', '/recruitment/availability', body);
    if (!view || !Array.isArray(view.days) || !Array.isArray(view.people)) return { errors: ['The server sent an answer that could not be read.'] };
    return { view };
  } catch (err) {
    return { errors: refusal(err) };
  }
}

/** POST /recruitment/availability/check: what a time typed by hand runs into, as warnings (it can be saved all the same). */
export async function checkTime(input: TimeCheckInput): Promise<CheckResult> {
  const body: TimeCheckInput = {
    interviewerIds: strings(input?.interviewerIds),
    date: String(input?.date ?? ''),
    time: String(input?.time ?? ''),
    minutes: Number(input?.minutes),
    kind: input?.kind,
    ...(typeof input?.interviewId === 'string' && input.interviewId && { interviewId: input.interviewId }),
  };
  try {
    const check = await apiSend<TimeCheckView>('POST', '/recruitment/availability/check', body);
    if (!check || !Array.isArray(check.warnings)) return { errors: ['The server sent an answer that could not be read.'] };
    return { check: { warnings: strings(check.warnings), people: Array.isArray(check.people) ? check.people : [] } };
  } catch (err) {
    return { errors: refusal(err) };
  }
}
