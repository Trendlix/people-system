import {
  isMailProvider,
  isMailSecurity,
  listed,
  MAIL_PASSWORD_UNREADABLE,
  mailSettingsProblems,
  type MailProvider,
  type MailSecurity,
  type MailSettingsInput,
  type MailSettingsView,
  type MailTestInput,
  type MailTestView,
} from '@trendlix/shared';
import type { FormState } from '@/lib/types';

// Organization → Email Settings (owner, 23 October 2026: "why dont we add SMTP setup in the organization setup"): what
// the page's form sends, and what the page says. Pure code, tested (settings.test.ts); the API checks every request
// again (packages/shared mail-settings.ts).

/** What the form's action answers: a save's message, a refusal's reasons, and a test email's result. */
export interface MailFormState extends FormState {
  test?: MailTestView;
  /** Bumped by each save that went through, so the form closes the password box it had open. */
  saved?: number;
}

/** The buttons of the one form: Save, Send a test email, Remove the saved password. */
export const MAIL_INTENTS = ['save', 'test', 'remove'] as const;
export type MailIntent = (typeof MAIL_INTENTS)[number];

export const intentOf = (fd: FormData): MailIntent => {
  const v = fd.get('intent');
  return v === 'test' || v === 'remove' ? v : 'save';
};

const text = (fd: FormData, key: string): string => {
  const v = fd.get(key);
  return typeof v === 'string' ? v.trim() : '';
};

/** The password as typed: never trimmed (a space may be part of it); empty when the box isn't there or left empty. */
const passwordOf = (fd: FormData): string => {
  const v = fd.get('password');
  return typeof v === 'string' ? v : '';
};

/** "587" → 587; anything that isn't a whole number → NaN (the shared check says so). */
export function portOf(value: string): number {
  return /^\d{1,5}$/.test(value.trim()) ? Number(value.trim()) : Number.NaN;
}

/** The values the form's fields hold, as both a save and a test send them (an empty password left out: the saved one). */
function fieldsOf(fd: FormData): Omit<MailSettingsInput, 'enabled'> {
  const provider = text(fd, 'provider');
  const security = text(fd, 'security');
  const password = passwordOf(fd);
  return {
    provider: (isMailProvider(provider) ? provider : '') as MailProvider,
    host: text(fd, 'host') || null,
    port: portOf(text(fd, 'port')),
    security: (isMailSecurity(security) ? security : '') as MailSecurity,
    username: text(fd, 'username') || null,
    ...(password && { password }),
    fromName: text(fd, 'fromName') || null,
    fromAddress: text(fd, 'fromAddress').toLowerCase() || null,
    replyTo: text(fd, 'replyTo').toLowerCase() || null,
  };
}

/** Whether a readable password is saved (a hidden field the page fills): an empty box keeps it. */
const passwordSaved = (fd: FormData): boolean => fd.get('passwordSaved') === 'true';

/** PUT /mail-settings's body from the form, with what is wrong with it (the shared checks, as the API makes them). */
export function mailSettingsBody(fd: FormData): { body: MailSettingsInput; errors: string[] } {
  // a hidden "false" before the box, so switching it off is sent too
  const body: MailSettingsInput = { ...fieldsOf(fd), enabled: fd.getAll('enabled').includes('true') };
  return { body, errors: mailSettingsProblems(body, { passwordSaved: passwordSaved(fd) }) };
}

/**
 * POST /mail-settings/test's body from the form: the values as they are on screen, saved or not, so the settings can
 * be tried before they are saved or switched on; an empty password box means the saved one. `to`: "Send the test to",
 * left out when empty (the API sends it to the signed-in user).
 */
export function mailTestBody(fd: FormData): { body: MailTestInput; errors: string[] } {
  const to = text(fd, 'testTo').toLowerCase();
  const body: MailTestInput = { ...fieldsOf(fd), ...(to && { to }) };
  return { body, errors: mailSettingsProblems(body, { passwordSaved: passwordSaved(fd), forTest: true }) };
}

/** What a save that went through says, by where emails are sent from now. */
export function savedMessage(view: MailSettingsView): string {
  if (view.enabled && view.sending.source === 'system') return 'Saved. The system’s emails are sent with these settings from now on.';
  if (view.enabled && view.passwordUnreadable) return `Saved, but not used yet. ${MAIL_PASSWORD_UNREADABLE}`;
  if (view.enabled && view.missing.length) return `Saved, but not used yet: enter ${listed(view.missing)}.`;
  if (view.enabled) return 'Saved.';
  return view.sending.source === 'server' ? 'Saved, switched off: the server’s settings are used meanwhile.' : 'Saved, switched off: nothing is emailed until they are switched on.';
}

/** The status at the top of the page: where emails are sent from now, and what keeps these settings from being used. */
export interface MailStatus {
  tone: 'ok' | 'neutral' | 'warn';
  headline: string;
  /** Said prominently: the saved password can't be read any more. */
  alert: string | null;
  notes: string[];
}

export function mailStatus(view: MailSettingsView): MailStatus {
  const { source, address } = view.sending;
  const alert = view.passwordUnreadable ? MAIL_PASSWORD_UNREADABLE : null;
  const notes: string[] = [];
  if (view.enabled && view.missing.length && source !== 'system') notes.push(`These settings are switched on but not used yet: enter ${listed(view.missing)}.`);
  if (!view.enabled && view.host) notes.push('These settings are saved but switched off.');
  if (source === 'system') return { tone: 'ok', headline: address ? `Emails are sent from ${address}` : 'Emails are sent with the system’s settings', alert, notes };
  if (source === 'server') {
    notes.push('They come from the server’s deploy/.env, until the settings below are filled in and switched on.');
    return { tone: 'neutral', headline: address ? `Using the server’s settings: emails are sent from ${address}` : 'Using the server’s settings', alert, notes };
  }
  return { tone: 'warn', headline: 'Not set up: nothing is emailed', alert, notes };
}

/** The last test, in words: "Last test 23/10/2026, 2:05 PM: …". `when`: how the page writes a moment. */
export function lastTestText(test: MailTestView, when: (iso: string) => string): string {
  return `Last test ${when(test.at)}: ${test.message}`;
}
