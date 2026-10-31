// Signing in with a code by email (owner, 31 October 2026: "and i can add OTP via Mail for app login if the user didn't
// remember his password", "via app and web"): an active account's email gets a 6-digit code that works once, for 10
// minutes, and 5 tries; it is traded for an ordinary session, as a password is (the website or the app, by the user
// agent). Asking always gets the same answer, so it never says whether an account has the email; a wrong code counts as
// a failed sign-in (the sign-in's own lockout), and every refusal says the same. Pure: the API enforces these, and the
// website and the app say the same words.

/** How many digits a code has. */
export const LOGIN_CODE_DIGITS = 6;
/** How long a code works. */
export const LOGIN_CODE_MINUTES = 10;
/** How many tries one code takes before it stops working. */
export const LOGIN_CODE_TRIES = 5;
/** How soon a new code may be asked for after the last one for the same email. */
export const LOGIN_CODE_RESEND_SECONDS = 60;
/** Codes asked for an hour, for one email (more are quietly left unsent) and from one address (then refused). */
export const LOGIN_CODE_LIMITS = { perEmailHour: 5, perIpHour: 20 } as const;

/** The answer to asking, the same whether or not an account has the email. */
export const LOGIN_CODE_ANSWER = `If that email has an account, we sent it a ${LOGIN_CODE_DIGITS}-digit code. It works for ${LOGIN_CODE_MINUTES} minutes.`;
/** Every refusal of a code (wrong, expired, used, too many tries, or no account): the same, so none says more. */
export const LOGIN_CODE_REFUSED = 'That code isn’t right, or it has expired. Check the email, or ask for a new code.';
/** A code not written as one. */
export const LOGIN_CODE_FORMAT = `Enter the ${LOGIN_CODE_DIGITS}-digit code from the email.`;

/** What the AccessLinkRequest table counts asking by. */
export const LOGIN_CODE_REQUEST_KIND = 'login_code';

/** A code as typed: spaces and dashes out, Arabic-Indic (and Persian) digits as 0-9; null when it isn't 6 digits. */
export function loginCodeOf(typed: unknown): string | null {
  if (typeof typed !== 'string') return null;
  const code = typed
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\s-]/g, '');
  return new RegExp(`^\\d{${LOGIN_CODE_DIGITS}}$`).test(code) ? code : null;
}

/** A code as the email shows it: "482 913". */
export const loginCodeShown = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;

/** The email with a code: its subject and text, English then Arabic. */
export function loginCodeMail(code: string, name: string | null): { subject: string; text: string } {
  return {
    subject: 'Your People sign-in code',
    text: [
      name ? `Hello ${name},` : 'Hello,',
      '',
      `Your code to sign in to Trendlix People: ${loginCodeShown(code)}`,
      `It works once, for ${LOGIN_CODE_MINUTES} minutes.`,
      '',
      'If you didn’t ask for it, ignore this email: nobody can sign in without the code.',
      '',
      '—',
      '',
      name ? `مرحبًا ${name}،` : 'مرحبًا،',
      '',
      `رمز الدخول إلى Trendlix People: ${loginCodeShown(code)}`,
      `يعمل مرة واحدة لمدة ${LOGIN_CODE_MINUTES} دقائق.`,
      '',
      'إن لم تطلبه فتجاهل هذه الرسالة: لا يمكن لأحد الدخول دون الرمز.',
    ].join('\n'),
  };
}
