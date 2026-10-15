import { describe, expect, it } from 'vitest';
import type { OfferView } from '../../../lib/types';
import { canBeSent, documentLabels, documentState, draftTemplateVersion, missingHelp, offerTimeline, templateProblem, waitingText } from './timeline';

/** An offer as GET /offers/:id sends it, with only what a test sets changed. */
function offer(o: Partial<OfferView> = {}): OfferView {
  return {
    id: 'off-1',
    number: 'OFF-2026-0001',
    status: 'draft',
    fullNameEn: 'Omar Khaled',
    fullNameAr: 'عمر خالد',
    email: 'omar@gmail.com',
    mobile: null,
    employeeId: null,
    employee: null,
    employmentType: 'full_time',
    department: null,
    jobTitle: null,
    grade: null,
    manager: null,
    shift: null,
    workArrangement: 'office',
    officeDays: [],
    joinDate: '2026-11-01',
    payBasis: 'monthly',
    grossSalary: 15000,
    hourlyRate: null,
    hoursPerWeek: null,
    daysPerWeek: null,
    basicPercent: 80,
    netSalary: null,
    insuredSalary: null,
    allowances: [],
    allowancesTotal: 0,
    totalSalary: 15000,
    salaryHidden: false,
    probationMonths: 3,
    durationMonths: 12,
    expiresOn: '2026-10-22',
    message: null,
    note: null,
    template: { slotKey: 'offer_full_time', name: 'Job offer · Full-time', status: 'published', version: 2, previewVersion: null },
    missing: [],
    document: null,
    sentVia: null,
    sentTo: null,
    sentAt: null,
    sentBy: null,
    sentCount: 0,
    viewedAt: null,
    respondedAt: null,
    answeredBy: null,
    acceptedName: null,
    declineReason: null,
    withdrawnAt: null,
    withdrawReason: null,
    hiredAt: null,
    emailConfigured: true,
    pdfAvailable: true,
    createdAt: '2026-10-15T08:00:00.000Z',
    createdBy: { email: 'hr@trendlix.com' },
    ...o,
  };
}

describe('the timeline', () => {
  it('starts with the draft', () => {
    expect(offerTimeline(offer())).toEqual([{ key: 'drafted', label: 'Drafted', at: '2026-10-15T08:00:00.000Z', detail: 'by hr@trendlix.com', tone: 'muted' }]);
  });

  it('follows an offer sent by email, opened, accepted online and turned into a profile', () => {
    const events = offerTimeline(
      offer({
        status: 'accepted',
        sentVia: 'email',
        sentTo: 'omar@gmail.com',
        sentAt: '2026-10-15T09:00:00.000Z',
        sentBy: { email: 'hr@trendlix.com' },
        sentCount: 2,
        viewedAt: '2026-10-15T10:00:00.000Z',
        respondedAt: '2026-10-16T07:30:00.000Z',
        acceptedName: 'Omar Khaled',
        hiredAt: '2026-10-16T07:30:01.000Z',
        employeeId: 'emp-9',
      }),
    );
    expect(events.map((e) => e.key)).toEqual(['drafted', 'sent', 'viewed', 'answered', 'hired']);
    expect(events[1].detail).toBe('By email to omar@gmail.com · sent 2 times, the latest shown · by hr@trendlix.com');
    expect(events[3]).toMatchObject({ label: 'Accepted', detail: 'Online: typed “Omar Khaled”', tone: 'ok' });
    expect(events[4]).toMatchObject({ label: 'Profile made', href: '/employees/emp-9' });
  });

  it('tells an answer HR recorded, with the reason for declining', () => {
    const events = offerTimeline(
      offer({
        status: 'declined',
        sentVia: 'link',
        sentAt: '2026-10-15T09:00:00.000Z',
        sentCount: 1,
        respondedAt: '2026-10-17T09:00:00.000Z',
        answeredBy: { email: 'hr@trendlix.com' },
        declineReason: 'Another offer',
      }),
    );
    expect(events[1].detail).toBe('As a link, sent by HR');
    expect(events[2]).toMatchObject({ label: 'Declined', detail: 'Recorded by hr@trendlix.com · “Another offer”', tone: 'danger' });
  });

  it('shows a withdrawal, in time order', () => {
    const events = offerTimeline(
      offer({ status: 'withdrawn', withdrawnAt: '2026-10-15T12:00:00.000Z', withdrawReason: 'Position filled', sentAt: '2026-10-15T09:00:00.000Z', sentVia: 'link' }),
    );
    expect(events.map((e) => e.key)).toEqual(['drafted', 'sent', 'withdrawn']);
    expect(events[2].detail).toBe('“Position filled”');
  });
});

