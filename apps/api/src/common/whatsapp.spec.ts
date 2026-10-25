import {
  ALL_WHATSAPP_GROUPS,
  inQuietHours,
  isStopWord,
  NOTIFICATION_KINDS,
  quietHoursEnd,
  WHATSAPP_FOOTER,
  WHATSAPP_GROUPS,
  WHATSAPP_LANGUAGES,
  WHATSAPP_NOTIFICATION_KINDS,
  WHATSAPP_QUIET_DEFAULT,
  WHATSAPP_TEMPLATE_KEYS,
  WHATSAPP_TEMPLATES,
  whatsappButtonPage,
  whatsappContent,
  whatsappGroupOf,
  whatsappParam,
  whatsappPreview,
  whatsappSettingsProblems,
  whatsappSpan,
  whatsappTemplateFor,
  whatsappTemplateMessage,
  whatsappTemplateProblems,
  whatsappTemplateRequest,
  whatsappWebhookUrl,
  zonedMoment,
  type WhatsAppFacts,
} from '@trendlix/shared';

// WhatsApp notifications (owner, 24 October 2026: "how to make whatsapp notifications?"; asked, "Employees and
// candidates", "Approvals waiting, Request decisions, Check-in reminders, Interviews", "Directly to Meta"): the rules in
// packages/shared whatsapp.ts: the templates and their variables in both languages, which notifications go on WhatsApp
// and under which choice, quiet hours, the STOP words, and the settings' checks.

const ORIGIN = 'https://people.trendlix.com';
const at = (iso: string) => new Date(iso);

describe('the templates', () => {
  it('pass Meta’s rules in both languages: numbered in order, words around each variable, an example each, Utility', () => {
    for (const key of WHATSAPP_TEMPLATE_KEYS) {
      const d = WHATSAPP_TEMPLATES[key];
      expect(whatsappTemplateProblems(d), key).toEqual([]);
      expect(d.name).toBe(`people_${key}`);
      for (const lang of WHATSAPP_LANGUAGES) expect(d.examples[lang]).toHaveLength(d.variables.length);
    }
    // an employee's opens the system; a candidate's and the test have no button
    for (const key of WHATSAPP_TEMPLATE_KEYS) {
      const d = WHATSAPP_TEMPLATES[key];
      if (d.audience !== 'employee' || key.startsWith('access_')) expect(d.button, key).toBeUndefined();
    }
  });

  it('catch what Meta refuses: a variable first or last, two together, out of order', () => {
    const base = WHATSAPP_TEMPLATES.payslip_ready;
    const withBody = (en: string) => ({ ...base, body: { en, ar: base.body.ar } });
    expect(whatsappTemplateProblems(withBody('{{1}}, your payslip for {{2}} is ready.'))).toEqual([expect.stringContaining('start or end')]);
    expect(whatsappTemplateProblems(withBody('Hello, your payslip {{1}} {{2}}'))).toEqual(expect.arrayContaining([expect.stringContaining('start or end'), expect.stringContaining('words between')]));
    expect(whatsappTemplateProblems(withBody('Hello {{2}}, your payslip for {{1}} is ready.'))).toEqual([expect.stringContaining('in order')]);
  });

  it('are submitted with their body and examples, the footer, and the button to the website', () => {
    const req = whatsappTemplateRequest('approval_waiting', 'ar', `${ORIGIN}/`);
    expect(req).toEqual({
      name: 'people_approval_waiting',
      language: 'ar',
      category: 'UTILITY',
      components: [
        { type: 'BODY', text: WHATSAPP_TEMPLATES.approval_waiting.body.ar, example: { body_text: [[...WHATSAPP_TEMPLATES.approval_waiting.examples.ar]] } },
        { type: 'FOOTER', text: WHATSAPP_FOOTER.ar },
        { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'افتح Trendlix People', url: `${ORIGIN}/{{1}}`, example: [`${ORIGIN}/leave/7c9e6679-7425-40de-944b-e07fc1f90ae7`] }] },
      ],
    });
    // a candidate's: no button
    expect((whatsappTemplateRequest('interview_reminder', 'en', ORIGIN).components as { type: string }[]).map((c) => c.type)).toEqual(['BODY', 'FOOTER']);
  });

  it('are sent with their variables and the button’s page', () => {
    expect(whatsappTemplateMessage('201012345678', { name: 'people_payslip_ready', language: 'en' }, ['Omar', 'October 2026'], 'app/payslips/1')).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '201012345678',
      type: 'template',
      template: {
        name: 'people_payslip_ready',
        language: { code: 'en' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: 'Omar' }, { type: 'text', text: 'October 2026' }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'app/payslips/1' }] },
        ],
      },
    });
    // Meta's sample: no variables
    expect(whatsappTemplateMessage('201012345678', { name: 'hello_world', language: 'en_US' }, [], null)).toMatchObject({ template: { name: 'hello_world', language: { code: 'en_US' } } });
    expect((whatsappTemplateMessage('1', { name: 'hello_world', language: 'en_US' }, [], null).template as object)).not.toHaveProperty('components');
  });
});

