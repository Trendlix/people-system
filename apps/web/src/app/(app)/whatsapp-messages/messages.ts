import {
  isWhatsAppMessageStatus,
  isWhatsAppTemplateKey,
  WHATSAPP_MESSAGE_STATUS_LABELS,
  WHATSAPP_MESSAGE_STATUSES,
  WHATSAPP_MESSAGES_PATH,
  WHATSAPP_TEMPLATE_KEYS,
  WHATSAPP_TEMPLATES,
  type WhatsAppDayCount,
  type WhatsAppMessagePage,
  type WhatsAppMessageStatus,
} from '@trendlix/shared';
import { formatDate, parseDate } from '@/lib/format';

// WhatsApp Messages (owner, 24 October 2026: "how to make whatsapp notifications?"; the brief: "a WhatsApp Messages log
// (Super Admin and HR) with filters (status, type, date), without message bodies beyond template name and reference;
// failures with plain reasons; per-day counts (cost awareness)"): the filters in the address, the API's query from them,
// and the page's words. Pure code, tested (messages.test.ts).

type Query = Record<string, string | string[] | undefined>;

export interface MessageFilters {
  status: WhatsAppMessageStatus | '';
  /** A template's key, or the STOP answer's. */
  template: string;
  /** Days, YYYY-MM-DD. */
  from: string;
  to: string;
  page: number;
}

export const NO_MESSAGE_FILTERS: MessageFilters = { status: '', template: '', from: '', to: '', page: 1 };

/** The types the filter offers: every template by its label, and the STOP answer. */
export const MESSAGE_TYPES: readonly { value: string; label: string }[] = [
  ...WHATSAPP_TEMPLATE_KEYS.map((k) => ({ value: k, label: WHATSAPP_TEMPLATES[k].label })),
  { value: 'stop_confirmation', label: 'STOP answered' },
];

/** The statuses the filter offers, in the order a message moves through them. */
export const MESSAGE_STATUSES: readonly { value: WhatsAppMessageStatus; label: string }[] = WHATSAPP_MESSAGE_STATUSES.map((s) => ({ value: s, label: WHATSAPP_MESSAGE_STATUS_LABELS[s] }));

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v.trim() : '');
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A day from the address: as typed (DD/MM/YYYY) or as the links write it (YYYY-MM-DD); null when it isn't one. */
function dayOf(value: string): string | null {
  if (!value) return '';
  if (ISO_DAY.test(value)) return parseDate(formatDate(value)) === value ? value : null;
  return parseDate(value);
}

/** The filters in the address, and what was wrong with any (left out then, so the page still shows the rest). */
export function readMessageFilters(query: Query): { filters: MessageFilters; problems: string[] } {
  const problems: string[] = [];
  const from = dayOf(one(query.from));
  const to = dayOf(one(query.to));
  if (from === null) problems.push('Enter the first day as DD/MM/YYYY, e.g. 01/10/2026.');
  if (to === null) problems.push('Enter the last day as DD/MM/YYYY, e.g. 31/10/2026.');
  const status = one(query.status);
  if (status && !isWhatsAppMessageStatus(status)) problems.push('Choose the status from the list.');
  const template = one(query.template);
  const knownType = isWhatsAppTemplateKey(template) || template === 'stop_confirmation';
  if (template && !knownType) problems.push('Choose the type from the list.');
  const page = Number(one(query.page));
  const filters: MessageFilters = {
    status: isWhatsAppMessageStatus(status) ? status : '',
    template: knownType ? template : '',
    from: from ?? '',
    to: to ?? '',
    page: Number.isInteger(page) && page > 1 ? Math.min(page, 100000) : 1,
  };
  if (filters.from && filters.to && filters.from > filters.to) {
    problems.push('The first day is after the last.');
    filters.from = '';
    filters.to = '';
  }
  return { filters, problems };
}

const paramsOf = (f: MessageFilters, page: number) => {
  const params = new URLSearchParams();
  if (f.status) params.set('status', f.status);
  if (f.template) params.set('template', f.template);
  if (f.from) params.set('from', f.from);
  if (f.to) params.set('to', f.to);
  if (page > 1) params.set('page', String(page));
  return params;
};

const withQuery = (path: string, params: URLSearchParams) => {
  const q = params.toString();
  return q ? `${path}?${q}` : path;
};

/** The page's address with the filters (and a page). */
export const messagesHref = (f: MessageFilters, page = 1): string => withQuery(WHATSAPP_MESSAGES_PATH, paramsOf(f, page));

/** GET /whatsapp/messages with the filters and the page. */
export const apiMessagesPath = (f: MessageFilters): string => withQuery('/whatsapp/messages', paramsOf(f, f.page));

export const isFiltered = (f: MessageFilters): boolean => !!(f.status || f.template || f.from || f.to);

/** How many pages the messages fill. */
export const pagesOf = (p: Pick<WhatsAppMessagePage, 'total' | 'pageSize'>): number => Math.max(1, Math.ceil(p.total / Math.max(1, p.pageSize)));

/** "1–50 of 230 messages", "No messages". */
export function rangeText(p: Pick<WhatsAppMessagePage, 'total' | 'page' | 'pageSize'>): string {
  if (!p.total) return 'No messages';
  const first = (p.page - 1) * p.pageSize + 1;
  const last = Math.min(p.total, p.page * p.pageSize);
  return `${first.toLocaleString('en-US')}–${last.toLocaleString('en-US')} of ${p.total.toLocaleString('en-US')} ${p.total === 1 ? 'message' : 'messages'}`;
}

/** The days' totals: what Meta charges for (each template message delivered) and what failed. */
export function daysTotals(days: readonly WhatsAppDayCount[]): Omit<WhatsAppDayCount, 'day'> {
  const out = { total: 0, sent: 0, delivered: 0, read: 0, failed: 0, waiting: 0 };
  for (const d of days) {
    out.total += d.total;
    out.sent += d.sent;
    out.delivered += d.delivered;
    out.read += d.read;
    out.failed += d.failed;
    out.waiting += d.waiting;
  }
  return out;
}