describe('what the offer waits for', () => {
  it('says the next step for each status', () => {
    expect(waitingText(offer())).toMatch(/^Not sent yet/);
    expect(waitingText(offer({ status: 'sent' }))).toBe("Waiting for the candidate's answer. Open until 22/10/2026.");
    expect(waitingText(offer({ status: 'expired' }))).toMatch(/^Not answered by 22\/10\/2026/);
    expect(waitingText(offer({ status: 'accepted' }))).toMatch(/profile hasn't been made yet: press Make the profile/);
    expect(waitingText(offer({ status: 'accepted', hiredAt: '2026-10-16T07:30:00.000Z' }))).toBeNull();
    expect(waitingText(offer({ status: 'withdrawn' }))).toBeNull();
  });
});

describe('what the template lacks', () => {
  const missing = [
    { tag: 'job_title_ar', label: 'Job title (Arabic)', where: { tab: 'offer', key: 'jobTitleId' } },
    { tag: 'company_address_ar', label: 'Company address (Arabic)', where: { tab: 'company', key: 'addressAr' } },
    { tag: 'odd', label: '', where: { tab: 'somewhere', key: '' } },
    { tag: 'national_id', label: 'National ID', where: { tab: 'offer', key: 'template' } },
  ];

  it("points a draft's missing values to the offer's field or the company profile", () => {
    expect(missingHelp(offer({ missing }))).toEqual([
      { tag: 'job_title_ar', label: 'Job title (Arabic)', what: 'Fill it in on the offer.', href: '/offers/off-1/edit#field-jobTitleId', linkText: 'Edit the offer' },
      { tag: 'company_address_ar', label: 'Company address (Arabic)', what: 'Fill it in on the company profile.', href: '/organization/company', linkText: 'Company profile' },
      { tag: 'odd', label: 'odd', what: 'Fill it in: somewhere.', href: null, linkText: null },
      {
        tag: 'national_id',
        label: 'National ID',
        what: "An offer never has this: it belongs on an employee's documents. Remove {{national_id}} from the job offer template, then publish it again.",
        href: '/templates/offer_full_time',
        linkText: 'Open the template',
      },
    ]);
  });

  it('sends missing duties to the job title, under Organization, whatever the offer’s status', () => {
    const duties = { tag: 'job_duties', label: 'Duties and responsibilities', where: { tab: 'offer', key: 'jobTitleId' } };
    const help = missingHelp({ ...offer({ missing: [duties] }), jobTitle: { id: 'jt-1', titleEn: 'Videographer', titleAr: null } });
    expect(help[0]).toMatchObject({ href: '/organization/departments?q=Videographer', linkText: 'Departments & Job Titles' });
    expect(help[0].what).toMatch(/^Write the duties and responsibilities of the Videographer job title/);
    expect(missingHelp(offer({ missing: [duties] }))[0].href).toBe('/organization/departments');
  });

  it("doesn't link to editing an offer that was sent", () => {
    expect(missingHelp(offer({ status: 'sent', missing: [missing[0]] }))[0]).toMatchObject({ href: null, what: 'It was left empty on the offer.' });
  });

  it('says to publish the template when there is none in use', () => {
    expect(templateProblem(offer())).toBeNull();
    expect(
      templateProblem(offer({ template: { slotKey: 'offer_full_time', name: 'Job offer · Full-time', status: 'missing', version: null, previewVersion: null } })),
    ).toEqual({
      text: 'There is no job offer template for Full-time yet. Upload and publish “Job offer · Full-time” in Templates.',
      href: '/templates/offer_full_time',
    });
    expect(
      templateProblem(offer({ status: 'sent', template: { slotKey: 'offer_sales', name: 'Job offer · Sales', status: 'draft', version: null, previewVersion: 1 } }))?.text,
    ).toMatch(/only a draft\. Publish it in Templates/);
  });

  it('a draft offer is previewed with the draft template meanwhile, but it has to be published before the offer is sent', () => {
    const draftOnly = { slotKey: 'offer_sales', name: 'Job offer · Sales', status: 'draft', version: null, previewVersion: 3 } as const;
    expect(templateProblem(offer({ employmentType: 'sales', template: draftOnly }))).toEqual({
      text: 'The job offer template “Job offer · Sales” is only a draft: the offer is previewed with draft v3, but the template still has to be published in Templates before the offer can be sent.',
      href: '/templates/offer_sales',
    });
    expect(draftTemplateVersion(offer({ template: draftOnly }))).toBe(3);
    // a published template, none at all, or an offer already sent (its document is as sent): no draft is used
    expect(draftTemplateVersion(offer())).toBeNull();
    expect(draftTemplateVersion(offer({ template: { ...draftOnly, status: 'missing', previewVersion: null } }))).toBeNull();
    expect(draftTemplateVersion(offer({ status: 'sent', template: draftOnly }))).toBeNull();

    expect(documentLabels(null)).toEqual({ preview: 'Preview (PDF)', download: 'Download PDF' });
    expect(documentLabels(3)).toEqual({ preview: 'Preview (PDF, draft template v3)', download: 'Download PDF (draft template v3)' });
  });
});

describe('the document, a protected PDF only', () => {
  const kept = (hasPdf: boolean) => ({ fileName: 'Job offer - OFF-2026-0001.docx', hasPdf, documentDate: '2026-10-15' });
  const noConverter = { pdfAvailable: false };

  it('opens a draft’s, filled in afresh, with the converter; without it there is no Word file instead', () => {
    expect(documentState(offer(), 'draft')).toEqual({ pdf: true, why: null, draftTemplate: null });
    expect(documentState(offer(noConverter), 'draft')).toEqual({
      pdf: false,
      why: "The PDF converter isn't set up on the server yet, so the offer's document can't be opened or sent.",
      draftTemplate: null,
    });
    // previewed with the draft template meanwhile
    const draftOnly = { slotKey: 'offer_sales', name: 'Job offer · Sales', status: 'draft', version: null, previewVersion: 3 } as const;
    expect(documentState(offer({ employmentType: 'sales', template: draftOnly }), 'draft')).toEqual({ pdf: true, why: null, draftTemplate: 3 });
    // missing values or no template at all: the warning at the top says why, once
    const missing = [{ tag: 'job_title_ar', label: 'Job title (Arabic)', where: { tab: 'offer', key: 'jobTitleId' } }];
    expect(documentState(offer({ missing }), 'draft')).toEqual({ pdf: false, why: null, draftTemplate: null });
    expect(documentState(offer({ template: { ...draftOnly, status: 'missing', previewVersion: null } }), 'draft')).toEqual({ pdf: false, why: null, draftTemplate: null });
  });

  it('opens a sent one’s as sent: the PDF kept, else made from the Word file kept, with the converter', () => {
    expect(documentState(offer({ status: 'sent', document: kept(false) }), 'sent')).toEqual({ pdf: true, why: null, draftTemplate: null });
    expect(documentState(offer({ status: 'accepted', document: kept(true), ...noConverter }), 'accepted')).toEqual({ pdf: true, why: null, draftTemplate: null });
    expect(documentState(offer({ status: 'sent', document: kept(true), ...noConverter }), 'sent').why).toBe(
      "The PDF converter isn't set up on the server yet, so the offer can't be sent again.",
    );
    expect(documentState(offer({ status: 'sent', document: kept(false), ...noConverter }), 'sent')).toEqual({
      pdf: false,
      why: "The PDF converter isn't set up on the server yet, so the offer's document can't be opened or sent again.",
      draftTemplate: null,
    });
    // past its last day it isn't sent again
    expect(documentState(offer({ status: 'sent', document: kept(false), ...noConverter }), 'expired').why).toBe(
      "The PDF converter isn't set up on the server yet, so the offer's document can't be opened.",
    );
    expect(documentState(offer({ status: 'sent', document: kept(true), ...noConverter }), 'expired').why).toBeNull();
    expect(documentState(offer({ status: 'declined' }), 'declined')).toEqual({ pdf: false, why: 'No document was kept for this offer.', draftTemplate: null });
    expect(documentState(offer({ status: 'withdrawn' }), 'withdrawn')).toEqual({ pdf: false, why: null, draftTemplate: null });
  });
});

describe('sending', () => {
  const today = '2026-10-15';
  const missingValue = { tag: 'job_title_ar', label: 'Job title (Arabic)', where: { tab: 'offer', key: 'jobTitleId' } };
  const unpublished = (status: 'draft' | 'missing') => ({
    slotKey: 'offer_part_time',
    name: 'Job offer · Part-time',
    status,
    version: null,
    previewVersion: status === 'draft' ? 1 : null,
  });

  it('is offered for a draft or a sent offer whose document can be made, before its last day', () => {
    expect(canBeSent(offer(), today)).toBe(true);
    expect(canBeSent(offer({ status: 'sent' }), today)).toBe(true);
    expect(canBeSent(offer({ expiresOn: today }), today)).toBe(true);
    expect(canBeSent(offer({ expiresOn: '2026-10-14' }), today)).toBe(false);
    for (const status of ['expired', 'accepted', 'declined', 'withdrawn'] as const) expect(canBeSent(offer({ status }), today)).toBe(false);
  });

  it('is left out while the template is not published, or a draft lacks values', () => {
    expect(canBeSent(offer({ employmentType: 'part_time', template: unpublished('missing') }), today)).toBe(false);
    // a draft previewed with a draft template is not sent from it
    expect(canBeSent(offer({ template: unpublished('draft') }), today)).toBe(false);
    // sending again fills the document in afresh, from the published template
    expect(canBeSent(offer({ status: 'sent', template: unpublished('draft') }), today)).toBe(false);
    expect(canBeSent(offer({ missing: [missingValue] }), today)).toBe(false);
    // the API lists missing values for drafts only
    expect(canBeSent(offer({ status: 'sent', missing: [missingValue] }), today)).toBe(true);
  });

  it('is left out without the server’s PDF converter: the offer goes as a protected PDF only', () => {
    expect(canBeSent(offer({ pdfAvailable: false }), today)).toBe(false);
    expect(canBeSent(offer({ status: 'sent', pdfAvailable: false }), today)).toBe(false);
  });
});
