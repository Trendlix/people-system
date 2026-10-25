// WhatsApp notifications (owner, 24 October 2026: "how to make whatsapp notifications?"; after the explanation (Meta's
// business verification, a dedicated number, approved templates, opt-in, per-message fees) they chose whom, "Employees
// and candidates"; what, "Approvals waiting, Request decisions, Check-in reminders, Interviews"; and how, "Directly to
// Meta": the WhatsApp Cloud API at graph.facebook.com, only Meta's fees). WhatsApp is one more channel beside the bell,
// push and email, never in their place: a message goes only to someone who opted in, with an approved template, while a
// Super Admin has it switched on in Organization → Company → WhatsApp. Anything else (not set up, a template not
// approved, outside the person's choices) falls back silently to today's channels. Short and general, as push is: names,
// dates and references, never an amount, a reason or a comment; each employee message with a button into the system.
// Pure code: the API builds and sends with it, the web shows the same words. Tested in
// apps/api/src/common/whatsapp.spec.ts. Twilio, a second way to send the same messages (owner, 25 October 2026: "Add
// Twilio as a choice"): whatsapp-twilio.ts.

import { zonedMoment } from './attendance.js';
import { cairoDay } from './check-in.js';
import type { NotificationKind } from './notifications.js';
import { toArabicDigits } from './pdf-fields.js';
import { phoneOk, phoneTidy } from './phone.js';
import type { WhatsAppProvider, WhatsAppTwilioView } from './whatsapp-twilio.js';

// ---------- Meta's Graph API ----------

/** Meta's Graph API: the WhatsApp Cloud API is a part of it. */
export const WHATSAPP_GRAPH = 'https://graph.facebook.com';

/** The Graph API version every request names (Meta keeps each for about two years; a new one is a one-line change). */
export const WHATSAPP_GRAPH_VERSION = 'v24.0';

/** Where Meta's webhook calls on the website (the website passes it on to the API, which can't be reached by Meta). */
export const WHATSAPP_WEBHOOK_PATH = '/whatsapp/webhook';

/** The webhook's address on a website: "https://people.trendlix.com/whatsapp/webhook". */
export const whatsappWebhookUrl = (origin: string): string => `${origin.replace(/\/+$/, '')}${WHATSAPP_WEBHOOK_PATH}`;

/** The Settings page. */
export const WHATSAPP_SETTINGS_PATH = '/organization/whatsapp';

/** HR's log of the messages sent (Super Admin and HR). */
export const WHATSAPP_MESSAGES_PATH = '/whatsapp-messages';

/** A number as Meta takes it: digits only, with the country code ("+201012345678" → "201012345678"). */
export const whatsappNumber = (mobile: string | null | undefined): string => String(mobile ?? '').replace(/\D/g, '');

// ---------- the groups a person chooses ----------

/**
 * What an employee may choose to get on WhatsApp (owner, 24 October 2026: "Approvals waiting, Request decisions, Check-in
 * reminders, Interviews"), all on when they opt in. Approvals waiting only for those who approve.
 */
export const WHATSAPP_GROUPS = ['approvals', 'decisions', 'check_in', 'interviews'] as const;
export type WhatsAppGroup = (typeof WHATSAPP_GROUPS)[number];

export const isWhatsAppGroup = (v: unknown): v is WhatsAppGroup => typeof v === 'string' && (WHATSAPP_GROUPS as readonly string[]).includes(v);

export const WHATSAPP_GROUP_LABELS: Readonly<Record<WhatsAppGroup, { label: string; hint: string }>> = {
  approvals: {
    label: 'Approvals waiting',
    hint: 'A request waiting for your approval: leave, work from home, official duty, permission, attendance correction, reimbursement or check-in location; for the CEO, a raise or a vacancy.',
  },
  decisions: {
    label: 'Request decisions',
    hint: 'Your own requests approved or rejected, a colleague naming you to cover their leave, your payslip issued, and your access on hold or given grace.',
  },
  check_in: { label: 'Check-in reminders', hint: '“You haven’t checked in” and “Still checked in?”, at most once a day each, never at night.' },
  interviews: { label: 'Interviews', hint: 'An interview you are on as an interviewer: scheduled, moved or cancelled.' },
};

/** Every group on: what opting in starts with. */
export const ALL_WHATSAPP_GROUPS: Readonly<Record<WhatsAppGroup, boolean>> = { approvals: true, decisions: true, check_in: true, interviews: true };

/** The languages of the templates: English and Arabic. An employee chooses on opting in; a candidate gets the page's. */
export const WHATSAPP_LANGUAGES = ['en', 'ar'] as const;
export type WhatsAppLanguage = (typeof WHATSAPP_LANGUAGES)[number];

export const isWhatsAppLanguage = (v: unknown): v is WhatsAppLanguage => v === 'en' || v === 'ar';

export const WHATSAPP_LANGUAGE_LABELS: Readonly<Record<WhatsAppLanguage, string>> = { en: 'English', ar: 'العربية (Arabic)' };

// ---------- the templates ----------

/**
 * The templates, one per kind of message, each in English and Arabic, all of Meta's Utility category (about something
 * the person asked for or takes part in; never marketing). Their names on Meta are "people_" and the key.
 */
export const WHATSAPP_TEMPLATE_KEYS = [
  'approval_waiting',
  'approvals_digest',
  'request_update',
  // a colleague named to cover someone's leave (owner, 25 October 2026: "Required over 2 days"; leave-coverage.ts)
  'cover_assigned',
  'payslip_ready',
  'access_on_hold',
  'access_grace',
  'access_grace_ending',
  'check_in_reminder',
  'check_out_reminder',
  'interview_panel',
  'application_received',
  'cv_received',
  'interview_invitation',
  'interview_updated',
  'interview_cancelled',
  'interview_reminder',
  'test_message',
] as const;
export type WhatsAppTemplateKey = (typeof WHATSAPP_TEMPLATE_KEYS)[number];

export const isWhatsAppTemplateKey = (v: unknown): v is WhatsAppTemplateKey => typeof v === 'string' && (WHATSAPP_TEMPLATE_KEYS as readonly string[]).includes(v);

/** Whom a template goes to: an employee who opted in, a candidate who ticked it, or the test's number. */
export type WhatsAppAudience = 'employee' | 'candidate' | 'test';

export interface WhatsAppTemplateDef {
  key: WhatsAppTemplateKey;
  /** Its name on Meta: lower case, digits and underscores. */
  name: string;
  audience: WhatsAppAudience;
  /** The employee's choice it falls under; none for a candidate's and the test. */
  group: WhatsAppGroup | null;
  /** What it is, as HR's log names it. */
  label: string;
  /** What each variable holds, in order ({{1}} first): the same order in both languages. */
  variables: readonly string[];
  body: Readonly<Record<WhatsAppLanguage, string>>;
  /** Example values for Meta's review, in order. */
  examples: Readonly<Record<WhatsAppLanguage, readonly string[]>>;
  /** A button opening a page of the system: its words; the address is the website's, the page its one variable. */
  button?: Readonly<Record<WhatsAppLanguage, string>>;
  /** The page in the button's example ("leave/…"). */
  buttonExample?: string;
}

/** Every template's footer: how to stop the messages (STOP, or توقف, answered by the webhook). */
export const WHATSAPP_FOOTER: Readonly<Record<WhatsAppLanguage, string>> = {
  en: 'Reply STOP to stop these messages',
  ar: 'أرسل "توقف" لإيقاف هذه الرسائل',
};

/** Every template's category on Meta. */
export const WHATSAPP_CATEGORY = 'UTILITY' as const;

const OPEN = { en: 'Open Trendlix People', ar: 'افتح Trendlix People' } as const;

const def = (d: Omit<WhatsAppTemplateDef, 'name'>): WhatsAppTemplateDef => ({ ...d, name: `people_${d.key}` });

