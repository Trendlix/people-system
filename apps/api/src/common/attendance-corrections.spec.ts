import {
  correctedDay,
  correctedFromText,
  correctionApplyRefusal,
  correctionAskFrom,
  correctionMoments,
  correctionProblems,
  correctionTimesText,
  NOT_YET_COME_APPROVAL_LEAD,
  notYetComeProblems,
  zonedMoment,
  type CorrectableDay,
  type CorrectionContext,
} from '@trendlix/shared';

// Attendance corrections (owner, 19 October 2026, "Proceed with those": "Attendance corrections with approval ("I forgot
// to check out")"; packages/shared attendance-corrections.ts): what each kind needs, a day still to come, a month whose
// payroll is approved, a correction already asked for, a day of leave, the times in order; the day a correction makes
// (the right times over those on record, remote and no longer flagged for work at a client, its hours counted again);
// and when one can be applied. A time not yet come (reported 25 October 2026: asked at 00:30 to set that day's check-in
// to 08:55; owner, 26 October 2026: "yes", refuse it), at its edges.

const DAY = '2026-10-12';
const at = (time: string, day = DAY) => new Date(zonedMoment(day, time)).toISOString();
const MORNING = { startTime: '09:00', endTime: '19:00', hoursPerDay: 9, graceMinutes: 15 };
const worked = (more: Partial<CorrectableDay> = {}): CorrectableDay => ({ status: 'worked', checkIn: at('09:05'), checkOut: null, place: 'office', source: 'system', flags: [], ...more });
const ctx = (more: Partial<CorrectionContext> = {}): CorrectionContext => ({ today: '2026-10-19', runStatus: null, day: worked(), shift: MORNING, open: false, ...more });
const ask = (more: Record<string, string | null> = {}) => ({ date: DAY, kind: 'forgot_check_out', checkOut: '18:30', reason: 'Left for a client meeting', ...more });

