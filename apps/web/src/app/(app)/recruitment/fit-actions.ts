'use server';

// Add to this vacancy from a CV's Other Open Positions (owner, 25 October 2026: "and if it recomended to another position
// based on the CV"): forwards to the API, which adds them through Suggested From Earlier CVs' add (the consent, the
// history's note, the audit log and the CV's reading as there) and checks again that they are still recommended. Then
// the new application opens.
import { redirect } from 'next/navigation';
import type { SuggestionAdded } from '@trendlix/shared';
import { ApiError, apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';
import { applicantHref } from './recruitment';

export async function addToOpenPosition(vacancyId: string, record: { applicationId: string } | { generalCvId: string }): Promise<FormState> {
  let made: SuggestionAdded | undefined;
  try {
    made = await apiSend<SuggestionAdded>('POST', `/recruitment/vacancies/${encodeURIComponent(vacancyId)}/recommended/add`, record);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  if (made?.applicationId) redirect(applicantHref(made.applicationId));
  return { message: 'Added.' };
}