export const WHATSAPP_TEMPLATES: Readonly<Record<WhatsAppTemplateKey, WhatsAppTemplateDef>> = {
  approval_waiting: def({
    key: 'approval_waiting',
    audience: 'employee',
    group: 'approvals',
    label: 'Approval waiting',
    variables: ['Their first name', 'The request, with “a”', 'Whose and when'],
    body: {
      en: 'Hello {{1}}, {{2}} is waiting for your approval: {{3}}.\n\nOpen Trendlix People to decide.',
      ar: 'مرحبًا {{1}}، {{2}} في انتظار موافقتك: {{3}}.\n\nافتح Trendlix People لاتخاذ القرار.',
    },
    examples: { en: ['Mona', 'a leave request', 'Omar Khaled, 02/11/2026–04/11/2026'], ar: ['منى', 'طلب إجازة', 'عمر خالد، من ٠٢/١١/٢٠٢٦ إلى ٠٤/١١/٢٠٢٦'] },
    button: OPEN,
    buttonExample: 'leave/7c9e6679-7425-40de-944b-e07fc1f90ae7',
  }),
  approvals_digest: def({
    key: 'approvals_digest',
    audience: 'employee',
    group: 'approvals',
    label: 'Approvals waiting (several)',
    variables: ['Their first name', 'How many more'],
    body: {
      en: 'Hello {{1}}, you have {{2}} more to approve.\n\nOpen Trendlix People to see them all.',
      ar: 'مرحبًا {{1}}، عدد الطلبات الأخرى في انتظار موافقتك: {{2}}.\n\nافتح Trendlix People لعرضها جميعًا.',
    },
    examples: { en: ['Mona', '5'], ar: ['منى', '٥'] },
    button: OPEN,
    buttonExample: 'notifications',
  }),
  request_update: def({
    key: 'request_update',
    audience: 'employee',
    group: 'decisions',
    label: 'Request decision',
    variables: ['Their first name', 'Their request', 'Its dates', 'The decision'],
    body: {
      en: 'Hello {{1}}, there is an update on your {{2}} ({{3}}): {{4}}.\n\nOpen Trendlix People for the details.',
      ar: 'مرحبًا {{1}}، يوجد تحديث على {{2}} ({{3}}): {{4}}.\n\nافتح Trendlix People لمعرفة التفاصيل.',
    },
    examples: { en: ['Omar', 'leave request', '02/11/2026–04/11/2026', 'approved'], ar: ['عمر', 'طلب الإجازة الخاص بك', 'من ٠٢/١١/٢٠٢٦ إلى ٠٤/١١/٢٠٢٦', 'تمت الموافقة'] },
    button: OPEN,
    buttonExample: 'leave/7c9e6679-7425-40de-944b-e07fc1f90ae7',
  }),
  cover_assigned: def({
    key: 'cover_assigned',
    audience: 'employee',
    group: 'decisions',
    label: 'Covering a colleague',
    variables: ['Their first name', 'The colleague', 'The leave’s days'],
    body: {
      en: 'Hello {{1}}, {{2}} named you to cover their work while they are on leave ({{3}}).\n\nOpen Trendlix People for their handover note.',
      ar: 'مرحبًا {{1}}، اختارك {{2}} لتغطية عمله أثناء إجازته ({{3}}).\n\nافتح Trendlix People للاطلاع على ملاحظات التسليم.',
    },
    examples: { en: ['Sara', 'Omar Khaled', '12/11/2026–14/11/2026'], ar: ['سارة', 'عمر خالد', 'من ١٢/١١/٢٠٢٦ إلى ١٤/١١/٢٠٢٦'] },
    button: OPEN,
    buttonExample: 'my-requests',
  }),
  payslip_ready: def({
    key: 'payslip_ready',
    audience: 'employee',
    group: 'decisions',
    label: 'Payslip issued',
    variables: ['Their first name', 'The month'],
    body: {
      en: 'Hello {{1}}, your payslip for {{2}} is ready.\n\nOpen Trendlix People to see it.',
      ar: 'مرحبًا {{1}}، قسيمة راتبك عن شهر {{2}} جاهزة.\n\nافتح Trendlix People للاطلاع عليها.',
    },
    examples: { en: ['Omar', 'October 2026'], ar: ['عمر', 'أكتوبر ٢٠٢٦'] },
    button: OPEN,
    buttonExample: 'app/payslips/7c9e6679-7425-40de-944b-e07fc1f90ae7',
  }),
  access_on_hold: def({
    key: 'access_on_hold',
    audience: 'employee',
    group: 'decisions',
    label: 'Access on hold',
    variables: ['Their first name'],
    body: {
      en: 'Hello {{1}}, your access to Trendlix People is on hold: only check-in and check-out work until a contract in force is entered. Please contact HR.',
      ar: 'مرحبًا {{1}}، تم إيقاف وصولك إلى Trendlix People مؤقتًا: يعمل تسجيل الحضور والانصراف فقط حتى يتم تسجيل عقد سارٍ. يُرجى التواصل مع الموارد البشرية.',
    },
    examples: { en: ['Omar'], ar: ['عمر'] },
  }),
  access_grace: def({
    key: 'access_grace',
    audience: 'employee',
    group: 'decisions',
    label: 'Grace given',
    variables: ['Their first name', 'The grace’s last day'],
    body: {
      en: 'Hello {{1}}, HR gave you full access to Trendlix People until {{2}}, while your contract is renewed.',
      ar: 'مرحبًا {{1}}، منحتك الموارد البشرية وصولًا كاملًا إلى Trendlix People حتى {{2}} لحين تجديد عقدك.',
    },
    examples: { en: ['Omar', '31/10/2026'], ar: ['عمر', '٣١/١٠/٢٠٢٦'] },
  }),
  access_grace_ending: def({
    key: 'access_grace_ending',
    audience: 'employee',
    group: 'decisions',
    label: 'Grace ending',
    variables: ['Their first name', 'The grace’s last day'],
    body: {
      en: 'Hello {{1}}, your full access to Trendlix People ends after {{2}} unless your contract is renewed. Checking in and out keeps working.',
      ar: 'مرحبًا {{1}}، ينتهي وصولك الكامل إلى Trendlix People بعد {{2}} ما لم يتم تجديد عقدك. يستمر تسجيل الحضور والانصراف في العمل.',
    },
    examples: { en: ['Omar', '31/10/2026'], ar: ['عمر', '٣١/١٠/٢٠٢٦'] },
  }),
  check_in_reminder: def({
    key: 'check_in_reminder',
    audience: 'employee',
    group: 'check_in',
    label: 'Check-in reminder',
    variables: ['Their first name', 'The shift’s start'],
    body: {
      en: 'Hello {{1}}, you haven’t checked in yet. Your shift started at {{2}}.\n\nCheck in from Trendlix People.',
      ar: 'مرحبًا {{1}}، لم تسجل حضورك بعد. بدأت ورديتك الساعة {{2}}.\n\nسجّل حضورك من Trendlix People.',
    },
    examples: { en: ['Omar', '9:00 AM'], ar: ['عمر', '٩:٠٠ ص'] },
    button: OPEN,
    buttonExample: 'my-attendance',
  }),
  check_out_reminder: def({
    key: 'check_out_reminder',
    audience: 'employee',
    group: 'check_in',
    label: 'Check-out reminder',
    variables: ['Their first name', 'When they checked in'],
    body: {
      en: 'Hello {{1}}, you are still checked in since {{2}}. Remember to check out when you leave.',
      ar: 'مرحبًا {{1}}، ما زلت مسجلًا للحضور منذ الساعة {{2}}. لا تنسَ تسجيل الانصراف عند المغادرة.',
    },
    examples: { en: ['Omar', '9:05 AM'], ar: ['عمر', '٩:٠٥ ص'] },
    button: OPEN,
    buttonExample: 'my-attendance',
  }),
  interview_panel: def({
    key: 'interview_panel',
    audience: 'employee',
    group: 'interviews',
    label: 'Interview (interviewer)',
    variables: ['Their first name', 'What changed', 'The candidate', 'The job', 'When'],
    body: {
      en: 'Hello {{1}}, an interview you are on was {{2}}: {{3}} for {{4}}, on {{5}} (Cairo time).\n\nOpen Trendlix People for the details.',
      ar: 'مرحبًا {{1}}، تم {{2}} مقابلة أنت ضمن لجنتها: {{3}} لوظيفة {{4}}، يوم {{5}} بتوقيت القاهرة.\n\nافتح Trendlix People لمعرفة التفاصيل.',
    },
    examples: {
      en: ['Omar', 'scheduled', 'Sara Ali', 'Video Editor', 'Monday 2 November 2026 at 10:30 AM'],
      ar: ['عمر', 'تحديد موعد', 'Sara Ali', 'Video Editor', 'الاثنين ٢ نوفمبر ٢٠٢٦ الساعة ١٠:٣٠ ص'],
    },
    button: OPEN,
    buttonExample: 'recruitment/applicants/7c9e6679-7425-40de-944b-e07fc1f90ae7',
  }),
  application_received: def({
    key: 'application_received',
    audience: 'candidate',
    group: null,
    label: 'Application received',
    variables: ['Their first name', 'The job', 'The company', 'The reference'],
    body: {
      en: 'Hello {{1}}, thank you for applying for {{2}} at {{3}}. We received your application; its reference is {{4}}.\n\nWe will contact you about the next step if your application fits what we are looking for.',
      ar: 'مرحبًا {{1}}، شكرًا لتقديمك على وظيفة {{2}} في {{3}}. استلمنا طلبك، ورقمه المرجعي {{4}}.\n\nسنتواصل معك بشأن الخطوة التالية إذا كان طلبك مناسبًا لما نبحث عنه.',
    },
    examples: { en: ['Sara', 'Video Editor', 'TrendLIX', 'APP-2026-0042'], ar: ['سارة', 'Video Editor', 'TrendLIX', 'APP-2026-0042'] },
  }),
  cv_received: def({
    key: 'cv_received',
    audience: 'candidate',
    group: null,
    label: 'CV received',
    variables: ['Their first name', 'The company', 'The reference'],
    body: {
      en: 'Hello {{1}}, thank you for sending your CV to {{2}}. We received it; its reference is {{3}}.\n\nWhen a job that fits you opens, we will contact you.',
      ar: 'مرحبًا {{1}}، شكرًا لإرسال سيرتك الذاتية إلى {{2}}. استلمناها، ورقمها المرجعي {{3}}.\n\nسنتواصل معك عند توفر وظيفة تناسبك.',
    },
    examples: { en: ['Sara', 'TrendLIX', 'APP-2026-0043'], ar: ['سارة', 'TrendLIX', 'APP-2026-0043'] },
  }),
  interview_invitation: def({
    key: 'interview_invitation',
    audience: 'candidate',
    group: null,
    label: 'Interview invitation',
    variables: ['Their first name', 'The job', 'The company', 'The date', 'The time', 'Where'],
    body: {
      en: 'Hello {{1}}, you are invited to an interview for {{2}} at {{3}}.\n\nDate: {{4}}\nTime: {{5}} (Cairo time)\nWhere: {{6}}\n\nIf the time doesn’t suit you, please let us know by email.',
      ar: 'مرحبًا {{1}}، يسعدنا دعوتك لمقابلة لوظيفة {{2}} في {{3}}.\n\nالتاريخ: {{4}}\nالوقت: {{5}} بتوقيت القاهرة\nالمكان: {{6}}\n\nإذا لم يناسبك الموعد، يُرجى إبلاغنا عبر البريد الإلكتروني.',
    },
    examples: {
      en: ['Sara', 'Video Editor', 'TrendLIX', 'Monday 2 November 2026', '10:30 AM', 'Online (Google Meet): https://meet.google.com/abc-defg-hij'],
      ar: ['سارة', 'Video Editor', 'TrendLIX', 'الاثنين ٢ نوفمبر ٢٠٢٦', '١٠:٣٠ ص', 'عبر الإنترنت (Google Meet): https://meet.google.com/abc-defg-hij'],
    },
  }),
  interview_updated: def({
    key: 'interview_updated',
    audience: 'candidate',
    group: null,
    label: 'Interview changed',
    variables: ['Their first name', 'The job', 'The company', 'The date', 'The time', 'Where'],
    body: {
      en: 'Hello {{1}}, your interview for {{2}} at {{3}} has changed. Here it is now:\n\nDate: {{4}}\nTime: {{5}} (Cairo time)\nWhere: {{6}}\n\nIf this doesn’t suit you, please let us know by email.',
      ar: 'مرحبًا {{1}}، تم تعديل مقابلتك لوظيفة {{2}} في {{3}}، وأصبحت كالتالي:\n\nالتاريخ: {{4}}\nالوقت: {{5}} بتوقيت القاهرة\nالمكان: {{6}}\n\nإذا لم يناسبك ذلك، يُرجى إبلاغنا عبر البريد الإلكتروني.',
    },
    examples: {
      en: ['Sara', 'Video Editor', 'TrendLIX', 'Tuesday 3 November 2026', '1:00 PM', 'In person: 12 Street 9, Maadi, Cairo'],
      ar: ['سارة', 'Video Editor', 'TrendLIX', 'الثلاثاء ٣ نوفمبر ٢٠٢٦', '١:٠٠ م', 'حضوريًا: 12 Street 9, Maadi, Cairo'],
    },
  }),
  interview_cancelled: def({
    key: 'interview_cancelled',
    audience: 'candidate',
    group: null,
    label: 'Interview cancelled',
    variables: ['Their first name', 'The job', 'The company', 'When it was'],
    body: {
      en: 'Hello {{1}}, we are sorry: your interview for {{2}} at {{3}} on {{4}} is cancelled. We will be in touch about what comes next.',
      ar: 'مرحبًا {{1}}، نأسف لإبلاغك بإلغاء مقابلتك لوظيفة {{2}} في {{3}} يوم {{4}}. سنتواصل معك بشأن الخطوات التالية.',
    },
    examples: { en: ['Sara', 'Video Editor', 'TrendLIX', 'Monday 2 November 2026 at 10:30 AM'], ar: ['سارة', 'Video Editor', 'TrendLIX', 'الاثنين ٢ نوفمبر ٢٠٢٦ الساعة ١٠:٣٠ ص'] },
  }),
  interview_reminder: def({
    key: 'interview_reminder',
    audience: 'candidate',
    group: null,
    label: 'Interview tomorrow',
    variables: ['Their first name', 'The job', 'The company', 'The time', 'Where'],
    body: {
      en: 'Hello {{1}}, a reminder: your interview for {{2}} at {{3}} is tomorrow at {{4}} (Cairo time).\nWhere: {{5}}\n\nWe look forward to meeting you.',
      ar: 'مرحبًا {{1}}، تذكير: مقابلتك لوظيفة {{2}} في {{3}} غدًا الساعة {{4}} بتوقيت القاهرة.\nالمكان: {{5}}\n\nنتطلع إلى لقائك.',
    },
    examples: { en: ['Sara', 'Video Editor', 'TrendLIX', '10:30 AM', 'Online (Zoom): https://zoom.us/j/81000000001'], ar: ['سارة', 'Video Editor', 'TrendLIX', '١٠:٣٠ ص', 'عبر الإنترنت (Zoom): https://zoom.us/j/81000000001'] },
  }),
  test_message: def({
    key: 'test_message',
    audience: 'test',
    group: null,
    label: 'Test message',
    variables: ['The company'],
    body: {
      en: 'This is a test message from {{1}} on Trendlix People. WhatsApp notifications are working.',
      ar: 'هذه رسالة تجريبية من {{1}} على Trendlix People. إشعارات واتساب تعمل.',
    },
    examples: { en: ['TrendLIX'], ar: ['TrendLIX'] },
  }),
};