describe('what each message says', () => {
  const leave: WhatsAppFacts = { template: 'approval_waiting', what: 'leave', who: { en: 'Omar Khaled', ar: 'عمر خالد' }, span: { from: '2026-11-02', to: '2026-11-04' } };

  it('an approval waiting: the request with its article, whose and when, in English and Arabic (the Arabic name, Arabic digits)', () => {
    expect(whatsappContent(leave, 'en', { firstName: 'Mona', link: '/leave/abc' })).toEqual({ template: 'approval_waiting', body: ['Mona', 'a leave request', 'Omar Khaled, 02/11/2026–04/11/2026'], button: 'leave/abc' });
    expect(whatsappContent(leave, 'ar', { firstName: 'منى', link: '/leave/abc' })).toEqual({ template: 'approval_waiting', body: ['منى', 'طلب إجازة', 'عمر خالد، من ٠٢/١١/٢٠٢٦ إلى ٠٤/١١/٢٠٢٦'], button: 'leave/abc' });
    expect(whatsappPreview('approval_waiting', 'en', whatsappContent(leave, 'en', { firstName: 'Mona' }).body)).toBe(
      'Hello Mona, a leave request is waiting for your approval: Omar Khaled, 02/11/2026–04/11/2026.\n\nOpen Trendlix People to decide.',
    );
    // "an" before a vowel; a raise and a vacancy without days
    expect(whatsappContent({ template: 'approval_waiting', what: 'od', who: { en: 'Omar' }, span: { from: '2026-11-02', to: '2026-11-02' } }, 'en').body[1]).toBe('an official duty request');
    expect(whatsappContent({ template: 'approval_waiting', what: 'raise', who: { en: 'Omar Khaled', ar: null } }, 'ar', { firstName: 'سارة' }).body).toEqual(['سارة', 'زيادة راتب', 'Omar Khaled']);
    expect(whatsappContent({ template: 'approval_waiting', what: 'vacancy', who: { en: 'Video Editor (VAC-2026-0003)' } }, 'en', { firstName: 'Sara' }).body).toEqual(['Sara', 'a vacancy', 'Video Editor (VAC-2026-0003)']);
  });

  it('a decision: approved, rejected, cancelled by HR, a claim’s pay month, a check-in location’s first step; a half day', () => {
    const update = (o: Partial<Extract<WhatsAppFacts, { template: 'request_update' }>>, lang: 'en' | 'ar' = 'en') =>
      whatsappContent({ template: 'request_update', what: 'leave', span: { from: '2026-11-02', to: '2026-11-02' }, outcome: 'approved', ...o }, lang, { firstName: 'Omar' }).body;
    expect(update({})).toEqual(['Omar', 'leave request', '02/11/2026', 'approved']);
    expect(update({ outcome: 'rejected' }, 'ar')).toEqual(['Omar', 'طلب الإجازة الخاص بك', '٠٢/١١/٢٠٢٦', 'تم الرفض']);
    expect(update({ outcome: 'cancelled' })[3]).toBe('cancelled by HR');
    expect(update({ what: 'reimbursement', payMonth: '2026-11-01' })[3]).toBe('approved, to be paid with the November 2026 payroll');
    expect(update({ what: 'reimbursement', payMonth: '2026-11-01' }, 'ar')[3]).toBe('تمت الموافقة، وسيتم الصرف مع رواتب شهر نوفمبر ٢٠٢٦');
    expect(update({ what: 'home', outcome: 'first_step' })[3]).toBe('approved by HR, now with the CEO');
    expect(update({ span: { from: '2026-11-02', to: '2026-11-02', halfDay: true } })[2]).toBe('02/11/2026 (half day)');
  });

  it('the payslip, access, reminders and an interviewer’s: names, months, days and times only', () => {
    expect(whatsappContent({ template: 'payslip_ready', month: '2026-10' }, 'ar', { firstName: 'عمر', link: '/app/payslips/x' })).toEqual({ template: 'payslip_ready', body: ['عمر', 'أكتوبر ٢٠٢٦'], button: 'app/payslips/x' });
    expect(whatsappContent({ template: 'access_on_hold' }, 'en', { firstName: 'Omar', link: '/hold' })).toEqual({ template: 'access_on_hold', body: ['Omar'], button: null });
    expect(whatsappContent({ template: 'access_grace', until: '2026-10-31' }, 'en', { firstName: 'Omar' }).body).toEqual(['Omar', '31/10/2026']);
    expect(whatsappContent({ template: 'check_in_reminder', shiftStart: '09:00' }, 'ar', { firstName: 'عمر', link: '/my-attendance' })).toEqual({ template: 'check_in_reminder', body: ['عمر', '٩:٠٠ ص'], button: 'my-attendance' });
    // 06:05 UTC is 9:05 AM in Cairo (summer time) on 24 October 2026
    expect(whatsappContent({ template: 'check_out_reminder', checkedInAt: '2026-10-24T06:05:00.000Z' }, 'en', { firstName: 'Omar' }).body).toEqual(['Omar', '9:05 AM']);
    expect(whatsappContent({ template: 'interview_panel', change: 'moved', candidate: 'Sara Ali', job: 'Video Editor', at: '2026-11-02T08:30:00.000Z' }, 'en', { firstName: 'Omar', link: '/recruitment/applicants/1' }).body).toEqual([
      'Omar',
      'changed',
      'Sara Ali',
      'Video Editor',
      'Monday 2 November 2026 at 10:30 AM',
    ]);
  });

  it('a candidate’s: their first name, the job, the company, the reference; the interview’s day, time and place', () => {
    expect(whatsappContent({ template: 'application_received', name: 'Sara  Ali', job: 'Video Editor', company: 'TrendLIX', reference: 'APP-2026-0042' }, 'en')).toEqual({
      template: 'application_received',
      body: ['Sara', 'Video Editor', 'TrendLIX', 'APP-2026-0042'],
      button: null,
    });
    const invite = whatsappContent(
      { template: 'interview_invitation', name: 'Sara Ali', job: 'Video Editor', company: 'TrendLIX', at: '2026-11-02T08:30:00.000Z', place: { kind: 'online', location: 'https://meet.google.com/abc', meetingName: 'Google Meet', company: 'TrendLIX' } },
      'ar',
    );
    expect(invite.body).toEqual(['Sara', 'Video Editor', 'TrendLIX', 'الاثنين، ٢ نوفمبر ٢٠٢٦', '١٠:٣٠ ص', 'عبر الإنترنت (Google Meet): https://meet.google.com/abc']);
    const reminder = whatsappContent({ template: 'interview_reminder', name: 'Sara', job: 'Video Editor', company: 'TrendLIX', at: '2026-11-02T08:30:00.000Z', place: { kind: 'in_person', location: null, company: 'TrendLIX' } }, 'en');
    expect(whatsappPreview('interview_reminder', 'en', reminder.body)).toBe(
      'Hello Sara, a reminder: your interview for Video Editor at TrendLIX is tomorrow at 10:30 AM (Cairo time).\nWhere: In person: TrendLIX\n\nWe look forward to meeting you.',
    );
    expect(whatsappContent({ template: 'interview_reminder', name: 'Sara', job: 'J', company: 'C', at: '2026-11-02T08:30:00.000Z', place: { kind: 'phone', location: null, company: 'C', mobile: '+201001234567' } }, 'en').body[4]).toBe(
      'By phone: we will call you on +201001234567',
    );
  });

  it('a variable on one line, never empty, at most its length; a button’s page from the link, the inbox when none', () => {
    expect(whatsappParam('Line one\nline\ttwo     wide')).toBe('Line one line two wide');
    expect(whatsappParam('   ')).toBe('–');
    expect(whatsappParam('x'.repeat(300))).toHaveLength(200);
    expect(whatsappButtonPage('/leave/abc')).toBe('leave/abc');
    expect(whatsappButtonPage('/raise-requests?status=with_hr')).toBe('raise-requests?status=with_hr');
    expect(whatsappButtonPage(null)).toBe('notifications');
    expect(whatsappButtonPage('/')).toBe('notifications');
    expect(whatsappSpan({ from: '2026-11-02', to: '2026-11-03' }, 'en')).toBe('02/11/2026–03/11/2026');
    expect(whatsappWebhookUrl(`${ORIGIN}/`)).toBe(`${ORIGIN}/whatsapp/webhook`);
  });
});

