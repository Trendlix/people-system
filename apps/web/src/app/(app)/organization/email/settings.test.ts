import { MAIL_PASSWORD_UNREADABLE, type MailSettingsView } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { intentOf, lastTestText, mailSettingsBody, mailStatus, mailTestBody, portOf, savedMessage } from './settings';

// Organization → Email Settings (owner, 23 October 2026: "why dont we add SMTP setup in the organization setup"): what
// the form sends, and what the page says about where emails are sent from.

/** The form as the page sends it: the hidden "false" before the switch, and the switch's "true" when on. */
function form(values: Record<string, string>, opts: { enabled?: boolean; passwordSaved?: boolean; intent?: string } = {}): FormData {
  const fd = new FormData();
  if (opts.intent) fd.set('intent', opts.intent);
  fd.set('passwordSaved', String(opts.passwordSaved ?? false));
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  fd.append('enabled', 'false');
  if (opts.enabled) fd.append('enabled', 'true');
  return fd;
}

const filled = {
  provider: 'google',
  host: ' smtp.gmail.com ',
  port: '587',
  security: 'starttls',
  username: 'hr@trendlix.com',
  password: ' app pass ',
  fromName: 'TrendLIX HR',
  fromAddress: 'HR@Trendlix.com',
  replyTo: '',
};

const view = (over: Partial<MailSettingsView> = {}): MailSettingsView => ({
  provider: 'google',
  host: 'smtp.gmail.com',
  port: 587,
  security: 'starttls',
  username: 'hr@trendlix.com',
  passwordSet: true,
  passwordUnreadable: false,
  fromName: 'TrendLIX HR',
  fromAddress: 'hr@trendlix.com',
  replyTo: null,
  enabled: true,
  missing: [],
  updatedAt: '2026-10-23T10:00:00.000Z',
  updatedBy: { id: 'u1', name: 'Hazem Magdy' },
  lastTest: null,
  sending: { source: 'system', from: 'TrendLIX HR <hr@trendlix.com>', address: 'hr@trendlix.com' },
  ...over,
});

describe('the buttons', () => {
  it('tells Save, Send a test email and Remove the saved password apart; Enter saves', () => {
    expect(intentOf(form({}, { intent: 'test' }))).toBe('test');
    expect(intentOf(form({}, { intent: 'remove' }))).toBe('remove');
    expect(intentOf(form({}, { intent: 'save' }))).toBe('save');
    expect(intentOf(form({}))).toBe('save');
  });
});

describe('mailSettingsBody', () => {
  it('sends the values tidied: trimmed, the addresses in lower case, the port a number; the password as typed', () => {
    const { body, errors } = mailSettingsBody(form(filled, { enabled: true }));
    expect(errors).toEqual([]);
    expect(body).toEqual({
      provider: 'google',
      host: 'smtp.gmail.com',
      port: 587,
      security: 'starttls',
      username: 'hr@trendlix.com',
      password: ' app pass ',
      fromName: 'TrendLIX HR',
      fromAddress: 'hr@trendlix.com',
      replyTo: null,
      enabled: true,
    });
  });

  it('leaves the password out when the box is empty or not there: the saved one is kept', () => {
    const { body, errors } = mailSettingsBody(form({ ...filled, password: '' }, { enabled: true, passwordSaved: true }));
    expect(errors).toEqual([]);
    expect(body).not.toHaveProperty('password');
    const withoutBox: Record<string, string> = { ...filled };
    delete withoutBox.password;
    expect(mailSettingsBody(form(withoutBox, { enabled: true, passwordSaved: true })).body).not.toHaveProperty('password');
  });

  it('switched off when only the hidden "false" is sent, and may then be saved unfinished', () => {
    const { body, errors } = mailSettingsBody(form({ provider: 'other', host: '', port: '587', security: 'starttls', username: '', fromName: '', fromAddress: '', replyTo: '' }));
    expect(body.enabled).toBe(false);
    expect(errors).toEqual([]);
  });

  it('switched on, needs the server, the sender’s address and, with a username, a password', () => {
    const { errors } = mailSettingsBody(form({ ...filled, host: '', password: '', fromAddress: '' }, { enabled: true }));
    expect(errors).toEqual(['To send emails with these settings, enter the server, the password and the sender’s address.']);
  });

  it('says what is wrong with the port, the provider and the addresses', () => {
    expect(portOf('587')).toBe(587);
    expect(portOf(' 465 ')).toBe(465);
    expect(portOf('58a')).toBeNaN();
    expect(portOf('')).toBeNaN();
    const { errors } = mailSettingsBody(form({ ...filled, provider: 'yahoo', port: 'abc', fromAddress: 'hr@', replyTo: 'nobody' }, { enabled: true }));
    expect(errors).toEqual(
      expect.arrayContaining([
        'Choose the email provider.',
        'The port is a whole number from 1 to 65535, usually 587 or 465.',
        'Write the sender’s address in full, e.g. hr@trendlix.com.',
        'Write the reply-to address in full, e.g. hr@trendlix.com, or leave it empty.',
      ]),
    );
  });
});