/** Meta's own sample template every new WhatsApp Business Account has: the test until ours is approved. */
export const WHATSAPP_HELLO_WORLD = { name: 'hello_world', language: 'en_US' } as const;

/** A template's text with its variables filled in ({{1}} the first), for the tests and a preview. */
export function whatsappPreview(key: WhatsAppTemplateKey, lang: WhatsAppLanguage, values: readonly string[]): string {
  return WHATSAPP_TEMPLATES[key].body[lang].replace(/\{\{(\d+)\}\}/g, (m, n: string) => values[Number(n) - 1] ?? m);
}

/** The numbers of a text's variables, in the order they appear: [1, 2, 3]. */
export const variablesIn = (text: string): number[] => [...text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));

/**
 * What Meta's rules refuse in a template's text, in words; empty when it may be submitted: its variables numbered 1 to N
 * in order, with words before the first and after the last and between any two, the body at most 1,024 characters.
 */
export function whatsappTemplateProblems(d: WhatsAppTemplateDef): string[] {
  const out: string[] = [];
  for (const lang of WHATSAPP_LANGUAGES) {
    const text = d.body[lang];
    const nums = variablesIn(text);
    if (nums.some((n, i) => n !== i + 1) || nums.length !== d.variables.length) out.push(`${d.name} (${lang}): its variables must be {{1}} to {{${d.variables.length}}}, in order.`);
    if (/^\s*\{\{/.test(text) || /\}\}\s*\.?\s*$/.test(text)) out.push(`${d.name} (${lang}): it may not start or end with a variable.`);
    if (/\}\}\s*\{\{/.test(text)) out.push(`${d.name} (${lang}): two variables need words between them.`);
    if (text.length > 1024) out.push(`${d.name} (${lang}): the text is longer than 1,024 characters.`);
    if (d.examples[lang].length !== d.variables.length) out.push(`${d.name} (${lang}): one example for each variable.`);
    if (d.button && d.button[lang].length > 25) out.push(`${d.name} (${lang}): the button’s words are longer than 25 characters.`);
  }
  if (!/^[a-z0-9_]{1,512}$/.test(d.name)) out.push(`${d.name}: a name is lower case letters, digits and underscores.`);
  return out;
}