describe('which notifications go on WhatsApp', () => {
  it('only kinds that exist, each under one of the four choices, with the templates their facts may name', () => {
    const kinds = Object.keys(WHATSAPP_NOTIFICATION_KINDS);
    for (const k of kinds) expect(NOTIFICATION_KINDS as readonly string[], k).toContain(k);
    for (const [k, v] of Object.entries(WHATSAPP_NOTIFICATION_KINDS)) {
      expect(WHATSAPP_GROUPS, k).toContain(v!.group);
      for (const t of v!.templates) expect(WHATSAPP_TEMPLATES[t].group, `${k} → ${t}`).toBe(v!.group);
    }
    // the owner's four: approvals waiting, request decisions, check-in reminders, interviews
    const by = (g: string) => kinds.filter((k) => whatsappGroupOf(k) === g).sort();
    expect(by('approvals')).toEqual(['correction_waiting', 'home_location_waiting', 'leave_waiting', 'od_waiting', 'pay_raise_waiting', 'permission_waiting', 'reimbursement_waiting', 'vacancy_waiting', 'wfh_waiting']);
    expect(by('decisions')).toEqual([
      'access_grace',
      'access_grace_ending',
      'access_hold',
      'correction_decided',
      'home_location_decided',
      // a colleague named to cover someone's leave (25 October 2026)
      'leave_cover',
      'leave_decided',
      'od_decided',
      'payslip_issued',
      'permission_decided',
      'reimbursement_decided',
      'wfh_decided',
    ]);
    expect(by('check_in')).toEqual(['check_in_reminder', 'check_out_reminder']);
    expect(by('interviews')).toEqual(['interview_scheduled']);
    expect(ALL_WHATSAPP_GROUPS).toEqual({ approvals: true, decisions: true, check_in: true, interviews: true });
  });

  it('a notification goes with its facts’ template only when its kind takes it; never a kind outside the list', () => {
    expect(whatsappTemplateFor('leave_waiting', { template: 'approval_waiting', what: 'leave', who: { en: 'A' } })).toBe('approval_waiting');
    expect(whatsappTemplateFor('leave_decided', { template: 'approval_waiting', what: 'leave', who: { en: 'A' } })).toBeNull();
    expect(whatsappTemplateFor('payslip_issued', { template: 'payslip_ready', month: '2026-10' })).toBe('payslip_ready');
    expect(whatsappTemplateFor('kpi_waiting', { template: 'approval_waiting', what: 'leave', who: { en: 'A' } })).toBeNull();
    expect(whatsappTemplateFor('custody_handover', null)).toBeNull();
    expect(whatsappGroupOf('screening_mention')).toBeNull();
  });
});