describe('mailTestBody', () => {
  it('sends the values on screen, switched on or not, and where to', () => {
    const { body, errors } = mailTestBody(form({ ...filled, testTo: ' Owner@Trendlix.com ' }));
    expect(errors).toEqual([]);
    expect(body).toMatchObject({ host: 'smtp.gmail.com', port: 587, password: ' app pass ', to: 'owner@trendlix.com' });
    expect(body).not.toHaveProperty('enabled');
  });

  it('leaves "to" out when empty (the API sends it to the signed-in user), and the password with the box empty', () => {
    const { body, errors } = mailTestBody(form({ ...filled, password: '', testTo: '' }, { passwordSaved: true }));
    expect(errors).toEqual([]);
    expect(body).not.toHaveProperty('to');
    expect(body).not.toHaveProperty('password');
  });

  it('needs complete settings even while switched off', () => {
    expect(mailTestBody(form({ ...filled, host: '' })).errors).toEqual(['To send a test email, enter the server.']);
  });
});

describe('savedMessage', () => {
  it('says where emails go from now on', () => {
    expect(savedMessage(view())).toBe('Saved. The system’s emails are sent with these settings from now on.');
    expect(savedMessage(view({ enabled: true, missing: ['the password'], sending: { source: 'server', from: null, address: null } }))).toBe('Saved, but not used yet: enter the password.');
    expect(savedMessage(view({ passwordUnreadable: true, sending: { source: 'none', from: null, address: null } }))).toBe(`Saved, but not used yet. ${MAIL_PASSWORD_UNREADABLE}`);
    expect(savedMessage(view({ enabled: false, sending: { source: 'server', from: null, address: 'server@trendlix.com' } }))).toBe(
      'Saved, switched off: the server’s settings are used meanwhile.',
    );
    expect(savedMessage(view({ enabled: false, sending: { source: 'none', from: null, address: null } }))).toBe('Saved, switched off: nothing is emailed until they are switched on.');
  });
});

describe('mailStatus', () => {
  it('names the address emails are sent from with the system’s settings', () => {
    expect(mailStatus(view())).toEqual({ tone: 'ok', headline: 'Emails are sent from hr@trendlix.com', alert: null, notes: [] });
  });

  it('says the server’s settings are used, and why these aren’t', () => {
    const s = mailStatus(view({ enabled: false, sending: { source: 'server', from: 'HR <server@trendlix.com>', address: 'server@trendlix.com' } }));
    expect(s.tone).toBe('neutral');
    expect(s.headline).toBe('Using the server’s settings: emails are sent from server@trendlix.com');
    expect(s.notes).toContain('These settings are saved but switched off.');
    expect(mailStatus(view({ missing: ['the server'], host: null, sending: { source: 'server', from: null, address: null } })).notes[0]).toBe(
      'These settings are switched on but not used yet: enter the server.',
    );
  });

  it('says nothing is emailed when neither is set up, and the saved password can’t be read any more', () => {
    const s = mailStatus(view({ passwordUnreadable: true, sending: { source: 'none', from: null, address: null } }));
    expect(s.tone).toBe('warn');
    expect(s.headline).toBe('Not set up: nothing is emailed');
    expect(s.alert).toBe(MAIL_PASSWORD_UNREADABLE);
  });
});

describe('lastTestText', () => {
  it('says when, and the result in the API’s words', () => {
    expect(lastTestText({ at: '2026-10-23T11:05:00.000Z', ok: false, message: 'The username or password was refused.' }, () => '23/10/2026, 2:05 PM')).toBe(
      'Last test 23/10/2026, 2:05 PM: The username or password was refused.',
    );
  });
});