describe('asking for a correction', () => {
  it('is fine for a day gone by with what its kind needs and a reason', () => {
    expect(correctionProblems(ask(), ctx())).toEqual([]);
    // today too
    expect(correctionProblems({ ...ask(), date: '2026-10-19' }, ctx({ today: '2026-10-19' }))).toEqual([]);
  });

  it('refuses a day still to come, a missing reason, a time that isn’t one', () => {
    expect(correctionProblems({ ...ask(), date: '2026-10-20' }, ctx())).toEqual(['20/10/2026 is still to come: only a day gone by, or today, can be corrected.']);
    expect(correctionProblems(ask({ reason: '  ' }), ctx())).toEqual(['Write why the day needs correcting, e.g. I left for a client meeting and forgot to check out.']);
    expect(correctionProblems(ask({ reason: 'x'.repeat(501) }), ctx())[0]).toBe('Keep the reason to 500 characters; it has 501.');
    expect(correctionProblems(ask({ checkOut: '6:30 pm' }), ctx())).toEqual(['Enter the time of the check-out as HH:MM, e.g. 18:30.']);
    expect(correctionProblems(ask({ kind: 'something' }), ctx())[0]).toContain('Choose what was wrong');
    expect(correctionProblems({ ...ask(), date: '12/10/2026' }, ctx())).toEqual(['Enter the day to correct, e.g. 2026-10-12.']);
  });

  it('refuses a month whose payroll is approved or paid, a correction already asked for, a day of leave', () => {
    expect(correctionProblems(ask(), ctx({ runStatus: 'approved' }))).toEqual(["The October 2026 payroll is approved, so its days can't be corrected any more."]);
    expect(correctionProblems(ask(), ctx({ runStatus: 'paid' }))[0]).toContain('is paid');
    // a draft or a run with the CEO: it can be asked for
    expect(correctionProblems(ask(), ctx({ runStatus: 'pending_ceo' }))).toEqual([]);
    expect(correctionProblems(ask(), ctx({ open: true }))).toEqual(['You asked to correct 12/10/2026 already: wait for it to be decided, or cancel it.']);
    expect(correctionProblems(ask(), ctx({ open: true, name: 'Nour Adel' }))).toEqual(['Nour Adel asked to correct 12/10/2026 already: decide that request first.']);
    expect(correctionProblems(ask(), ctx({ day: worked({ status: 'leave', checkIn: null }) }))).toEqual(['You have approved leave on 12/10/2026: there is no attendance to correct on a day of leave.']);
  });

  it('needs, by kind: the time they came in or left (not one on record already), a time to change, a start for work away', () => {
    expect(correctionProblems(ask({ kind: 'forgot_check_in', checkOut: null }), ctx())).toEqual(['Enter the time you came in.']);
    expect(correctionProblems(ask({ kind: 'forgot_check_in', checkIn: '09:00', checkOut: null }), ctx())).toEqual([
      'You checked in at 9:05 AM on 12/10/2026 already: choose “A time is wrong” to change it.',
    ]);
    expect(correctionProblems(ask({ kind: 'forgot_check_in', checkIn: '09:00', checkOut: null }), ctx({ day: null }))).toEqual([]);
    expect(correctionProblems(ask({ checkOut: null }), ctx())).toEqual(['Enter the time you left.']);
    expect(correctionProblems(ask(), ctx({ day: worked({ checkOut: at('18:00') }) }))[0]).toContain('You checked out at 6:00 PM on 12/10/2026 already');
    expect(correctionProblems(ask({ kind: 'wrong_time', checkOut: null }), ctx())).toEqual(['Enter the right time of the check-in, of the check-out, or both.']);
    expect(correctionProblems(ask({ kind: 'wrong_time', checkIn: '08:55', checkOut: null }), ctx({ day: null }))).toEqual([
      'There is no check-in or check-out on 12/10/2026 to correct: choose “I forgot to check in”.',
    ]);
    expect(correctionProblems(ask({ kind: 'wrong_time', checkIn: '09:05', checkOut: null }), ctx())).toEqual(['Those are the times on record for 12/10/2026 already.']);
    expect(correctionProblems(ask({ kind: 'wrong_time', checkIn: '08:55', checkOut: null }), ctx())).toEqual([]);
    // work away from the office is official duty now (owner, 31 October 2026: "Remove it, point to OD")
    const away = 'Working away from the office (at a client, a shoot, an errand) is official duty: ask for official duty instead, or work from home for a day at home.';
    expect(correctionProblems(ask({ kind: 'worked_remotely', checkOut: null }), ctx({ day: null }))).toEqual([away]);
    expect(correctionProblems(ask({ kind: 'worked_remotely', checkIn: null, checkOut: null }), ctx())).toEqual([away]);
  });

  it('needs the check-out after the check-in, a night shift’s on the next morning', () => {
    expect(correctionProblems(ask({ checkOut: '08:00' }), ctx())).toEqual(['The check-out (8:00 AM) must be after the check-in (9:05 AM) on the same day.']);
    const night = { startTime: '22:00', endTime: '06:00', hoursPerDay: 8, graceMinutes: 15 };
    const nightDay = worked({ checkIn: at('22:05') });
    expect(correctionProblems(ask({ checkOut: '06:00' }), ctx({ shift: night, day: nightDay }))).toEqual([]);
    expect(correctionMoments(DAY, { checkOut: '06:00' }, nightDay, night)).toEqual({ checkIn: null, checkOut: at('06:00', '2026-10-13') });
    expect(correctionMoments(DAY, { checkIn: '09:00', checkOut: '18:30' }, null, MORNING)).toEqual({ checkIn: at('09:00'), checkOut: at('18:30') });
  });
});

