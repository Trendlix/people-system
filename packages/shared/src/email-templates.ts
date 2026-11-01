// Email templates (owner, 1 November 2026: "is there a templete screen for email and whatsapptempletes", then "build the
// mail templetes"): Organization → Email Templates lists each email the system sends, by who gets it, and HR (an Admin, a
// Super Admin) may write its subject and text themselves, with fields such as {{name}} or {{link}} filled in when it is
// sent. One not customised goes out exactly as before, worded by the system; one customised goes out as written, its
// text turned into the email's HTML (paragraphs, links), whatever it is sent with kept (an offer's document, an
// interview's calendar invitation). "Reset to standard" goes back to the system's words. The job rejection email and the
// invitation to apply keep their own words in Recruitment Settings. Pure: the API checks and fills them, the web shows
// and previews them.

/** The emails whose words HR may write, in the page's order. */
export const EMAIL_TEMPLATE_KEYS = [
  'sign_in_code',
  'account_invite',
  'password_reset',
  'application_received',
  'application_updated',
  'cv_received',
  'interview_invite',
  'interview_moved',
  'interview_cancelled',
  'job_offer',
  'shortlist_review',
  'interviewer_notice',
  'offer_answer',
] as const;
export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];
export const isEmailTemplateKey = (v: unknown): v is EmailTemplateKey => typeof v === 'string' && (EMAIL_TEMPLATE_KEYS as readonly string[]).includes(v);

/** Who gets them, the page's groups. */
export const EMAIL_TEMPLATE_GROUPS = ['employees', 'candidates', 'team'] as const;
export type EmailTemplateGroup = (typeof EMAIL_TEMPLATE_GROUPS)[number];
export const EMAIL_TEMPLATE_GROUP_LABELS: Record<EmailTemplateGroup, string> = {
  employees: 'To employees',
  candidates: 'To candidates',
  team: 'To HR and managers',
};

/** A field filled in when the email is sent: what it holds, and the sample a preview and a test use. */
export interface EmailTemplateField {
  key: string;
  label: string;
  sample: string;
}

/** An email HR may write: its name, who gets it and when, its fields (those it can't go without), and the starting words. */
export interface EmailTemplateKind {
  key: EmailTemplateKey;
  group: EmailTemplateGroup;
  label: string;
  when: string;
  fields: readonly EmailTemplateField[];
  /** Fields the text must have: the email is useless without them (the code, the link). */
  required: readonly string[];
  /** What Customise starts from: the system's words with the fields in them. */
  start: { subject: string; body: string };
}

const f = (key: string, label: string, sample: string): EmailTemplateField => ({ key, label, sample });

const NAME = f('name', 'Their name (empty when not known)', 'Mona Ali');
const COMPANY = f('company', 'The company’s name', 'TrendLIX');
const CANDIDATE = f('candidate', 'The candidate’s name', 'Mona Ali');
const JOB = f('job', 'The job', 'Graphic Designer');
const FIRST = f('first_name', 'Their first name', 'Mona');
const REFERENCE = f('reference', 'The application’s reference', 'APP-2026-0042');
const INTERVIEW = [
  CANDIDATE,
  JOB,
  COMPANY,
  f('day', 'The day', 'Thursday 5 November 2026'),
  f('day_ar', 'The day in Arabic', 'الخميس 5 نوفمبر 2026'),
  f('time', 'The time, in Cairo', '10:30 AM'),
  f('minutes', 'How long, in minutes', '45'),
  f('how', 'Where or how', 'Online (Google Meet): https://meet.google.com/abc-defg-hij'),
  f('how_ar', 'Where or how, in Arabic', 'عبر الإنترنت (Google Meet): https://meet.google.com/abc-defg-hij'),
  f('note', 'HR’s note for the candidate (empty without one)', 'Please bring your portfolio.'),
];

const SIGN_IN = 'https://people.trendlix.com/login';

