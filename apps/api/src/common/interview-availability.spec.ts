import {
  availabilityNotes,
  availabilityProblems,
  effectiveRules,
  findSlots,
  hoursOn,
  hoursSummary,
  interviewDefaultsProblems,
  interviewHoursProblems,
  panelNames,
  slotWarnings,
  tidyHours,
  zonedMoment,
  type BusyBlock,
  type InterviewHours,
  type PanelPerson,
} from '@trendlix/shared';

// Interviewers' availability (owner, 25 October 2026: "is it better for each interviewer to add his available interviews
// timeslots?"; asked, "Hours + calendar" and "HR only"): the interview hours' rules, the slots every interviewer is free
// (weekly ranges and one-off changes, minus leave, holidays, days from home, booked interviews with their buffer and busy
// calendars, from the notice on, on the quarter hour, in Cairo with its summer time), and the warnings of a time typed by
// hand. Every name is invented.

const DEFAULTS = { noticeHours: 24, bufferMinutes: 15 };
const TODAY = '2026-10-20';
/** Long before every slot below, so the notice never cuts them unless a test says so. */
const LONG_AGO = Date.parse('2026-01-01T00:00:00Z');
const at = (date: string, time: string) => zonedMoment(date, time);
const iso = (ms: number) => new Date(ms).toISOString();

function hours(windows: InterviewHours['windows'], extra: Partial<InterviewHours> = {}): InterviewHours {
  return { windows, changes: [], effectiveFrom: '2026-01-01', noticeHours: null, bufferMinutes: null, ...extra };
}

function person(id: string, name: string, h: InterviewHours | null, blocks: BusyBlock[] = [], more: Partial<PanelPerson> = {}): PanelPerson {
  return { id, name, hours: h, rules: effectiveRules(h, DEFAULTS), blocks, calendar: 'checked', ...more };
}

/** The slots' starts on a date, as Cairo "HH:mm". */
const CLOCK = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const startsOn = (r: ReturnType<typeof findSlots>, date: string) => r.days.find((d) => d.date === date)!.slots.map((s) => CLOCK.format(new Date(s.start)));

// 1 November 2026 is a Sunday (winter time, UTC+2); 25 October 2026 a Sunday in summer time (UTC+3)
const SUN = '2026-11-01';
const MON = '2026-11-02';

