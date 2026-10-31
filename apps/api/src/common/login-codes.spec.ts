import { LOGIN_CODE_ANSWER, loginCodeMail, loginCodeOf, loginCodeShown } from '@trendlix/shared';

// Signing in with a code by email (owner, 31 October 2026: "and i can add OTP via Mail for app login if the user didn't
// remember his password"; packages/shared login-codes.ts): a code as typed, as the email shows it, and the email.

describe('a sign-in code', () => {
  it('is 6 digits as typed: spaces and dashes out, Arabic-Indic and Persian digits taken', () => {
    expect(loginCodeOf('482913')).toBe('482913');
    expect(loginCodeOf(' 482 913 ')).toBe('482913');
    expect(loginCodeOf('482-913')).toBe('482913');
    expect(loginCodeOf('٤٨٢٩١٣')).toBe('482913');
    expect(loginCodeOf('۴۸۲۹۱۳')).toBe('482913');
    expect(loginCodeOf('48291')).toBeNull();
    expect(loginCodeOf('4829134')).toBeNull();
    expect(loginCodeOf('48a913')).toBeNull();
    expect(loginCodeOf(482913)).toBeNull();
  });

  it('is shown in two threes, in an email in English then Arabic', () => {
    expect(loginCodeShown('482913')).toBe('482 913');
    const m = loginCodeMail('482913', 'Mona Adel');
    expect(m.subject).toBe('Your People sign-in code');
    expect(m.text.split('\n').slice(0, 5)).toEqual([
      'Hello Mona Adel,',
      '',
      'Your code to sign in to Trendlix People: 482 913',
      'It works once, for 10 minutes.',
      '',
    ]);
    expect(m.text).toContain('If you didn’t ask for it, ignore this email: nobody can sign in without the code.');
    expect(m.text).toContain('رمز الدخول إلى Trendlix People: 482 913');
    expect(loginCodeMail('000001', null).text.startsWith('Hello,')).toBe(true);
    expect(LOGIN_CODE_ANSWER).toBe('If that email has an account, we sent it a 6-digit code. It works for 10 minutes.');
  });
});
