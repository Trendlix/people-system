import { LABELS, type OfferShownStatus } from '@trendlix/shared';
import { formatDate } from '../../../lib/format';
import type { OfferView } from '../../../lib/types';
import { templateHref } from '../templates/wording';

// What an offer's page says about its progress and what it lacks (pure code, tested; relative imports for the tests):
// the timeline (drafted, sent, opened by the candidate, answered, withdrawn, profile made), what it waits for, what
// filling in the job offer template lacks, with where to fix it, and whether its document can be opened and sent.

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
 * Where each missing value is filled in: the company profile ({tab: 'company'}), or a field of the offer ({tab:
 * 'offer', key: its field}: on its Edit page while it is a draft, at the field's anchor #field-<key>). {tab: 'offer',
 * key: 'template'}: the template prints something an offer never has (a national ID, an address, the social insurance
 * occupation, bank details …), so the tag comes out of the job offer template, in Templates.
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
 * The draft of the job offer template a draft offer is previewed with while none is published (owner's request, 15
 * October 2026: "Job offer preview should call data from the offer tab, even if not published yet"): its version; null
 * with a published template or none at all, and for an offer that is no longer a draft (its document is as sent).
 */
export function draftTemplateVersion(o: Pick<OfferView, 'status' | 'template'>): number | null {
  const t = o.template;
  return o.status === 'draft' && t?.status === 'draft' ? (t.previewVersion ?? null) : null;
}

/**
 * The labels of the document's buttons: "Preview (PDF)", "Download PDF" and "Print" (owner's request, 20 October 2026:
 * "add Print Button"), saying so when a draft template is used.
 */
export function documentLabels(draftVersion: number | null): { preview: string; download: string; print: string } {
  if (draftVersion === null) return { preview: 'Preview (PDF)', download: 'Download PDF', print: 'Print' };
  return {
    preview: `Preview (PDF, draft template v${draftVersion})`,
    download: `Download PDF (draft template v${draftVersion})`,
    print: `Print (draft template v${draftVersion})`,
  };
}

/** The start of what the page says while the server has no PDF converter (`pdfAvailable` false). */
const NO_CONVERTER = "The PDF converter isn't set up on the server yet, so";

/**
 * The offer's document on its page: whether it can be opened now (Preview (PDF), Download PDF), and why not. It is only
 * ever a protected PDF (owner's request, 15 October 2026: "No doc file export, just a protected PDF"), so there is no
 * Word file instead: a draft's is made with the server's PDF converter, and sending needs it too; a sent one's is the
 * PDF kept when it was sent, else made from the Word file kept, with the converter. A draft's missing template or
 * values give no reason here: the warning at the top of the page says it, once (MissingValues). While its template is
 * only a draft, a draft offer is previewed with that draft (`draftTemplate`, its version), though it can't be sent.
 * `status`: as shown (a sent offer past its last day is expired).
 */
export function documentState(
  o: Pick<OfferView, 'status' | 'template' | 'employmentType' | 'missing' | 'document' | 'pdfAvailable'>,
  status: OfferShownStatus,
): { pdf: boolean; why: string | null; draftTemplate: number | null } {
  if (o.status === 'draft') {
    const draftTemplate = draftTemplateVersion(o);
    if ((templateProblem(o) && draftTemplate === null) || o.missing.length > 0) return { pdf: false, why: null, draftTemplate: null };
    return { pdf: o.pdfAvailable, why: o.pdfAvailable ? null : `${NO_CONVERTER} the offer's document can't be opened or sent.`, draftTemplate };
  }
  if (!o.document) return { pdf: false, why: o.status === 'withdrawn' ? null : 'No document was kept for this offer.', draftTemplate: null };
  if (o.pdfAvailable) return { pdf: true, why: null, draftTemplate: null };
  // an offer still open would be sent again otherwise
  const again = status === 'sent';
  if (!o.document.hasPdf) return { pdf: false, why: `${NO_CONVERTER} the offer's document can't be opened${again ? ' or sent again' : ''}.`, draftTemplate: null };
  return { pdf: true, why: again ? `${NO_CONVERTER} the offer can't be sent again.` : null, draftTemplate: null };
}

/**
 * Why the offer's document can't be made, when its template isn't published: none uploaded for this employment type
 * yet, or only a draft. A draft offer is previewed with the draft meanwhile, but can't be sent until it is published.
 * Null once one is published.
 */
export function templateProblem(o: Pick<OfferView, 'template' | 'employmentType' | 'status'>): { text: string; href: string } | null {
  const t = o.template;
  if (!t || t.status === 'published') return null;
  const type = LABELS.employmentType[o.employmentType] ?? o.employmentType;
  const draft = draftTemplateVersion(o);
  const text =
    t.status !== 'draft'
      ? `There is no job offer template for ${type} yet. Upload and publish “${t.name}” in Templates.`
      : draft !== null
        ? `The job offer template “${t.name}” is only a draft: the offer is previewed with draft v${draft}, but the template still has to be published in Templates before the offer can be sent.`
        : `The job offer template “${t.name}” is only a draft. Publish it in Templates to make the offer's document.`;
  return { text, href: templateHref(t.slotKey) };
}

/**
 * Whether Send by email and Copy link are offered: for a draft or a sent offer before its last day has passed, whose
 * document can be made. Sending fills the document in afresh, so it needs the employment type's published template
 * (a draft offer previewed with a draft of it can't be sent yet), and for a draft every value the template prints (the
 * API refuses it otherwise). It goes as a protected PDF only (owner's request, 15 October 2026), so it needs the
 * server's PDF converter too. When it can't be made, the page says why, once, and the sending buttons are left out.
 */
export function canBeSent(o: Pick<OfferView, 'status' | 'expiresOn' | 'template' | 'missing' | 'pdfAvailable'>, today: string): boolean {
  if ((o.status !== 'draft' && o.status !== 'sent') || o.expiresOn < today) return false;
  if (o.template && o.template.status !== 'published') return false;
  if (!o.pdfAvailable) return false;
  return o.status !== 'draft' || (o.missing ?? []).length === 0;
}
