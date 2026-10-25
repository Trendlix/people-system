// Twilio as a second way to send WhatsApp (owner, 25 October 2026: "is the system ready to be linked with twillio?";
// asked, "Add Twilio as a choice": WhatsApp Settings gets "Send through: Meta directly / Twilio", the same messages,
// opt-ins, quiet hours, queue and log, switchable later; and "No, WhatsApp only": no SMS). Through Twilio:
// - the same 17 templates and texts (whatsapp.ts), made as Twilio Content (content.twilio.com): twilio/text, or
//   twilio/call-to-action for those with the "Open Trendlix People" button, their variables {{1}}…, named
//   people_<key>_<lang>, and submitted for WhatsApp's approval (Utility); only approved ones are used;
// - sent with Twilio's Messages API (api.twilio.com), the template's Content SID and its variables;
// - Twilio's status callbacks and the messages people send (STOP) come to the website, signed (X-Twilio-Signature).
// One provider sends at a time; each keeps its own templates' approval. Pure code: the API builds and checks with it,
// the web shows the same words. Tested in apps/api/src/common/whatsapp-twilio.spec.ts.

import { phoneOk, phoneTidy } from './phone.js';
import {
  WHATSAPP_CATEGORY,
  WHATSAPP_FOOTER,
  WHATSAPP_TEMPLATES,
  whatsappSettingsProblems,
  type WhatsAppLanguage,
  type WhatsAppSettingsInput,
  type WhatsAppTemplateKey,
  type WhatsAppTemplateStatus,
  type WhatsAppTemplateStatusView,
} from './whatsapp.js';

// ---------- the providers ----------

/** How WhatsApp messages are sent: Meta's WhatsApp Cloud API directly (the first way, 24 October 2026), or Twilio. */
export const WHATSAPP_PROVIDERS = ['meta', 'twilio'] as const;
export type WhatsAppProvider = (typeof WHATSAPP_PROVIDERS)[number];

export const isWhatsAppProvider = (v: unknown): v is WhatsAppProvider => v === 'meta' || v === 'twilio';

export const WHATSAPP_PROVIDER_LABELS: Readonly<Record<WhatsAppProvider, string>> = { meta: 'Meta directly', twilio: 'Twilio' };

export const WHATSAPP_PROVIDER_HINTS: Readonly<Record<WhatsAppProvider, string>> = {
  meta: 'Meta’s WhatsApp Cloud API, set up in Meta’s own tools: only Meta’s fees.',
  twilio: 'A Twilio account sends them, set up in the Twilio Console: Meta’s fees plus Twilio’s own small fee per message, billed by Twilio.',
};

// ---------- Twilio's addresses ----------

/** Twilio's Messages API (the message itself). */
export const TWILIO_API = 'https://api.twilio.com/2010-04-01';

/** Twilio's Content API (the templates and their WhatsApp approval). */
export const TWILIO_CONTENT_API = 'https://content.twilio.com/v1';

/** Where Twilio tells the system what became of each message (sent with every message as its StatusCallback). */
export const WHATSAPP_TWILIO_STATUS_PATH = '/whatsapp/twilio/status';

/** Where Twilio passes on what people write to the business number (the sender's "When a message comes in"). */
export const WHATSAPP_TWILIO_INCOMING_PATH = '/whatsapp/twilio/incoming';

const site = (origin: string) => origin.replace(/\/+$/, '');

/** "https://people.trendlix.com/whatsapp/twilio/status". */
export const whatsappTwilioStatusUrl = (origin: string): string => `${site(origin)}${WHATSAPP_TWILIO_STATUS_PATH}`;

/** "https://people.trendlix.com/whatsapp/twilio/incoming". */
export const whatsappTwilioIncomingUrl = (origin: string): string => `${site(origin)}${WHATSAPP_TWILIO_INCOMING_PATH}`;

// ---------- the templates as Twilio Content ----------

/** A template's name on Twilio, its friendly name and its WhatsApp name alike: "people_approval_waiting_en". */
export const twilioTemplateName = (key: WhatsAppTemplateKey, lang: WhatsAppLanguage): string => `${WHATSAPP_TEMPLATES[key].name}_${lang}`;

/**
 * A template's text on Twilio: its body and, as twilio/text and twilio/call-to-action have no footer of their own, the
 * STOP line after a blank line (the same words as Meta's footer).
 */
export const twilioTemplateBody = (key: WhatsAppTemplateKey, lang: WhatsAppLanguage): string => `${WHATSAPP_TEMPLATES[key].body[lang]}\n\n${WHATSAPP_FOOTER[lang]}`;

/** Twilio's type for a template: twilio/call-to-action with its button, else twilio/text. */
export const twilioContentType = (key: WhatsAppTemplateKey): 'twilio/call-to-action' | 'twilio/text' => (WHATSAPP_TEMPLATES[key].button ? 'twilio/call-to-action' : 'twilio/text');

/** The number of the button's variable (the page it opens), after the body's: {{4}} for a body of three. */
export const twilioButtonVariable = (key: WhatsAppTemplateKey): number => WHATSAPP_TEMPLATES[key].variables.length + 1;

