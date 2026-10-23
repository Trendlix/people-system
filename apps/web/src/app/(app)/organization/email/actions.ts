'use server';

// Organization → Email Settings (owner, 23 October 2026: "why dont we add SMTP setup in the organization setup"): the
// page's one form, by the button pressed. Each forwards to the API, which checks the session, that it is a Super Admin
// in their own session, and every value again, so calling this directly bypasses nothing. The password typed is sent on
// to the API once and never comes back: the answer carries no field values.
import type { MailSettingsView, MailTestView } from '@trendlix/shared';
import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';
import { intentOf, mailSettingsBody, mailTestBody, savedMessage, type MailFormState } from './settings';

/** The request's answer, or the API's refusal as the form's errors. */
async function refused(prev: MailFormState, request: () => Promise<MailFormState>): Promise<MailFormState> {
  try {
    return await request();
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, saved: prev.saved };
    throw err;
  }
}

export async function submitMailSettings(prev: MailFormState, fd: FormData): Promise<MailFormState> {
  const intent = intentOf(fd);

  // Remove the saved password (DELETE /mail-settings/password): settings that need one stop being used until a new one
  if (intent === 'remove') {
    return refused(prev, async () => {
      await apiSend<MailSettingsView>('DELETE', '/mail-settings/password');
      refresh();
      return { message: 'The saved password was removed.', saved: (prev.saved ?? 0) + 1 };
    });
  }

  // Send a test email (POST /mail-settings/test): the values on screen, saved or not, so they can be tried before they
  // are saved or switched on; answered sent or why not in plain words, and kept as the last test
  if (intent === 'test') {
    const { body, errors } = mailTestBody(fd);
    if (errors.length) return { errors, saved: prev.saved };
    return refused(prev, async () => {
      const test = (await apiSend<MailTestView>('POST', '/mail-settings/test', body))!;
      refresh();
      return { test, saved: prev.saved };
    });
  }

  // Save (PUT /mail-settings): an empty password box keeps the saved one
  const { body, errors } = mailSettingsBody(fd);
  if (errors.length) return { errors, saved: prev.saved };
  return refused(prev, async () => {
    const view = (await apiSend<MailSettingsView>('PUT', '/mail-settings', body))!;
    refresh();
    return { message: savedMessage(view), saved: (prev.saved ?? 0) + 1 };
  });
}
