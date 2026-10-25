import {
  isWhatsAppProvider,
  TWILIO_CTA_BODY_MAX,
  TWILIO_TEXT_BODY_MAX,
  twilioApprovalRequest,
  twilioButtonVariable,
  twilioContentRequest,
  twilioContentType,
  twilioContentVariables,
  twilioSenderOf,
  twilioSenderText,
  twilioTemplateBody,
  twilioTemplateName,
  twilioTemplateStatusOf,
  variablesIn,
  WHATSAPP_FOOTER,
  WHATSAPP_LANGUAGES,
  WHATSAPP_TEMPLATE_KEYS,
  WHATSAPP_TEMPLATES,
  WHATSAPP_TWILIO_SETUP_STEPS,
  whatsappAllSettingsProblems,
  whatsappContent,
  whatsappTwilioIncomingUrl,
  whatsappTwilioMissing,
  whatsappTwilioProblems,
  whatsappTwilioStatusUrl,
} from '@trendlix/shared';

// Twilio as a second way to send WhatsApp (owner, 25 October 2026: "Add Twilio as a choice"): the same 18 templates (the
// cover's since leave coverage, 25 October 2026) and texts made as Twilio Content, the variables sent, Twilio's approval
// words, the sender, the settings' checks and the owner's steps. packages/shared whatsapp-twilio.ts.

const ORIGIN = 'https://people.trendlix.com/';
const SID = `AC${'0123456789abcdef'.repeat(2)}`;

describe('the templates as Twilio Content', () => {
  it('are the 18 in both languages, named people_<key>_<lang>, Utility, with the same texts and the STOP line', () => {
    expect(WHATSAPP_TEMPLATE_KEYS).toHaveLength(18);
    for (const key of WHATSAPP_TEMPLATE_KEYS) {
      for (const lang of WHATSAPP_LANGUAGES) {
        const d = WHATSAPP_TEMPLATES[key];
        const c = twilioContentRequest(key, lang, ORIGIN) as { friendly_name: string; language: string; variables: Record<string, string>; types: Record<string, { body: string; actions?: unknown[] }> };
        expect(c.friendly_name).toBe(`people_${key}_${lang}`);
        expect(twilioTemplateName(key, lang)).toBe(c.friendly_name);
        expect(c.language).toBe(lang);
        const type = twilioContentType(key);
        expect(Object.keys(c.types)).toEqual([type]);
        const body = c.types[type].body;
        expect(body).toBe(`${d.body[lang]}\n\n${WHATSAPP_FOOTER[lang]}`);
        expect(twilioTemplateBody(key, lang)).toBe(body);
        expect(body.length, `${key} ${lang}`).toBeLessThanOrEqual(type === 'twilio/call-to-action' ? TWILIO_CTA_BODY_MAX : TWILIO_TEXT_BODY_MAX);
        // the body's variables 1..N, each with its example; a button's page the next
        expect(variablesIn(body)).toEqual(d.variables.map((_, i) => i + 1));
        expect(Object.keys(c.variables).map(Number)).toEqual([...d.variables.map((_, i) => i + 1), ...(d.button ? [d.variables.length + 1] : [])]);
        d.examples[lang].forEach((v, i) => expect(c.variables[String(i + 1)]).toBe(v));
        expect(twilioApprovalRequest(key, lang)).toEqual({ name: c.friendly_name, category: 'UTILITY' });
      }
    }
  });

  it('carry the “Open Trendlix People” button as a URL action to the website, its page the last variable', () => {
    const c = twilioContentRequest('approval_waiting', 'en', ORIGIN) as { variables: Record<string, string>; types: Record<string, { actions: unknown[] }> };
    expect(twilioButtonVariable('approval_waiting')).toBe(4);
    expect(c.types['twilio/call-to-action'].actions).toEqual([{ type: 'URL', title: 'Open Trendlix People', url: 'https://people.trendlix.com/{{4}}' }]);
    expect(c.variables['4']).toBe(WHATSAPP_TEMPLATES.approval_waiting.buttonExample);
    const ar = twilioContentRequest('approval_waiting', 'ar', ORIGIN) as { types: Record<string, { actions: { title: string }[] }> };
    expect(ar.types['twilio/call-to-action'].actions[0].title).toBe('افتح Trendlix People');
    // a candidate's has no button: a plain text
    expect(Object.keys((twilioContentRequest('application_received', 'en', ORIGIN) as { types: object }).types)).toEqual(['twilio/text']);
  });

  it('are sent with the message’s variables in order, the button’s page after them', () => {
    const content = whatsappContent({ template: 'payslip_ready', month: '2026-10' }, 'ar', { firstName: 'منى', link: '/app/payslips/7' });
    expect(JSON.parse(twilioContentVariables(content.body, content.button))).toEqual({ 1: 'منى', 2: 'أكتوبر ٢٠٢٦', 3: 'app/payslips/7' });
  });

  it('read Twilio’s approval words as ours', () => {
    expect(twilioTemplateStatusOf('approved')).toBe('approved');
    expect(twilioTemplateStatusOf('received')).toBe('pending');
    expect(twilioTemplateStatusOf('PENDING')).toBe('pending');
    expect(twilioTemplateStatusOf('rejected')).toBe('rejected');
    expect(twilioTemplateStatusOf('paused')).toBe('paused');
    expect(twilioTemplateStatusOf('disabled')).toBe('disabled');
    expect(twilioTemplateStatusOf('unsubmitted')).toBe('not_submitted');
    expect(twilioTemplateStatusOf(undefined)).toBe('not_submitted');
    expect(twilioTemplateStatusOf('something_new')).toBe('other');
  });
});