export const EMAIL_TEMPLATES: Readonly<Record<EmailTemplateKey, EmailTemplateKind>> = {
  sign_in_code: {
    key: 'sign_in_code',
    group: 'employees',
    label: 'Sign-in code',
    when: 'When someone signs in with a code sent to their email.',
    fields: [NAME, f('code', 'The code', '482 913'), f('minutes', 'How long it works, in minutes', '10')],
    required: ['code'],
    start: {
      subject: 'Your People sign-in code',
      body: [
        'Hello {{name}},',
        '',
        'Your code to sign in to Trendlix People: {{code}}',
        'It works once, for {{minutes}} minutes.',
        '',
        'If you didn’t ask for it, ignore this email: nobody can sign in without the code.',
        '',
        '—',
        '',
        'مرحبًا {{name}}،',
        '',
        'رمز الدخول إلى Trendlix People: {{code}}',
        'يعمل مرة واحدة لمدة {{minutes}} دقائق.',
        '',
        'إن لم تطلبه فتجاهل هذه الرسالة: لا يمكن لأحد الدخول دون الرمز.',
      ].join('\n'),
    },
  },
  account_invite: {
    key: 'account_invite',
    group: 'employees',
    label: 'Account invitation',
    when: 'When HR invites an employee to set their password.',
    fields: [
      NAME,
      COMPANY,
      f('company_ar', 'The company’s name in Arabic', 'تريندلكس'),
      f('email', 'The email they sign in with', 'mona.ali@trendlix.com'),
      f('link', 'The set-password link', 'https://people.trendlix.com/set-password?token=…'),
      f('until', 'The link’s last day', '08/11/2026'),
      f('sign_in', 'The sign-in page', SIGN_IN),
    ],
    required: ['link'],
    start: {
      subject: '{{company}}: your Trendlix People account',
      body: [
        'Hello {{name}},',
        '',
        '{{company}} has given you access to Trendlix People, the company’s HR system: your requests, attendance, payslips and more.',
        '',
        'Your sign-in email: {{email}}',
        'Set your password with this link (it works once, until {{until}}):',
        '{{link}}',
        '',
        'Then sign in at {{sign_in}}, or in the Trendlix People app.',
        '',
        '—',
        '',
        'مرحبًا {{name}}،',
        '',
        'أتاحت لك {{company_ar}} الدخول إلى Trendlix People، نظام الموارد البشرية للشركة: طلباتك وحضورك وقسائم راتبك وغيرها.',
        '',
        'بريد الدخول: {{email}}',
        'اختر كلمة المرور من هذا الرابط (يعمل مرة واحدة حتى {{until}}):',
        '{{link}}',
      ].join('\n'),
    },
  },
  password_reset: {
    key: 'password_reset',
    group: 'employees',
    label: 'Password reset',
    when: 'When a new password is asked for (Forgot password, or HR’s Send password reset).',
    fields: [
      NAME,
      f('email', 'The email they sign in with', 'mona.ali@trendlix.com'),
      f('link', 'The set-password link', 'https://people.trendlix.com/set-password?token=…'),
      f('until', 'The link’s last day', '08/11/2026'),
      f('sign_in', 'The sign-in page', SIGN_IN),
    ],
    required: ['link'],
    start: {
      subject: 'Set a new password for Trendlix People',
      body: [
        'Hello {{name}},',
        '',
        'A new password was asked for your Trendlix People account. If you didn’t ask for it, you can ignore this email.',
        '',
        'Your sign-in email: {{email}}',
        'Set your password with this link (it works once, until {{until}}):',
        '{{link}}',
        '',
        'Then sign in at {{sign_in}}, or in the Trendlix People app.',
        '',
        '—',
        '',
        'مرحبًا {{name}}،',
        '',
        'طُلبت كلمة مرور جديدة لحسابك في Trendlix People. إن لم تطلبها فتجاهل هذه الرسالة.',
        '',
        'بريد الدخول: {{email}}',
        'اختر كلمة المرور من هذا الرابط (يعمل مرة واحدة حتى {{until}}):',
        '{{link}}',
      ].join('\n'),
    },
  },
  application_received: {
    key: 'application_received',
    group: 'candidates',
    label: 'Application received',
    when: 'When someone applies for a job on the careers page.',
    fields: [FIRST, JOB, COMPANY, REFERENCE],
    required: [],
    start: {
      subject: 'Your application for {{job}} ({{reference}})',
      body: [
        'Dear {{first_name}},',
        '',
        'Thank you for applying for {{job}} at {{company}}. We received your application; its reference is {{reference}}.',
        'We read every application. If yours fits what we are looking for, we will contact you about the next step.',
        '',
        '{{company}} HR',
      ].join('\n'),
    },
  },
  application_updated: {
    key: 'application_updated',
    group: 'candidates',
    label: 'Application updated',
    when: 'When someone applies for the same job again, their application updated.',
    fields: [FIRST, JOB, COMPANY, REFERENCE],
    required: [],
    start: {
      subject: 'Your updated application for {{job}} ({{reference}})',
      body: [
        'Dear {{first_name}},',
        '',
        'We’ve updated your application for {{job}} at {{company}} with what you just sent, your CV included; its reference is still {{reference}}.',
        'We read every application. If yours fits what we are looking for, we will contact you about the next step.',
        '',
        '{{company}} HR',
      ].join('\n'),
    },
  },
  cv_received: {
    key: 'cv_received',
    group: 'candidates',
    label: 'CV received',
    when: 'When someone sends their CV on the careers page without a job.',
    fields: [FIRST, COMPANY, f('reference', 'The CV’s reference', 'CV-2026-0042')],
    required: [],
    start: {
      subject: 'Your CV ({{reference}})',
      body: [
        'Dear {{first_name}},',
        '',
        'Thank you for sending us your CV. We received it; its reference is {{reference}}.',
        'When a job opens that fits what you do, we will contact you.',
        '',
        '{{company}} HR',
      ].join('\n'),
    },
  },
  interview_invite: {
    key: 'interview_invite',
    group: 'candidates',
    label: 'Interview invitation',
    when: 'When HR schedules an interview (the calendar invitation goes with it).',
    fields: INTERVIEW,
    required: [],
    start: {
      subject: 'Interview invitation: {{job}} at {{company}} · دعوة لمقابلة',
      body: [
        'Dear {{candidate}},',
        '',
        'Thank you for applying for {{job}} at {{company}}. We would like to invite you to an interview:',
        '',
        'When: {{day}}, {{time}} (Cairo time), {{minutes}} minutes',
        '{{how}}',
        '{{note}}',
        '',
        'The calendar invitation is attached. If the time doesn’t suit you, reply to this email.',
        '',
        'Best regards,',
        '{{company}} HR',
        '',
        '— — —',
        '',
        'عزيزي/عزيزتي {{candidate}}،',
        '',
        'شكرًا لتقديمك على وظيفة {{job}} في {{company}}. يسعدنا دعوتك لمقابلة:',
        '',
        'الموعد: {{day_ar}}، الساعة {{time}} بتوقيت القاهرة، لمدة {{minutes}} دقيقة',
        '{{how_ar}}',
        '',
        'دعوة التقويم مرفقة. إذا لم يناسبك الموعد، يُرجى الرد على هذه الرسالة.',
        '',
        'مع التحية،',
        'الموارد البشرية – {{company}}',
      ].join('\n'),
    },
  },
  interview_moved: {
    key: 'interview_moved',
    group: 'candidates',
    label: 'Interview moved',
    when: 'When HR moves an interview to another time (the calendar invitation goes with it).',
    fields: INTERVIEW,
    required: [],
    start: {
      subject: 'Interview rescheduled: {{job}} at {{company}} · تغيير موعد المقابلة',
      body: [
        'Dear {{candidate}},',
        '',
        'The interview for {{job}} has moved to a new time:',
        '',
        'When: {{day}}, {{time}} (Cairo time), {{minutes}} minutes',
        '{{how}}',
        '{{note}}',
        '',
        'The calendar invitation is attached. If the time doesn’t suit you, reply to this email.',
        '',
        'Best regards,',
        '{{company}} HR',
        '',
        '— — —',
        '',
        'عزيزي/عزيزتي {{candidate}}،',
        '',
        'تم تغيير موعد مقابلة وظيفة {{job}} إلى:',
        '',
        'الموعد: {{day_ar}}، الساعة {{time}} بتوقيت القاهرة، لمدة {{minutes}} دقيقة',
        '{{how_ar}}',
        '',
        'دعوة التقويم مرفقة. إذا لم يناسبك الموعد، يُرجى الرد على هذه الرسالة.',
        '',
        'مع التحية،',
        'الموارد البشرية – {{company}}',
      ].join('\n'),
    },
  },
  interview_cancelled: {
    key: 'interview_cancelled',
    group: 'candidates',
    label: 'Interview cancelled',
    when: 'When HR cancels an interview.',
    fields: INTERVIEW.filter((x) => !['minutes', 'how', 'how_ar'].includes(x.key)),
    required: [],
    start: {
      subject: 'Interview cancelled: {{job}} · إلغاء المقابلة',
      body: [
        'Dear {{candidate}},',
        '',
        'We are sorry: the interview for {{job}} on {{day}} at {{time}} is cancelled. We will be in touch about what comes next.',
        '{{note}}',
        '',
        'Best regards,',
        '{{company}} HR',
        '',
        '— — —',
        '',
        'عزيزي/عزيزتي {{candidate}}،',
        '',
        'نأسف لإبلاغك بإلغاء مقابلة وظيفة {{job}} المحددة يوم {{day_ar}} الساعة {{time}}. سنتواصل معك بشأن الخطوات التالية.',
        '',
        'مع التحية،',
        'الموارد البشرية – {{company}}',
      ].join('\n'),
    },
  },
  job_offer: {
    key: 'job_offer',
    group: 'candidates',
    label: 'Job offer',
    when: 'When HR sends a job offer by email (the offer’s document goes with it).',
    fields: [
      NAME,
      f('position', 'The position in words', 'the full-time position of Graphic Designer'),
      JOB,
      COMPANY,
      f('join_date', 'The join date', '15/11/2026'),
      f('open_until', 'The offer’s last day', '08/11/2026'),
      f('message', 'HR’s message with the offer (empty without one)', 'We look forward to working with you.'),
      f('link', 'The offer’s page, to accept or decline it', 'https://people.trendlix.com/offer/…'),
    ],
    required: ['link'],
    start: {
      subject: 'Job offer: {{job}} at {{company}}',
      body: [
        'Dear {{name}},',
        '',
        'We are pleased to offer you {{position}} at {{company}}, starting on {{join_date}}. The offer is attached.',
        '',
        '{{message}}',
        '',
        'Read the offer and accept or decline it here:',
        '{{link}}',
        '',
        'This offer is open until {{open_until}}.',
        '',
        '{{company}}',
      ].join('\n'),
    },
  },
  shortlist_review: {
    key: 'shortlist_review',
    group: 'team',
    label: 'Shortlist to review',
    when: 'To a vacancy’s hiring manager when HR shortlists applicants for them to accept or reject.',
    fields: [JOB, f('count', 'How many, in words', '3 applicants'), f('names', 'Their names, one a line', '- Mona Ali\n- Omar Said\n- Sara Adel'), f('link', 'My Hiring', 'https://people.trendlix.com/recruitment/my-hiring')],
    required: [],
    start: {
      subject: '{{count}} shortlisted for {{job}}: please accept or reject them',
      body: ['HR shortlisted {{count}} for {{job}}:', '', '{{names}}', '', 'Please accept or reject them on My Hiring: {{link}}'].join('\n'),
    },
  },
  interviewer_notice: {
    key: 'interviewer_notice',
    group: 'team',
    label: 'Interview, to the interviewers',
    when: 'To the interviewers when an interview is scheduled, moved or cancelled, or they leave its panel (the calendar invitation goes with it).',
    fields: [
      f('what', 'What happened', 'Interview scheduled'),
      CANDIDATE,
      JOB,
      f('details', 'When, and for how long', 'Mona Ali on Thursday 5 November 2026 at 10:30 AM, 45 minutes'),
      f('how', 'Where or how', 'Online (Google Meet): https://meet.google.com/abc-defg-hij'),
    ],
    required: [],
    start: {
      subject: '{{what}}: {{candidate}} · {{job}}',
      body: ['{{details}}', '', '{{how}}', '', 'Open the applicant in People System → Recruitment → My Hiring.'].join('\n'),
    },
  },
  offer_answer: {
    key: 'offer_answer',
    group: 'team',
    label: 'Offer answered',
    when: 'To the HR person who sent a job offer, when it is accepted or declined.',
    fields: [
      NAME,
      f('number', 'The offer’s number', 'OFF-2026-0012'),
      f('answer', 'accepted or declined', 'accepted'),
      f('date', 'The day it was answered', '03/11/2026'),
      f('how', 'How', 'on the offer’s page'),
      f('reason', 'Their reason (empty without one)', ''),
      f('profile', 'Their profile, made or not', 'Their profile (EMP-0042), employment and draft contract are ready in the People System.'),
    ],
    required: [],
    start: {
      subject: '{{name}} {{answer}} offer {{number}}',
      body: ['{{name}} {{answer}} job offer {{number}} on {{date}}, {{how}}.', '', '{{reason}}', '', '{{profile}}'].join('\n'),
    },
  },
};

