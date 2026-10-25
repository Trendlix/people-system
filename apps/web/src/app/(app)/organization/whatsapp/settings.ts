import {
  listed,
  twilioSenderText,
  WHATSAPP_QUIET_DEFAULT,
  WHATSAPP_SECRET_UNREADABLE,
  WHATSAPP_TOKEN_UNREADABLE,
  WHATSAPP_TWILIO_TOKEN_UNREADABLE,
  whatsappAllSettingsProblems,
  type WhatsAppProvider,
  type WhatsAppSettingsInput,
  type WhatsAppSettingsView,
  type WhatsAppTemplateStatusView,
  type WhatsAppTemplatesResult,
  type WhatsAppTestView,
} from '@trendlix/shared';
import { parseTime } from '@/lib/format';
import type { FormState } from '@/lib/types';

// Organization → Company → WhatsApp (owner, 24 October 2026: "how to make whatsapp notifications?"; asked how, "Directly
// to Meta": the WhatsApp Cloud API): what the page's one form sends, and what the page says. Pure code, tested
// (settings.test.ts); the API checks every request again (packages/shared whatsapp.ts). Since 25 October 2026 ("Add Twilio
// as a choice"): "Send through" Meta directly or Twilio, Twilio's fields, and what a switch means, said before saving.

/** What the form's action answers: a save's message, a refusal's reasons, a test's result, the templates' submit or sync. */
export interface WhatsAppFormState extends FormState {
  test?: WhatsAppTestView;
  templates?: WhatsAppTemplatesResult;
  /** Whose templates `templates` are: Meta's or Twilio's. */
  templatesProvider?: WhatsAppProvider;
  /** Bumped by each save that went through, so the form closes the token and secret boxes it had open. */
  saved?: number;
}

/** The provider chosen on the form ("Send through"): Twilio when it is ticked, else Meta directly. */
export const providerOf = (fd: FormData): WhatsAppProvider => (fd.get('provider') === 'twilio' ? 'twilio' : 'meta');

/** The form's buttons: Save, Send a test message, Make a new verify token, Submit templates, Sync status. */
export const WHATSAPP_INTENTS = ['save', 'test', 'verify-token', 'submit', 'sync'] as const;
export type WhatsAppIntent = (typeof WHATSAPP_INTENTS)[number];

export const intentOf = (fd: FormData): WhatsAppIntent => {
  const v = fd.get('intent');
  return typeof v === 'string' && (WHATSAPP_INTENTS as readonly string[]).includes(v) ? (v as WhatsAppIntent) : 'save';
};

const text = (fd: FormData, key: string): string => {
  const v = fd.get(key);
  return typeof v === 'string' ? v.trim() : '';
};

/** A switch sent as a hidden "false" before its box, and the box's "true" when ticked. */
const switchedOn = (fd: FormData, key: string): boolean => fd.getAll(key).includes('true');

/** PUT /whatsapp/settings's body from the form, with what is wrong with it (the shared checks, as the API makes them). */
export function whatsappSettingsBody(fd: FormData): { body: WhatsAppSettingsInput; errors: string[] } {
  const accessToken = text(fd, 'accessToken');
  const appSecret = text(fd, 'appSecret');
  const twilioAuthToken = text(fd, 'twilioAuthToken');
  const quietHours = switchedOn(fd, 'quietHours');
  const body: WhatsAppSettingsInput = {
    provider: providerOf(fd),
    phoneNumberId: text(fd, 'phoneNumberId') || null,
    businessAccountId: text(fd, 'businessAccountId') || null,
    displayPhone: text(fd, 'displayPhone') || null,
    // an empty box keeps the saved one: left out
    ...(accessToken && { accessToken }),
    ...(appSecret && { appSecret }),
    enabled: switchedOn(fd, 'enabled'),
    quietHours,
    // the times as the 12-hour fields write them ("10:00 PM"), sent as "22:00"
    quietFrom: quietHours ? parseTime(text(fd, 'quietFrom')) || null : null,
    quietTo: quietHours ? parseTime(text(fd, 'quietTo')) || null : null,
    // Twilio's, kept beside Meta's whichever is chosen; an empty Auth Token box keeps the saved one
    twilioAccountSid: text(fd, 'twilioAccountSid') || null,
    ...(twilioAuthToken && { twilioAuthToken }),
    twilioSender: text(fd, 'twilioSender') || null,
  };
  const errors = whatsappAllSettingsProblems(body, {
    tokenSaved: fd.get('tokenSaved') === 'true',
    secretSaved: fd.get('secretSaved') === 'true',
    twilioTokenSaved: fd.get('twilioTokenSaved') === 'true',
  });
  return { body, errors };
}

/**
 * POST /whatsapp/settings/test's body: the number to send to, as the phone field keeps it (+201012345678), through the
 * provider chosen on the form (saved or not: the test uses that provider's saved settings).
 */
export function whatsappTestBody(fd: FormData): { body: { to: string; provider: WhatsAppProvider }; errors: string[] } {
  const to = text(fd, 'testTo');
  return { body: { to, provider: providerOf(fd) }, errors: to ? [] : ['Write the number to send the test message to, with its country code.'] };
}

/** The quiet hours the form starts with: those saved, else 22:00 to 08:00 (switched off when none are saved). */
export function quietStart(view: Pick<WhatsAppSettingsView, 'quietHours'>): { on: boolean; from: string; to: string } {
  return view.quietHours ? { on: true, ...view.quietHours } : { on: false, ...WHATSAPP_QUIET_DEFAULT };
}

