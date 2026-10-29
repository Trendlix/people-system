'use server';

// HR's screening call (owner, 29 October 2026: "HR Screening and scheduling"; asked, "Screening call + result"): Passed or
// Failed with a comment, on a shortlisted applicant the hiring manager accepted. Forwarded to the API (HR and a Super
// Admin; audited), which checks every rule again; the page then refreshes.
import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';
import { screeningCallApiPath, screeningCallForm, screeningCallSavedText } from './screening-call';

/** What was typed, kept to show again after a refusal. */
function typed(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === 'string' && !k.startsWith('$')) out[k] = v;
  return out;
}

export async function saveScreeningCall(applicationId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const values = typed(fd);
  const { body, errors } = screeningCallForm(fd);
  if (!body) return { errors, values };
  try {
    await apiSend('POST', screeningCallApiPath(applicationId), body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, values };
    throw err;
  }
  refresh();
  return { message: screeningCallSavedText(body.result) };
}
