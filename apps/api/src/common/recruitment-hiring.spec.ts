import {
  averageDays,
  boardMove,
  buildIcs,
  daysSince,
  feedbackOpen,
  feedbackProblems,
  feedbackSeen,
  funnelOf,
  furthestStage,
  hiringManagerSees,
  icsFold,
  icsMoment,
  icsText,
  interviewMail,
  interviewProblems,
  percentOf,
  rejectionMail,
  rejectionWordsProblems,
  REJECTION_STANDARD,
  stageSince,
  zonedMoment,
} from '@trendlix/shared';
import { recruitmentCaller, viewerOf, visibleApplications } from '../recruitment/recruitment-scope.js';
import type { SessionUser } from '../auth/session-user.js';

// Recruitment, Phase 2 (owner, 22 October 2026: "where will we include the ATS?"; "interview invites go by email through
// the owner's SMTP settings"): the board's moves, the interviews' rules and calendar invitations, the scorecards'
// visibility, the rejection email and the analytics' arithmetic (packages/shared recruitment-hiring.ts), and who sees
// which applicants (recruitment-scope.ts).

const free = { filteredOut: false, openOffer: false };

describe('the pipeline board', () => {
  it('moves by the stage actions’ rules: Reject asks why, Offer goes through Make offer', () => {
    expect(boardMove('applied', 'shortlisted', free)).toEqual({ kind: 'move', to: 'shortlisted', needsReason: false });
    expect(boardMove('shortlisted', 'interview', free)).toEqual({ kind: 'move', to: 'interview', needsReason: false });
    expect(boardMove('interview', 'rejected', free)).toEqual({ kind: 'move', to: 'rejected', needsReason: true });
    expect(boardMove('interview', 'offer', free)).toEqual({ kind: 'offer' });
    expect(boardMove('shortlisted', 'offer', free)).toEqual({ kind: 'offer' });
  });

  it('refuses in words what the stage actions refuse', () => {
    expect(boardMove('applied', 'hired', free)).toEqual({ kind: 'refused', reason: 'Hired follows an accepted job offer: make them an offer first.' });
    expect(boardMove('shortlisted', 'applied', free).kind).toBe('refused');
    expect(boardMove('applied', 'interview', free)).toEqual({ kind: 'refused', reason: 'Shortlist them first.' });
    expect(boardMove('applied', 'offer', free)).toEqual({ kind: 'refused', reason: 'They are at Applied: shortlist them first.' });
    expect(boardMove('interview', 'offer', { filteredOut: false, openOffer: true }).kind).toBe('refused');
    expect(boardMove('offer', 'rejected', { filteredOut: false, openOffer: true })).toEqual({ kind: 'refused', reason: 'A job offer to them is open: withdraw it first.' });
    expect(boardMove('applied', 'shortlisted', { filteredOut: true, openOffer: false }).kind).toBe('refused');
    expect(boardMove('hired', 'rejected', free).kind).toBe('refused');
    expect(boardMove('interview', 'interview', free)).toEqual({ kind: 'refused', reason: 'They are at Interview already.' });
  });

  it('counts the days at a stage from the last change of stage', () => {
    const steps = [
      { stage: 'applied', at: '2026-10-01T08:00:00Z' },
      { stage: 'shortlisted', at: '2026-10-03T08:00:00Z' },
      { stage: 'shortlisted', at: '2026-10-04T08:00:00Z' }, // a restore at the same stage
      { stage: 'interview', at: '2026-10-05T08:00:00Z' },
    ];
    expect(stageSince(steps, '2026-10-01T08:00:00Z')).toBe('2026-10-05T08:00:00.000Z');
    expect(stageSince(steps.slice(0, 3), '2026-10-01T08:00:00Z')).toBe('2026-10-03T08:00:00.000Z');
    expect(stageSince([], '2026-10-01T08:00:00Z')).toBe('2026-10-01T08:00:00.000Z');
    expect(daysSince('2026-10-05T08:00:00Z', Date.parse('2026-10-08T07:00:00Z'))).toBe(2);
    expect(daysSince('2026-10-05T08:00:00Z', Date.parse('2026-10-01T07:00:00Z'))).toBe(0);
  });
});