/**
 * The request that submits a template in a language (POST /{waba-id}/message_templates): its body with the examples,
 * the footer, and the button opening a page of the website (`origin`), its page the button's variable.
 */
export function whatsappTemplateRequest(key: WhatsAppTemplateKey, lang: WhatsAppLanguage, origin: string): Record<string, unknown> {
  const d = WHATSAPP_TEMPLATES[key];
  const site = origin.replace(/\/+$/, '');
  const components: Record<string, unknown>[] = [
    { type: 'BODY', text: d.body[lang], ...(d.variables.length ? { example: { body_text: [[...d.examples[lang]]] } } : {}) },
    { type: 'FOOTER', text: WHATSAPP_FOOTER[lang] },
  ];
  if (d.button) components.push({ type: 'BUTTONS', buttons: [{ type: 'URL', text: d.button[lang], url: `${site}/{{1}}`, example: [`${site}/${d.buttonExample ?? 'notifications'}`] }] });
  return { name: d.name, language: lang, category: WHATSAPP_CATEGORY, components };
}

/** The longest a variable's value may be (Meta takes the whole message up to 1,024 characters). */
export const WHATSAPP_PARAM_MAX = 200;
/** "Where" (an address, or a meeting's link) may be longer. */
export const WHATSAPP_WHERE_MAX = 300;

/**
 * A variable's value as Meta takes it: on one line (Meta refuses a line break, a tab, or more than four spaces in a row),
 * at most `max` characters, never empty ("–" for nothing).
 */
export function whatsappParam(value: unknown, max = WHATSAPP_PARAM_MAX): string {
  const t = String(value ?? '')
    .replace(/[\r\n\t\u2028\u2029]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!t) return '–';
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** The page a button opens, from a notification's link ("/leave/7c9e…" → "leave/7c9e…"); the inbox when none. */
export function whatsappButtonPage(link: string | null | undefined): string {
  const page = String(link ?? '').trim().replace(/^\/+/, '');
  return page && !/[\s\\]/.test(page) && page.length <= 300 ? page : 'notifications';
}

/**
 * The message Meta sends (POST /{phone-number-id}/messages): an approved template in a language, its variables, and the
 * button's page.
 */
export function whatsappTemplateMessage(to: string, template: { name: string; language: string }, body: readonly string[], button: string | null): Record<string, unknown> {
  const components: Record<string, unknown>[] = [];
  if (body.length) components.push({ type: 'body', parameters: body.map((text) => ({ type: 'text', text })) });
  if (button !== null) components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: button }] });
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: { name: template.name, language: { code: template.language }, ...(components.length ? { components } : {}) },
  };
}

/** A plain text (the STOP confirmation, free within the 24 hours after the person wrote). */
export const whatsappTextMessage = (to: string, body: string): Record<string, unknown> => ({
  messaging_product: 'whatsapp',
  recipient_type: 'individual',
  to,
  type: 'text',
  text: { preview_url: false, body },
});

// ---------- what each message says: names, dates and references ----------

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

const digits = (text: string, lang: WhatsAppLanguage) => (lang === 'ar' ? toArabicDigits(text) : text);

/** A day as the messages write it: "02/11/2026"; in Arabic "٠٢/١١/٢٠٢٦" (Arabic digits, 22 October 2026). */
export function whatsappDate(ymd: string, lang: WhatsAppLanguage): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  return m ? digits(`${m[3]}/${m[2]}/${m[1]}`, lang) : ymd;
}

/** A month "2026-10" as "October 2026" / "أكتوبر ٢٠٢٦". */
export function whatsappMonth(month: string, lang: WhatsAppLanguage): string {
  const m = /^(\d{4})-(\d{2})/.exec(month);
  if (!m) return month;
  const i = Number(m[2]) - 1;
  return lang === 'ar' ? `${MONTHS_AR[i]} ${toArabicDigits(m[1])}` : `${MONTHS_EN[i]} ${m[1]}`;
}

/** Days from one to another: "02/11/2026–04/11/2026" / "من ٠٢/١١/٢٠٢٦ إلى ٠٤/١١/٢٠٢٦"; one day alone; "(half day)". */
export function whatsappSpan(span: WhatsAppSpan, lang: WhatsAppLanguage): string {
  if (span.from === span.to) return `${whatsappDate(span.from, lang)}${span.halfDay ? (lang === 'ar' ? ' (نصف يوم)' : ' (half day)') : ''}`;
  return lang === 'ar' ? `من ${whatsappDate(span.from, lang)} إلى ${whatsappDate(span.to, lang)}` : `${whatsappDate(span.from, lang)}–${whatsappDate(span.to, lang)}`;
}

const CLOCK_EN = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit', hour12: true });
const CLOCK_AR = new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit', hour12: true });
const DAY_EN = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const DAY_AR = new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

const tidySpaces = (t: string) => t.replace(/[\u00a0\u202f]/g, ' ');

/** A moment's time in Cairo: "10:30 AM" / "١٠:٣٠ ص". */
export const whatsappTime = (moment: Date | string | number, lang: WhatsAppLanguage): string => tidySpaces((lang === 'ar' ? CLOCK_AR : CLOCK_EN).format(new Date(moment)));

/** A moment's day in Cairo with its weekday: "Monday 2 November 2026" / "الاثنين، ٢ نوفمبر ٢٠٢٦". */
export const whatsappDay = (moment: Date | string | number, lang: WhatsAppLanguage): string =>
  tidySpaces((lang === 'ar' ? DAY_AR : DAY_EN).format(new Date(moment))).replace(/^(\p{L}+),/u, '$1');

/** A time of day "09:00" as the messages say it: "9:00 AM" / "٩:٠٠ ص". */
export function whatsappClock(hhmm: string, lang: WhatsAppLanguage): string {
  const m = /^([01]\d|2[0-3]):([0-5]\d)/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const text = `${h % 12 === 0 ? 12 : h % 12}:${m[2]}`;
  return lang === 'ar' ? `${toArabicDigits(text)} ${h < 12 ? 'ص' : 'م'}` : `${text} ${h < 12 ? 'AM' : 'PM'}`;
}

/** The first word of a name, as the greeting uses it ("Hello Mona"). */
export const firstNameOf = (name: string | null | undefined): string => String(name ?? '').trim().split(/\s+/)[0] ?? '';

/** Days, as the facts carry them: from and to (YYYY-MM-DD), and a half day. */
export interface WhatsAppSpan {
  from: string;
  to: string;
  halfDay?: boolean;
}

/** A person's name in both languages (the Arabic when the record has one). */
export interface WhatsAppName {
  en: string;
  ar?: string | null;
}

const nameIn = (n: WhatsAppName, lang: WhatsAppLanguage) => (lang === 'ar' && n.ar?.trim() ? n.ar.trim() : n.en.trim());

/** The requests a message about an approval or a decision names. */
export type WhatsAppRequestWhat = 'leave' | 'permission' | 'correction' | 'wfh' | 'od' | 'reimbursement' | 'home' | 'remote_site' | 'client';
export type WhatsAppApprovalWhat = WhatsAppRequestWhat | 'raise' | 'vacancy';

const REQUEST_NAMES: Readonly<Record<WhatsAppApprovalWhat, { a: string; noun: string; ar: string; arYours: string }>> = {
  leave: { a: 'a leave request', noun: 'leave request', ar: 'طلب إجازة', arYours: 'طلب الإجازة الخاص بك' },
  permission: { a: 'a permission request', noun: 'permission request', ar: 'طلب إذن', arYours: 'طلب الإذن الخاص بك' },
  correction: { a: 'an attendance correction', noun: 'attendance correction', ar: 'طلب تصحيح حضور', arYours: 'طلب تصحيح الحضور الخاص بك' },
  wfh: { a: 'a work from home request', noun: 'work from home request', ar: 'طلب عمل من المنزل', arYours: 'طلب العمل من المنزل الخاص بك' },
  od: { a: 'an official duty request', noun: 'official duty request', ar: 'طلب مأمورية', arYours: 'طلب المأمورية الخاص بك' },
  reimbursement: { a: 'a reimbursement claim', noun: 'reimbursement claim', ar: 'طلب استرداد مصروفات', arYours: 'طلب استرداد المصروفات الخاص بك' },
  home: { a: 'a home location', noun: 'home location request', ar: 'طلب موقع المنزل', arYours: 'طلب موقع المنزل الخاص بك' },
  remote_site: { a: 'a remote site', noun: 'remote site request', ar: 'طلب موقع عمل خارجي', arYours: 'طلب موقع العمل الخارجي الخاص بك' },
  client: { a: 'a client location', noun: 'client location request', ar: 'طلب موقع عميل', arYours: 'طلب موقع العميل الخاص بك' },
  raise: { a: 'a raise', noun: 'raise', ar: 'زيادة راتب', arYours: 'زيادة الراتب' },
  vacancy: { a: 'a vacancy', noun: 'vacancy', ar: 'وظيفة شاغرة', arYours: 'الوظيفة الشاغرة' },
};

