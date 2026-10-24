import { WHATSAPP_TOKEN_UNREADABLE, type WhatsAppSettingsView, type WhatsAppTemplateStatusView } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { approvedText, intentOf, lastTestText, quietStart, savedMessage, templatesByKey, whatsappSettingsBody, whatsappStatus, whatsappTestBody } from './settings';

// Organization → Company → WhatsApp (owner, 24 October 2026: "how to make whatsapp notifications?"; "Directly to
// Meta"): what the form sends, and what the page says about whether messages go out.

/** The form as the page sends it: the hidden "false" before each switch, and the switch's "true" when on. */
function form(values: Record<string, string>, opts: { enabled?: boolean; quiet?: boolean; tokenSaved?: boolean; secretSaved?: boolean; intent?: string } = {}): FormData {
  const fd = new FormData();
  if (opts.intent) fd.set('intent', opts.intent);
  fd.set('tokenSaved', String(opts.tokenSaved ?? false));
  fd.set('secretSaved', String(opts.secretSaved ?? false));
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  fd.append('enabled', 'false');
  if (opts.enabled) fd.append('enabled', 'true');
  fd.append('quietHours', 'false');
  if (opts.quiet) fd.append('quietHours', 'true');
  return fd;
}

const filled = {
  phoneNumberId: ' 123456789012345 ',
  businessAccountId: '987654321098765',
  displayPhone: '+201001234567',
  accessToken: 'EAAGtest.Token_123',
  appSecret: 'abcdef0123456789abcdef0123456789',
  quietFrom: '10:00 PM',
  quietTo: '8:00 AM',
};

const template = (over: Partial<WhatsAppTemplateStatusView>): WhatsAppTemplateStatusView => ({
  key: 'approval_waiting',
  name: 'people_approval_waiting',
  label: 'Approval waiting',
  language: 'en',
  category: 'UTILITY',
  status: 'approved',
  reason: null,
  submittedAt: null,
  syncedAt: null,
  ...over,
});

const view = (over: Partial<WhatsAppSettingsView> = {}): WhatsAppSettingsView => ({
  phoneNumberId: '123456789012345',
  businessAccountId: '987654321098765',
  displayPhone: '+201001234567',
  tokenSet: true,
  tokenUnreadable: false,
  appSecretSet: true,
  appSecretUnreadable: false,
  verifyToken: 'v'.repeat(32),
  webhookUrl: 'https://people.trendlix.com/whatsapp/webhook',
  enabled: true,
  quietHours: { from: '22:00', to: '08:00' },
  missing: [],
  updatedAt: '2026-10-24T10:00:00.000Z',
  updatedBy: { id: 'u1', name: 'Hazem Magdy' },
  lastTest: null,
  templates: [template({}), template({ language: 'ar', status: 'pending' })],
  templatesSyncedAt: null,
  webhook: { verifiedAt: null, lastEventAt: null },
  sending: { on: true, why: null },
  ...over,
});

describe('the buttons', () => {
  it('tell Save, the test, a new verify token, Submit templates and Sync status apart; anything else saves', () => {
    for (const intent of ['test', 'verify-token', 'submit', 'sync', 'save'] as const) expect(intentOf(form({}, { intent }))).toBe(intent);
    expect(intentOf(form({}))).toBe('save');
    expect(intentOf(form({}, { intent: 'delete' }))).toBe('save');
  });
});