describe('who sees which applicants', () => {
  it('shows a hiring manager their vacancy’s applicants from Shortlisted on, never one filtered out', () => {
    expect(hiringManagerSees({ stage: 'applied', rejectedFrom: null, filteredOut: false })).toBe(false);
    expect(hiringManagerSees({ stage: 'shortlisted', rejectedFrom: null, filteredOut: false })).toBe(true);
    expect(hiringManagerSees({ stage: 'hired', rejectedFrom: null, filteredOut: false })).toBe(true);
    expect(hiringManagerSees({ stage: 'rejected', rejectedFrom: 'interview', filteredOut: false })).toBe(true);
    expect(hiringManagerSees({ stage: 'rejected', rejectedFrom: 'applied', filteredOut: false })).toBe(false);
    expect(hiringManagerSees({ stage: 'shortlisted', rejectedFrom: null, filteredOut: true })).toBe(false);
  });

  const user = (roles: string[]) => ({ id: 'u', email: 'u@x.test', roles }) as unknown as SessionUser;

  it('lets HR, the CEO and a Super Admin read every one; the others only theirs; nobody without a profile', () => {
    expect(visibleApplications(recruitmentCaller(user(['hr']), null))).toEqual({ vacancy: expect.any(Object) });
    expect(JSON.stringify(visibleApplications(recruitmentCaller(user(['employee']), 'e1')))).toContain('"hiringManagerId":"e1"');
    expect(JSON.stringify(visibleApplications(recruitmentCaller(user(['employee']), 'e1')))).toContain('"employeeId":"e1"');
    expect(visibleApplications(recruitmentCaller(user(['employee']), null))).toEqual({ id: { in: [] } });
  });

  it('names how the caller sees one', () => {
    const app = { vacancy: { hiringManagerId: 'e1' } };
    expect(viewerOf(recruitmentCaller(user(['hr']), 'e1'), app)).toBe('manages');
    expect(viewerOf(recruitmentCaller(user(['super_admin']), null), app)).toBe('manages');
    expect(viewerOf(recruitmentCaller(user(['ceo']), null), app)).toBe('reads');
    expect(viewerOf(recruitmentCaller(user(['employee']), 'e1'), app)).toBe('hiring_manager');
    expect(viewerOf(recruitmentCaller(user(['employee', 'manager']), 'e2'), app)).toBe('interviewer');
  });
});

describe('interviews', () => {
  const now = Date.parse('2026-10-22T08:00:00Z');
  const good = { date: '2026-10-29', time: '10:30', minutes: 45, kind: 'in_person' as const, location: null, interviewerIds: ['a', 'b'], note: null };

  it('takes a day and time in Cairo, from now on, in quarter hours, with 1 to 6 interviewers', () => {
    expect(interviewProblems(good, zonedMoment(good.date, good.time), now)).toEqual([]);
    // Cairo's summer time (UTC+3) ends the night of the last Thursday of October: 10:30 on 29 October 2026 is 07:30Z,
    // on 5 November 08:30Z
    expect(new Date(zonedMoment('2026-10-29', '10:30')).toISOString()).toBe('2026-10-29T07:30:00.000Z');
    expect(new Date(zonedMoment('2026-11-05', '10:30')).toISOString()).toBe('2026-11-05T08:30:00.000Z');
    expect(interviewProblems({ ...good, date: '2026-10-21' }, zonedMoment('2026-10-21', '10:30'), now)).toEqual(['That time has passed: choose a later one.']);
    expect(interviewProblems({ ...good, time: '' }, Number.NaN, now)).toEqual(['Choose the day and the time of the interview.']);
    expect(interviewProblems({ ...good, minutes: 50 }, zonedMoment(good.date, good.time), now)).toEqual(['Give its length in quarter hours, from 15 minutes to 8 hours.']);
    expect(interviewProblems({ ...good, interviewerIds: [] }, zonedMoment(good.date, good.time), now)).toEqual(['Choose who interviews them.']);
    expect(interviewProblems({ ...good, interviewerIds: ['a', 'a'] }, zonedMoment(good.date, good.time), now)).toEqual(['An interviewer is chosen twice.']);
    expect(interviewProblems({ ...good, interviewerIds: ['1', '2', '3', '4', '5', '6', '7'] }, zonedMoment(good.date, good.time), now)).toEqual(['Choose at most 6 interviewers.']);
  });

  it('wants an online one’s link in full', () => {
    const at = zonedMoment(good.date, good.time);
    expect(interviewProblems({ ...good, kind: 'online', location: 'meet.google.com/abc' }, at, now)).toEqual(['Give the meeting’s link in full, starting with https://.']);
    expect(interviewProblems({ ...good, kind: 'online', location: 'https://meet.google.com/abc-defg-hij' }, at, now)).toEqual([]);
    expect(interviewProblems({ ...good, kind: 'phone', location: null }, at, now)).toEqual([]);
  });

  it('opens the scorecards once it started, never for one cancelled or a no-show', () => {
    expect(feedbackOpen({ status: 'scheduled', startsAt: '2026-10-22T07:00:00Z' }, now)).toBe(true);
    expect(feedbackOpen({ status: 'scheduled', startsAt: '2026-10-22T09:00:00Z' }, now)).toBe(false);
    expect(feedbackOpen({ status: 'done', startsAt: '2026-10-20T09:00:00Z' }, now)).toBe(true);
    expect(feedbackOpen({ status: 'cancelled', startsAt: '2026-10-20T09:00:00Z' }, now)).toBe(false);
    expect(feedbackOpen({ status: 'no_show', startsAt: '2026-10-20T09:00:00Z' }, now)).toBe(false);
  });
});

