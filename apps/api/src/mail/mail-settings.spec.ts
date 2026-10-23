import {
  addressOfSender,
  listed,
  MAIL_PRESETS,
  mailFromText,
  mailMissing,
  mailPreset,
  mailProviderNote,
  mailSettingsProblems,
  MAIL_OTHER_NOTE,
  type MailSettingsInput,
} from '@trendlix/shared';
import { keyIdOf, mailKeyOf, openSecret, sameKey, sealSecret } from './mail-secret.js';
import { smtpProblem, transportOptions } from './smtp-problems.js';

// Email (SMTP) settings in the system (owner, 23 October 2026: "why dont we add SMTP setup in the organization setup"):
// the password sealed and opened, the plain words of a failed send, the providers' presets and what a save needs.

/** An error as nodemailer's SMTPConnection makes it (_formatError): its code, the server's answer, the command. */
function smtpError(message: string, code: string, response?: string, command?: string) {
  const err = new Error(response ? `${message}: ${response}` : message) as Error & { code: string; response?: string; responseCode?: number; command?: string };
  err.code = code;
  if (response) {
    err.response = response;
    err.responseCode = Number(/^\d+/.exec(response)?.[0]);
  }
  if (command) err.command = command;
  return err;
}

describe('the saved password', () => {
  const key = mailKeyOf('a-jwt-secret-for-the-tests-only-0123456789');

  it('is sealed as v1:iv:tag:ciphertext with a new IV each time, and opens again', () => {
    const a = sealSecret('app-pass word ü 🔑', key);
    const b = sealSecret('app-pass word ü 🔑', key);
    expect(a).toMatch(/^v1:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(b);
    expect(a.split(':')[1]).not.toBe(b.split(':')[1]);
    expect(a).not.toContain('app-pass');
    expect(openSecret(a, key)).toBe('app-pass word ü 🔑');
    expect(openSecret(b, key)).toBe('app-pass word ü 🔑');
  });

  it('fails cleanly (null) with another key, changed, or not a sealed value', () => {
    const sealed = sealSecret('secret', key);
    expect(openSecret(sealed, mailKeyOf('another-secret'))).toBeNull();
    const [v, iv, tag, data] = sealed.split(':');
    const flipped = Buffer.from(data, 'base64url');
    flipped[0] ^= 1;
    expect(openSecret([v, iv, tag, flipped.toString('base64url')].join(':'), key)).toBeNull();
    expect(openSecret([v, iv, Buffer.alloc(16).toString('base64url'), data].join(':'), key)).toBeNull();
    expect(openSecret(`v2:${iv}:${tag}:${data}`, key)).toBeNull();
    for (const bad of ['', 'secret', 'v1:a:b', 'v1:!!:??:**', null, undefined]) expect(openSecret(bad, key)).toBeNull();
  });

  it('is derived from the secret alone (the same secret, the same key), and its fingerprint says which key without being it', () => {
    expect(mailKeyOf('s').equals(mailKeyOf('s'))).toBe(true);
    expect(mailKeyOf('s').equals(mailKeyOf('t'))).toBe(false);
    expect(mailKeyOf('s')).toHaveLength(32);
    expect(() => mailKeyOf('')).toThrow();
    const id = keyIdOf(key);
    expect(id).toMatch(/^[0-9a-f]{12}$/);
    expect(key.toString('hex')).not.toContain(id);
    expect(sameKey(id, key)).toBe(true);
    expect(sameKey(id, mailKeyOf('another-secret'))).toBe(false);
    expect(sameKey(null, key)).toBe(false);
    expect(sameKey('short', key)).toBe(false);
  });
});

describe('a failed send in plain words', () => {
  const at = { host: 'smtp.example.com', port: 587 };

  it('says the sign-in was refused, with the provider’s own step when it is known', () => {
    expect(smtpProblem(smtpError('Invalid login', 'EAUTH', '535 5.7.8 Username and Password not accepted', 'AUTH PLAIN'), at)).toBe('The username or password was refused.');
    expect(smtpProblem(smtpError('Invalid login', 'EAUTH', '535 5.7.3 Authentication unsuccessful', 'AUTH LOGIN'), at)).toBe('The username or password was refused.');
    expect(smtpProblem(smtpError('Invalid login', 'EAUTH', '534-5.7.9 Application-specific password required.', 'AUTH PLAIN'), { ...at, provider: 'google' })).toBe(
      'The username or password was refused: Google needs an app password, with 2-step verification on for the mailbox.',
    );
    expect(
      smtpProblem(smtpError('Invalid login', 'EAUTH', '535 5.7.139 Authentication unsuccessful, SmtpClientAuthentication is disabled for the Tenant.', 'AUTH LOGIN'), at),
    ).toBe('The username or password was refused: Microsoft 365 also needs SMTP AUTH turned on for the mailbox.');
    expect(smtpProblem(smtpError('Missing credentials for "PLAIN"', 'EAUTH', undefined, 'API'), at)).toBe('The server asks for a username and password: enter them.');
    expect(smtpProblem(smtpError("Can't send mail", 'EENVELOPE', '530 5.7.0 Authentication Required', 'MAIL FROM'), at)).toBe(
      'The server asks for a username and password: enter them.',
    );
  });

  it('says the server couldn’t be reached, by name and port', () => {
    expect(smtpProblem(smtpError('connect ECONNREFUSED 10.0.0.5:587', 'ESOCKET', undefined, 'CONN'), at)).toBe('Couldn’t reach smtp.example.com on port 587.');
    expect(smtpProblem(smtpError('Connection timeout', 'ETIMEDOUT', undefined, 'CONN'), at)).toBe('Couldn’t reach smtp.example.com on port 587.');
    expect(smtpProblem(smtpError('Connection closed unexpectedly', 'ECONNECTION', undefined, 'CONN'), { host: 'smtp.zoho.com', port: 2525 })).toBe(
      'Couldn’t reach smtp.zoho.com on port 2525.',
    );
    expect(smtpProblem(smtpError('getaddrinfo ENOTFOUND smtp.example.com', 'EDNS', undefined, 'CONN'), at)).toBe(
      'Couldn’t reach smtp.example.com on port 587: there is no server by that name.',
    );
  });

  it('says the secure connection failed, with the two usual pairs', () => {
    const said = 'The secure connection failed: try port 465 with SSL, or 587 with STARTTLS.';
    expect(smtpProblem(smtpError('Error upgrading connection with STARTTLS', 'ETLS', '502 5.5.1 Unrecognized command', 'STARTTLS'), at)).toBe(said);
    expect(smtpProblem(smtpError('140245:error:0A00010B:SSL routines:ssl3_get_record:wrong version number', 'ESOCKET', undefined, 'CONN'), at)).toBe(said);
    expect(smtpProblem(smtpError('Greeting never received', 'ETIMEDOUT', undefined, 'CONN'), { ...at, port: 465 })).toBe(said);
    expect(smtpProblem(smtpError('self-signed certificate in certificate chain', 'ESOCKET', undefined, 'CONN'), at)).toBe(said);
  });

  it('says the sender isn’t allowed for the mailbox, on MAIL FROM or after the message', () => {
    const said = 'The sender address isn’t allowed for this mailbox.';
    expect(smtpProblem(smtpError('Mail command failed', 'EENVELOPE', '553 5.7.1 Sender address rejected: not owned by user hr@example.com', 'MAIL FROM'), at)).toBe(said);
    expect(smtpProblem(smtpError('Mail command failed', 'EENVELOPE', '550 5.7.60 SMTP; Client does not have permissions to send as this sender', 'MAIL FROM'), at)).toBe(said);
    expect(smtpProblem(smtpError('Message failed', 'EMESSAGE', '554 5.2.252 SendAsDenied; hr@example.com not allowed to send as ceo@example.com', 'DATA'), at)).toBe(said);
  });

  it('says a refused recipient, and else gives the server’s own words, short and on one line', () => {
    expect(smtpProblem(smtpError('Recipient command failed', 'EENVELOPE', '550 5.1.1 No such user', 'RCPT TO'), at)).toBe('The email server refused to send to that address.');
    expect(smtpProblem(smtpError('Message failed', 'EMESSAGE', '552 5.3.4 Message\r\n too big', 'DATA'), at)).toBe('The email couldn’t be sent: the server said “552 5.3.4 Message too big”.');
    const long = smtpProblem(smtpError('Message failed', 'EMESSAGE', `451 ${'x'.repeat(400)}`, 'DATA'), at);
    expect(long.length).toBeLessThan(260);
    expect(smtpProblem('not an error', at)).toBe('The email couldn’t be sent: the server said “not an error”.');
  });
});

describe('the providers’ presets', () => {
  it('fill the server, port and security of each, with a note', () => {
    expect(MAIL_PRESETS).toEqual({
      google: expect.objectContaining({ host: 'smtp.gmail.com', port: 587, security: 'starttls' }),
      microsoft: expect.objectContaining({ host: 'smtp.office365.com', port: 587, security: 'starttls' }),
      zoho: expect.objectContaining({ host: 'smtp.zoho.com', port: 587, security: 'starttls' }),
    });
    expect(mailProviderNote('google')).toMatch(/app password.*2-step verification/);
    expect(mailProviderNote('microsoft')).toMatch(/SMTP AUTH/);
    expect(mailProviderNote('zoho')).toMatch(/zoho\.eu.*regional/);
    expect(mailPreset('other')).toBeNull();
    expect(mailProviderNote('other')).toBe(MAIL_OTHER_NOTE);
  });
});

describe('what a save needs', () => {
  const full: MailSettingsInput = {
    provider: 'google',
    host: 'smtp.gmail.com',
    port: 587,
    security: 'starttls',
    username: 'hr@trendlix.com',
    password: 'app-password',
    fromName: 'TrendLIX HR',
    fromAddress: 'hr@trendlix.com',
    replyTo: null,
    enabled: true,
  };

  it('takes a full set, and an empty password while one is saved', () => {
    expect(mailSettingsProblems(full, { passwordSaved: false })).toEqual([]);
    expect(mailSettingsProblems({ ...full, password: '' }, { passwordSaved: true })).toEqual([]);
    // a server without sign-in (an office relay): no username, no password
    expect(mailSettingsProblems({ ...full, username: null, password: null, security: 'none', port: 25 }, { passwordSaved: false })).toEqual([]);
  });

  it('switched on, needs the server, the password for a username and the sender’s address; switched off, saves unfinished', () => {
    expect(mailSettingsProblems({ ...full, host: '', password: '', fromAddress: '' }, { passwordSaved: false })).toEqual([
      'To send emails with these settings, enter the server, the password and the sender’s address.',
    ]);
    expect(mailSettingsProblems({ ...full, host: '', password: '', fromAddress: '', enabled: false }, { passwordSaved: false })).toEqual([]);
    expect(mailSettingsProblems({ ...full, password: '', enabled: false }, { passwordSaved: false, forTest: true })).toEqual(['To send a test email, enter the password.']);
  });

  it('refuses what can’t be right', () => {
    expect(mailSettingsProblems({ ...full, host: 'smtp gmail', port: 70000, fromAddress: 'hr@', replyTo: 'nobody' }, { passwordSaved: false })).toEqual([
      'Write the server’s name, e.g. smtp.gmail.com.',
      'The port is a whole number from 1 to 65535, usually 587 or 465.',
      'Write the sender’s address in full, e.g. hr@trendlix.com.',
      'Write the reply-to address in full, e.g. hr@trendlix.com, or leave it empty.',
    ]);
    expect(mailSettingsProblems({ ...full, username: null }, { passwordSaved: false })).toEqual(['Enter the username the password goes with.']);
    expect(mailSettingsProblems({ ...full, password: 'two\nlines' }, { passwordSaved: false })).toEqual(['Write the password on one line.']);
    expect(mailSettingsProblems({ ...full, provider: 'yahoo' as never, security: 'tls' as never }, { passwordSaved: false })).toEqual([
      'Choose the email provider.',
      'Choose how the connection is secured.',
    ]);
  });

  it('says what is missing, the sender and the list in words', () => {
    expect(mailMissing({ host: 'smtp.zoho.com', fromAddress: 'hr@x.com', username: 'hr@x.com', password: false })).toEqual(['the password']);
    expect(mailMissing({ host: 'smtp.zoho.com', fromAddress: 'hr@x.com', username: null, password: false })).toEqual([]);
    expect(listed(['the server'])).toBe('the server');
    expect(listed(['a', 'b', 'c'])).toBe('a, b and c');
    expect(mailFromText('TrendLIX HR', 'hr@trendlix.com')).toBe('TrendLIX HR <hr@trendlix.com>');
    expect(mailFromText(' ', 'hr@trendlix.com')).toBe('hr@trendlix.com');
    expect(addressOfSender('"TrendLIX HR" <HR@trendlix.com>')).toBe('hr@trendlix.com');
    expect(addressOfSender('hr@trendlix.com')).toBe('hr@trendlix.com');
    expect(addressOfSender('TrendLIX HR')).toBeNull();
  });
});

describe('the connection’s options', () => {
  it('SSL from the start, STARTTLS required, or neither; never a log of the sign-in', () => {
    const base = { host: 'smtp.example.com', port: 465, username: 'hr@example.com', password: 'pw' };
    expect(transportOptions({ ...base, security: 'ssl' })).toMatchObject({ secure: true, requireTLS: false, ignoreTLS: false, auth: { user: 'hr@example.com', pass: 'pw' } });
    expect(transportOptions({ ...base, port: 587, security: 'starttls' })).toMatchObject({ secure: false, requireTLS: true, ignoreTLS: false });
    expect(transportOptions({ ...base, port: 25, security: 'none', username: null })).toMatchObject({ secure: false, requireTLS: false, ignoreTLS: true, auth: undefined });
    expect(transportOptions({ ...base, security: 'ssl' })).toMatchObject({ logger: false, debug: false });
  });
});
