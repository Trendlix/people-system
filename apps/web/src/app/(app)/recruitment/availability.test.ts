import type { AvailabilityPerson, AvailabilityView } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  availabilityQuestion,
  calendarText,
  checkSummary,
  dayHeading,
  defaultRange,
  findLength,
  lengthText,
  panelOf,
  pickedFields,
  savedWarnings,
  slotCountText,
  slotGroups,
  slotItem,
  timeCheckQuestion,
  withWarnings,
} from './availability';

// "Find a time" and the warnings of a time typed by hand (owner, 25 October 2026: "is it better for each interviewer to
// add his available interviews timeslots?"; "Hours + calendar"; "HR only"). Every name is invented.

const form = (entries: [string, string][]) => {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
};

const person = (employeeId: string, name: string, extra: Partial<AvailabilityPerson> = {}): AvailabilityPerson => ({
  employeeId,
  name,
  hasHours: true,
  calendar: 'none',
  sources: [],
  reconnect: false,
  ...extra,
});

const PEOPLE = [person('a', 'Ahmed Fathy'), person('s', 'Sara Nabil'), person('o', 'Omar Adel')];

describe('the question', () => {
  it('looks at the next 14 days, from today in Cairo', () => {
    expect(defaultRange('2026-10-25')).toEqual({ from: '2026-10-25', to: '2026-11-07' });
    expect(defaultRange('2026-12-25')).toEqual({ from: '2026-12-25', to: '2027-01-07' });
  });

  it('starts on the form’s length when it is one it offers, else 45 minutes', () => {
    expect(findLength(60)).toBe(60);
    expect(findLength(90)).toBe(90);
    expect(findLength(15)).toBe(45);
    expect(findLength(120)).toBe(45);
    expect([30, 45, 60, 90].map(lengthText)).toEqual(['30 minutes', '45 minutes', '1 hour', '1.5 hours']);
  });

  it('reads the panel from the interview form: the interviewers ticked (once each), how it is held, its length', () => {
    expect(panelOf(form([['interviewerIds', 'a'], ['interviewerIds', 's'], ['interviewerIds', 'a'], ['kind', 'online'], ['minutes', '60']]))).toEqual({
      interviewerIds: ['a', 's'],
      kind: 'online',
      minutes: 60,
    });
    expect(panelOf(form([['kind', 'by_pigeon']]))).toEqual({ interviewerIds: [], kind: null, minutes: null });
  });

  it('asks the API for the times with the days as typed, and the interview moved on a reschedule', () => {
    const fd = form([['interviewerIds', 'a'], ['interviewerIds', 's'], ['kind', 'in_person'], ['minutes', '45'], ['findMinutes', '60'], ['findFrom', '26/10/2026'], ['findTo', '6/11/2026']]);
    expect(availabilityQuestion(fd, 'iv-1')).toEqual({
      input: { interviewerIds: ['a', 's'], minutes: 60, kind: 'in_person', from: '2026-10-26', to: '2026-11-06', interviewId: 'iv-1' },
      errors: [],
    });
    expect(availabilityQuestion(fd).input).not.toHaveProperty('interviewId');
  });

  it('says what is missing before asking', () => {
    const { input, errors } = availabilityQuestion(form([['kind', 'online'], ['findMinutes', '20'], ['findFrom', '06/11/2026'], ['findTo', '26/10/2026']]));
    expect(input).toBeNull();
    expect(errors).toEqual(['Choose who interviews them first.', 'Choose the length: 30, 45, 60 or 90 minutes.', 'The last day comes after the first.']);
    expect(availabilityQuestion(form([['interviewerIds', 'a'], ['kind', 'online'], ['findMinutes', '30'], ['findFrom', '31/02/2026'], ['findTo', '']])).errors).toEqual([
      'Give the days to look in, as DD/MM/YYYY.',
    ]);
  });

  it('checks a time typed by hand: the day, the 12-hour time, the length, how and who', () => {
    const fd = form([['date', '29/10/2026'], ['time', '2:30 PM'], ['minutes', '45'], ['kind', 'online'], ['interviewerIds', 'o']]);
    expect(timeCheckQuestion(fd, 'iv-2')).toEqual({ input: { interviewerIds: ['o'], date: '2026-10-29', time: '14:30', minutes: 45, kind: 'online', interviewId: 'iv-2' }, errors: [] });
    expect(timeCheckQuestion(form([['date', ''], ['time', ''], ['kind', 'online']])).errors).toEqual([
      'Choose the day of the interview, as DD/MM/YYYY.',
      'Choose the time of the interview.',
      'Choose how long it takes.',
      'Choose who interviews them.',
    ]);
  });
});