describe('the calendar invitation', () => {
  const event = {
    uid: 'interview-1@people.trendlix.com',
    sequence: 0,
    method: 'REQUEST' as const,
    start: new Date('2026-10-29T08:30:00Z'),
    minutes: 45,
    summary: 'Interview: Sara Strong · Video Editor',
    description: 'In person interview for Video Editor (VAC-2026-0001).\nBring your reel; it helps',
    location: '13, Al Doctor Al Mahrouqi Street, Cairo',
    organizer: { name: 'TrendLIX HR', email: 'hr@trendlix.test' },
    attendees: [
      { name: 'Sara Strong', email: 'sara@mail.test' },
      { name: 'Omar, "the lead"', email: 'omar@trendlix.test' },
    ],
    stamp: new Date('2026-10-22T08:00:00Z'),
  };

  it('writes one event with a stable UID, its times in UTC, CRLF lines', () => {
    const ics = buildIcs(event);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain('METHOD:REQUEST\r\n');
    expect(unfolded).toContain('UID:interview-1@people.trendlix.com\r\n');
    expect(unfolded).toContain('DTSTART:20261029T083000Z\r\n');
    expect(unfolded).toContain('DTEND:20261029T091500Z\r\n');
    expect(unfolded).toContain('SEQUENCE:0\r\n');
    expect(unfolded).toContain('STATUS:CONFIRMED\r\n');
    expect(unfolded).toContain('ORGANIZER;CN="TrendLIX HR":mailto:hr@trendlix.test\r\n');
    expect(unfolded).toContain('ATTENDEE;CN="Omar,  the lead";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:omar@trendlix.test\r\n');
  });

  it('escapes text values: backslashes, semicolons, commas and new lines', () => {
    expect(icsText('a\\b;c,d\ne')).toBe('a\\\\b\\;c\\,d\\ne');
    const unfolded = buildIcs(event).replace(/\r\n /g, '');
    expect(unfolded).toContain('LOCATION:13\\, Al Doctor Al Mahrouqi Street\\, Cairo\r\n');
    expect(unfolded).toContain('DESCRIPTION:In person interview for Video Editor (VAC-2026-0001).\\nBring your reel\\; it helps\r\n');
  });

  it('cancels the same event with a higher sequence', () => {
    const unfolded = buildIcs({ ...event, method: 'CANCEL', sequence: 2 }).replace(/\r\n /g, '');
    expect(unfolded).toContain('METHOD:CANCEL\r\n');
    expect(unfolded).toContain('SEQUENCE:2\r\n');
    expect(unfolded).toContain('STATUS:CANCELLED\r\n');
    expect(unfolded).toContain('UID:interview-1@people.trendlix.com\r\n');
  });

  it('folds lines at 75 octets without splitting a character', () => {
    const long = `SUMMARY:${'مقابلة '.repeat(30)}`;
    const folded = icsFold(long);
    for (const line of folded.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, '')).toBe(long);
    expect(icsMoment(new Date('2026-01-02T03:04:05.678Z'))).toBe('20260102T030405Z');
  });
});

describe('the candidate’s emails', () => {
  const facts = {
    candidate: 'Sara Strong',
    job: 'Video Editor',
    company: 'TrendLIX',
    day: 'Thursday 29 October 2026',
    dayAr: 'الخميس 29 أكتوبر 2026',
    time: '10:30 AM',
    minutes: 45,
    kind: 'online' as const,
    location: 'https://meet.example.com/abc',
    mobile: '+20 100 123 4567',
    note: 'Bring your reel.',
  };

  it('invites in English then Arabic, with when and how', () => {
    const m = interviewMail('invite', facts);
    expect(m.subject).toBe('Interview invitation: Video Editor at TrendLIX · دعوة لمقابلة');
    expect(m.text).toContain('When: Thursday 29 October 2026, 10:30 AM (Cairo time), 45 minutes');
    expect(m.text).toContain('Online: https://meet.example.com/abc');
    expect(m.text).toContain('Bring your reel.');
    expect(m.text).toContain('الموعد: الخميس 29 أكتوبر 2026، الساعة 10:30 AM بتوقيت القاهرة، لمدة 45 دقيقة');
    expect(m.text.indexOf('Dear Sara Strong')).toBeLessThan(m.text.indexOf('عزيزي/عزيزتي Sara Strong'));
  });

  it('says when it moved or was cancelled', () => {
    expect(interviewMail('moved', facts).subject).toBe('Interview moved: Video Editor at TrendLIX · تغيير موعد المقابلة');
    expect(interviewMail('cancelled', facts).subject).toBe('Interview cancelled: Video Editor · إلغاء المقابلة');
    expect(interviewMail('invite', { ...facts, kind: 'phone', location: null }).text).toContain('By phone: we will call you on +20 100 123 4567');
    expect(interviewMail('invite', { ...facts, kind: 'in_person', location: null }).text).toContain('In person: TrendLIX');
  });
});

