import { LABELS } from '@trendlix/shared';
import { formatDate } from '../../../lib/format';
import type { OfferView } from '../../../lib/types';
import { templateHref } from '../templates/wording';

// What an offer's page says about its progress and what it lacks (pure code, tested; relative imports for the tests):
// the timeline (drafted, sent, opened by the candidate, answered, withdrawn, profile made), what it waits for, and what
// filling in the job offer template lacks, with where to fix it.

export interface TimelineEvent {
  key: 'drafted' | 'sent' | 'viewed' | 'answered' | 'withdrawn' | 'hired';
  label: string;
  /** ISO moment. */
  at: string;
  detail: string | null;
  tone: 'ok' | 'danger' | 'muted' | 'accent';
  /** A link to follow from it: the profile made. */
  href?: string;
}

const by = (who: { email: string } | null | undefined) => (who?.email ? `by ${who.email}` : null);
const joined = (...parts: (string | null | false | undefined)[]) => parts.filter(Boolean).join(' · ') || null;

/** "Online: typed “Omar Khaled”", "Recorded by hr@…: by phone". */
function answerDetail(o: OfferView): string | null {
  const reason = o.status === 'declined' && o.declineReason ? `“${o.declineReason}”` : null;
  if (o.answeredBy) return joined(`Recorded ${by(o.answeredBy)}`, reason);
  return joined(o.status === 'accepted' && o.acceptedName ? `Online: typed “${o.acceptedName}”` : 'Online, by the candidate', reason);
}

/** What happened to the offer, oldest first. */
export function offerTimeline(o: OfferView): TimelineEvent[] {
  const events: TimelineEvent[] = [{ key: 'drafted', label: 'Drafted', at: o.createdAt, detail: by(o.createdBy), tone: 'muted' }];
  if (o.sentAt) {
    const how = o.sentVia === 'email' ? `By email${o.sentTo ? ` to ${o.sentTo}` : ''}` : 'As a link, sent by HR';
    const times = o.sentCount > 1 ? `sent ${o.sentCount} times, the latest shown` : null;
    events.push({ key: 'sent', label: 'Sent', at: o.sentAt, detail: joined(how, times, by(o.sentBy)), tone: 'accent' });
  }
  if (o.viewedAt) events.push({ key: 'viewed', label: 'Opened by the candidate', at: o.viewedAt, detail: null, tone: 'muted' });
  if (o.respondedAt && (o.status === 'accepted' || o.status === 'declined')) {
    events.push({
      key: 'answered',
      label: o.status === 'accepted' ? 'Accepted' : 'Declined',
      at: o.respondedAt,
      detail: answerDetail(o),
      tone: o.status === 'accepted' ? 'ok' : 'danger',
    });
  }
  if (o.withdrawnAt) events.push({ key: 'withdrawn', label: 'Withdrawn', at: o.withdrawnAt, detail: o.withdrawReason ? `“${o.withdrawReason}”` : null, tone: 'muted' });
  if (o.hiredAt) {
    events.push({
      key: 'hired',
      label: 'Profile made',
      at: o.hiredAt,
      detail: 'The employee profile, the employment and a draft contract',
      tone: 'ok',
      ...(o.employeeId && { href: `/employees/${encodeURIComponent(o.employeeId)}` }),
    });
  }
  // stable: events at the same moment keep the order above
  return events.map((e, i) => ({ e, i })).sort((a, b) => Date.parse(a.e.at) - Date.parse(b.e.at) || a.i - b.i).map(({ e }) => e);
}

/** What the offer waits for, in a sentence; null when nothing does. */
export function waitingText(o: Pick<OfferView, 'status' | 'expiresOn' | 'hiredAt' | 'sentAt'>): string | null {
  switch (o.status) {
    case 'draft':
      return 'Not sent yet. Check the PDF, then send it by email or copy the link.';
    case 'sent':
      return `Waiting for the candidate's answer. Open until ${formatDate(o.expiresOn)}.`;
    case 'expired':
      return `Not answered by ${formatDate(o.expiresOn)}, its last day. Extend it to give more time, or record an answer given another way.`;
    case 'accepted':
      return o.hiredAt ? null : "Accepted, but the employee profile hasn't been made yet: press Make the profile.";
    default:
      return null;
  }
}

