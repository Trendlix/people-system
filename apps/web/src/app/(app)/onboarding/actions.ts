'use server';

// Onboarding (owner, 22 October 2026, the ATS's Phase 2): clearing a checklist's item (its owner, or HR, the CEO, a Super
// Admin), adding a one-off item, completing a checklist, opening one by hand from a profile, and the default items. Each
// forwards to the API, which checks who may and every rule again.
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import type { OnboardingView } from '@trendlix/shared';
import { ApiError, apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';
import { addItemForm, checklistForm, markItemForm, typedValues } from '../offboarding/offboarding';
import { ONBOARDING_CHECKLIST_PATH, onboardingHref } from './onboarding';

async function send(method: 'POST' | 'PUT' | 'PATCH', path: string, body: unknown, values?: Record<string, string>): Promise<FormState> {
  try {
    await apiSend(method, path, body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, ...(values && { values }) };
    throw err;
  }
  refresh();
  return { message: 'Saved.' };
}

export async function markOnboardingItem(id: string, itemId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const { body, errors } = markItemForm(fd);
  if (!body) return { errors };
  return send('PATCH', `/onboarding/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}`, body);
}

export async function addOnboardingItem(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const values = typedValues(fd);
  const { body, errors } = addItemForm(fd);
  if (!body) return { errors, values };
  const done = await send('POST', `/onboarding/${encodeURIComponent(id)}/items`, body, values);
  return done.errors ? done : { message: 'Item added.' };
}

export async function completeOnboarding(id: string): Promise<FormState> {
  const done = await send('POST', `/onboarding/${encodeURIComponent(id)}/complete`, {});
  return done.errors ? done : { message: 'Onboarding completed.' };
}

/** Opens a checklist by hand for a current employment, then opens its page. */
export async function openOnboarding(employmentId: string): Promise<FormState> {
  let made: OnboardingView | undefined;
  try {
    made = await apiSend<OnboardingView>('POST', `/onboarding/employments/${encodeURIComponent(employmentId)}`);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  refresh();
  if (made?.id) redirect(onboardingHref(made.id));
  return { message: 'Opened.' };
}

export async function saveOnboardingChecklist(_prev: FormState, fd: FormData): Promise<FormState> {
  const { items } = checklistForm(fd);
  const done = await send('PUT', '/onboarding/checklist', { items }, typedValues(fd));
  if (done.errors) return done;
  redirect(`${ONBOARDING_CHECKLIST_PATH}?saved=1`);
}