describe('scorecards', () => {
  const card = { ratings: { skills: 4, experience: 3, communication: 5, culture: 4 }, recommendation: 'yes' as const, notes: null };

  it('wants every criterion rated 1 to 5 and a recommendation', () => {
    expect(feedbackProblems(card)).toEqual([]);
    expect(feedbackProblems({ ...card, ratings: { ...card.ratings, skills: 6 } })).toEqual(['Rate skills for the role from 1 to 5.']);
    expect(feedbackProblems({ ...card, ratings: { skills: 4, experience: 3, communication: 5 } as never })).toEqual(['Rate culture fit from 1 to 5.']);
    expect(feedbackProblems({ ...card, recommendation: 'maybe' as never })).toEqual(['Choose your recommendation: strong yes, yes, no or strong no.']);
    expect(feedbackProblems({ ...card, notes: 'x'.repeat(2001) })).toEqual(['Keep the notes to 2000 characters or fewer.']);
  });

  it('shows an interviewer the others’ only once they gave theirs (no anchoring); everyone else all of them', () => {
    expect(feedbackSeen('interviewer', false)).toBe('own');
    expect(feedbackSeen('interviewer', true)).toBe('all');
    expect(feedbackSeen('hiring_manager', false)).toBe('all');
    expect(feedbackSeen('manages', false)).toBe('all');
    expect(feedbackSeen('reads', false)).toBe('all');
  });
});

describe('the rejection email', () => {
  const vars = { name: 'Sara Strong', job: 'Video Editor', company: 'TrendLIX' };

  it('is the standard words with the name, job and company filled in, English then Arabic', () => {
    const m = rejectionMail({ subject: null, en: null, ar: null }, vars);
    expect(m.subject).toBe('Your application for Video Editor · طلبك لوظيفة Video Editor');
    expect(m.text).toContain('Dear Sara Strong,');
    expect(m.text).toContain('the Video Editor role at TrendLIX');
    expect(m.text).toContain('عزيزي/عزيزتي Sara Strong،');
    expect(m.text).not.toContain('{');
    expect(REJECTION_STANDARD.en).toContain('{company} HR');
  });

  it('takes HR’s words when set', () => {
    const m = rejectionMail({ subject: 'About {job}', en: 'Hello {name}, thank you.', ar: null }, vars);
    expect(m.subject).toBe('About Video Editor');
    expect(m.text.startsWith('Hello Sara Strong, thank you.')).toBe(true);
    expect(rejectionWordsProblems({ subject: 'x'.repeat(151) })).toEqual(['Keep the subject to 150 characters or fewer.']);
    expect(rejectionWordsProblems({ en: 'x'.repeat(3001), ar: 'y' })).toEqual(['Keep the English text to 3000 characters or fewer.']);
  });
});

describe('the analytics’ arithmetic', () => {
  it('finds the furthest stage an applicant reached, Rejected never counting as one', () => {
    expect(furthestStage(['applied'])).toBe('applied');
    expect(furthestStage(['rejected', 'applied', 'shortlisted', 'interview', 'rejected'])).toBe('interview');
    expect(furthestStage(['hired', 'offer'])).toBe('hired');
    expect(furthestStage([])).toBe('applied');
  });

  it('builds the funnel with each stage’s share of the one before', () => {
    expect(funnelOf(['applied', 'applied', 'shortlisted', 'interview', 'hired'])).toEqual([
      { stage: 'applied', reached: 5, conversion: null },
      { stage: 'shortlisted', reached: 3, conversion: 60 },
      { stage: 'interview', reached: 2, conversion: 66.7 },
      { stage: 'offer', reached: 1, conversion: 50 },
      { stage: 'hired', reached: 1, conversion: 100 },
    ]);
    expect(funnelOf([])[1]).toEqual({ stage: 'shortlisted', reached: 0, conversion: null });
  });

  it('averages days to one decimal, and rounds a % to one decimal', () => {
    expect(averageDays([['2026-10-01T00:00:00Z', '2026-10-11T00:00:00Z'], ['2026-10-01T00:00:00Z', '2026-10-04T12:00:00Z']])).toBe(6.8);
    expect(averageDays([])).toBeNull();
    expect(percentOf(2, 3)).toBe(66.7);
    expect(percentOf(1, 0)).toBeNull();
  });
});
