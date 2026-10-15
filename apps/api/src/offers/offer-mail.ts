import { LABELS, type EmploymentType } from '@trendlix/shared';
import { shownDate } from '../common/date-only.js';

// The emails of a job offer (owner's request, 15 October 2026): the offer to the candidate, with the link to its page
// and the document attached, and the candidate's answer to the HR user who sent it. Plain text with a simple HTML copy;
// never an amount (the document has them).

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Paragraphs as HTML, each line break kept. */
const html = (paragraphs: string[]) =>
  `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.5; color: #1f2937;">${paragraphs
    .map((p) => `<p>${p}</p>`)
    .join('')}</div>`;

export interface OfferEmailInput {
  fullNameEn: string;
  jobTitleEn: string | null;
  employmentType: EmploymentType;
  companyName: string;
  /** YYYY-MM-DD */
  joinDate: string;
  /** YYYY-MM-DD */
  expiresOn: string;
  message: string | null;
  link: string;
}

/** The offer to the candidate. */
export function offerEmail(o: OfferEmailInput): { subject: string; text: string; html: string } {
  const type = LABELS.employmentType[o.employmentType].toLowerCase();
  const position = o.jobTitleEn ? `the ${type} position of ${o.jobTitleEn}` : `a ${type} position`;
  const subject = o.jobTitleEn ? `Job offer: ${o.jobTitleEn} at ${o.companyName}` : `Job offer at ${o.companyName}`;
  const offer = `We are pleased to offer you ${position} at ${o.companyName}, starting on ${shownDate(o.joinDate)}. The offer is attached.`;
  const open = `This offer is open until ${shownDate(o.expiresOn)}.`;
  const text = [
    `Dear ${o.fullNameEn},`,
    offer,
    ...(o.message ? [o.message] : []),
    `Read the offer and accept or decline it here:\n${o.link}`,
    open,
    o.companyName,
  ].join('\n\n');
  const body = html([
    `Dear ${escape(o.fullNameEn)},`,
    escape(offer),
    ...(o.message ? [escape(o.message).replace(/\n/g, '<br>')] : []),
    `Read the offer and accept or decline it here:<br><a href="${escape(o.link)}">${escape(o.link)}</a>`,
    escape(open),
    escape(o.companyName),
  ]);
  return { subject, text, html: body };
}

export interface AnswerEmailInput {
  number: string;
  fullNameEn: string;
  answer: 'accepted' | 'declined';
  /** Who answered: the candidate on the offer's page, or HR recording it. */
  online: boolean;
  /** YYYY-MM-DD, in Cairo */
  on: string;
  reason: string | null;
  /** Accepted: whether the profile, employment and draft contract were made, or why not. */
  hired: { employeeCode: string } | { error: string } | null;
}

/** The answer, to the HR user who sent the offer. */
export function answerEmail(a: AnswerEmailInput): { subject: string; text: string; html: string } {
  const subject = `${a.fullNameEn} ${a.answer} offer ${a.number}`;
  const how = a.online ? 'on the offer’s page' : 'as recorded by HR';
  const lines = [`${a.fullNameEn} ${a.answer} job offer ${a.number} on ${shownDate(a.on)}, ${how}.`];
  if (a.reason) lines.push(`Their reason: ${a.reason}`);
  if (a.hired && 'employeeCode' in a.hired) {
    lines.push(`Their profile (${a.hired.employeeCode}), employment and draft contract are ready in the People System.`);
  } else if (a.hired) {
    lines.push(`Their profile could not be made: ${a.hired.error} Open the offer in the People System to fix this and make it.`);
  }
  return { subject, text: lines.join('\n\n'), html: html(lines.map(escape)) };
}