describe('interview hours: the rules', () => {
  it('takes ranges on the quarter hour, at most four a day, not overlapping, and changes from today on', () => {
    expect(interviewHoursProblems(hours([{ day: 0, from: '12:00', to: '15:00' }]), DEFAULTS, TODAY)).toEqual([]);
    expect(interviewHoursProblems(hours([{ day: 0, from: '12:10', to: '15:00' }]), DEFAULTS, TODAY)).toEqual(['Start and end Sunday’s range on the quarter hour (:00, :15, :30, :45).']);
    expect(interviewHoursProblems(hours([{ day: 1, from: '15:00', to: '12:00' }]), DEFAULTS, TODAY)).toEqual(['End Monday’s range after it starts.']);
    expect(
      interviewHoursProblems(
        hours([
          { day: 2, from: '09:00', to: '11:00' },
          { day: 2, from: '10:30', to: '12:00' },
        ]),
        DEFAULTS,
        TODAY,
      ),
    ).toEqual(['Tuesday’s ranges overlap: join them into one.']);
    const five = ['08:00', '09:00', '10:00', '11:00', '12:00'].map((f, i) => ({ day: 3, from: f, to: `${String(8 + i).padStart(2, '0')}:45` }));
    expect(interviewHoursProblems(hours(five), DEFAULTS, TODAY)).toContain('Give Wednesday at most 4 ranges.');
    expect(interviewHoursProblems(hours([], { changes: [{ date: '2026-10-19', kind: 'off', from: null, to: null }] }), DEFAULTS, TODAY)).toEqual(['A one-off change is for today or a later day.']);
    expect(
      interviewHoursProblems(
        hours([], {
          changes: [
            { date: '2026-10-22', kind: 'off', from: null, to: null },
            { date: '2026-10-22', kind: 'extra', from: '10:00', to: '11:00' },
          ],
        }),
        DEFAULTS,
        TODAY,
      ),
    ).toEqual(['A day off from interviews can’t have extra hours on it too, nor be given twice.']);
    expect(interviewHoursProblems(hours([], { changes: [{ date: '2026-10-22', kind: 'extra', from: null, to: null }] }), DEFAULTS, TODAY)).toEqual(['Give the extra hours a start and an end time.']);
  });

  it('lets a person make the notice and buffer only stricter than the company’s', () => {
    expect(interviewHoursProblems(hours([], { noticeHours: 48, bufferMinutes: 30 }), DEFAULTS, TODAY)).toEqual([]);
    expect(interviewHoursProblems(hours([], { noticeHours: 12 }), DEFAULTS, TODAY)).toEqual(['Your notice can’t be shorter than the company’s 24 hours.']);
    expect(interviewHoursProblems(hours([], { bufferMinutes: 10 }), DEFAULTS, TODAY)).toEqual(['Your buffer can’t be shorter than the company’s 15 minutes.']);
    expect(interviewHoursProblems(hours([], { bufferMinutes: 17 }), DEFAULTS, TODAY)).toEqual(['Give the buffer in minutes, in fives, up to 120.']);
    expect(effectiveRules({ noticeHours: null, bufferMinutes: 30 }, DEFAULTS)).toEqual({ noticeHours: 24, bufferMinutes: 30 });
    // the company made stricter later: its own counts
    expect(effectiveRules({ noticeHours: 24, bufferMinutes: 15 }, { noticeHours: 48, bufferMinutes: 20 })).toEqual({ noticeHours: 48, bufferMinutes: 20 });
    expect(interviewDefaultsProblems({ noticeHours: 24, bufferMinutes: 15 })).toEqual([]);
    expect(interviewDefaultsProblems({ noticeHours: -1, bufferMinutes: 7 })).toHaveLength(2);
  });

  it('keeps the ranges in order and the one-off changes from today on, and says the week in words', () => {
    const tidy = tidyHours(
      hours(
        [
          { day: 2, from: '10:00', to: '12:00' },
          { day: 0, from: '12:00', to: '15:00' },
        ],
        {
          changes: [
            { date: '2026-10-25', kind: 'extra', from: '18:00', to: '19:00' },
            { date: '2026-10-01', kind: 'off', from: null, to: null },
          ],
        },
      ),
      TODAY,
    );
    expect(tidy.windows.map((w) => w.day)).toEqual([0, 2]);
    expect(tidy.changes).toEqual([{ date: '2026-10-25', kind: 'extra', from: '18:00', to: '19:00' }]);
    expect(hoursSummary(tidy)).toBe('Sun 12:00 PM–3:00 PM · Tue 10:00 AM–12:00 PM');
  });

  it('gives a date’s hours: the weekday’s, a day off, extra hours, none on a holiday but the extra, none set before they count', () => {
    const h = hours([{ day: 0, from: '12:00', to: '15:00' }], {
      changes: [
        { date: '2026-11-08', kind: 'off', from: null, to: null },
        { date: '2026-11-15', kind: 'extra', from: '16:00', to: '17:00' },
      ],
      effectiveFrom: '2026-10-26',
    });
    expect(hoursOn(h, SUN)).toEqual([[720, 900]]);
    expect(hoursOn(h, MON)).toEqual([]);
    expect(hoursOn(h, '2026-11-08')).toEqual([]);
    expect(hoursOn(h, '2026-11-15')).toEqual([
      [720, 900],
      [960, 1020],
    ]);
    expect(hoursOn(h, '2026-11-15', true)).toEqual([[960, 1020]]);
    expect(hoursOn(h, '2026-10-25')).toBeNull();
    expect(hoursOn(null, SUN)).toBeNull();
  });
});

