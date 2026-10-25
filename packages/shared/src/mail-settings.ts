// Email (SMTP) settings in the system (owner, 23 October 2026: "why dont we add SMTP setup in the organization setup").
// Until then email was set up only in the server's deploy/.env (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM),
// and a change needed a redeploy. Now: Organization → Email Settings, a Super Admin's only:
// - a provider preset fills the server, the port and the security (Google Workspace, Microsoft 365, Zoho Mail);
// - the password is kept encrypted, never shown again ("Set · Replace"), never sent to the browser, a developer or the
//   audit log;
// - "Send a test email" answers in plain words;
// - the server's deploy/.env stays as the fallback while the page isn't filled in and switched on.
// Pure code: the API checks a save with it, the web fills and checks the form with it. Tested in
// apps/api/src/mail/mail-settings.spec.ts.

import { isEmail, normalEmail } from './recruitment.js';

/** The email providers the page knows, and "another provider". */
export const MAIL_PROVIDERS = ['google', 'microsoft', 'zoho', 'other'] as const;
export type MailProvider = (typeof MAIL_PROVIDERS)[number];

export const MAIL_PROVIDER_LABELS: Readonly<Record<MailProvider, string>> = {
  google: 'Google Workspace',
  microsoft: 'Microsoft 365',
  zoho: 'Zoho Mail',
  other: 'Another provider',
};

/** How the connection to the server is secured: STARTTLS (usually 587), SSL from the start (usually 465), or none. */
export const MAIL_SECURITIES = ['starttls', 'ssl', 'none'] as const;
export type MailSecurity = (typeof MAIL_SECURITIES)[number];

export const MAIL_SECURITY_LABELS: Readonly<Record<MailSecurity, string>> = {
  starttls: 'STARTTLS (usually port 587)',
  ssl: 'SSL from the start (usually port 465)',
  none: 'None: not encrypted',
};

export const isMailProvider = (v: unknown): v is MailProvider => typeof v === 'string' && (MAIL_PROVIDERS as readonly string[]).includes(v);
export const isMailSecurity = (v: unknown): v is MailSecurity => typeof v === 'string' && (MAIL_SECURITIES as readonly string[]).includes(v);

/** What choosing a provider fills in, and the note shown under it. */
export interface MailPreset {
  host: string;
  port: number;
  security: MailSecurity;
  note: string;
}

/** The providers' sending servers (their own help pages): all three on 587 with STARTTLS. */
export const MAIL_PRESETS: Readonly<Record<Exclude<MailProvider, 'other'>, MailPreset>> = {
  google: {
    host: 'smtp.gmail.com',
    port: 587,
    security: 'starttls',
    note: 'Google needs an app password: turn on 2-step verification for the mailbox, make an app password in its Google account, and enter that here.',
  },
  microsoft: {
    host: 'smtp.office365.com',
    port: 587,
    security: 'starttls',
    note: 'Microsoft 365 needs SMTP AUTH (authenticated SMTP) turned on for the mailbox, in the Microsoft 365 admin center.',
  },
  // a company's own domain on a paid plan sends through smtppro (owner, 25 October 2026: offers to outside addresses were
  // refused through smtp.zoho.com, Zoho's server for personal and free accounts)
  zoho: {
    host: 'smtppro.zoho.com',
    port: 587,
    security: 'starttls',
    note: 'A company domain on a paid Zoho plan sends through smtppro.zoho.com; a personal or free account through smtp.zoho.com. Send from the mailbox you sign in with, or one of its aliases. If the account is on zoho.eu, zoho.in or another region, use its regional server instead, e.g. smtppro.zoho.eu.',
  },
};

/** The note under "Another provider". */
export const MAIL_OTHER_NOTE = 'Enter the sending (SMTP) server, port and security your email provider gives.';

/** The preset of a provider, or null for another provider. */
export const mailPreset = (provider: MailProvider): MailPreset | null => (provider === 'other' ? null : MAIL_PRESETS[provider]);

/** The note shown under the provider. */
export const mailProviderNote = (provider: MailProvider): string => mailPreset(provider)?.note ?? MAIL_OTHER_NOTE;

export const MAIL_LIMITS = { host: 253, username: 254, password: 256, fromName: 100, address: 254 } as const;

/** Where the system's emails are sent from now: its own settings, the server's (deploy/.env), or nowhere. */
export const MAIL_SOURCES = ['system', 'server', 'none'] as const;
export type MailSource = (typeof MAIL_SOURCES)[number];

export const MAIL_SOURCE_LABELS: Readonly<Record<MailSource, string>> = {
  system: 'the system’s settings',
  server: 'the server’s settings (deploy/.env)',
  none: 'not set up',
};

/** Said when the saved password was encrypted with a key the server no longer has (its JWT_SECRET changed). */
export const MAIL_PASSWORD_UNREADABLE = 'The saved password can’t be read any more: enter it again.';

/** The refusals: anyone but a Super Admin, and a Super Admin viewing as someone. */
export const MAIL_SETTINGS_SUPER_ADMIN_ONLY = 'Only a Super Admin can see or change the email settings.';
export const MAIL_SETTINGS_OWN_ACCOUNT = 'Switch back to your own account to see or change the email settings.';

