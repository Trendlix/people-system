import { describe, expect, it } from 'vitest';
import type { OfferView } from '../../../lib/types';
import { missingHelp, offerTimeline, templateProblem, waitingText } from './timeline';

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
    template: { slotKey: 'offer_full_time', name: 'Job offer · Full-time', status: 'published', version: 2 },
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

  it("doesn't link to editing an offer that was sent", () => {
    expect(missingHelp(offer({ status: 'sent', missing: [missing[0]] }))[0]).toMatchObject({ href: null, what: 'It was left empty on the offer.' });
  });

  it('says to publish the template when there is none in use', () => {
    expect(templateProblem(offer())).toBeNull();
    expect(templateProblem(offer({ template: { slotKey: 'offer_full_time', name: 'Job offer · Full-time', status: 'missing', version: null } }))).toEqual({
      text: 'There is no job offer template for Full-time yet. Upload and publish “Job offer · Full-time” in Templates.',
      href: '/templates/offer_full_time',
    });
    expect(templateProblem(offer({ template: { slotKey: 'offer_sales', name: 'Job offer · Sales', status: 'draft', version: null } }))?.text).toMatch(
      /only a draft\. Publish it in Templates/,
    );
  });
});