/** The longest body Twilio takes for a twilio/call-to-action; a twilio/text, WhatsApp's 1,024. */
export const TWILIO_CTA_BODY_MAX = 640;
export const TWILIO_TEXT_BODY_MAX = 1024;

/**
 * The request that makes a template in a language as Twilio Content (POST /v1/Content): its friendly name, language,
 * the variables' examples for WhatsApp's review, and its type: twilio/text, or twilio/call-to-action with the URL button
 * to the website (`origin`), its page the last variable.
 */
export function twilioContentRequest(key: WhatsAppTemplateKey, lang: WhatsAppLanguage, origin: string): Record<string, unknown> {
  const d = WHATSAPP_TEMPLATES[key];
  const variables: Record<string, string> = {};
  d.examples[lang].forEach((v, i) => (variables[String(i + 1)] = v));
  const body = twilioTemplateBody(key, lang);
  const base = { friendly_name: twilioTemplateName(key, lang), language: lang };
  if (!d.button) return { ...base, variables, types: { 'twilio/text': { body } } };
  const n = twilioButtonVariable(key);
  variables[String(n)] = d.buttonExample ?? 'notifications';
  return { ...base, variables, types: { 'twilio/call-to-action': { body, actions: [{ type: 'URL', title: d.button[lang], url: `${site(origin)}/{{${n}}}` }] } } };
}

/** The request that submits a Content for WhatsApp's approval (POST /v1/Content/{sid}/ApprovalRequests/whatsapp). */
export const twilioApprovalRequest = (key: WhatsAppTemplateKey, lang: WhatsAppLanguage): Record<string, unknown> => ({ name: twilioTemplateName(key, lang), category: WHATSAPP_CATEGORY });

/**
 * A message's variables as Twilio's ContentVariables takes them: a JSON object, "1" the first; the button's page last
 * ({{N+1}}), when the template has one.
 */
export function twilioContentVariables(body: readonly string[], button: string | null): string {
  const vars: Record<string, string> = {};
  body.forEach((v, i) => (vars[String(i + 1)] = v));
  if (button !== null) vars[String(body.length + 1)] = button;
  return JSON.stringify(vars);
}

/** WhatsApp's approval of a Content as Twilio says it ("received", "pending", "approved", "rejected"…) as ours. */
export function twilioTemplateStatusOf(status: unknown): WhatsAppTemplateStatus {
  const s = String(status ?? '').trim().toLowerCase();
  if (s === 'approved') return 'approved';
  if (s === 'received' || s === 'pending' || s === 'submitted' || s === 'in_review') return 'pending';
  if (s === 'rejected') return 'rejected';
  if (s === 'paused') return 'paused';
  if (s === 'disabled') return 'disabled';
  if (s === 'in_appeal') return 'in_appeal';
  if (!s || s === 'unsubmitted' || s === 'not_submitted') return 'not_submitted';
  return 'other';
}

// ---------- the settings ----------

/** Twilio's identifiers: the account's (AC…), a Messaging Service's (MG…), a Content's (HX…), a message's (SM…, MM…). */
export const TWILIO_ACCOUNT_SID = /^AC[0-9a-fA-F]{32}$/;
export const TWILIO_MESSAGING_SERVICE_SID = /^MG[0-9a-fA-F]{32}$/;
export const TWILIO_CONTENT_SID = /^HX[0-9a-fA-F]{32}$/;
export const TWILIO_MESSAGE_SID = /^(SM|MM)[0-9a-fA-F]{32}$/;
/** The Auth Token, as the Console shows it: 32 letters and digits. */
export const TWILIO_AUTH_TOKEN = /^[A-Za-z0-9]{32}$/;

export const WHATSAPP_TWILIO_TOKEN_UNREADABLE = 'The saved Twilio Auth Token can’t be read any more: paste it again.';

/**
 * The WhatsApp sender as written: a number ("whatsapp:+20 100 123 4567", "+201001234567", "01001234567"), kept as Twilio
 * takes it, whatsapp:+201001234567 (sent as From); or a Messaging Service SID (MG…, sent as MessagingServiceSid: Twilio
 * picks the service's WhatsApp sender). Null when it is neither.
 */
export function twilioSenderOf(v: unknown): { kind: 'number' | 'service'; value: string } | null {
  const t = String(v ?? '').trim();
  if (!t) return null;
  if (/^MG[0-9a-f]{32}$/i.test(t)) return { kind: 'service', value: `MG${t.slice(2).toLowerCase()}` };
  if (/^[A-Z]{2}[0-9a-f]{32}$/i.test(t)) return null;
  const number = phoneTidy(t.replace(/^whatsapp:/i, '').trim());
  return phoneOk(number) ? { kind: 'number', value: `whatsapp:${number}` } : null;
}

/** The sender as people see it: the number (+201001234567), or the Messaging Service's SID. */
export const twilioSenderText = (sender: string | null | undefined): string => String(sender ?? '').replace(/^whatsapp:/, '');

