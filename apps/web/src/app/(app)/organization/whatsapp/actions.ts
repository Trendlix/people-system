'use server';

// Organization → Company → WhatsApp (owner, 24 October 2026: "how to make whatsapp notifications?"; "Directly to Meta"):
// the page's one form, by the button pressed. Each forwards to the API, which checks the session, that it is a Super
// Admin in their own session, and every value again, so calling this directly bypasses nothing. The access token and the
// app secret typed are sent on to the API once and never come back: the answer carries neither.
import type { WhatsAppSettingsView, WhatsAppTemplatesResult, WhatsAppTestView } from '@trendlix/shared';
import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';
import { intentOf, savedMessage, whatsappSettingsBody, whatsappTestBody, type WhatsAppFormState } from './settings';

/** The request's answer, or the API's refusal as the form's errors. */
async function refused(prev: WhatsAppFormState, request: () => Promise<WhatsAppFormState>): Promise<WhatsAppFormState> {
  try {
    return await request();
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, saved: prev.saved };
    throw err;
  }
}

export async function submitWhatsAppSettings(prev: WhatsAppFormState, fd: FormData): Promise<WhatsAppFormState> {
  const intent = intentOf(fd);

  // Send a test message (POST /whatsapp/settings/test): with the saved settings, to the number written; answered sent or
  // why not in plain words, either way, and kept as the last test
  if (intent === 'test') {
    const { body, errors } = whatsappTestBody(fd);
    if (errors.length) return { errors, saved: prev.saved };
    return refused(prev, async () => {
      const test = (await apiSend<WhatsAppTestView>('POST', '/whatsapp/settings/test', body))!;
      refresh();
      return { test, saved: prev.saved };
    });
  }

  // Make a new verify token (POST /whatsapp/settings/verify-token): Meta's webhook must be verified again with it
  if (intent === 'verify-token') {
    return refused(prev, async () => {
      await apiSend<WhatsAppSettingsView>('POST', '/whatsapp/settings/verify-token');
      refresh();
      return { message: 'A new verify token was made. Paste it in Meta’s webhook settings and verify the webhook again.', saved: prev.saved };
    });
  }

  // Submit templates (POST /whatsapp/templates/submit) and Sync status (POST /whatsapp/templates/sync): Meta's answer
  if (intent === 'submit' || intent === 'sync') {
    return refused(prev, async () => {
      const templates = (await apiSend<WhatsAppTemplatesResult>('POST', `/whatsapp/templates/${intent}`))!;
      refresh();
      return { templates, saved: prev.saved };
    });
  }

  // Save (PUT /whatsapp/settings): an empty token or app secret box keeps the saved one
  const { body, errors } = whatsappSettingsBody(fd);
  if (errors.length) return { errors, saved: prev.saved };
  return refused(prev, async () => {
    const view = (await apiSend<WhatsAppSettingsView>('PUT', '/whatsapp/settings', body))!;
    refresh();
    return { message: savedMessage(view), saved: (prev.saved ?? 0) + 1 };
  });
}