/** The kinds in the page's order. */
export const emailTemplateKinds = (): EmailTemplateKind[] => EMAIL_TEMPLATE_KEYS.map((k) => EMAIL_TEMPLATES[k]);

/** The longest subject and text HR writes. */
export const EMAIL_TEMPLATE_LIMITS = { subject: 200, body: 10_000 } as const;

const FIELD = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** The fields a text names ({{name}} → name), in order, each once. */
export function fieldsIn(text: string): string[] {
  return [...new Set([...text.matchAll(FIELD)].map((m) => m[1]))];
}

/**
 * What is wrong with a template to save, in words; empty when fine: a subject on one line, a text, both within their
 * limits, only this email's fields, and the fields it can't go without (the code, the link).
 */
export function emailTemplateProblems(key: EmailTemplateKey, t: { subject: unknown; body: unknown }): string[] {
  const kind = EMAIL_TEMPLATES[key];
  const out: string[] = [];
  const subject = typeof t.subject === 'string' ? t.subject.trim() : '';
  const body = typeof t.body === 'string' ? t.body.trim() : '';
  if (!subject) out.push('Write the subject.');
  else if (/[\r\n]/.test(subject)) out.push('Write the subject on one line.');
  else if (subject.length > EMAIL_TEMPLATE_LIMITS.subject) out.push(`Keep the subject to ${EMAIL_TEMPLATE_LIMITS.subject} characters.`);
  if (!body) out.push('Write the email’s text.');
  else if (body.length > EMAIL_TEMPLATE_LIMITS.body) out.push(`Keep the text to ${EMAIL_TEMPLATE_LIMITS.body.toLocaleString('en-US')} characters.`);
  const known = new Set(kind.fields.map((x) => x.key));
  const unknown = fieldsIn(`${subject}\n${body}`).filter((x) => !known.has(x));
  if (unknown.length) out.push(`${unknown.map((x) => `{{${x}}}`).join(', ')} ${unknown.length === 1 ? 'isn’t one of this email’s fields' : 'aren’t this email’s fields'}: use ${kind.fields.map((x) => `{{${x.key}}}`).join(', ')}.`);
  const missing = kind.required.filter((x) => !fieldsIn(body).includes(x));
  if (missing.length) out.push(`The text needs ${missing.map((x) => `{{${x}}}`).join(' and ')}: the email is no use without it.`);
  return out;
}

