'use server';

// The batches (owner, 29 October 2026: "Tick several at once"; the recruitment tree, 3 November 2026; 5 November 2026:
// Applicants decided as a review, no Send to Review 1): a step decided for several at once (on a vacancy's list, or the
// Final Review on My Hiring). Each forwards to the API, which checks who may and each applicant again, and answers what it
// did and what it skipped with why; the page is then read again.

import type { HiringBatchResult } from '@trendlix/shared';
import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';
import { batchDecisionForm, decideDoneText } from './shortlist';

/** A batch's answer: what the API did (and the words for it), or why it refused. */
export type BatchState = FormState & { result?: HiringBatchResult };

const messages = (err: unknown): string[] => {
  if (err instanceof ApiError) return err.messages;
  throw err;
};

/** The applicants ticked at one step decided together: the outcome, a rejection's reasons, the feedback. */
export async function decideBatch(vacancyId: string, _prev: BatchState, fd: FormData): Promise<BatchState> {
  const { body, errors } = batchDecisionForm(fd);
  if (!body) return { errors };
  try {
    const result = (await apiSend<HiringBatchResult>('POST', `/recruitment/vacancies/${encodeURIComponent(vacancyId)}/decide`, body)) ?? { done: [], skipped: [] };
    refresh();
    return { result, message: decideDoneText(body.outcome, result) };
  } catch (err) {
    return { errors: messages(err) };
  }
}