/** A decision as the update names it. */
export type WhatsAppOutcome = 'approved' | 'rejected' | 'cancelled' | 'first_step';

/** The words of a decision: "approved", "cancelled by HR", "approved by HR, now with the CEO", the claim's pay month. */
function outcomeText(o: { outcome: WhatsAppOutcome; payMonth?: string | null; firstStepBy?: 'hr' | 'ceo' | null }, lang: WhatsAppLanguage): string {
  if (lang === 'ar') {
    if (o.outcome === 'rejected') return 'تم الرفض';
    if (o.outcome === 'cancelled') return 'تم الإلغاء من الموارد البشرية';
    if (o.outcome === 'first_step') return o.firstStepBy === 'ceo' ? 'تمت الموافقة من الرئيس التنفيذي' : 'تمت الموافقة من الموارد البشرية، وهو الآن لدى الرئيس التنفيذي';
    return o.payMonth ? `تمت الموافقة، وسيتم الصرف مع رواتب شهر ${whatsappMonth(o.payMonth, 'ar')}` : 'تمت الموافقة';
  }
  if (o.outcome === 'rejected') return 'rejected';
  if (o.outcome === 'cancelled') return 'cancelled by HR';
  if (o.outcome === 'first_step') return o.firstStepBy === 'ceo' ? 'approved by the CEO' : 'approved by HR, now with the CEO';
  return o.payMonth ? `approved, to be paid with the ${whatsappMonth(o.payMonth, 'en')} payroll` : 'approved';
}

/** How an interview takes place, for a candidate: "Online (Google Meet): <link>", "In person: <address>", "By phone: …". */
export interface WhatsAppInterviewPlace {
  kind: 'in_person' | 'online' | 'phone';
  location: string | null;
  meetingName?: string | null;
  company: string;
  mobile?: string | null;
}

export function whatsappWhere(p: WhatsAppInterviewPlace, lang: WhatsAppLanguage): string {
  const meeting = p.meetingName ? ` (${p.meetingName})` : '';
  if (lang === 'ar') {
    if (p.kind === 'online') return `عبر الإنترنت${meeting}: ${p.location ?? ''}`.trim();
    if (p.kind === 'phone') return p.location ? `عبر الهاتف: ${p.location}` : `عبر الهاتف: سنتصل بك${p.mobile ? ` على ${p.mobile}` : ''}`;
    return `حضوريًا: ${p.location ?? p.company}`;
  }
  if (p.kind === 'online') return `Online${meeting}: ${p.location ?? ''}`.trim();
  if (p.kind === 'phone') return p.location ? `By phone: ${p.location}` : `By phone: we will call you${p.mobile ? ` on ${p.mobile}` : ''}`;
  return `In person: ${p.location ?? p.company}`;
}

/** What changed on an interview, as its interviewers are told: scheduled, moved, cancelled, or taken off the panel. */
export type WhatsAppPanelChange = 'scheduled' | 'moved' | 'cancelled' | 'dropped';

const PANEL_CHANGES: Readonly<Record<WhatsAppPanelChange, Record<WhatsAppLanguage, string>>> = {
  scheduled: { en: 'scheduled', ar: 'تحديد موعد' },
  moved: { en: 'changed', ar: 'تعديل' },
  cancelled: { en: 'cancelled', ar: 'إلغاء' },
  dropped: { en: 'cancelled for you', ar: 'إلغاء مشاركتك في' },
};

/**
 * What a message is about, as the flow that sends it knows it: the template and its facts (names, days, references),
 * from which each language's variables are made. Never an amount, a reason or a comment.
 */
export type WhatsAppFacts =
  | { template: 'approval_waiting'; what: WhatsAppApprovalWhat; who: WhatsAppName; span?: WhatsAppSpan | null }
  | { template: 'approvals_digest'; count: number }
  | { template: 'request_update'; what: WhatsAppRequestWhat; span: WhatsAppSpan; outcome: WhatsAppOutcome; payMonth?: string | null; firstStepBy?: 'hr' | 'ceo' | null }
  | { template: 'cover_assigned'; who: WhatsAppName; span: WhatsAppSpan }
  | { template: 'payslip_ready'; month: string }
  | { template: 'access_on_hold' }
  | { template: 'access_grace'; until: string }
  | { template: 'access_grace_ending'; lastDay: string }
  | { template: 'check_in_reminder'; shiftStart: string }
  | { template: 'check_out_reminder'; checkedInAt: string }
  | { template: 'interview_panel'; change: WhatsAppPanelChange; candidate: string; job: string; at: string }
  | { template: 'application_received'; name: string; job: string; company: string; reference: string }
  | { template: 'cv_received'; name: string; company: string; reference: string }
  | { template: 'interview_invitation' | 'interview_updated'; name: string; job: string; company: string; at: string; place: WhatsAppInterviewPlace }
  | { template: 'interview_cancelled'; name: string; job: string; company: string; at: string }
  | { template: 'interview_reminder'; name: string; job: string; company: string; at: string; place: WhatsAppInterviewPlace }
  | { template: 'test_message'; company: string };

/** A message ready to send: its template, the variables in order, and the button's page (null: no button). */
export interface WhatsAppContent {
  template: WhatsAppTemplateKey;
  body: string[];
  button: string | null;
}

/** The moment "on Monday 2 November 2026 at 10:30 AM" / "الاثنين ٢ نوفمبر ٢٠٢٦ الساعة ١٠:٣٠ ص". */
const dayAndTime = (at: string, lang: WhatsAppLanguage) => `${whatsappDay(at, lang)} ${lang === 'ar' ? 'الساعة' : 'at'} ${whatsappTime(at, lang)}`;

/**
 * A message's variables in a language, from its facts. `firstName`: an employee's, in the language (their Arabic name's
 * when they have one); a candidate's comes from the facts. `link`: the notification's page, for the button.
 */
export function whatsappContent(facts: WhatsAppFacts, lang: WhatsAppLanguage, ctx: { firstName?: string | null; link?: string | null } = {}): WhatsAppContent {
  const d = WHATSAPP_TEMPLATES[facts.template];
  const hello = whatsappParam(ctx.firstName || (lang === 'ar' ? 'زميلنا' : 'there'));
  const button = d.button ? whatsappButtonPage(ctx.link) : null;
  const p = (v: unknown, max?: number) => whatsappParam(v, max);
  const out = (body: unknown[]): WhatsAppContent => ({ template: facts.template, body: body.map((v) => p(v)), button });
  switch (facts.template) {
    case 'approval_waiting': {
      const n = REQUEST_NAMES[facts.what];
      const who = nameIn(facts.who, lang);
      return out([hello, lang === 'ar' ? n.ar : n.a, facts.span ? `${who}${lang === 'ar' ? '، ' : ', '}${whatsappSpan(facts.span, lang)}` : who]);
    }
    case 'approvals_digest':
      return out([hello, digits(String(facts.count), lang)]);
    case 'request_update': {
      const n = REQUEST_NAMES[facts.what];
      return out([hello, lang === 'ar' ? n.arYours : n.noun, whatsappSpan(facts.span, lang), outcomeText(facts, lang)]);
    }
    case 'cover_assigned':
      return out([hello, nameIn(facts.who, lang), whatsappSpan(facts.span, lang)]);
    case 'payslip_ready':
      return out([hello, whatsappMonth(facts.month, lang)]);
    case 'access_on_hold':
      return out([hello]);
    case 'access_grace':
      return out([hello, whatsappDate(facts.until, lang)]);
    case 'access_grace_ending':
      return out([hello, whatsappDate(facts.lastDay, lang)]);
    case 'check_in_reminder':
      return out([hello, whatsappClock(facts.shiftStart, lang)]);
    case 'check_out_reminder':
      return out([hello, whatsappTime(facts.checkedInAt, lang)]);
    case 'interview_panel':
      return out([hello, PANEL_CHANGES[facts.change][lang], facts.candidate, facts.job, dayAndTime(facts.at, lang)]);
    case 'application_received':
      return out([firstNameOf(facts.name) || hello, facts.job, facts.company, facts.reference]);
    case 'cv_received':
      return out([firstNameOf(facts.name) || hello, facts.company, facts.reference]);
    case 'interview_invitation':
    case 'interview_updated':
      return {
        template: facts.template,
        body: [p(firstNameOf(facts.name) || hello), p(facts.job), p(facts.company), p(whatsappDay(facts.at, lang)), p(whatsappTime(facts.at, lang)), p(whatsappWhere(facts.place, lang), WHATSAPP_WHERE_MAX)],
        button: null,
      };
    case 'interview_cancelled':
      return out([firstNameOf(facts.name) || hello, facts.job, facts.company, dayAndTime(facts.at, lang)]);
    case 'interview_reminder':
      return {
        template: facts.template,
        body: [p(firstNameOf(facts.name) || hello), p(facts.job), p(facts.company), p(whatsappTime(facts.at, lang)), p(whatsappWhere(facts.place, lang), WHATSAPP_WHERE_MAX)],
        button: null,
      };
    case 'test_message':
      return out([facts.company]);
  }
}