describe('the settings', () => {
  it('know the two providers, and Twilio’s addresses on the website', () => {
    expect(isWhatsAppProvider('meta')).toBe(true);
    expect(isWhatsAppProvider('twilio')).toBe(true);
    expect(isWhatsAppProvider('sms')).toBe(false);
    expect(whatsappTwilioStatusUrl(ORIGIN)).toBe('https://people.trendlix.com/whatsapp/twilio/status');
    expect(whatsappTwilioIncomingUrl(ORIGIN)).toBe('https://people.trendlix.com/whatsapp/twilio/incoming');
  });

  it('take the sender as a number (whatsapp:+…) or a Messaging Service SID', () => {
    expect(twilioSenderOf('whatsapp:+20 100 123 4567')).toEqual({ kind: 'number', value: 'whatsapp:+201001234567' });
    expect(twilioSenderOf('+201001234567')).toEqual({ kind: 'number', value: 'whatsapp:+201001234567' });
    expect(twilioSenderOf('01001234567')).toEqual({ kind: 'number', value: 'whatsapp:+201001234567' });
    expect(twilioSenderOf(`MG${'AB'.repeat(16)}`)).toEqual({ kind: 'service', value: `MG${'ab'.repeat(16)}` });
    expect(twilioSenderOf(SID)).toBeNull();
    expect(twilioSenderOf('whatsapp:+20')).toBeNull();
    expect(twilioSenderOf('')).toBeNull();
    expect(twilioSenderText('whatsapp:+201001234567')).toBe('+201001234567');
  });

  it('say what is wrong with Twilio’s fields, whatever the provider; what a switched-on Twilio lacks only when it is chosen', () => {
    expect(whatsappTwilioProblems({ twilioAccountSid: 'AC123', twilioAuthToken: 'short', twilioSender: 'nope' }, { tokenSaved: false })).toEqual([
      'The Account SID is AC and 32 letters and digits, as the Twilio Console’s home page shows it.',
      'Paste the Auth Token as the Twilio Console’s home page shows it: 32 letters and digits, on one line.',
      'Write the WhatsApp sender as whatsapp:+20… (the number registered in Twilio, with its country code), or paste its Messaging Service SID (MG…).',
    ]);
    expect(whatsappTwilioProblems({ enabled: true, provider: 'twilio' }, { tokenSaved: false })).toEqual(['To send WhatsApp messages through Twilio, enter the Account SID, the Auth Token and the WhatsApp sender.']);
    expect(whatsappTwilioProblems({ enabled: true, provider: 'twilio', twilioAccountSid: SID, twilioSender: '+201001234567' }, { tokenSaved: true })).toEqual([]);
    // Meta chosen: Twilio may be left unfinished
    expect(whatsappTwilioProblems({ enabled: true, provider: 'meta' }, { tokenSaved: false })).toEqual([]);
    expect(whatsappTwilioMissing({ accountSid: SID, authToken: false, sender: null })).toEqual(['the Auth Token', 'the WhatsApp sender']);
  });

  it('check both providers together: while Twilio sends, Meta’s may be unfinished, and the other way round', () => {
    const opts = { tokenSaved: false, secretSaved: false, twilioTokenSaved: true };
    const twilio = { enabled: true, provider: 'twilio' as const, phoneNumberId: null, businessAccountId: null, displayPhone: null, quietHours: false, twilioAccountSid: SID, twilioSender: 'whatsapp:+201001234567' };
    expect(whatsappAllSettingsProblems(twilio, opts)).toEqual([]);
    expect(whatsappAllSettingsProblems({ ...twilio, provider: 'meta' }, opts)).toEqual([
      'To send WhatsApp messages, enter the phone number ID, the WhatsApp Business Account ID, the access token and the app secret.',
    ]);
    expect(whatsappAllSettingsProblems({ ...twilio, phoneNumberId: 'abc', quietHours: true, quietFrom: '22:00', quietTo: '22:00' }, opts)).toEqual([
      'The phone number ID is the long number in WhatsApp → API Setup, digits only.',
      'Quiet hours start and end at different times.',
    ]);
  });

  it('show the owner four steps in Twilio', () => {
    expect(WHATSAPP_TWILIO_SETUP_STEPS.map((s) => s.title)).toEqual([
      'Register the WhatsApp sender',
      'Copy the Account SID and Auth Token',
      'Paste the sender, and set its webhook',
      'Submit templates, then sync',
    ]);
    expect(WHATSAPP_TWILIO_SETUP_STEPS[0].text).toContain('Messaging → Senders → WhatsApp senders');
    expect(WHATSAPP_TWILIO_SETUP_STEPS[2].text).toContain('When a message comes in');
  });
});