describe('quiet hours (22:00–08:00 Cairo unless changed)', () => {
  const q = WHATSAPP_QUIET_DEFAULT;

  it('are from 22:00 to just before 08:00, across midnight; none, or the same start and end, never', () => {
    // Cairo is UTC+3 on 24 October 2026 (summer time until the last Thursday of October)
    expect(inQuietHours(at('2026-10-24T18:59:00Z'), q)).toBe(false); // 21:59
    expect(inQuietHours(at('2026-10-24T19:00:00Z'), q)).toBe(true); // 22:00
    expect(inQuietHours(at('2026-10-24T23:30:00Z'), q)).toBe(true); // 02:30
    expect(inQuietHours(at('2026-10-25T04:59:00Z'), q)).toBe(true); // 07:59
    expect(inQuietHours(at('2026-10-25T05:00:00Z'), q)).toBe(false); // 08:00
    expect(inQuietHours(at('2026-10-24T19:00:00Z'), null)).toBe(false);
    expect(inQuietHours(at('2026-10-24T19:00:00Z'), { from: '22:00', to: '22:00' })).toBe(false);
    // daytime hours (13:00–14:00) work too
    expect(inQuietHours(at('2026-10-24T10:30:00Z'), { from: '13:00', to: '14:00' })).toBe(true);
  });

  it('end at 08:00 that day or the next; outside them, the moment itself', () => {
    expect(new Date(quietHoursEnd(at('2026-10-24T19:30:00Z'), q)).toISOString()).toBe('2026-10-25T05:00:00.000Z');
    expect(new Date(quietHoursEnd(at('2026-10-25T02:00:00Z'), q)).toISOString()).toBe('2026-10-25T05:00:00.000Z');
    expect(quietHoursEnd(at('2026-10-25T09:00:00Z'), q)).toBe(Date.parse('2026-10-25T09:00:00Z'));
    // in winter time (UTC+2), 08:00 Cairo is 06:00 UTC
    expect(new Date(quietHoursEnd(at('2026-12-01T22:00:00Z'), q)).toISOString()).toBe(new Date(zonedMoment('2026-12-02', '08:00')).toISOString());
    expect(new Date(zonedMoment('2026-12-02', '08:00')).toISOString()).toBe('2026-12-02T06:00:00.000Z');
  });
});

