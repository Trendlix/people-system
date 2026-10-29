'use server';

import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';
import { readAgainApiPath } from './read-again';

// HR's Read again and Read as a scan on the From the CV card (owner, 29 October 2026: "can i perform a rerun for
// example?"; read-again.ts).

/** A CV read again (`asScan`: by the OCR service whatever its own text); the page shows it being read. */
export async function readCvAgain(subject: { applicationId: string } | { generalCvId: string }, asScan: boolean): Promise<FormState> {
  try {
    await apiSend('POST', readAgainApiPath(subject), asScan ? { asScan: true } : {});
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  refresh();
  return { message: 'Being read again: refresh the page in a minute.' };
}