/** What the Twilio settings lack to be used, in words, in the form's order; empty when complete. */
export function whatsappTwilioMissing(s: { accountSid: string | null; authToken: boolean; sender: string | null }): string[] {
  const out: string[] = [];
  if (!s.accountSid?.trim()) out.push('the Account SID');
  if (!s.authToken) out.push('the Auth Token');
  if (!s.sender?.trim()) out.push('the WhatsApp sender');
  return out;
}

const listedWords = (items: readonly string[]) => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/**
 * What is wrong with the Twilio settings to save, in words; empty when fine. Their shapes whatever the provider (they
 * may be filled in before switching); what a switched-on Twilio needs only while Twilio is chosen. `tokenSaved`: a
 * readable Auth Token is saved, so an empty box keeps it.
 */
export function whatsappTwilioProblems(input: Partial<WhatsAppSettingsInput>, opts: { tokenSaved: boolean }): string[] {
  const out: string[] = [];
  const sid = input.twilioAccountSid?.trim() ?? '';
  if (sid && !TWILIO_ACCOUNT_SID.test(sid)) out.push('The Account SID is AC and 32 letters and digits, as the Twilio Console’s home page shows it.');
  const token = input.twilioAuthToken?.trim() ?? '';
  if (token && !TWILIO_AUTH_TOKEN.test(token)) out.push('Paste the Auth Token as the Twilio Console’s home page shows it: 32 letters and digits, on one line.');
  const sender = input.twilioSender?.trim() ?? '';
  if (sender && !twilioSenderOf(sender)) out.push('Write the WhatsApp sender as whatsapp:+20… (the number registered in Twilio, with its country code), or paste its Messaging Service SID (MG…).');
  if (input.enabled && input.provider === 'twilio') {
    const lacking = whatsappTwilioMissing({ accountSid: sid || null, authToken: !!token || opts.tokenSaved, sender: sender || null });
    if (lacking.length) out.push(`To send WhatsApp messages through Twilio, enter ${listedWords(lacking)}.`);
  }
  return out;
}

/**
 * What is wrong with WhatsApp Settings to save, in words, both providers' fields (packages/shared whatsapp.ts for
 * Meta's and the quiet hours): what the page and the API check alike.
 */
export function whatsappAllSettingsProblems(input: Partial<WhatsAppSettingsInput>, opts: { tokenSaved: boolean; secretSaved: boolean; twilioTokenSaved: boolean }): string[] {
  return [...whatsappSettingsProblems(input, opts), ...whatsappTwilioProblems(input, { tokenSaved: opts.twilioTokenSaved })];
}

// ---------- the owner's steps ----------

/** The setup in Twilio, as the page shows it: the owner's short, exact steps. */
export const WHATSAPP_TWILIO_SETUP_STEPS: readonly { title: string; text: string }[] = [
  {
    title: 'Register the WhatsApp sender',
    text: 'In the Twilio Console → Messaging → Senders → WhatsApp senders, register the number through Twilio’s guided sign-up: it creates or links the company’s WhatsApp Business Account with Meta. Use a dedicated number that isn’t on the WhatsApp app.',
  },
  {
    title: 'Copy the Account SID and Auth Token',
    text: 'Both are on the Twilio Console’s home page, under Account Info.',
  },
  {
    title: 'Paste the sender, and set its webhook',
    text: 'Paste the sender here (whatsapp:+20…, or the SID of the Messaging Service that holds it). In the sender’s settings, set “When a message comes in” to the incoming-message URL shown on this page (HTTP POST); with a Messaging Service, its Integration → Incoming messages → Send a webhook instead. Paste the Account SID and Auth Token here, and save.',
  },
  {
    title: 'Submit templates, then sync',
    text: 'Press Submit templates, then Sync status until Twilio shows them approved (usually minutes, at most a day). Send a test message.',
  },
];

/** Said under the steps. */
export const WHATSAPP_TWILIO_SETUP_NOTE =
  'Meta’s business verification is still needed to go beyond the starter limits on how many people a day can get messages: start it in Meta Business Suite → Settings → Security Center, with the company’s commercial register.';

// ---------- what the settings page shows ----------

/** Twilio's part of GET /whatsapp/settings: never the Auth Token, nor any part of it. */
export interface WhatsAppTwilioView {
  accountSid: string | null;
  authTokenSet: boolean;
  /** An Auth Token is saved but can't be read with the server's key any more (WHATSAPP_TWILIO_TOKEN_UNREADABLE). */
  authTokenUnreadable: boolean;
  /** whatsapp:+201001234567, or a Messaging Service SID (MG…). */
  sender: string | null;
  senderKind: 'number' | 'service' | null;
  /** Pasted in Twilio (or sent with each message): what became of each message. */
  statusCallbackUrl: string;
  /** Pasted in Twilio as the sender's "When a message comes in": STOP. */
  incomingUrl: string;
  /** Each template in each language, as Twilio last said (the sync). */
  templates: WhatsAppTemplateStatusView[];
  templatesSyncedAt: string | null;
  /** When Twilio last called the system with something signed. */
  lastEventAt: string | null;
  /** What the Twilio settings lack to be used, in words. */
  missing: string[];
}