/**
 * A template filled in: each field by its value (a field it doesn't know left as written); what an empty field leaves
 * tidied: a space before a comma or a full stop, !, ?, ; or : ("Hello ," → "Hello,"), an empty line, more than one empty line in a row.
 */
export function fillTemplate(text: string, values: Readonly<Record<string, string | null | undefined>>): string {
  const filled = text.replace(FIELD, (whole, key: string) => (key in values ? (values[key] ?? '') : whole));
  return filled
    .split('\n')
    .map((line) => line.replace(/[ \t]+([,،.!?؟;؛:])/g, '$1').replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The samples of an email's fields, for a preview and a test. */
export const sampleValues = (key: EmailTemplateKey): Record<string, string> => Object.fromEntries(EMAIL_TEMPLATES[key].fields.map((x) => [x.key, x.sample]));

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const URL_IN = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g;

/**
 * A filled text as the email's HTML: a paragraph for each block between empty lines, a line break for each line within
 * one, each link made a link, each paragraph's direction its own (Arabic right to left).
 */
export function emailTextHtml(text: string): string {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p dir="auto">${escapeHtml(p).replace(URL_IN, (u) => `<a href="${u}">${u}</a>`).replace(/\n/g, '<br>')}</p>`);
  return `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.5; color: #1f2937;">${paragraphs.join('')}</div>`;
}

/** An email as saved by HR: its subject and text. */
export interface EmailTemplateText {
  subject: string;
  body: string;
}

/** An email filled from HR's template: its subject, text and HTML. */
export function renderEmailTemplate(t: EmailTemplateText, values: Readonly<Record<string, string | null | undefined>>): { subject: string; text: string; html: string } {
  const subject = fillTemplate(t.subject, values).replace(/\s+/g, ' ');
  const text = fillTemplate(t.body, values);
  return { subject, text, html: emailTextHtml(text) };
}

/** A template as the page shows it: the kind, and HR's words when customised (null: the system's). */
export interface EmailTemplateView {
  key: EmailTemplateKey;
  group: EmailTemplateGroup;
  label: string;
  when: string;
  fields: EmailTemplateField[];
  required: string[];
  start: EmailTemplateText;
  custom: (EmailTemplateText & { updatedAt: string; updatedBy: { id: string; name: string } | null }) | null;
}

/** The values an email is filled with when sent (the fields' keys), for MailService to use HR's words when customised. */
export interface EmailTemplateUse {
  key: EmailTemplateKey;
  values: Readonly<Record<string, string | null | undefined>>;
}
