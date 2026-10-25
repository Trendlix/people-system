'use server';

// Organization → Interview Hours (owner, 25 October 2026: "Hours + calendar": weekly interview hours set once; HR, the CEO
// and a Super Admin can set anyone's, and the company's minimum notice and buffer between interviews, which a person may
// only make stricter): forwarded to the API, which checks who may and every value again, so calling these directly
// bypasses nothing.
import type { InterviewDefaultsView, InterviewHoursView } from '@trendlix/shared';
import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';
import { defaultsFormBody, hoursFormBody } from '@/lib/interview-hours';
import type { FormState } from '@/lib/types';

/** PUT /interview-hours/settings: the company's minimum notice and buffer. */
export async function saveInterviewDefaults(_prev: FormState, fd: FormData): Promise<FormState> {
  const { body, errors } = defaultsFormBody(fd);
  if (!body) return { errors };
  try {
    await apiSend<InterviewDefaultsView>('PUT', '/interview-hours/settings', body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  refresh();
  return { message: 'Saved: new interviews are booked with them.' };
}

/** PUT /interview-hours/people/:employeeId: someone's hours; an empty week and no one-off changes clears them. */
export async function saveHoursFor(employeeId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const { body, errors } = hoursFormBody(fd);
  if (!body) return { errors };
  let saved: InterviewHoursView | undefined;
  try {
    saved = await apiSend<InterviewHoursView>('PUT', `/interview-hours/people/${encodeURIComponent(employeeId)}`, body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  refresh();
  return { message: (saved ? saved.hours : body.windows.length || body.changes.length) ? 'Saved. HR’s times follow these hours from now on.' : 'Saved: they have no interview hours now.' };
}
