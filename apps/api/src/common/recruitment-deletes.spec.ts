import {
  applicationDeleteRefusal,
  interviewUpcoming,
  interviewWhen,
  offerWentOut,
  vacancyConfirmed,
  vacancyConfirmText,
  vacancyDeleteRefusal,
  type DeletableApplication,
} from '@trendlix/shared';

// Deleting an applicant, or a vacancy people applied to (owner, 25 October 2026: "i want to delete this"; asked, "Vacancy
// alone - applicant alone - superadmin only"; packages/shared recruitment-deletes.ts): why one stays on record, and the
// vacancy's number typed to confirm. Invented numbers only.

const NOW = new Date('2026-10-25T10:00:00Z'); // 1:00 PM in Cairo

const app = (extra: Partial<DeletableApplication> = {}): DeletableApplication => ({
  number: 'APP-2026-0001',
  stage: 'rejected',
  employeeId: null,
  offers: [],
  interviews: [],
  onboarding: 0,
  ...extra,
});

describe('why an application stays on record', () => {
  it('lets a rejected one go, with past, cancelled and finished interviews and a draft offer', () => {
    expect(
      applicationDeleteRefusal(
        app({
          interviews: [
            { status: 'done', startsAt: '2026-10-20T08:00:00Z', minutes: 45 },
            { status: 'cancelled', startsAt: '2026-11-02T08:30:00Z', minutes: 45 },
            // scheduled but over: never marked
            { status: 'scheduled', startsAt: '2026-10-25T09:00:00Z', minutes: 45 },
          ],
          offers: [
            { number: 'OFF-2026-0001', status: 'draft', sentAt: null, hiredAt: null },
            { number: 'OFF-2026-0002', status: 'withdrawn', sentAt: null, hiredAt: null },
          ],
        }),
        NOW,
      ),
    ).toBeNull();
  });

  it('keeps one someone was hired from: its stage, the profile, an onboarding checklist, an offer turned into a hire', () => {
    const hired = { kind: 'hired', text: 'They were hired from it, so the application stays on record.', short: 'APP-2026-0001: they were hired from it' };
    expect(applicationDeleteRefusal(app({ stage: 'hired' }), NOW)).toEqual(hired);
    expect(applicationDeleteRefusal(app({ employeeId: 'e1' }), NOW)).toEqual(hired);
    expect(applicationDeleteRefusal(app({ onboarding: 1 }), NOW)).toEqual(hired);
    expect(applicationDeleteRefusal(app({ offers: [{ number: 'OFF-2026-0003', status: 'accepted', sentAt: NOW, hiredAt: NOW }] }), NOW)?.kind).toBe('hired');
  });

  it('keeps one an offer was sent to: sent, accepted, declined, or withdrawn after it was sent', () => {
    for (const status of ['sent', 'accepted', 'declined', 'withdrawn']) {
      const r = applicationDeleteRefusal(app({ stage: 'shortlisted', offers: [{ number: 'OFF-2026-0004', status, sentAt: '2026-10-20T08:00:00Z', hiredAt: null }] }), NOW);
      expect(r).toEqual({ kind: 'offer_sent', text: 'An offer was sent to them, so the application stays on record.', short: 'APP-2026-0001: an offer was sent (OFF-2026-0004)' });
    }
    expect(offerWentOut({ status: 'draft', sentAt: null })).toBe(false);
    expect(offerWentOut({ status: 'withdrawn', sentAt: null })).toBe(false);
    expect(offerWentOut({ status: 'declined', sentAt: null })).toBe(true);
  });

  it('keeps one with an interview still to come, naming the earliest in Cairo', () => {
    const r = applicationDeleteRefusal(
      app({
        stage: 'interview',
        interviews: [
          { status: 'scheduled', startsAt: '2026-11-04T08:30:00Z', minutes: 45 },
          { status: 'scheduled', startsAt: '2026-11-02T08:30:00Z', minutes: 45 },
        ],
      }),
      NOW,
    );
    expect(r).toEqual({
      kind: 'interview_upcoming',
      text: 'Cancel the interview on Monday 2 November 2026 at 10:30 AM first, so the invitations go out as cancelled.',
      short: 'APP-2026-0001: an interview on Monday 2 November 2026 at 10:30 AM is still to come',
    });
    // one under way counts as still to come; one over doesn't
    expect(interviewUpcoming({ status: 'scheduled', startsAt: '2026-10-25T09:30:00Z', minutes: 45 }, NOW)).toBe(true);
    expect(interviewUpcoming({ status: 'scheduled', startsAt: '2026-10-25T09:00:00Z', minutes: 45 }, NOW)).toBe(false);
    expect(interviewWhen('2026-10-25T10:00:00Z')).toBe('Sunday 25 October 2026 at 1:00 PM');
  });

  it('names the strongest reason first: hired, then an offer, then an interview', () => {
    const all = app({
      stage: 'hired',
      offers: [{ number: 'OFF-2026-0005', status: 'sent', sentAt: NOW, hiredAt: null }],
      interviews: [{ status: 'scheduled', startsAt: '2026-11-02T08:30:00Z', minutes: 45 }],
    });
    expect(applicationDeleteRefusal(all, NOW)?.kind).toBe('hired');
    expect(applicationDeleteRefusal({ ...all, stage: 'offer' }, NOW)?.kind).toBe('offer_sent');
  });
});

describe('a vacancy’s delete', () => {
  it('names each application that stays', () => {
    expect(vacancyDeleteRefusal(['APP-2026-0005: an offer was sent (OFF-2026-0002)'])).toBe('One application stays on record, so the vacancy stays: APP-2026-0005: an offer was sent (OFF-2026-0002).');
    expect(vacancyDeleteRefusal(['APP-2026-0005: they were hired from it', 'APP-2026-0006: an offer was sent (OFF-2026-0003)'])).toBe(
      '2 applications stay on record, so the vacancy stays: APP-2026-0005: they were hired from it; APP-2026-0006: an offer was sent (OFF-2026-0003).',
    );
  });

  it('is confirmed by its number typed, whatever its case and the spaces around it', () => {
    expect(vacancyConfirmed(' vac-2026-0001 ', 'VAC-2026-0001')).toBe(true);
    expect(vacancyConfirmed('VAC-2026-0002', 'VAC-2026-0001')).toBe(false);
    expect(vacancyConfirmed(undefined, 'VAC-2026-0001')).toBe(false);
    expect(vacancyConfirmText('VAC-2026-0001', 1)).toBe('Type VAC-2026-0001 to confirm: its application is deleted with it.');
    expect(vacancyConfirmText('VAC-2026-0001', 3)).toBe('Type VAC-2026-0001 to confirm: its 3 applications are deleted with it.');
  });
});