// ---------- which notifications go on WhatsApp ----------

/**
 * The notifications WhatsApp is added to (WhatsApp is a channel, not new kinds), each under the group an employee
 * chooses, with the templates its facts may name. Everything else stays on the bell, push and email only.
 * - Approvals waiting: the *_waiting kinds for the approver of the step (leave, work from home, official duty,
 *   permission, attendance correction, reimbursement, check-in location; for the CEO a raise and a vacancy).
 * - Request decisions: the *_decided kinds for the requester (a check-in location's too), a colleague naming them to cover
 *   their leave (25 October 2026), the payslip issued, access on hold, grace given and grace ending.
 * - Check-in reminders: "You haven't checked in" and "Still checked in?" (one WhatsApp a kind a day).
 * - Interviews: the interview scheduled, moved or cancelled, for its interviewers.
 */
export const WHATSAPP_NOTIFICATION_KINDS: Readonly<Partial<Record<NotificationKind, { group: WhatsAppGroup; templates: readonly WhatsAppTemplateKey[] }>>> = {
  leave_waiting: { group: 'approvals', templates: ['approval_waiting'] },
  permission_waiting: { group: 'approvals', templates: ['approval_waiting'] },
  correction_waiting: { group: 'approvals', templates: ['approval_waiting'] },
  wfh_waiting: { group: 'approvals', templates: ['approval_waiting'] },
  od_waiting: { group: 'approvals', templates: ['approval_waiting'] },
  reimbursement_waiting: { group: 'approvals', templates: ['approval_waiting'] },
  home_location_waiting: { group: 'approvals', templates: ['approval_waiting'] },
  pay_raise_waiting: { group: 'approvals', templates: ['approval_waiting'] },
  vacancy_waiting: { group: 'approvals', templates: ['approval_waiting'] },
  leave_decided: { group: 'decisions', templates: ['request_update'] },
  permission_decided: { group: 'decisions', templates: ['request_update'] },
  correction_decided: { group: 'decisions', templates: ['request_update'] },
  wfh_decided: { group: 'decisions', templates: ['request_update'] },
  od_decided: { group: 'decisions', templates: ['request_update'] },
  reimbursement_decided: { group: 'decisions', templates: ['request_update'] },
  home_location_decided: { group: 'decisions', templates: ['request_update'] },
  // a colleague named to cover someone's leave (25 October 2026); "no longer covering" stays on the bell and push
  leave_cover: { group: 'decisions', templates: ['cover_assigned'] },
  payslip_issued: { group: 'decisions', templates: ['payslip_ready'] },
  access_hold: { group: 'decisions', templates: ['access_on_hold'] },
  access_grace: { group: 'decisions', templates: ['access_grace'] },
  access_grace_ending: { group: 'decisions', templates: ['access_grace_ending'] },
  check_in_reminder: { group: 'check_in', templates: ['check_in_reminder'] },
  check_out_reminder: { group: 'check_in', templates: ['check_out_reminder'] },
  interview_scheduled: { group: 'interviews', templates: ['interview_panel'] },
};

/** The group a notification's WhatsApp falls under; null when WhatsApp isn't added to its kind. */
export const whatsappGroupOf = (kind: string): WhatsAppGroup | null => WHATSAPP_NOTIFICATION_KINDS[kind as NotificationKind]?.group ?? null;

/** The template a notification goes with on WhatsApp: its facts' own, when its kind takes it; else null (none sent). */
export function whatsappTemplateFor(kind: string, facts: WhatsAppFacts | null | undefined): WhatsAppTemplateKey | null {
  const entry = WHATSAPP_NOTIFICATION_KINDS[kind as NotificationKind];
  if (!entry || !facts) return null;
  return entry.templates.includes(facts.template) ? facts.template : null;
}

/** The reminders sent at most once a kind a day on WhatsApp, and dropped (never held) when they fall in quiet hours. */
export const WHATSAPP_REMINDER_TEMPLATES: readonly WhatsAppTemplateKey[] = ['check_in_reminder', 'check_out_reminder'];

/**
 * Approvals waiting, one message per item (each with its own button), up to WHATSAPP_DIGEST_AFTER within
 * WHATSAPP_DIGEST_MINUTES; any more in that time gathered into one "you have N more to approve" sent when the 10
 * minutes end (a burst, e.g. the morning's leave requests, costs one message instead of many). The bell and push keep
 * every one.
 */
export const WHATSAPP_DIGEST_AFTER = 3;
export const WHATSAPP_DIGEST_MINUTES = 10;

// ---------- quiet hours ----------

/** No WhatsApp between 22:00 and 08:00 Cairo unless changed (the brief: "configurable"). */
export const WHATSAPP_QUIET_DEFAULT = { from: '22:00', to: '08:00' } as const;