describe('STOP', () => {
  it('is STOP or توقف alone, however written; nothing else stops the messages', () => {
    for (const t of ['STOP', 'stop', ' Stop. ', 'STOP!', '"stop"', 'توقف', 'تـوقـف', 'تَوَقَّفْ', 'توقف.', 'Ｓｔｏｐ']) expect(isStopWord(t), t).toBe(true);
    for (const t of ['stop please', 'STOPP', 'no', '', 'توقف من فضلك', 'unsubscribe', 42, null]) expect(isStopWord(t), String(t)).toBe(false);
  });
});

describe('the settings', () => {
  const none = { tokenSaved: false, secretSaved: false };

  it('take Meta’s ids as digits, the number with its country code, the token and secret on one line, quiet hours apart', () => {
    expect(whatsappSettingsProblems({ phoneNumberId: '1234567890123', businessAccountId: '9876543210987', displayPhone: '+20 100 123 4567', enabled: false, quietHours: true, quietFrom: '22:00', quietTo: '08:00' }, none)).toEqual([]);
    expect(whatsappSettingsProblems({ phoneNumberId: 'abc', businessAccountId: '12', displayPhone: '12', enabled: false, quietHours: false }, none)).toEqual([
      expect.stringContaining('phone number ID'),
      expect.stringContaining('WhatsApp Business Account ID'),
      expect.stringContaining('business number'),
    ]);
    expect(whatsappSettingsProblems({ accessToken: 'EAAG xyz\nabc', appSecret: 'not a secret!', enabled: false, quietHours: true, quietFrom: '22:00', quietTo: '22:00' }, none)).toEqual([
      expect.stringContaining('access token'),
      expect.stringContaining('app secret'),
      'Quiet hours start and end at different times.',
    ]);
  });

  it('switched on, need the ids, a token and an app secret (saved ones count)', () => {
    expect(whatsappSettingsProblems({ enabled: true, quietHours: false }, none)).toEqual([
      'To send WhatsApp messages, enter the phone number ID, the WhatsApp Business Account ID, the access token and the app secret.',
    ]);
    expect(whatsappSettingsProblems({ phoneNumberId: '1234567890', businessAccountId: '1234567890', enabled: true, quietHours: false }, { tokenSaved: true, secretSaved: true })).toEqual([]);
  });
});
