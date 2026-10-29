'use server';

// The hiring steps' batches (owner, 29 October 2026: "HR Filteration and shortlisting - Manager view the shortlisted and
// accept or reject them"; "Tick several at once"): HR's shortlist of the applicants ticked on a vacancy's list, and the
// hiring manager's Accept or Reject of those ticked on My Hiring. Each forwards to the API, which checks who may and each
// applicant again, and answers what it did and what it skipped with why; the page is then read again.

import type { HiringBatchResult } from '@trendlix/shared';
import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';
import { batchDoneText, batchProblem, reviewDoneText, reviewForm } from './shortlist';

/** A batch's answer: what the API did (and the words for it), or why it refused. */
export type BatchState = FormState & { result?: HiringBatchResult };

const messages = (err: unknown): string[] => {
  if (err instanceof ApiError) return err.messages;
  throw err;
};

/** HR shortlists the applicants ticked (those at Applied); the hiring manager told once. */
export async function shortlistApplicants(vacancyId: string, applicationIds: string[]): Promise<BatchState> {
  const problem = batchProblem(applicationIds, 'shortlist');
  if (problem) return { errors: [problem] };
  try {
    const result = (await apiSend<HiringBatchResult>('POST', `/recruitment/vacancies/${encodeURIComponent(vacancyId)}/shortlist`, { applicationIds })) ?? { done: [], skipped: [] };
    refresh();
    return { result, message: batchDoneText('Shortlisted', result) };
  } catch (err) {
    return { errors: messages(err) };
  }
}

/** The hiring manager accepts or rejects the applicants ticked, with a note; HR told once. */
export async function reviewShortlist(vacancyId: string, _prev: BatchState, fd: FormData): Promise<BatchState> {
  const { body, errors } = reviewForm(fd);
  if (!body) return { errors };
  try {
    const result = (await apiSend<HiringBatchResult>('POST', `/recruitment/vacancies/${encodeURIComponent(vacancyId)}/review`, body)) ?? { done: [], skipped: [] };
    refresh();
    return { result, message: reviewDoneText(body.decision, result) };
  } catch (err) {
    return { errors: messages(err) };
  }
}