describe('a time not yet come', () => {
  const TODAY = '2026-10-19';
  const now = (time: string, day = TODAY) => zonedMoment(day, time);
  const today = (more: Partial<CorrectionContext> = {}) => ctx({ today: TODAY, day: null, ...more });
  const askToday = (more: Record<string, string | null> = {}) => ({ date: TODAY, kind: 'forgot_check_in', checkIn: '08:55', checkOut: null, reason: 'Forgot this morning', ...more });

  it('is refused today: asked at 00:30 for a check-in at 08:55, a minute before it; fine exactly then and after', () => {
    expect(correctionProblems(askToday(), today({ now: now('00:30') }))).toEqual(["Choose a time that has passed: 8:55 AM today hasn't come yet."]);
    expect(correctionProblems(askToday(), today({ now: now('08:54') }))).toEqual(["Choose a time that has passed: 8:55 AM today hasn't come yet."]);
    expect(correctionProblems(askToday(), today({ now: now('08:55') }))).toEqual([]);
    expect(correctionProblems(askToday(), today({ now: now('08:55') + 30_000 }))).toEqual([]);
    // HR correcting directly: the same
    expect(correctionProblems(askToday(), today({ now: now('00:30'), name: 'Nour Adel' }))).toEqual(["Choose a time that has passed: 8:55 AM today hasn't come yet."]);
  });

  it('says each time not yet come, the check-out too; none when the time isn’t known (the web before it reads its clock)', () => {
    expect(correctionProblems(askToday({ checkOut: '17:00' }), today({ now: now('12:00') }))).toEqual(["Choose a time that has passed: 5:00 PM today hasn't come yet."]);
    expect(correctionProblems(askToday({ checkOut: '17:00' }), today({ now: now('00:30') }))).toEqual([
      "Choose a time that has passed: 8:55 AM today hasn't come yet.",
      "Choose a time that has passed: 5:00 PM today hasn't come yet.",
    ]);
    expect(correctionProblems(askToday(), today({ now: null }))).toEqual([]);
    expect(correctionProblems(askToday(), today())).toEqual([]);
  });

  it('leaves a day before today alone, whatever the time now', () => {
    expect(correctionProblems({ ...askToday({ checkIn: '23:30' }), date: '2026-10-18' }, today({ now: now('00:30') }))).toEqual([]);
    expect(correctionProblems(ask(), ctx({ now: now('00:00') }))).toEqual([]);
  });

  it('takes a night shift’s check-out on the next morning once it has passed, not before', () => {
    const night = { startTime: '22:00', endTime: '06:00', hoursPerDay: 8, graceMinutes: 15 };
    const nightDay = worked({ checkIn: at('22:05', TODAY) });
    const out = { ...askToday({ kind: 'forgot_check_out', checkIn: null, checkOut: '06:00' }), reason: 'Forgot on the way out' };
    // asked during the night, the check-out the next morning: not yet
    expect(correctionProblems(out, today({ now: now('23:00'), shift: night, day: nightDay }))).toEqual(["Choose a time that has passed: 6:00 AM tomorrow hasn't come yet."]);
    // the next morning, once 06:00 has passed (the day asked for is yesterday by then)
    expect(correctionProblems(out, today({ today: '2026-10-20', now: now('06:30', '2026-10-20'), shift: night, day: nightDay }))).toEqual([]);
    expect(correctionProblems(out, today({ today: '2026-10-20', now: now('05:45', '2026-10-20'), shift: night, day: nightDay }))).toEqual([
      "Choose a time that has passed: 6:00 AM today hasn't come yet.",
    ]);
  });

  it('words an approval’s check again: wait for the time, not choose another', () => {
    const moments = [at('08:55', TODAY), null];
    expect(notYetComeProblems(moments, now('00:30'), NOT_YET_COME_APPROVAL_LEAD)).toEqual(["Approve it once the time has passed: 8:55 AM today hasn't come yet."]);
    expect(notYetComeProblems(moments, now('08:55'), NOT_YET_COME_APPROVAL_LEAD)).toEqual([]);
    expect(notYetComeProblems([new Date(at('08:55', TODAY)), at('08:55', TODAY)], now('00:30'))).toEqual(["Choose a time that has passed: 8:55 AM today hasn't come yet."]);
    expect(notYetComeProblems([at('09:00', '2026-10-18'), undefined], now('00:30'))).toEqual([]);
  });
});

describe('the day a correction makes', () => {
  it('puts the right times over those on record, worked, its hours counted again by the shift’s rule', () => {
    const made = correctedDay(worked(), { kind: 'forgot_check_out', checkIn: null, checkOut: at('18:30') }, DAY, MORNING);
    expect(made).toEqual({
      status: 'worked',
      checkIn: at('09:05'),
      checkOut: at('18:30'),
      place: 'office',
      flags: [],
      hoursCounted: 9,
      // its one pair (25 October 2026)
      pairs: [{ in: at('09:05'), out: at('18:30') }],
      openAt: null,
      breakMinutes: 0,
    });
    // a day with no record at all, absent: from the times given
    const absent = correctedDay({ status: 'absent', checkIn: null, checkOut: null, place: null, source: 'system' }, { kind: 'forgot_check_in', checkIn: at('10:00'), checkOut: at('17:30') }, DAY, MORNING);
    expect(absent).toMatchObject({ status: 'worked', hoursCounted: 7.5, place: null });
  });

  it('makes work away remote and no longer flagged, and keeps the flags of any other kind', () => {
    const flagged = worked({ place: 'remote', flags: ['outside_office'], checkOut: at('18:00') });
    expect(correctedDay(flagged, { kind: 'worked_remotely', checkIn: null, checkOut: null }, DAY, MORNING)).toMatchObject({ place: 'remote', flags: [] });
    expect(correctedDay(flagged, { kind: 'wrong_time', checkIn: at('09:00'), checkOut: null }, DAY, MORNING)).toMatchObject({ flags: ['outside_office'], hoursCounted: 9 });
  });

  it('says what it was corrected from, and its times', () => {
    expect(correctedFromText({ source: 'system', status: 'worked', checkIn: at('09:30'), checkOut: null, place: 'office' })).toBe('Corrected from 9:30 AM – no check-out');
    expect(correctedFromText({ source: 'system', status: 'absent', checkIn: null, checkOut: null, place: null })).toBe('Corrected from absent');
    expect(correctedFromText(null)).toBe('Corrected from no day on record');
    expect(correctionTimesText({ checkIn: at('09:05'), checkOut: at('18:30') })).toBe('9:05 AM – 6:30 PM');
    expect(correctionTimesText({ checkIn: null, checkOut: at('18:30') })).toBe('out at 6:30 PM');
    expect(correctionTimesText({ checkIn: null, checkOut: null })).toBeNull();
  });

  it('is applied while the month’s payroll is a draft or not made, never with the CEO, approved or paid', () => {
    expect(correctionApplyRefusal(DAY, null)).toBeNull();
    expect(correctionApplyRefusal(DAY, 'draft')).toBeNull();
    expect(correctionApplyRefusal(DAY, 'pending_ceo')).toBe('The October 2026 payroll is with the CEO, so the correction would miss it: ask the CEO to return it to HR, then approve the correction.');
    expect(correctionApplyRefusal(DAY, 'approved')).toBe("The October 2026 payroll is approved, so its days can't be corrected any more.");
  });
});