describe('interview hours: the slots', () => {
  const ahmed = hours([{ day: 0, from: '12:00', to: '15:00' }]);

  it('starts on the quarter hour inside the hours, for the length asked', () => {
    const r = findSlots([person('a', 'Ahmed Hassan', ahmed)], { from: SUN, to: SUN, minutes: 60, now: LONG_AGO, holidays: [] });
    expect(startsOn(r, SUN)).toEqual(['12:00', '12:15', '12:30', '12:45', '13:00', '13:15', '13:30', '13:45', '14:00']);
    expect(r.days[0].slots.every((s) => !s.marked && s.people[0].status === 'free')).toBe(true);
    // a calendar busy to 12:20 moves the first start to 12:30
    const busy = findSlots([person('a', 'Ahmed Hassan', ahmed, [{ start: at(SUN, '11:00'), end: at(SUN, '12:20'), kind: 'calendar' }])], { from: SUN, to: SUN, minutes: 60, now: LONG_AGO, holidays: [] });
    expect(startsOn(busy, SUN)[0]).toBe('12:30');
  });

  it('keeps Cairo’s own time in summer and in winter (no summer-time surprises)', () => {
    const h = hours([{ day: 0, from: '10:00', to: '11:00' }]);
    const summer = findSlots([person('a', 'Ahmed', h)], { from: '2026-10-25', to: '2026-10-25', minutes: 60, now: LONG_AGO, holidays: [] });
    const winter = findSlots([person('a', 'Ahmed', h)], { from: SUN, to: SUN, minutes: 60, now: LONG_AGO, holidays: [] });
    expect(summer.days[0].slots.map((s) => iso(s.start))).toEqual(['2026-10-25T07:00:00.000Z']);
    expect(winter.days[0].slots.map((s) => iso(s.start))).toEqual(['2026-11-01T08:00:00.000Z']);
    // the Thursday the clocks go back at midnight (29 October 2026): the morning is as any other
    const thursday = findSlots([person('a', 'Ahmed', hours([{ day: 4, from: '10:00', to: '11:00' }]))], { from: '2026-10-29', to: '2026-10-30', minutes: 30, now: LONG_AGO, holidays: [] });
    expect(startsOn(thursday, '2026-10-29')).toEqual(['10:00', '10:15', '10:30']);
  });

  it('intersects the hours of a panel of two and of three', () => {
    const sara = hours([{ day: 0, from: '13:00', to: '16:00' }]);
    const omar = hours([{ day: 0, from: '09:00', to: '14:00' }]);
    const two = findSlots([person('a', 'Ahmed', ahmed), person('s', 'Sara', sara)], { from: SUN, to: SUN, minutes: 60, now: LONG_AGO, holidays: [] });
    expect(startsOn(two, SUN)).toEqual(['13:00', '13:15', '13:30', '13:45', '14:00']);
    const three = findSlots([person('a', 'Ahmed', ahmed), person('s', 'Sara', sara), person('o', 'Omar', omar)], { from: SUN, to: SUN, minutes: 45, now: LONG_AGO, holidays: [] });
    expect(startsOn(three, SUN)).toEqual(['13:00', '13:15']);
    expect(three.days[0].slots[0].people.map((p) => p.id)).toEqual(['a', 's', 'o']);
  });

  it('keeps the buffer around a booked interview, and the longest notice', () => {
    const booked: BusyBlock = { start: at(SUN, '13:00'), end: at(SUN, '13:45'), kind: 'interview', at: at(SUN, '13:00') };
    const r = findSlots([person('a', 'Ahmed', ahmed, [booked])], { from: SUN, to: SUN, minutes: 30, now: LONG_AGO, holidays: [] });
    // 12:45–14:00 taken (15 minutes each side)
    expect(startsOn(r, SUN)).toEqual(['12:00', '12:15', '14:00', '14:15', '14:30']);
    // their own buffer of 30 minutes
    const strict = findSlots([person('a', 'Ahmed', hours(ahmed.windows, { bufferMinutes: 30 }), [booked])], { from: SUN, to: SUN, minutes: 30, now: LONG_AGO, holidays: [] });
    expect(startsOn(strict, SUN)).toEqual(['12:00', '14:15', '14:30']);
    // 24 hours' notice from Saturday 1:30 PM: Sunday from 1:30 PM on
    const notice = findSlots([person('a', 'Ahmed', ahmed)], { from: SUN, to: SUN, minutes: 60, now: at('2026-10-31', '13:30'), holidays: [] });
    expect(startsOn(notice, SUN)).toEqual(['13:30', '13:45', '14:00']);
    // someone else's 48 hours: nothing on Sunday
    const longer = findSlots([person('a', 'Ahmed', ahmed), person('s', 'Sara', hours(ahmed.windows, { noticeHours: 48 }))], { from: SUN, to: SUN, minutes: 60, now: at('2026-10-31', '13:30'), holidays: [] });
    expect(startsOn(longer, SUN)).toEqual([]);
  });

  it('takes approved leave away, and marks leave waiting for a decision as maybe', () => {
    const away: BusyBlock = { start: at(SUN, '00:00'), end: at(MON, '00:00'), kind: 'away' };
    expect(startsOn(findSlots([person('a', 'Ahmed', ahmed, [away])], { from: SUN, to: SUN, minutes: 60, now: LONG_AGO, holidays: [] }), SUN)).toEqual([]);
    const maybe = findSlots([person('a', 'Ahmed', ahmed, [{ ...away, kind: 'away_maybe' }]), person('s', 'Sara', ahmed)], { from: SUN, to: SUN, minutes: 60, now: LONG_AGO, holidays: [] });
    expect(maybe.days[0].slots).toHaveLength(9);
    expect(maybe.days[0].slots[0]).toMatchObject({ marked: true, people: [{ id: 'a', status: 'maybe' }, { id: 's', status: 'free' }] });
    // a calendar that couldn't be checked: offered, marked
    const failed = findSlots([person('a', 'Ahmed', ahmed, [], { calendar: 'failed' })], { from: SUN, to: SUN, minutes: 60, now: LONG_AGO, holidays: [] });
    expect(failed.days[0].slots.every((s) => s.marked && s.people[0].status === 'maybe')).toBe(true);
  });

  it('takes a public holiday away, keeping extra hours given for it, and for those without hours too', () => {
    const h = hours(ahmed.windows, { changes: [{ date: SUN, kind: 'extra', from: '16:00', to: '17:00' }] });
    const holidays = [{ date: SUN, name: 'Victory Day' }];
    const r = findSlots([person('a', 'Ahmed', h)], { from: SUN, to: SUN, minutes: 60, now: LONG_AGO, holidays });
    expect(r.days[0].holiday).toBe('Victory Day');
    expect(startsOn(r, SUN)).toEqual(['16:00']);
    const withoutHours = findSlots([person('a', 'Ahmed', h), person('n', 'Nour', null)], { from: SUN, to: SUN, minutes: 60, now: LONG_AGO, holidays });
    expect(startsOn(withoutHours, SUN)).toEqual([]);
  });

  it('takes days from home away when given (in person), marking the waiting ones', () => {
    const day: BusyBlock = { start: at(SUN, '00:00'), end: at(MON, '00:00'), kind: 'wfh' };
    expect(startsOn(findSlots([person('a', 'Ahmed', ahmed, [day])], { from: SUN, to: SUN, minutes: 60, now: LONG_AGO, holidays: [] }), SUN)).toEqual([]);
    const maybe = findSlots([person('a', 'Ahmed', ahmed, [{ ...day, kind: 'wfh_maybe' }])], { from: SUN, to: SUN, minutes: 60, now: LONG_AGO, holidays: [] });
    expect(maybe.days[0].slots[0].marked).toBe(true);
    // online, the API gives no days from home: the slots are there
    expect(startsOn(findSlots([person('a', 'Ahmed', ahmed)], { from: SUN, to: SUN, minutes: 60, now: LONG_AGO, holidays: [] }), SUN)).toHaveLength(9);
  });

  it('lets those without hours narrow nothing but their busy times, and says when nobody has hours', () => {
    const r = findSlots([person('a', 'Ahmed', ahmed), person('n', 'Nour', null, [{ start: at(SUN, '12:00'), end: at(SUN, '13:00'), kind: 'calendar' }])], {
      from: SUN,
      to: SUN,
      minutes: 60,
      now: LONG_AGO,
      holidays: [],
    });
    expect(startsOn(r, SUN)).toEqual(['13:00', '13:15', '13:30', '13:45', '14:00']);
    expect(r.days[0].slots[0].people).toEqual([
      { id: 'a', status: 'free' },
      { id: 'n', status: 'no_hours' },
    ]);
    const none = findSlots([person('n', 'Nour', null)], { from: SUN, to: MON, minutes: 60, now: LONG_AGO, holidays: [] });
    expect(none.noHours).toBe(true);
    expect(none.days.every((d) => !d.slots.length)).toBe(true);
  });

  it('lists at most 400 times', () => {
    const allDay = hours([0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, from: '00:00', to: '23:45' })));
    const r = findSlots([person('a', 'Ahmed', allDay)], { from: SUN, to: '2026-11-30', minutes: 30, now: LONG_AGO, holidays: [] });
    expect(r.truncated).toBe(true);
    expect(r.days.reduce((n, d) => n + d.slots.length, 0)).toBe(400);
  });
});

