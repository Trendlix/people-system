import {
  correctedDay,
  correctedFromText,
  correctionApplyRefusal,
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
    expect(correctionProblems(ask({ kind: 'worked_remotely', checkOut: null }), ctx({ day: null }))).toEqual(['Enter the time you started work on 12/10/2026.']);
    expect(correctionProblems(ask({ kind: 'worked_remotely', checkIn: null, checkOut: null }), ctx())).toEqual([]);
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