describe('whatsappSettingsBody', () => {
  it('sends the values trimmed, the switches as booleans and the quiet hours as HH:mm', () => {
    const { body, errors } = whatsappSettingsBody(form(filled, { enabled: true, quiet: true }));
    expect(errors).toEqual([]);
    expect(body).toEqual({
      phoneNumberId: '123456789012345',
      businessAccountId: '987654321098765',
      displayPhone: '+201001234567',
      accessToken: 'EAAGtest.Token_123',
      appSecret: 'abcdef0123456789abcdef0123456789',
      enabled: true,
      quietHours: true,
      quietFrom: '22:00',
      quietTo: '08:00',
    });
  });

  it('leaves out an empty token and app secret (the saved ones stay), and the quiet hours when switched off', () => {
    const { body, errors } = whatsappSettingsBody(form({ ...filled, accessToken: '', appSecret: ' ' }, { enabled: true, tokenSaved: true, secretSaved: true }));
    expect(errors).toEqual([]);
    expect(body).not.toHaveProperty('accessToken');
    expect(body).not.toHaveProperty('appSecret');
    expect(body).toMatchObject({ quietHours: false, quietFrom: null, quietTo: null });
  });

  it('says what a switched-on set lacks, and what is wrong, as the API would', () => {
    const lacking = whatsappSettingsBody(form({ phoneNumberId: '', businessAccountId: '' }, { enabled: true }));
    expect(lacking.errors).toEqual(['To send WhatsApp messages, enter the phone number ID, the WhatsApp Business Account ID, the access token and the app secret.']);
    // switched off, it may be saved unfinished
    expect(whatsappSettingsBody(form({})).errors).toEqual([]);
    const wrong = whatsappSettingsBody(form({ phoneNumberId: '12ab', quietFrom: '10:00 PM', quietTo: '10:00 PM' }, { quiet: true }));
    expect(wrong.errors).toEqual(['The phone number ID is the long number in WhatsApp → API Setup, digits only.', 'Quiet hours start and end at different times.']);
  });
});

describe('whatsappTestBody', () => {
  it('sends the number written, and asks for one', () => {
    expect(whatsappTestBody(form({ testTo: '+201001234567' }))).toEqual({ body: { to: '+201001234567' }, errors: [] });
    expect(whatsappTestBody(form({})).errors).toEqual(['Write the number to send the test message to, with its country code.']);
  });
});

describe('what the page says', () => {
  it('starts the quiet hours with the saved ones, else 22:00 to 08:00 switched off', () => {
    expect(quietStart(view())).toEqual({ on: true, from: '22:00', to: '08:00' });
    expect(quietStart(view({ quietHours: { from: '21:00', to: '09:00' } }))).toEqual({ on: true, from: '21:00', to: '09:00' });
    expect(quietStart(view({ quietHours: null }))).toEqual({ on: false, from: '22:00', to: '08:00' });
  });

  it('says whether messages go out, and what keeps them', () => {
    expect(whatsappStatus(view())).toMatchObject({ tone: 'ok', headline: 'WhatsApp messages go out from +201001234567', alert: null });
    expect(whatsappStatus(view()).notes).toEqual(['1 of 2 templates approved: only approved templates are used; anything else goes by the bell, push and email only.']);
    expect(whatsappStatus(view({ enabled: false, sending: { on: false, why: 'Switched off.' } }))).toMatchObject({ tone: 'neutral', headline: 'Switched off: no WhatsApp messages go out' });
    const stuck = whatsappStatus(view({ tokenUnreadable: true, missing: ['the access token'], sending: { on: false, why: 'The access token can’t be read.' } }));
    expect(stuck).toMatchObject({ tone: 'warn', headline: 'Not sending: The access token can’t be read.', alert: WHATSAPP_TOKEN_UNREADABLE });
    expect(stuck.notes[0]).toBe('To send, enter the access token.');
  });

  it('says what a save came to', () => {
    expect(savedMessage(view())).toBe('Saved. WhatsApp messages go out with these settings from now on.');
    expect(savedMessage(view({ sending: { on: false, why: null }, missing: ['the app secret'] }))).toBe('Saved, but not used yet: enter the app secret.');
    expect(savedMessage(view({ enabled: false, sending: { on: false, why: null } }))).toMatch(/^Saved, switched off/);
  });

  it('counts the approved templates and lists them by template, English first', () => {
    expect(approvedText([template({})])).toBe('1 of 1 template approved');
    const rows = templatesByKey([template({ language: 'ar' }), template({}), template({ key: 'payslip_ready', name: 'people_payslip_ready', label: 'Payslip issued' })]);
    expect(rows.map((r) => [r.name, r.languages.map((l) => l.language)])).toEqual([
      ['people_approval_waiting', ['en', 'ar']],
      ['people_payslip_ready', ['en']],
    ]);
  });

  it('writes the last test', () => {
    expect(lastTestText({ at: '2026-10-24T11:05:00.000Z', ok: false, message: 'The access token expired.' }, () => '24/10/2026, 2:05 PM')).toBe(
      'Last test 24/10/2026, 2:05 PM: The access token expired.',
    );
  });
});