describe('interview hours: the warnings of a time typed by hand', () => {
  const ahmed = hours([{ day: 0, from: '12:00', to: '15:00' }]);
  const t = at(SUN, '13:00');

  it('says nothing when it suits them all', () => {
    expect(slotWarnings([person('a', 'Ahmed Hassan', ahmed)], t, 60, { now: LONG_AGO, holidays: [] })).toEqual([]);
  });

  it('warns of leave as unavailable (never its type), interviews, hours, calendars, the notice and holidays', () => {
    const people = [
      person('a', 'Ahmed Hassan', ahmed, [{ start: at(SUN, '00:00'), end: at(MON, '00:00'), kind: 'away' }]),
      person('s', 'Sara Adel', ahmed, [{ start: at(SUN, '14:30'), end: at(SUN, '15:15'), kind: 'interview', at: at(SUN, '14:30') }]),
      person('o', 'Omar Fathy', hours([{ day: 0, from: '09:00', to: '12:00' }]), [{ start: at(SUN, '13:30'), end: at(SUN, '14:00'), kind: 'calendar' }]),
      person('n', 'Nour Samir', null, [{ start: at(SUN, '00:00'), end: at(MON, '00:00'), kind: 'away_maybe' }], { calendar: 'failed' }),
    ];
    expect(slotWarnings(people, at(SUN, '13:30'), 60, { now: at(SUN, '01:00'), holidays: [{ date: SUN, name: 'Victory Day' }] })).toEqual([
      'That day is a public holiday (Victory Day).',
      'Ahmed is unavailable then.',
      'Outside Ahmed’s interview hours.',
      'Sooner than Ahmed’s notice of 24 hours.',
      'Sara has another interview at 2:30 PM.',
      'Outside Sara’s interview hours.',
      'Sooner than Sara’s notice of 24 hours.',
      'Outside Omar’s interview hours.',
      'Omar’s calendar is busy.',
      'Sooner than Omar’s notice of 24 hours.',
      'Nour may be unavailable then.',
      'Couldn’t check Nour’s calendar.',
      'Sooner than Nour’s notice of 24 hours.',
    ]);
  });

  it('counts the buffer around another interview, and days from home and tentative events', () => {
    const near = person('s', 'Sara', ahmed, [{ start: at(SUN, '14:10'), end: at(SUN, '14:40'), kind: 'interview', at: at(SUN, '14:10') }]);
    expect(slotWarnings([near], t, 60, { now: LONG_AGO, holidays: [] })).toEqual(['Sara has another interview at 2:10 PM.']);
    const home = person('a', 'Ahmed', ahmed, [
      { start: at(SUN, '00:00'), end: at(MON, '00:00'), kind: 'wfh' },
      { start: at(SUN, '13:00'), end: at(SUN, '13:30'), kind: 'calendar_maybe' },
    ]);
    expect(slotWarnings([home], t, 60, { now: LONG_AGO, holidays: [] })).toEqual(['Ahmed works from home that day.', 'Ahmed’s calendar may be busy.']);
  });

  it('says only “isn’t free” of a C-level person hidden from the caller', () => {
    const hidden = person('c', 'Karim Nabil', ahmed, [{ start: at(SUN, '00:00'), end: at(MON, '00:00'), kind: 'hidden' }]);
    expect(slotWarnings([hidden], t, 60, { now: LONG_AGO, holidays: [] })).toEqual(['Karim isn’t free then.']);
  });

  it('uses first names, and full names where two share one', () => {
    const names = panelNames([
      { id: '1', name: 'Ahmed Hassan' },
      { id: '2', name: 'Ahmed Samy' },
      { id: '3', name: 'Sara Adel' },
    ]);
    expect([...names.values()]).toEqual(['Ahmed Hassan', 'Ahmed Samy', 'Sara']);
  });
});