/** The settings as GET /mail-settings answers them: never the password, its length or any part of it. */
export interface MailSettingsView {
  provider: MailProvider;
  host: string | null;
  port: number;
  security: MailSecurity;
  username: string | null;
  /** Whether a password is saved. */
  passwordSet: boolean;
  /** A password is saved but can't be read with the server's key any more (MAIL_PASSWORD_UNREADABLE). */
  passwordUnreadable: boolean;
  fromName: string | null;
  fromAddress: string | null;
  replyTo: string | null;
  /** "Send the system's emails with these settings". */
  enabled: boolean;
  /** What the settings lack to be used, in words ("the server", "the password"); empty when complete. */
  missing: string[];
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
  lastTest: MailTestView | null;
  /** Where emails are sent from now, and the sender they carry ("TrendLIX HR <hr@trendlix.com>"), null when none. */
  sending: { source: MailSource; from: string | null; address: string | null };
}

/** A test email's result: sent, or why not in plain words. */
export interface MailTestView {
  at: string;
  ok: boolean;
  message: string;
}

/** What PUT /mail-settings takes. An empty or left-out password keeps the saved one. */
export interface MailSettingsInput {
  provider: MailProvider;
  host: string | null;
  port: number;
  security: MailSecurity;
  username: string | null;
  password?: string | null;
  fromName: string | null;
  fromAddress: string | null;
  replyTo: string | null;
  enabled: boolean;
}

/** What POST /mail-settings/test takes: where to (default: the signed-in user), and the form's values to test. */
export interface MailTestInput extends Omit<MailSettingsInput, 'enabled'> {
  to?: string | null;
}

const HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Whether a text is a server's name or an IPv4 address (smtp.gmail.com, 10.0.0.5). */
export const isMailHost = (v: string): boolean => HOST.test(v);

/** An email address as kept (trimmed, lower case), or null when empty. */
export const mailAddress = (v: string | null | undefined): string | null => {
  const t = typeof v === 'string' ? normalEmail(v) : '';
  return t ? t : null;
};

/**
 * What is wrong with the settings to save or test, in words; empty when fine. `passwordSaved`: a password is saved and
 * readable, so an empty one keeps it. `forTest`: the test needs a complete set whether switched on or not.
 */
export function mailSettingsProblems(input: Partial<MailSettingsInput>, opts: { passwordSaved: boolean; forTest?: boolean }): string[] {
  const out: string[] = [];
  if (!isMailProvider(input.provider)) out.push('Choose the email provider.');
  const host = input.host?.trim() ?? '';
  if (host && !isMailHost(host)) out.push('Write the server’s name, e.g. smtp.gmail.com.');
  if (typeof input.port !== 'number' || !Number.isInteger(input.port) || input.port < 1 || input.port > 65535) out.push('The port is a whole number from 1 to 65535, usually 587 or 465.');
  if (!isMailSecurity(input.security)) out.push('Choose how the connection is secured.');
  const username = input.username?.trim() ?? '';
  if (username.length > MAIL_LIMITS.username || CONTROL.test(username)) out.push(`Write the username on one line, ${MAIL_LIMITS.username} characters or fewer.`);
  const password = input.password ?? '';
  if (password.length > MAIL_LIMITS.password) out.push(`Keep the password to ${MAIL_LIMITS.password} characters or fewer.`);
  if (/[\r\n]/.test(password)) out.push('Write the password on one line.');
  const fromName = input.fromName?.trim() ?? '';
  if (fromName.length > MAIL_LIMITS.fromName || CONTROL.test(fromName)) out.push(`Write the sender’s name on one line, ${MAIL_LIMITS.fromName} characters or fewer.`);
  const from = mailAddress(input.fromAddress);
  if (from && !isEmail(from)) out.push('Write the sender’s address in full, e.g. hr@trendlix.com.');
  const replyTo = mailAddress(input.replyTo);
  if (replyTo && !isEmail(replyTo)) out.push('Write the reply-to address in full, e.g. hr@trendlix.com, or leave it empty.');
  // switched off, they may be saved unfinished: the page says what they lack
  if (input.enabled || opts.forTest) {
    const lacking = mailMissing({ host, fromAddress: from, username, password: !!password || opts.passwordSaved });
    if (lacking.length) out.push(`${opts.forTest ? 'To send a test email' : 'To send emails with these settings'}, enter ${listed(lacking)}.`);
  }
  if (!username && password) out.push('Enter the username the password goes with.');
  return out;
}

/** What the settings lack to be used, in words, in the form's order; empty when complete. */
export function mailMissing(s: { host: string | null; fromAddress: string | null; username: string | null; password: boolean }): string[] {
  const out: string[] = [];
  if (!s.host?.trim()) out.push('the server');
  if (s.username?.trim() && !s.password) out.push('the password');
  if (!s.fromAddress?.trim()) out.push('the sender’s address');
  return out;
}

/** "the server, the password and the sender’s address". */
export function listed(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** A sender as an email shows it: "TrendLIX HR <hr@trendlix.com>", or the address alone. */
export function mailFromText(name: string | null | undefined, address: string): string {
  const n = name?.trim();
  return n ? `${n} <${address}>` : address;
}

/** The address in a sender written "Name <address>" (MAIL_FROM), or the text itself when it is an address. */
export function addressOfSender(from: string | null | undefined): string | null {
  if (!from) return null;
  const m = /<([^<>\s]+@[^<>\s]+)>\s*$/.exec(from);
  const address = (m ? m[1] : from).trim().toLowerCase();
  return address.includes('@') ? address : null;
}