describe('the list', () => {
  const view: AvailabilityView = {
    from: '2026-10-25',
    to: '2026-10-28',
    minutes: 45,
    kind: 'in_person',
    people: PEOPLE,
    truncated: false,
    notes: [],
    days: [
      {
        date: '2026-10-25',
        holiday: null,
        slots: [
          { start: '2026-10-25T09:00:00.000Z', time: '12:00', people: [{ employeeId: 'a', status: 'free' }, { employeeId: 's', status: 'free' }, { employeeId: 'o', status: 'free' }], marked: false },
          { start: '2026-10-25T09:15:00.000Z', time: '12:15', people: [{ employeeId: 'a', status: 'free' }, { employeeId: 's', status: 'maybe' }, { employeeId: 'o', status: 'no_hours' }], marked: true },
        ],
      },
      { date: '2026-10-26', holiday: null, slots: [] },
      { date: '2026-10-27', holiday: 'Revolution Day', slots: [] },
      { date: '2027-01-03', holiday: null, slots: [{ start: '2027-01-03T08:00:00.000Z', time: '10:00', people: [{ employeeId: 'a', status: 'free' }, { employeeId: 's', status: 'free' }, { employeeId: 'o', status: 'free' }], marked: false }] },
    ],
  };

  it('groups the times by day under Title Case headings, a day without times left out but a holiday said', () => {
    const groups = slotGroups(view, '2026-10-25');
    expect(groups.map((g) => [g.heading, g.holiday, g.slots.length])).toEqual([
      ['Sunday 25 October', null, 2],
      ['Tuesday 27 October', 'Revolution Day', 0],
      ['Sunday 3 January 2027', null, 1],
    ]);
    expect(dayHeading('2026-11-01', '2026-10-25')).toBe('Sunday 1 November');
  });

  it('says who each time suits with first names, the marked ones why', () => {
    const [plain, marked] = slotGroups(view, '2026-10-25')[0].slots;
    expect(plain).toMatchObject({ hhmm: '12:00', time: '12:00 PM', who: 'All free', why: [], marked: false, label: '12:00 PM, All free' });
    expect(marked).toMatchObject({ time: '12:15 PM', who: 'Ahmed free · Sara: maybe · Omar: no interview hours set', why: ['Sara: maybe', 'Omar: no interview hours set'], marked: true });
  });

  it('a panel of one: "Free"; two sharing a first name: their full names', () => {
    expect(slotItem({ start: 'x', time: '09:30', people: [{ employeeId: 'a', status: 'free' }], marked: false }, PEOPLE).who).toBe('Free');
    const twins = [person('a', 'Ahmed Fathy'), person('b', 'Ahmed Samir')];
    expect(slotItem({ start: 'x', time: '09:30', people: [{ employeeId: 'a', status: 'free' }, { employeeId: 'b', status: 'maybe' }], marked: true }, twins).who).toBe(
      'Ahmed Fathy free · Ahmed Samir: maybe',
    );
  });

  it('counts the times, and says how each calendar was read', () => {
    expect(slotCountText(view)).toBe('3 free times');
    expect(slotCountText({ days: [view.days[3]] })).toBe('1 free time');
    expect(calendarText(person('a', 'Ahmed', { calendar: 'failed' }))).toBe('Couldn’t check Ahmed’s calendar.');
    expect(calendarText(person('a', 'Ahmed', { calendar: 'checked', sources: ['Zoho Calendar', 'Google Calendar'] }))).toBe('Ahmed: Zoho Calendar and Google Calendar checked.');
    expect(calendarText(person('a', 'Ahmed', { reconnect: true }))).toBe('Ahmed: reconnect their Google account to share busy times.');
    expect(calendarText(person('a', 'Ahmed'))).toBeNull();
  });

  it('picking a time fills the day as DD/MM/YYYY, the time on the 12-hour clock and the length', () => {
    expect(pickedFields('2026-10-25', { time: '14:45' }, 60)).toEqual({ date: '25/10/2026', time: '2:45 PM', minutes: '60' });
    expect(pickedFields('2026-11-01', { time: '00:15' }, 30)).toEqual({ date: '01/11/2026', time: '12:15 AM', minutes: '30' });
  });
});

describe('the warnings', () => {
  const warnings = ['Ahmed is unavailable then.', 'Sara has another interview at 2:30 PM.', 'Outside Omar’s interview hours.', 'Omar’s calendar is busy.'];

  it('come after a save’s words, and are split back apart to show as warnings', () => {
    const message = withWarnings('The candidate was emailed, with the calendar invitation.', warnings);
    expect(message).toBe(
      'The candidate was emailed, with the calendar invitation. Saved with warnings: Ahmed is unavailable then. Sara has another interview at 2:30 PM. Outside Omar’s interview hours. Omar’s calendar is busy.',
    );
    expect(savedWarnings(message)).toEqual({ text: 'The candidate was emailed, with the calendar invitation.', warnings });
    expect(withWarnings('Saved.', [])).toBe('Saved.');
    expect(withWarnings('Saved.', undefined)).toBe('Saved.');
    expect(savedWarnings('Saved.')).toEqual({ text: 'Saved.', warnings: [] });
    expect(savedWarnings(undefined)).toEqual({ text: '', warnings: [] });
  });

  it('never mention a leave’s type: the API’s words are shown as they are', () => {
    expect(savedWarnings(withWarnings('Saved.', ['Ahmed is unavailable then.'])).warnings.join(' ')).not.toMatch(/sick|annual|casual|maternity|leave/i);
  });

  it('"Check this time" says how many things to know, or that it suits them all', () => {
    expect(checkSummary([])).toBe('No conflicts: the time suits them all.');
    expect(checkSummary(['Sara has another interview at 2:30 PM.'])).toBe('1 thing to know about this time:');
    expect(checkSummary(warnings)).toBe('4 things to know about this time:');
  });
});