// ---------- what filling in the template lacks ----------

/** A missing value as the page lists it: what it is, what to do, and the link there (null: no link). */
export interface MissingHelp {
  tag: string;
  label: string;
  what: string;
  href: string | null;
  linkText: string | null;
}

/**
 * Where each missing value is filled in: the company profile ({tab: 'company'}), or a field of the offer ({tab: 'offer',
 * key: its field}: on its Edit page while it is a draft, at the field's anchor #field-<key>). {tab: 'offer', key:
 * 'template'}: the template prints something an offer never has (a national ID, an address, bank details …), so the tag
 * comes out of the job offer template, in Templates.
 */
export function missingHelp(o: Pick<OfferView, 'id' | 'status' | 'missing' | 'template'> & { jobTitle?: OfferView['jobTitle'] }): MissingHelp[] {
  return (o.missing ?? []).map((m) => {
    const label = m.label || m.tag;
    // the duties are written on the job title itself, not on the offer (owner, 15 October 2026)
    if (m.tag === 'job_duties') {
      const title = o.jobTitle?.titleEn;
      return {
        tag: m.tag,
        label,
        what: `Write the duties and responsibilities of ${title ? `the ${title} job title` : 'the job title'} under Organization › Departments & Job Titles, or choose another job title on the offer.`,
        href: title ? `/organization/departments?q=${encodeURIComponent(title)}` : '/organization/departments',
        linkText: 'Departments & Job Titles',
      };
    }
    if (m.where?.tab === 'company') {
      return { tag: m.tag, label, what: 'Fill it in on the company profile.', href: '/organization/company', linkText: 'Company profile' };
    }
    if (m.where?.tab === 'offer' && m.where.key === 'template') {
      return {
        tag: m.tag,
        label,
        what: `An offer never has this: it belongs on an employee's documents. Remove {{${m.tag}}} from the job offer template, then publish it again.`,
        href: o.template?.slotKey ? templateHref(o.template.slotKey) : '/templates',
        linkText: 'Open the template',
      };
    }
    if (m.where?.tab === 'offer') {
      const key = m.where.key ? `#field-${encodeURIComponent(m.where.key)}` : '';
      return o.status === 'draft'
        ? { tag: m.tag, label, what: 'Fill it in on the offer.', href: `/offers/${encodeURIComponent(o.id)}/edit${key}`, linkText: 'Edit the offer' }
        : { tag: m.tag, label, what: 'It was left empty on the offer.', href: null, linkText: null };
    }
    return { tag: m.tag, label, what: m.where?.tab ? `Fill it in: ${m.where.tab}.` : 'Fill it in.', href: null, linkText: null };
  });
}

/**
 * Why the offer's document can't be made, when its template isn't published: none uploaded for this employment type
 * yet, or only a draft. Null once one is published.
 */
export function templateProblem(o: Pick<OfferView, 'template' | 'employmentType'>): { text: string; href: string } | null {
  const t = o.template;
  if (!t || t.status === 'published') return null;
  const type = LABELS.employmentType[o.employmentType] ?? o.employmentType;
  const text =
    t.status === 'draft'
      ? `The job offer template “${t.name}” is only a draft. Publish it in Templates to make the offer's document.`
      : `There is no job offer template for ${type} yet. Upload and publish “${t.name}” in Templates.`;
  return { text, href: templateHref(t.slotKey) };
}

/**
 * Whether Send by email and Copy link are offered: for a draft or a sent offer before its last day has passed, whose
 * document can be made. Sending fills the document in afresh, so it needs the employment type's published template,
 * and for a draft every value the template prints (the API refuses it otherwise). When it can't be made, the page's
 * warning says why, once, and the sending buttons are left out.
 */
export function canBeSent(o: Pick<OfferView, 'status' | 'expiresOn' | 'template' | 'missing'>, today: string): boolean {
  if ((o.status !== 'draft' && o.status !== 'sent') || o.expiresOn < today) return false;
  if (o.template && o.template.status !== 'published') return false;
  return o.status !== 'draft' || (o.missing ?? []).length === 0;
}
