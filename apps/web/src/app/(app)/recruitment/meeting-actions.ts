'use server';

// An online interview whose meeting couldn't be made (owner, 24 October 2026: "automatically generate meeting links";
// the brief: "HR is told plainly … with Try again or Paste a link"): POST /recruitment/interviews/:id/meeting, made again
// with a choice, or with a link pasted. The candidate and the interviewers are told once it has its link. The API checks
// who may (HR, a Super Admin) and the rest again.
import type { InterviewSaved } from '@trendlix/shared';
import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';
import { interviewSavedText, meetingFixForm } from './meetings';

export async function fixInterviewMeeting(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const { body, errors } = meetingFixForm(fd);
  if (!body) return { errors };
  let saved: InterviewSaved | undefined;
  try {
    saved = await apiSend<InterviewSaved>('POST', `/recruitment/interviews/${encodeURIComponent(id)}/meeting`, body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  refresh();
  if (saved?.meeting === 'failed') return { errors: [interviewSavedText(saved)] };
  return { message: saved ? interviewSavedText(saved) : 'Saved.' };
}
