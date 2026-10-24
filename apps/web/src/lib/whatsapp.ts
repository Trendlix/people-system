import {
  WHATSAPP_GROUP_LABELS,
  WHATSAPP_GROUPS,
  WHATSAPP_LANGUAGE_LABELS,
  WHATSAPP_MESSAGE_STATUS_LABELS,
  WHATSAPP_TEMPLATE_STATUS_LABELS,
  type Role,
  type WhatsAppGroup,
  type WhatsAppLanguage,
  type WhatsAppMessageStatus,
  type WhatsAppPersonView,
  type WhatsAppTemplateStatus,
} from '@trendlix/shared';

// WhatsApp notifications on the website (owner, 24 October 2026: "how to make whatsapp notifications?"; asked whom,
// "Employees and candidates", and how, "Directly to Meta"): who sees the settings and HR's log, and the small texts the
// pages share. Hiding is a convenience: the API checks every request. Pure code (no server-only), so client components
// and the tests can use it.

type Viewer = { roles: readonly Role[]; developer?: boolean; viewAs?: unknown };

/** Organization → Company → WhatsApp: a Super Admin's, never a developer's (the page holds the company's token). */
export const seesWhatsAppSettings = (user: Viewer): boolean => user.roles.includes('super_admin') && !user.developer;

/** HR's log of the messages sent: HR and a Super Admin, never a developer (it carries people's numbers). */
export const seesWhatsAppLog = (user: Viewer): boolean => (user.roles.includes('hr') || user.roles.includes('super_admin')) && !user.developer;

/** The colours of a status badge, as the other pages' badges are. */
export type BadgeTone = 'ok' | 'warn' | 'danger' | 'neutral' | 'muted';

export const BADGE_CLASSES: Readonly<Record<BadgeTone, string>> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-accent-soft text-accent',
  muted: 'bg-canvas text-muted',
};

/** A template's status at Meta: its words and colour. */
export function templateBadge(status: WhatsAppTemplateStatus): { text: string; tone: BadgeTone } {
  const tone: BadgeTone = status === 'approved' ? 'ok' : status === 'pending' || status === 'in_appeal' ? 'neutral' : status === 'not_submitted' ? 'muted' : status === 'paused' ? 'warn' : 'danger';
  return { text: WHATSAPP_TEMPLATE_STATUS_LABELS[status] ?? status, tone };
}

/** A message's status in HR's log: its words and colour. */
export function messageBadge(status: WhatsAppMessageStatus): { text: string; tone: BadgeTone } {
  const tone: BadgeTone = status === 'delivered' || status === 'read' ? 'ok' : status === 'sent' ? 'neutral' : status === 'failed' ? 'danger' : status === 'cancelled' ? 'muted' : 'warn';
  return { text: WHATSAPP_MESSAGE_STATUS_LABELS[status] ?? status, tone };
}

/** The groups someone chose, in words: "Approvals waiting, Request decisions"; "none" when none. */
export function groupsText(groups: Partial<Record<WhatsAppGroup, boolean>> | null | undefined, opts: { approver?: boolean } = {}): string {
  const on = WHATSAPP_GROUPS.filter((g) => groups?.[g] && (g !== 'approvals' || opts.approver !== false)).map((g) => WHATSAPP_GROUP_LABELS[g].label);
  return on.length ? on.join(', ') : 'none';
}

/** A language's name: "English", "العربية (Arabic)". */
export const languageText = (lang: WhatsAppLanguage | null | undefined): string => (lang ? WHATSAPP_LANGUAGE_LABELS[lang] : '—');

/** How the log names whom a message went to: the person's name, or the kind of recipient when it has none. */
export function recipientText(r: { kind: 'employee' | 'candidate' | 'number'; name: string | null }): string {
  if (r.name) return r.name;
  return r.kind === 'employee' ? 'An employee' : r.kind === 'candidate' ? 'A candidate' : 'A number';
}

export const RECIPIENT_KIND_LABELS: Readonly<Record<'employee' | 'candidate' | 'number', string>> = {
  employee: 'Employee',
  candidate: 'Candidate',
  number: 'Test or reply',
};

/**
 * What HR sees of someone's WhatsApp messages on their Access tab (the brief: "HR can see the status but can't opt
 * someone in"): on or off and since when, the number, the language and the groups; a STOP reply; who turns it on.
 */
export function personWhatsAppLines(v: WhatsAppPersonView, name: string, when: (iso: string) => string): { status: string; details: string[]; note: string } {
  const note = `Only ${name} turns this on or off, from their own Notifications page (or by replying STOP).`;
  if (v.noAccount) return { status: 'Off', details: ['They have no account yet, so they can’t turn WhatsApp messages on.'], note };
  if (!v.on) {
    const details = v.stoppedBy === 'stop' && v.stoppedAt ? [`They replied STOP on ${when(v.stoppedAt)}.`] : v.stoppedAt ? [`Turned off on ${when(v.stoppedAt)}.`] : ['They haven’t turned WhatsApp messages on.'];
    return { status: 'Off', details, note };
  }
  const details = [
    ...(v.optedInAt ? [`On since ${when(v.optedInAt)}${v.mobile ? `, at ${v.mobile}` : ''}.`] : v.mobile ? [`At ${v.mobile}.`] : []),
    `In ${languageText(v.language)}: ${groupsText(v.groups)}.`,
  ];
  return { status: 'On', details, note };
}
