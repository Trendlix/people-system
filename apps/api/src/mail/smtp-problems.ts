import type { MailProvider, MailSecurity } from '@trendlix/shared';
import type { SMTPTransportOptions } from 'nodemailer';

// How the system's email settings (Organization → Email Settings; owner, 23 October 2026: "why dont we add SMTP setup
// in the organization setup") become an SMTP connection, and what a failed send means in plain words (the plan told to
// the owner: a "Send a test email" button "with the result in plain words"). Pure code, tested in mail-settings.spec.ts.

/** The settings an SMTP connection is made with: the password opened, only to send. */
export interface SmtpSettings {
  host: string;
  port: number;
  security: MailSecurity;
  username: string | null;
  password: string | null;
}

/** How long a connection may take before it is given up: a test answers within a minute at worst. */
export const SMTP_TIMEOUTS = { connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 45_000 } as const;

/**
 * nodemailer's options for the settings: SSL from the start (465), STARTTLS required (587: never sent in plain text if
 * the server doesn't offer it), or none (not encrypted, STARTTLS not tried). Never its logger or debug output, which
 * would write the sign-in to the log.
 */
export function transportOptions(s: SmtpSettings): SMTPTransportOptions {
  return {
    host: s.host,
    port: s.port,
    secure: s.security === 'ssl',
    requireTLS: s.security === 'starttls',
    ignoreTLS: s.security === 'none',
    auth: s.username ? { user: s.username, pass: s.password ?? '' } : undefined,
    ...SMTP_TIMEOUTS,
    logger: false,
    debug: false,
  };
}

/** What nodemailer says of a failure (SMTPConnection's errors): its kind, the server's answer, the command it was at. */
interface SmtpError {
  code?: string;
  responseCode?: number;
  response?: string;
  command?: string;
  message?: string;
}

const TLS_WORDS = /wrong version number|ssl|tls|certificate|handshake|EPROTO|self[- ]signed|unable to verify|greeting never received/i;
const NOT_FOUND = /ENOTFOUND|EAI_AGAIN|EAI_NONAME|getaddrinfo/i;
const UNREACHABLE = /ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ECONNRESET|ETIMEDOUT|timeout/i;
/** The server won't pass mail on outside its own domain (owner, 25 October 2026: Zoho's "553 Relaying disallowed"). */
const RELAY_REFUSED = /relaying disallowed|relay(ing)? (access )?denied|not permitted to relay|unable to relay|relay not permitted/i;
const SENDER_REFUSED = /SendAsDenied|not allowed to send as|send as|sender address rejected|not owned by user|sender .*(not|isn.t) allowed|5\.7\.60|5\.2\.252|5\.7\.1 .*sender/i;
const MICROSOFT_AUTH_OFF = /SmtpClientAuthentication|5\.7\.139/i;
const GOOGLE_APP_PASSWORD = /Application-specific password|InvalidSecondFactor|534[- ]5\.7\.9/i;

/** The server's own words, on one line and short, for a failure the mapping doesn't know. */
function serverWords(e: SmtpError): string {
  const text = (e.response || e.message || 'no answer').replace(/\s+/g, ' ').trim();
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

/**
 * Why an email couldn't be sent, in plain words, from nodemailer's error: the sign-in refused, the server not reached,
 * the secure connection failed, the sender not allowed, or else the server's own words. Never the password: nodemailer's
 * errors carry the server's answers, never the sign-in sent.
 */
export function smtpProblem(err: unknown, at: { host: string; port: number; provider?: MailProvider }): string {
  const e = (err && typeof err === 'object' ? err : { message: String(err) }) as SmtpError;
  const code = e.code ?? '';
  const said = `${e.response ?? ''} ${e.message ?? ''}`;
  const command = e.command ?? '';
  const reach = `Couldn’t reach ${at.host} on port ${at.port}`;

  // the sign-in: refused (535, or 534 with Google's "application-specific password"), or the server asked for one
  if (code === 'EAUTH' || code === 'ENOAUTH' || command.startsWith('AUTH')) {
    if (MICROSOFT_AUTH_OFF.test(said)) return 'The username or password was refused: Microsoft 365 also needs SMTP AUTH turned on for the mailbox.';
    if (GOOGLE_APP_PASSWORD.test(said) || (at.provider === 'google' && e.responseCode === 534)) {
      return 'The username or password was refused: Google needs an app password, with 2-step verification on for the mailbox.';
    }
    if (/Missing credentials/i.test(said)) return 'The server asks for a username and password: enter them.';
    return 'The username or password was refused.';
  }

  // the secure connection: STARTTLS refused or failed, a certificate not trusted, or SSL and plain text crossed (465 and
  // 587 swapped: one side waits for the other's greeting)
  if (code === 'ETLS' || ((code === 'ESOCKET' || code === 'ECONNECTION' || code === 'ETIMEDOUT') && TLS_WORDS.test(said))) {
    return 'The secure connection failed: try port 465 with SSL, or 587 with STARTTLS.';
  }

  // the server not reached: no such name, refused, or no answer
  if (code === 'EDNS' || NOT_FOUND.test(said)) return `${reach}: there is no server by that name.`;
  if (code === 'ECONNECTION' || code === 'ESOCKET' || code === 'ETIMEDOUT' || UNREACHABLE.test(said)) return `${reach}.`;

  // the envelope: the sender refused (MAIL FROM, or after the message as Microsoft does), or the recipient
  if (e.responseCode === 530 || /authentication required/i.test(said)) return 'The server asks for a username and password: enter them.';
  // mail inside the company goes, outside it is refused: Zoho's personal server for a company domain, or a sender that
  // isn't the mailbox signed in with
  if (RELAY_REFUSED.test(said)) {
    if (at.provider === 'zoho' || /zoho/i.test(at.host)) {
      return 'Zoho refused to send outside the company (“Relaying disallowed”): a company domain on a paid Zoho plan sends through smtppro.zoho.com, from the mailbox you sign in with or one of its aliases.';
    }
    return 'The email server refused to send outside the company (it doesn’t relay): check the server, and send from the mailbox you sign in with or one of its aliases.';
  }
  if ((code === 'EENVELOPE' && command === 'MAIL FROM') || SENDER_REFUSED.test(said)) return 'The sender address isn’t allowed for this mailbox.';
  if (code === 'EENVELOPE' && command === 'RCPT TO') return 'The email server refused to send to that address.';

  return `The email couldn’t be sent: the server said “${serverWords(e)}”.`;
}
