import { describe, expect, it } from 'vitest';
import { draftedBadges, expiringLine } from './expiring';

// Contracts ending soon on the home page and the Contracts page (owner, 19 October 2026: trainees' and interns'
// agreements are renewed once, then converted to full-time, with no non-renewal notice).

describe('the line under a contract ending soon', () => {
  it('gives a fixed term’s non-renewal notice due date, as before', () => {
    expect(expiringLine({ endDate: '2026-12-31', nonRenewalNoticeBy: '2026-10-26' }, '2026-10-19')).toEqual({ kind: 'notice', by: '2026-10-26' });
    expect(expiringLine({ endDate: '2026-12-31', nonRenewalNoticeBy: '2026-10-26', training: null }, '2026-10-19')).toEqual({ kind: 'notice', by: '2026-10-26' });
  });

  it('gives a first agreement’s way forward instead: renew it once, or convert to full-time', () => {
    expect(expiringLine({ endDate: '2027-03-31', nonRenewalNoticeBy: null, training: { agreement: 1, next: 'renew_or_convert' } }, '2027-02-01')).toEqual({
      kind: 'training',
      text: 'Training ends on 31/03/2027: renew it once, or convert to full-time.',
    });
  });

  it('gives a renewed agreement’s: convert to full-time, or end the training; “ended” once past', () => {
    const renewed = { endDate: '2027-03-31', nonRenewalNoticeBy: null, training: { agreement: 2, next: 'convert_or_end' } } as const;
    expect(expiringLine(renewed, '2027-03-31')).toEqual({ kind: 'training', text: 'Training ends on 31/03/2027: convert to full-time, or end the training.' });
    expect(expiringLine(renewed, '2027-04-01')).toEqual({ kind: 'training', text: 'Training ended on 31/03/2027: convert to full-time, or end the training.' });
  });

  it('says nothing without a notice date or an agreement', () => {
    expect(expiringLine({ endDate: '2026-12-31', nonRenewalNoticeBy: null }, '2026-10-19')).toEqual({ kind: 'none' });
  });
});

describe('what is drafted after it', () => {
  it('shows a renewal or a conversion drafted', () => {
    expect(draftedBadges({ renewalDraft: true, conversionDraft: false })).toEqual(['Renewal drafted']);
    expect(draftedBadges({ renewalDraft: false, conversionDraft: true })).toEqual(['Conversion drafted']);
    expect(draftedBadges({ renewalDraft: false, conversionDraft: false })).toEqual([]);
    // an API from before conversions
    expect(draftedBadges({ renewalDraft: true })).toEqual(['Renewal drafted']);
  });
});