describe('interview hours: "Find a time"', () => {
  it('checks the question: the panel, the length, the days', () => {
    const ok = { interviewerIds: ['a'], minutes: 45, kind: 'online' as const, from: '2026-10-20', to: '2026-11-02' };
    expect(availabilityProblems(ok, TODAY)).toEqual([]);
    expect(availabilityProblems({ ...ok, interviewerIds: [] }, TODAY)).toEqual(['Choose who interviews them first.']);
    expect(availabilityProblems({ ...ok, minutes: 20 }, TODAY)).toEqual(['Choose the length: 30, 45, 60 or 90 minutes.']);
    expect(availabilityProblems({ ...ok, to: '2026-12-31' }, TODAY)).toEqual(['Look at most 31 days at a time.']);
    expect(availabilityProblems({ ...ok, from: '2026-11-03', to: '2026-11-01' }, TODAY)).toEqual(['The last day comes after the first.']);
  });

  it('notes who has no hours and whose calendar couldn’t be checked', () => {
    const people = [
      { employeeId: 'a', name: 'Ahmed Hassan', hasHours: true, calendar: 'failed' as const, sources: [], reconnect: false },
      { employeeId: 'n', name: 'Nour Samir', hasHours: false, calendar: 'checked' as const, sources: ['Zoho Calendar'], reconnect: false },
    ];
    expect(availabilityNotes(people, false, false)).toEqual([
      'Nour hasn’t set interview hours: their leave, interviews and calendar are checked, not their hours.',
      'Couldn’t check Ahmed’s calendar: the times are offered all the same, marked.',
    ]);
    expect(availabilityNotes(people, true, true)[0]).toBe('None of them has set interview hours yet: type a time by hand, or ask them to set theirs.');
  });
});