export interface WhatsAppQuietHours {
  from: string;
  to: string;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const isTimeOfDay = (v: unknown): v is string => typeof v === 'string' && HHMM.test(v);

const CAIRO_HM = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** A moment's time of day in Cairo, "HH:mm". */
export const cairoTimeOfDay = (moment: Date | number): string => CAIRO_HM.format(new Date(moment)).replace(/^24/, '00');

/** Whether a moment falls in quiet hours (none, or from = to: never). Overnight hours (22:00–08:00) cross midnight. */
export function inQuietHours(moment: Date | number, quiet: WhatsAppQuietHours | null | undefined): boolean {
  if (!quiet || !isTimeOfDay(quiet.from) || !isTimeOfDay(quiet.to) || quiet.from === quiet.to) return false;
  const m = minutesOf(cairoTimeOfDay(moment));
  const f = minutesOf(quiet.from);
  const t = minutesOf(quiet.to);
  return f < t ? m >= f && m < t : m >= f || m < t;
}

const nextDay = (ymd: string) => new Date(Date.parse(`${ymd}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** When the quiet hours a moment is in end (08:00 Cairo, that day or the next); the moment itself when it isn't in them. */
export function quietHoursEnd(moment: Date | number, quiet: WhatsAppQuietHours | null | undefined): number {
  const at = new Date(moment).getTime();
  if (!quiet || !inQuietHours(at, quiet)) return at;
  const day = cairoDay(at);
  const today = zonedMoment(day, quiet.to);
  return today > at ? today : zonedMoment(nextDay(day), quiet.to);
}

// ---------- STOP ----------

/** The words that stop the messages (owner's brief: "STOP" / "توقف"), however written: in any case, with spaces or a full stop. */
export const WHATSAPP_STOP_WORDS = ['stop', 'توقف'] as const;

/** Whether a message someone sent is STOP or توقف (and nothing else): the webhook opts their number out. */
export function isStopWord(text: unknown): boolean {
  if (typeof text !== 'string' || text.length > 40) return false;
  const t = text
    .normalize('NFKC')
    // the Arabic marks and the stretching line (تـوقـف, تَوَقَّفْ)
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[\s.!?؟،,;:"'«»()[\]*_~\-]+/g, '')
    .toLowerCase();
  return (WHATSAPP_STOP_WORDS as readonly string[]).includes(t);
}

/** The answer to STOP (free: within the 24 hours after they wrote), in the language they wrote it in. */
export function whatsappStopConfirmation(lang: WhatsAppLanguage, company: string): string {
  return lang === 'ar'
    ? `تم. لن تصلك رسائل واتساب من ${company} على Trendlix People بعد الآن.`
    : `Done. You won’t get WhatsApp messages from ${company} on Trendlix People any more.`;
}

// ---------- the messages kept ----------

/** A message's life: waiting (for its time, or quiet hours to end), being sent, then Meta's statuses; or failed, or cancelled. */
export const WHATSAPP_MESSAGE_STATUSES = ['queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'cancelled'] as const;
export type WhatsAppMessageStatus = (typeof WHATSAPP_MESSAGE_STATUSES)[number];

export const isWhatsAppMessageStatus = (v: unknown): v is WhatsAppMessageStatus => typeof v === 'string' && (WHATSAPP_MESSAGE_STATUSES as readonly string[]).includes(v);

export const WHATSAPP_MESSAGE_STATUS_LABELS: Readonly<Record<WhatsAppMessageStatus, string>> = {
  queued: 'Waiting',
  sending: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Failed',
  cancelled: 'Not sent',
};

/** Meta's statuses, in the order a message moves through them: a later one never goes back to an earlier. */
export const WHATSAPP_STATUS_ORDER: Readonly<Record<'sent' | 'delivered' | 'read', number>> = { sent: 1, delivered: 2, read: 3 };

/** Tries at sending a message before it fails, and the waits between them (minutes). */
export const WHATSAPP_RETRY_MINUTES = [1, 5, 30, 120] as const;
export const WHATSAPP_MAX_ATTEMPTS = WHATSAPP_RETRY_MINUTES.length + 1;

/** How long a message may wait to be sent (quiet hours, retries); a reminder much less. */
export const WHATSAPP_SEND_WITHIN_HOURS = 24;
export const WHATSAPP_REMINDER_WITHIN_MINUTES = 30;

/** The candidate's reminder the day before an interview goes from this time (Cairo). */
export const WHATSAPP_INTERVIEW_REMINDER_FROM = '10:00';

/** How many messages a round sends at most (every 15 seconds: about 80 a minute, well within Meta's own limits). */
export const WHATSAPP_SEND_PER_ROUND = 20;
export const WHATSAPP_ROUND_SECONDS = 15;

// ---------- the settings ----------

export const WHATSAPP_LIMITS = { id: 30, token: 1024, appSecret: 128, phone: 20 } as const;

/** The refusals. */
export const WHATSAPP_SETTINGS_SUPER_ADMIN_ONLY = 'Only a Super Admin can see or change the WhatsApp settings.';
export const WHATSAPP_SETTINGS_OWN_ACCOUNT = 'Switch back to your own account to see or change the WhatsApp settings.';
export const WHATSAPP_LOG_STAFF_ONLY = 'Only HR and a Super Admin see the WhatsApp messages.';
export const WHATSAPP_OPT_IN_OWN = 'Only the person themself turns WhatsApp messages on, from their own account.';
export const WHATSAPP_TOKEN_UNREADABLE = 'The saved access token can’t be read any more: paste it again.';
export const WHATSAPP_SECRET_UNREADABLE = 'The saved app secret can’t be read any more: paste it again.';

/** A template's status at Meta (as the sync read it), and before it was submitted. */
export const WHATSAPP_TEMPLATE_STATUSES = ['not_submitted', 'pending', 'approved', 'rejected', 'paused', 'disabled', 'in_appeal', 'other'] as const;
export type WhatsAppTemplateStatus = (typeof WHATSAPP_TEMPLATE_STATUSES)[number];

export const WHATSAPP_TEMPLATE_STATUS_LABELS: Readonly<Record<WhatsAppTemplateStatus, string>> = {
  not_submitted: 'Not submitted',
  pending: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
  paused: 'Paused by Meta',
  disabled: 'Disabled by Meta',
  in_appeal: 'In appeal',
  other: 'Other',
};

/** Meta's word for a status ("APPROVED", "PENDING", "REJECTED"…) as ours. */
export function templateStatusOf(meta: unknown): WhatsAppTemplateStatus {
  const s = String(meta ?? '').toUpperCase();
  if (s === 'APPROVED') return 'approved';
  if (s === 'PENDING' || s === 'IN_REVIEW' || s === 'PENDING_DELETION') return s === 'PENDING_DELETION' ? 'other' : 'pending';
  if (s === 'REJECTED') return 'rejected';
  if (s === 'PAUSED') return 'paused';
  if (s === 'DISABLED') return 'disabled';
  if (s === 'IN_APPEAL') return 'in_appeal';
  return s ? 'other' : 'not_submitted';
}

/** Meta's reason for a rejection ("INVALID_FORMAT", "TAG_CONTENT_MISMATCH"…) in words; its own words for one we don't know. */
export function templateReasonText(reason: unknown): string | null {
  const r = String(reason ?? '').trim();
  if (!r || r.toUpperCase() === 'NONE') return null;
  const known: Record<string, string> = {
    INVALID_FORMAT: 'Meta found its format invalid.',
    TAG_CONTENT_MISMATCH: 'Meta found the text doesn’t fit the Utility category.',
    INCORRECT_CATEGORY: 'Meta found the text doesn’t fit the Utility category.',
    ABUSIVE_CONTENT: 'Meta found the content against its policies.',
    PROMOTIONAL: 'Meta found it promotional (marketing), not utility.',
    SCAM: 'Meta flagged it as a possible scam.',
  };
  return known[r.toUpperCase()] ?? r;
}

/** The setup, as the page shows it: the owner's short, exact steps. */
export const WHATSAPP_SETUP_STEPS: readonly { title: string; text: string }[] = [
  {
    title: 'Business verification',
    text: 'In Meta Business Suite (business.facebook.com) → Settings → Security Center, start Business verification with the company’s commercial register and address, and wait for Meta’s approval.',
  },
  {
    title: 'Create the app with the WhatsApp product',
    text: 'At developers.facebook.com → My Apps → Create app: the Business type, the company’s business portfolio, then add the WhatsApp product. This also makes the WhatsApp Business Account.',
  },
  {
    title: 'Add and verify the number',
    text: 'In WhatsApp Manager → Phone numbers → Add: a dedicated number not used on the WhatsApp app, its display name, and the code Meta sends by SMS or call. Add a payment method there too (Meta charges per message).',
  },
  {
    title: 'Create a system user and a permanent token',
    text: 'Business settings → Users → System users → Add (Admin). Assign it the app and the WhatsApp Business Account with full control, then Generate token: the app, expiry Never, permissions whatsapp_business_messaging and whatsapp_business_management. Copy the token.',
  },
  {
    title: 'Set the webhook',
    text: 'In the app → WhatsApp → Configuration → Webhook → Edit: paste the webhook URL and the verify token shown on this page, Verify and save, then Manage → subscribe to messages.',
  },
  {
    title: 'Paste everything here',
    text: 'The phone number ID and the WhatsApp Business Account ID (WhatsApp → API Setup), the number as people see it, the token, and the app secret (App settings → Basic). Save, send a test message, then Submit templates and Sync status until Meta approves them.',
  },
];

/** The settings as GET /whatsapp/settings answers them: never the access token or the app secret, nor any part of them. */
export interface WhatsAppSettingsView {
  /** How the messages go now (25 October 2026: "Add Twilio as a choice"): Meta directly, or Twilio (`twilio` below). */
  provider: WhatsAppProvider;
  phoneNumberId: string | null;
  businessAccountId: string | null;
  /** The number as people see it, +201012345678. */
  displayPhone: string | null;
  tokenSet: boolean;
  /** A token is saved but can't be read with the server's key any more (WHATSAPP_TOKEN_UNREADABLE). */
  tokenUnreadable: boolean;
  appSecretSet: boolean;
  appSecretUnreadable: boolean;
  /** Made by the system, pasted in Meta beside the webhook's address (shown with Copy). */
  verifyToken: string;
  webhookUrl: string;
  enabled: boolean;
  /** Quiet hours in Cairo; null: none (messages at any hour). */
  quietHours: WhatsAppQuietHours | null;
  /** What the settings of the provider chosen lack to be used, in words; empty when complete. */
  missing: string[];
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
  lastTest: WhatsAppTestView | null;
  /** Each template in each language, as Meta last said (the sync). */
  templates: WhatsAppTemplateStatusView[];
  templatesSyncedAt: string | null;
  /** Meta's webhook: when it was last verified, and when Meta last called it with something signed. */
  webhook: { verifiedAt: string | null; lastEventAt: string | null };
  /** Twilio's settings and its own templates' approval (whatsapp-twilio.ts): never the Auth Token. */
  twilio: WhatsAppTwilioView;
  /** Whether WhatsApp messages go now, and why not in words. */
  sending: { on: boolean; why: string | null };
}

export interface WhatsAppTemplateStatusView {
  key: WhatsAppTemplateKey;
  name: string;
  label: string;
  language: WhatsAppLanguage;
  category: typeof WHATSAPP_CATEGORY;
  status: WhatsAppTemplateStatus;
  reason: string | null;
  submittedAt: string | null;
  syncedAt: string | null;
}

/** A test message's result: sent (with what), or why not in plain words. */
export interface WhatsAppTestView {
  at: string;
  ok: boolean;
  message: string;
}

/** What PUT /whatsapp/settings takes. A token or app secret left empty keeps the saved one. */
export interface WhatsAppSettingsInput {
  /** Meta directly or Twilio; left out, the saved one stays. */
  provider?: WhatsAppProvider;
  phoneNumberId: string | null;
  businessAccountId: string | null;
  displayPhone: string | null;
  accessToken?: string | null;
  appSecret?: string | null;
  enabled: boolean;
  /** Quiet hours on, from and to ("HH:mm", Cairo). */
  quietHours: boolean;
  quietFrom?: string | null;
  quietTo?: string | null;
  /** Twilio's (whatsapp-twilio.ts): left out, the saved one stays; an empty Auth Token box keeps the saved one too. */
  twilioAccountSid?: string | null;
  twilioAuthToken?: string | null;
  /** whatsapp:+20…, or a Messaging Service SID (MG…). */
  twilioSender?: string | null;
}

/** What submitting or syncing the templates came to. */
export interface WhatsAppTemplatesResult {
  ok: boolean;
  message: string;
  templates: WhatsAppTemplateStatusView[];
}

const META_ID = /^\d{5,30}$/;
const TOKEN = /^[A-Za-z0-9_\-.|=]+$/;
const SECRET = /^[A-Za-z0-9]+$/;

/**
 * What is wrong with the settings to save, in words; empty when fine. `tokenSaved`, `secretSaved`: a readable one is
 * saved, so an empty box keeps it. Switched off, they may be saved unfinished; and while Twilio sends (25 October 2026),
 * Meta's may be (whatsapp-twilio.ts whatsappTwilioProblems checks Twilio's).
 */
export function whatsappSettingsProblems(input: Partial<WhatsAppSettingsInput>, opts: { tokenSaved: boolean; secretSaved: boolean }): string[] {
  const out: string[] = [];
  const id = input.phoneNumberId?.trim() ?? '';
  if (id && !META_ID.test(id)) out.push('The phone number ID is the long number in WhatsApp → API Setup, digits only.');
  const waba = input.businessAccountId?.trim() ?? '';
  if (waba && !META_ID.test(waba)) out.push('The WhatsApp Business Account ID is the long number in WhatsApp → API Setup, digits only.');
  const phone = input.displayPhone?.trim() ?? '';
  if (phone && !phoneOk(phoneTidy(phone))) out.push('Write the business number with its country code, e.g. +20 100 123 4567.');
  const token = input.accessToken ?? '';
  if (token && (token.length > WHATSAPP_LIMITS.token || !TOKEN.test(token.trim()))) out.push('Paste the access token on its own, on one line, as Meta gave it.');
  const secret = input.appSecret ?? '';
  if (secret && (secret.length > WHATSAPP_LIMITS.appSecret || !SECRET.test(secret.trim()))) out.push('Paste the app secret as App settings → Basic shows it: letters and digits.');
  if (input.quietHours) {
    if (!isTimeOfDay(input.quietFrom) || !isTimeOfDay(input.quietTo)) out.push('Choose when quiet hours start and end, e.g. 22:00 to 08:00.');
    else if (input.quietFrom === input.quietTo) out.push('Quiet hours start and end at different times.');
  }
  if (input.enabled && input.provider !== 'twilio') {
    const lacking = whatsappMissing({ phoneNumberId: id, businessAccountId: waba, token: !!token || opts.tokenSaved, appSecret: !!secret || opts.secretSaved });
    if (lacking.length) out.push(`To send WhatsApp messages, enter ${lacking.length <= 1 ? (lacking[0] ?? '') : `${lacking.slice(0, -1).join(', ')} and ${lacking[lacking.length - 1]}`}.`);
  }
  return out;
}

/** What the settings lack to be used, in words, in the form's order; empty when complete. */
export function whatsappMissing(s: { phoneNumberId: string | null; businessAccountId: string | null; token: boolean; appSecret: boolean }): string[] {
  const out: string[] = [];
  if (!s.phoneNumberId?.trim()) out.push('the phone number ID');
  if (!s.businessAccountId?.trim()) out.push('the WhatsApp Business Account ID');
  if (!s.token) out.push('the access token');
  if (!s.appSecret) out.push('the app secret');
  return out;
}

/** A webhook verify token made by the system: 32 URL-safe characters. */
export const WHATSAPP_VERIFY_TOKEN = /^[A-Za-z0-9_-]{24,64}$/;

// ---------- an employee's own choice ----------

/** GET /me/whatsapp: the person's own WhatsApp messages, as their account page shows them. */
export interface MyWhatsAppView {
  /** Whether the company sends WhatsApp messages now (a Super Admin set it up and switched it on). */
  available: boolean;
  /** Their mobile as kept (+201012345678): where the messages go; null without one on their profile. */
  mobile: string | null;
  /** On: they opted in at their current mobile. */
  on: boolean;
  language: WhatsAppLanguage;
  groups: Record<WhatsAppGroup, boolean>;
  /** Whether "Approvals waiting" is for them: they approve something (a manager, a lead, HR, Finance, the CEO). */
  approver: boolean;
  optedInAt: string | null;
  /** They opted in at another number, no longer their mobile: off until they turn it on again for this one. */
  mobileChanged: boolean;
  /** When and how it was last turned off: by them, or by their replying STOP. */
  stoppedAt: string | null;
  stoppedBy: 'self' | 'stop' | null;
}

/** PUT /me/whatsapp. */
export interface MyWhatsAppInput {
  on: boolean;
  language: WhatsAppLanguage;
  groups: Partial<Record<WhatsAppGroup, boolean>>;
}

/** GET /whatsapp/people/:employeeId: HR sees whether someone gets WhatsApp messages, never changes it. */
export interface WhatsAppPersonView {
  on: boolean;
  mobile: string | null;
  language: WhatsAppLanguage | null;
  groups: Record<WhatsAppGroup, boolean> | null;
  optedInAt: string | null;
  stoppedAt: string | null;
  stoppedBy: 'self' | 'stop' | null;
  /** They have no account yet, so no choice to make. */
  noAccount: boolean;
}

/** The candidates' tick on the careers forms (owner's brief), off unless ticked. */
export const WHATSAPP_CANDIDATE_TICK = 'Send me updates about my application on WhatsApp';
export const WHATSAPP_CANDIDATE_TICK_HINT = 'To the mobile above: that we received it, and any interview (its invitation, a change, and a reminder the day before). Reply STOP to stop them.';

// ---------- HR's log ----------

export interface WhatsAppMessageRow {
  id: string;
  at: string;
  recipient: { kind: 'employee' | 'candidate' | 'number'; name: string | null; id: string | null };
  mobile: string;
  template: string;
  templateKey: WhatsAppTemplateKey | 'stop_confirmation';
  label: string;
  /** The record it is about, by its reference (APP-2026-0042) or what it is ("Leave"). */
  reference: string | null;
  language: WhatsAppLanguage;
  status: WhatsAppMessageStatus;
  /** Why it failed or wasn't sent, in plain words. */
  problem: string | null;
  attempts: number;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
}

/** A day's messages, for what they cost (Meta charges each template message delivered). */
export interface WhatsAppDayCount {
  day: string;
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  waiting: number;
}

export interface WhatsAppMessagePage {
  items: WhatsAppMessageRow[];
  page: number;
  pageSize: number;
  total: number;
  /** The days of the filter (the last 14 when none), newest first. */
  days: WhatsAppDayCount[];
}

export const WHATSAPP_MESSAGES_PAGE_SIZE = 50;

/** What HR's log calls a message: its template's label, or the STOP answer's. */
export const whatsappMessageLabel = (key: string): string => (isWhatsAppTemplateKey(key) ? WHATSAPP_TEMPLATES[key].label : key === 'stop_confirmation' ? 'STOP answered' : key);
