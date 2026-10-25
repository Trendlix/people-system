import { describe, expect, it } from 'vitest';
import { EARLIER_OFFER_NOTE } from '@trendlix/shared';
import { answerLeeway, answersNow, canRecordSent, earlierNote, recordsEarlier, recordSentDocumentHint } from './earlier';

// Earlier job offers (owner, 25 October 2026: "allow the HR to add for now job offers with a past duedate to enter the
// previous data"): what the offers' pages offer while "Entering earlier offers" is on, and as before while it is off.

const TODAY = '2026-10-25';
const HR = { roles: ['hr'] as const };
const CEO = { roles: ['ceo'] as const };
const SUPER_ADMIN = { roles: ['super_admin'] as const };
const FINANCE = { roles: ['finance'] as const };

describe('earlier offers on the offers pages', () => {
  it('says a past last day makes an earlier offer, only while the switch is on', () => {
    expect(earlierNote('20/10/2026', TODAY, true)).toBe(EARLIER_OFFER_NOTE);
    expect(earlierNote('20/10/2026', TODAY, false)).toBeNull();
    // today and later, empty or not yet a date: nothing
    expect(earlierNote('25/10/2026', TODAY, true)).toBeNull();
    expect(earlierNote('01/11/2026', TODAY, true)).toBeNull();
    expect(earlierNote('', TODAY, true)).toBeNull();
    expect(earlierNote('20/10/20', TODAY, true)).toBeNull();
  });

  it('records as sent earlier a draft only, while the switch is on, by HR, the CEO or a Super Admin', () => {
    expect(canRecordSent({ status: 'draft', earlierOffers: true })).toBe(true);
    expect(canRecordSent({ status: 'draft', earlierOffers: false })).toBe(false);
    expect(canRecordSent({ status: 'draft' })).toBe(false); // an API from before
    expect(canRecordSent({ status: 'sent', earlierOffers: true })).toBe(false);
    expect([HR, CEO, SUPER_ADMIN, FINANCE].map(recordsEarlier)).toEqual([true, true, true, false]);
  });

  it("records an earlier offer's answer past its last day, with its day, while the switch is on", () => {
    const earlier = { expiresOn: '2026-09-27', recordedEarlier: true, earlierOffers: true };
    expect(answerLeeway(earlier)).toBe(true);
    expect(answersNow(earlier, 'expired', TODAY, HR)).toBe(true);
    expect(answersNow(earlier, 'draft', TODAY, CEO)).toBe(true);
    expect(answersNow(earlier, 'sent', TODAY, SUPER_ADMIN)).toBe(true);
    expect(answersNow(earlier, 'expired', TODAY, FINANCE)).toBe(false);
    expect(answersNow(earlier, 'accepted', TODAY, HR)).toBe(false);
    // the switch off: as before it
    const off = { ...earlier, earlierOffers: false };
    expect(answerLeeway(off)).toBe(false);
    expect(answersNow(off, 'expired', TODAY, HR)).toBe(false);
  });

  it('records any other answer as before: by HR, before the last day has passed', () => {
    const open = { expiresOn: '2026-10-30', recordedEarlier: false, earlierOffers: true };
    expect(answersNow(open, 'sent', TODAY, HR)).toBe(true);
    expect(answersNow(open, 'draft', TODAY, HR)).toBe(true);
    expect(answersNow(open, 'sent', TODAY, CEO)).toBe(false);
    expect(answersNow({ ...open, expiresOn: '2026-10-24' }, 'expired', TODAY, HR)).toBe(false);
    expect(answersNow({ ...open, expiresOn: '2026-10-24' }, 'draft', TODAY, HR)).toBe(false);
  });

  it('says what Record as sent earlier keeps, by the template', () => {
    const template = { slotKey: 'offer_full_time', name: 'Job offer · Full-time', version: 2, previewVersion: null };
    expect(recordSentDocumentHint({ template: { ...template, status: 'published' } })).toBe(
      'Nothing is emailed and no link is made. Its document is filled in as of that day and kept, as when an offer is sent.',
    );
    expect(recordSentDocumentHint({ template: { ...template, status: 'draft', version: null } })).toBe(
      'Nothing is emailed and no link is made. The Job offer · Full-time template isn’t published, so no document is kept with it.',
    );
  });
});