/** What a save that went through says, by whether messages go now. */
export function savedMessage(view: WhatsAppSettingsView): string {
  const twilio = view.provider === 'twilio';
  if (view.enabled && view.sending.on) return twilio ? 'Saved. WhatsApp messages go out through Twilio from now on.' : 'Saved. WhatsApp messages go out with these settings from now on.';
  if (view.enabled && twilio && view.twilio.authTokenUnreadable) return `Saved, but not used yet. ${WHATSAPP_TWILIO_TOKEN_UNREADABLE}`;
  if (view.enabled && !twilio && view.tokenUnreadable) return `Saved, but not used yet. ${WHATSAPP_TOKEN_UNREADABLE}`;
  if (view.enabled && !twilio && view.appSecretUnreadable) return `Saved, but not used yet. ${WHATSAPP_SECRET_UNREADABLE}`;
  if (view.enabled && view.missing.length) return `Saved, but not used yet: enter ${listed(view.missing)}.`;
  if (view.enabled) return view.sending.why ? `Saved. ${view.sending.why}` : 'Saved.';
  return 'Saved, switched off: no WhatsApp messages go out until it is switched on. The bell, push and email go on as before.';
}

/** The status at the top of the page: whether messages go out now, and what keeps them from going. */
export interface WhatsAppStatus {
  tone: 'ok' | 'neutral' | 'warn';
  headline: string;
  /** Said prominently: a saved token or app secret can't be read any more. */
  alert: string | null;
  notes: string[];
}

/** "3 of 34 templates approved". */
export function approvedText(templates: readonly WhatsAppTemplateStatusView[]): string {
  const approved = templates.filter((t) => t.status === 'approved').length;
  return `${approved} of ${templates.length} ${templates.length === 1 ? 'template' : 'templates'} approved`;
}

export function whatsappStatus(view: WhatsAppSettingsView): WhatsAppStatus {
  const twilio = view.provider === 'twilio';
  const alert = twilio
    ? view.twilio.authTokenUnreadable
      ? WHATSAPP_TWILIO_TOKEN_UNREADABLE
      : null
    : view.tokenUnreadable
      ? WHATSAPP_TOKEN_UNREADABLE
      : view.appSecretUnreadable
        ? WHATSAPP_SECRET_UNREADABLE
        : null;
  const notes: string[] = [];
  if (view.missing.length) notes.push(`To send, enter ${listed(view.missing)}.`);
  const templates = templatesFor(view, view.provider).templates;
  if (templates.length) notes.push(`${approvedText(templates)}${twilio ? ' on Twilio' : ''}: only approved templates are used; anything else goes by the bell, push and email only.`);
  if (view.sending.on) {
    if (twilio) {
      const from = view.twilio.senderKind === 'service' ? `, from the Messaging Service ${view.twilio.sender}` : view.twilio.sender ? ` from ${twilioSenderText(view.twilio.sender)}` : '';
      return { tone: 'ok', headline: `WhatsApp messages go out through Twilio${from}`, alert, notes };
    }
    return { tone: 'ok', headline: view.displayPhone ? `WhatsApp messages go out from ${view.displayPhone}` : 'WhatsApp messages go out', alert, notes };
  }
  if (!view.enabled) return { tone: 'neutral', headline: 'Switched off: no WhatsApp messages go out', alert, notes };
  return { tone: 'warn', headline: view.sending.why ? `Not sending: ${view.sending.why}` : 'Not sending yet', alert, notes };
}

/** A provider's templates and when they were last synced: Meta's, or Twilio's own (each keeps its own approval). */
export function templatesFor(view: WhatsAppSettingsView, provider: WhatsAppProvider): { templates: WhatsAppTemplateStatusView[]; syncedAt: string | null } {
  return provider === 'twilio' ? { templates: view.twilio.templates, syncedAt: view.twilio.templatesSyncedAt } : { templates: view.templates, syncedAt: view.templatesSyncedAt };
}

/**
 * What choosing the other provider on the form means, said before saving (the brief: "Say so on the page when
 * switching"): messages waiting go by it too, and only with its own approved templates; null when it isn't a switch.
 */
export function switchNote(view: WhatsAppSettingsView, chosen: WhatsAppProvider): string | null {
  if (chosen === view.provider) return null;
  const { templates } = templatesFor(view, chosen);
  const approved = templates.filter((t) => t.status === 'approved').length;
  const first = `Once saved, WhatsApp messages go through ${chosen === 'twilio' ? 'Twilio' : 'Meta directly'}, those already waiting too.`;
  if (!approved) {
    return `${first} None of ${chosen === 'twilio' ? 'Twilio’s' : 'Meta’s'} templates is approved yet, so nothing goes on WhatsApp until they are: submit them below and sync their status until they are approved. The bell, push and email go on meanwhile.`;
  }
  if (approved < templates.length) return `${first} ${approvedText(templates)} there: the others go by the bell, push and email only until they are approved.`;
  return first;
}

/** The last test, in words: "Last test 24/10/2026, 2:05 PM: …". `when`: how the page writes a moment. */
export function lastTestText(test: WhatsAppTestView, when: (iso: string) => string): string {
  return `Last test ${when(test.at)}: ${test.message}`;
}

/** The templates as the list shows them: by template, its two languages side by side (English first). */
export function templatesByKey(templates: readonly WhatsAppTemplateStatusView[]): { key: string; name: string; label: string; languages: WhatsAppTemplateStatusView[] }[] {
  const out = new Map<string, { key: string; name: string; label: string; languages: WhatsAppTemplateStatusView[] }>();
  for (const t of templates) {
    const row = out.get(t.key) ?? { key: t.key, name: t.name, label: t.label, languages: [] };
    row.languages.push(t);
    out.set(t.key, row);
  }
  for (const row of out.values()) row.languages.sort((a, b) => (a.language === b.language ? 0 : a.language === 'en' ? -1 : 1));
  return [...out.values()];
}
