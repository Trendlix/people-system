'use server';

// Organization → Email Templates (owner, 1 November 2026: "build the mail templetes"): save, reset to standard and send
// a test. Each forwards to the API, which checks the session, the role and the words again, so calling these directly
// bypasses nothing.
import type { EmailTemplateText, EmailTemplateView } from '@trendlix/shared';
import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';

export type TemplateResult = { view?: EmailTemplateView; errors?: string[]; message?: string; test?: { ok: boolean; message: string } };

async function refused(request: () => Promise<TemplateResult>): Promise<TemplateResult> {
  try {
    return await request();
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
}

const path = (key: string) => `/email-templates/${encodeURIComponent(key)}`;

/** PUT /email-templates/:key: HR's words (the standard ones again: back to standard). */
export async function saveEmailTemplate(key: string, words: EmailTemplateText): Promise<TemplateResult> {
  return refused(async () => {
    const view = (await apiSend<EmailTemplateView>('PUT', path(key), { subject: words.subject, body: words.body }))!;
    refresh();
    return { view, message: view.custom ? 'Saved. The next emails go with these words.' : 'Saved: these are the standard words, so the email is back to standard.' };
  });
}

/** POST /email-templates/:key/reset: the standard words again. */
export async function resetEmailTemplate(key: string): Promise<TemplateResult> {
  return refused(async () => {
    const view = (await apiSend<EmailTemplateView>('POST', `${path(key)}/reset`))!;
    refresh();
    return { view, message: 'Back to the standard words.' };
  });
}

/** POST /email-templates/:key/test: the words on screen with the sample values, to the signed-in person. */
export async function testEmailTemplate(key: string, words: EmailTemplateText): Promise<TemplateResult> {
  return refused(async () => {
    const test = (await apiSend<{ ok: boolean; message: string }>('POST', `${path(key)}/test`, { subject: words.subject, body: words.body }))!;
    return { test };
  });
}