// Asking within 2 working days of the day (owner, 31 October 2026: "asking for correction is to be locked after 2 working
// days, i cant ask for correction after a week for example"). October 2026: the 1st is a Thursday; Sunday to Thursday.
describe('the time to ask for a correction', () => {
  const SUN_TO_THU = [0, 1, 2, 3, 4];

  it('is the day itself and until the end of the 2nd working day after it', () => {
    // Thursday 29th: Tuesday 27th has Wednesday between them (1), Monday 26th has Tuesday and Wednesday (2): closed
    expect(correctionAskFrom('2026-10-29', SUN_TO_THU)).toBe('2026-10-27');
    // Sunday 1 November: Wednesday 28th has only Thursday between (the weekend isn't worked): open; Tuesday 27th closed
    expect(correctionAskFrom('2026-11-01', SUN_TO_THU)).toBe('2026-10-28');
    // Monday 2 November: Thursday 29th (Sunday between) open, Wednesday 28th (Thursday and Sunday between) closed
    expect(correctionAskFrom('2026-11-02', SUN_TO_THU)).toBe('2026-10-29');
    // Tuesday 3 November: Thursday 29th (and the weekend after it) has Sunday and Monday between: closed; Sunday open
    expect(correctionAskFrom('2026-11-03', SUN_TO_THU)).toBe('2026-11-01');
  });

  it('skips the official holidays and their own leave, and reads Sunday to Thursday when no shift is known', () => {
    // Monday 2 November with Sunday a holiday: Wednesday 28th has only Thursday between it and today
    expect(correctionAskFrom('2026-11-02', SUN_TO_THU, ['2026-11-01'])).toBe('2026-10-28');
    // a week of leave after a Thursday: back on Sunday 8 November, that Thursday is still open
    const leave = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'];
    expect(correctionAskFrom('2026-11-08', SUN_TO_THU, leave)).toBe('2026-10-28');
    expect(correctionAskFrom('2026-11-03', null)).toBe('2026-11-01');
  });

  it('follows the shift: a Saturday-to-Wednesday week', () => {
    // Thursday 29th: Tuesday 27th has Wednesday between (1) and is open; Monday 26th is closed
    expect(correctionAskFrom('2026-10-29', [6, 0, 1, 2, 3])).toBe('2026-10-27');
    // Sunday 1 November: Wednesday 28th has Saturday between (1), Tuesday 27th has Wednesday and Saturday (2)
    expect(correctionAskFrom('2026-11-01', [6, 0, 1, 2, 3])).toBe('2026-10-28');
  });

  it('refuses an employee’s day asked too late, and HR’s direct correction has no such check', () => {
    const late = correctionProblems({ date: '2026-10-12', kind: 'forgot_check_out', checkOut: '18:30', reason: 'Client meeting' }, ctx({ askFrom: '2026-10-15' }));
    expect(late).toEqual(['It’s too late to ask to correct 12/10/2026: ask within 2 working days of the day. HR can still correct it for you.']);
    expect(correctionProblems({ date: '2026-10-15', kind: 'forgot_check_out', checkOut: '18:30', reason: 'Client meeting' }, ctx({ askFrom: '2026-10-15', day: worked({ checkIn: at('09:05', '2026-10-15') }) }))).toEqual([]);
    expect(correctionProblems({ date: '2026-10-12', kind: 'forgot_check_out', checkOut: '18:30', reason: 'Client meeting' }, ctx({ askFrom: null }))).toEqual([]);
  });
});
