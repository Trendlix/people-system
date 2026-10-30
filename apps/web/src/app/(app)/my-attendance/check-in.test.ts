import { describe, expect, it } from 'vitest';
import { checkInRefusal, dayFromPunches, EXEMPT_CHECK_IN_TEXT, NETWORK_NEEDED_TEXT } from '@trendlix/shared';
import type { CheckInTodayView, PunchView } from '../../../lib/attendance-types';
import {
  accuracyText,
  buttonLabel,
  checkInCount,
  checkInShows,
  counterShows,
  counterWords,
  countRuleOf,
  dayBreakText,
  dayHoursText,
  dayTimesText,
  dayTitle,
  durationClock,
  exemptToday,
  expectedTextOf,
  flagLabels,
  hoursToWorkText,
  latestView,
  LOCATION_OPTIONS,
  locationErrorOf,
  locationHelpText,
  lockNote,
  mockRefused,
  noteServerTime,
  placeLabel,
  dayPlaceLabel,
  networkNote,
  PLAIN_COUNT,
  punchBody,
  punchBodyFrom,
  punchErrors,
  punchRows,
  LOCATION_NOTE,
  LOCATION_NOTE_IN_APP,
  longDayTitle,
  readingOf,
  readLocation,
  todayBadge,
  todayHeadline,
  withoutMock,
  workLocationText,
  workTime,
} from './check-in';

// Checking in on the system (owner, 19 October 2026: "Check-in through the system (phone or web with the office location
// check, or a device) to replace Zoho"). Every point here is invented.

type Success = (p: { coords: { latitude: number; longitude: number; accuracy: number } }) => void;
type Failure = (e: { code: number }) => void;

/** A browser's geolocation that answers as told, and remembers what it was asked with. */
function fakeGeo(answer: (ok: Success, fail: Failure) => void) {
  const asked: unknown[] = [];
  return {
    asked,
    geo: {
      getCurrentPosition: (ok: Success, fail: Failure, options: unknown) => {
        asked.push(options);
        answer(ok, fail);
      },
    } as unknown as Pick<Geolocation, 'getCurrentPosition'>,
  };
}

const TODAY: CheckInTodayView = {
  refusal: null,
  date: '2026-10-19',
  now: '2026-10-19T06:00:00.000Z',
  next: 'in',
  punches: [],
  day: null,
  expected: 'office',
  expectedText: 'You work at the office: check in there.',
  officeLocationSet: true,
  shift: { startTime: '09:00', endTime: '17:00', hoursPerDay: 8, graceMinutes: 15 },
};

describe('the browser’s location, asked each press', () => {
  it('maps the browser’s error codes: 1 refused, 2 unavailable, 3 too slow', () => {
    expect([locationErrorOf(1), locationErrorOf(2), locationErrorOf(3), locationErrorOf(undefined), locationErrorOf(9)]).toEqual(['denied', 'unavailable', 'timeout', 'unavailable', 'unavailable']);
  });

  it('asks for a fresh, precise reading within 10 seconds, and gives the point and its accuracy', async () => {
    const { geo, asked } = fakeGeo((ok) => ok({ coords: { latitude: 30.0596, longitude: 31.3462, accuracy: 18.4 } }));
    await expect(readLocation(geo)).resolves.toEqual({ latitude: 30.0596, longitude: 31.3462, accuracy: 18.4 });
    expect(asked).toEqual([{ enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 }]);
    expect(LOCATION_OPTIONS.maximumAge).toBe(0);
  });

  it('gives the reason when there is no point: refused, unavailable, too slow, a browser without it', async () => {
    for (const [code, reason] of [
      [1, 'denied'],
      [2, 'unavailable'],
      [3, 'timeout'],
    ] as const) {
      await expect(readLocation(fakeGeo((_ok, fail) => fail({ code })).geo)).resolves.toEqual({ locationError: reason });
    }
    await expect(readLocation(undefined)).resolves.toEqual({ locationError: 'unsupported' });
    await expect(readLocation(null)).resolves.toEqual({ locationError: 'unsupported' });
    const throws = { getCurrentPosition: () => { throw new Error('blocked'); } } as unknown as Pick<Geolocation, 'getCurrentPosition'>;
    await expect(readLocation(throws)).resolves.toEqual({ locationError: 'unavailable' });
  });

  it('goes on as too slow when the browser never answers (a prompt left open), and counts only the first answer', async () => {
    await expect(readLocation(fakeGeo(() => undefined).geo, 5)).resolves.toEqual({ locationError: 'timeout' });
    const twice = fakeGeo((ok, fail) => {
      fail({ code: 1 });
      ok({ coords: { latitude: 30, longitude: 31, accuracy: 5 } });
    });
    await expect(readLocation(twice.geo)).resolves.toEqual({ locationError: 'denied' });
  });

  it('reads a point that isn’t one as unavailable, and an accuracy it doesn’t know as none', () => {
    expect(readingOf({ latitude: Number.NaN, longitude: 31 })).toEqual({ locationError: 'unavailable' });
    expect(readingOf({ latitude: 91, longitude: 31 })).toEqual({ locationError: 'unavailable' });
    expect(readingOf(null)).toEqual({ locationError: 'unavailable' });
    expect(readingOf({ latitude: 30, longitude: 31, accuracy: -1 })).toEqual({ latitude: 30, longitude: 31, accuracy: null });
  });
});

describe('the press, as the API takes it', () => {
  it('sends in or out with the point and its accuracy, or the reason, never a time', () => {
    expect(punchBody('in', { latitude: 30.0596, longitude: 31.3462, accuracy: 18 })).toEqual({ kind: 'in', latitude: 30.0596, longitude: 31.3462, accuracy: 18 });
    expect(punchBody('out', { latitude: 30.0596, longitude: 31.3462, accuracy: null })).toEqual({ kind: 'out', latitude: 30.0596, longitude: 31.3462 });
    expect(punchBody('in', { locationError: 'denied' })).toEqual({ kind: 'in', locationError: 'denied' });
  });

  it('reads what reaches the server action again: a kind, a point or a reason, nothing else', () => {
    expect(punchBodyFrom({ kind: 'in', latitude: 30.0596, longitude: 31.3462, accuracy: 18, at: '2026-10-19T05:00:00Z', time: 'x' })).toEqual({
      kind: 'in',
      latitude: 30.0596,
      longitude: 31.3462,
      accuracy: 18,
    });
    expect(punchBodyFrom({ kind: 'out', locationError: 'timeout' })).toEqual({ kind: 'out', locationError: 'timeout' });
    // a reason it doesn't know, or a point off the earth: unavailable
    expect(punchBodyFrom({ kind: 'out', locationError: 'mars' })).toEqual({ kind: 'out', locationError: 'unavailable' });
    expect(punchBodyFrom({ kind: 'in', latitude: 200, longitude: 31 })).toEqual({ kind: 'in', locationError: 'unavailable' });
    expect(punchBodyFrom({ kind: 'in', latitude: 30, longitude: 31, accuracy: 'near' })).toEqual({ kind: 'in', latitude: 30, longitude: 31 });
    // not a press
    expect(punchBodyFrom({ kind: 'lunch' })).toBeNull();
    expect(punchBodyFrom(null)).toBeNull();
    expect(punchBodyFrom('in')).toBeNull();
  });

  // the employee app on Android says whether a point is a mock one (fake GPS, Phase 2, 20 October 2026)
  it('sends whether the point is a mock one only when the app’s location said it, true or false', () => {
    expect(readingOf({ latitude: 30, longitude: 31, accuracy: 9, mock: true })).toEqual({ latitude: 30, longitude: 31, accuracy: 9, mock: true });
    expect(readingOf({ latitude: 30, longitude: 31, accuracy: 9, mock: 'yes' })).toEqual({ latitude: 30, longitude: 31, accuracy: 9 });
    expect(punchBody('in', { latitude: 30, longitude: 31, accuracy: 9, mock: true })).toEqual({ kind: 'in', latitude: 30, longitude: 31, accuracy: 9, mock: true });
    expect(punchBody('out', { latitude: 30, longitude: 31, accuracy: null, mock: false })).toEqual({ kind: 'out', latitude: 30, longitude: 31, mock: false });
    expect(punchBody('in', { latitude: 30, longitude: 31, accuracy: null })).not.toHaveProperty('mock');
    expect(punchBodyFrom({ kind: 'in', latitude: 30, longitude: 31, mock: true })).toEqual({ kind: 'in', latitude: 30, longitude: 31, mock: true });
    expect(punchBodyFrom({ kind: 'in', latitude: 30, longitude: 31, mock: 1 })).toEqual({ kind: 'in', latitude: 30, longitude: 31 });
    // no point, nothing to be a mock one
    expect(punchBodyFrom({ kind: 'in', locationError: 'denied', mock: true })).toEqual({ kind: 'in', locationError: 'denied' });
  });

  it('sends the press again without mock to an API from before it, and only then', () => {
    const body = { kind: 'in' as const, latitude: 30, longitude: 31, accuracy: 9, mock: true };
    expect(mockRefused(body, 400, ['property mock should not exist'])).toBe(true);
    expect(withoutMock(body)).toEqual({ kind: 'in', latitude: 30, longitude: 31, accuracy: 9 });
    expect(withoutMock({ kind: 'out', latitude: 30, longitude: 31, mock: false })).toEqual({ kind: 'out', latitude: 30, longitude: 31 });
    expect(mockRefused(body, 400, ['property mock should not exist', 'The location could not be read.'])).toBe(false);
    expect(mockRefused(body, 403, ['property mock should not exist'])).toBe(false);
    expect(mockRefused({ kind: 'in', latitude: 30, longitude: 31 }, 400, ['property mock should not exist'])).toBe(false);
  });

  it('says what to do when the location couldn’t be read: the app’s settings inside it, the site’s outside', () => {
    expect(locationHelpText('denied', true)).toContain('Settings → Apps → Trendlix People → Permissions → Location → Allow only while using the app');
    expect(locationHelpText('denied', false)).toBe('To check in with your location, allow this site to use it in your browser’s settings, then press again.');
    expect(locationHelpText('unavailable', true)).toBe('Turn on the phone’s location (Settings → Location), then press again.');
    expect(locationHelpText('timeout', false)).toContain('took too long');
    expect(locationHelpText('unsupported', false)).toBeNull();
  });

  it('says why a press couldn’t be sent: the API’s words, or not there yet', () => {
    expect(punchErrors(403, ['A freelancer doesn’t check in.'])).toEqual(['A freelancer doesn’t check in.']);
    expect(punchErrors(404, ['Cannot POST /api/me/attendance/punches'])).toEqual(['Checking in isn’t available yet: the server doesn’t have it yet. Please try again after its next update.']);
    expect(punchErrors(500, [])).toEqual(['The check-in couldn’t be sent. Please try again.']);
  });
});

describe('the panel', () => {
  it('says Check in or Check out, then what it is doing', () => {
    expect([buttonLabel('in', 'idle'), buttonLabel('out', 'idle')]).toEqual(['Check in', 'Check out']);
    expect([buttonLabel('in', 'locating'), buttonLabel('out', 'locating')]).toEqual(['Getting your location…', 'Getting your location…']);
    expect([buttonLabel('in', 'sending'), buttonLabel('out', 'sending')]).toEqual(['Checking in…', 'Checking out…']);
  });

  it('shows the button, the reason quietly, or nothing (no profile, no current employment)', () => {
    expect(checkInShows({ refusal: null })).toBe('panel');
    expect(checkInShows({ refusal: checkInRefusal(false, null) })).toBe('hidden');
    expect(checkInShows({ refusal: checkInRefusal(true, null) })).toBe('hidden');
    expect(checkInShows({ refusal: checkInRefusal(true, { employmentType: 'freelance', shiftId: 's1' }) })).toBe('refusal');
    expect(checkInShows({ refusal: checkInRefusal(true, { employmentType: 'full_time', shiftId: null }) })).toBe('refusal');
  });

  it('shows the newer of the page’s day and the last press’s, by the server’s time', () => {
    const pressed = { ...TODAY, now: '2026-10-19T06:05:00.000Z', next: 'out' as const };
    expect(latestView(TODAY, null)).toBe(TODAY);
    expect(latestView(TODAY, pressed)).toBe(pressed);
    // the page read again after the press: its own, newer
    const reread = { ...TODAY, now: '2026-10-19T06:05:01.000Z', next: 'out' as const };
    expect(latestView(reread, pressed)).toBe(reread);
    // a tie: the press's
    expect(latestView({ ...pressed }, pressed)).toBe(pressed);
  });

  it('says a reading’s accuracy in whole metres, and none it doesn’t know', () => {
    expect([accuracyText(18.4), accuracyText(1200), accuracyText(0), accuracyText(null), accuracyText(undefined), accuracyText(-3)]).toEqual(['±18 m', '±1,200 m', '±0 m', null, null, null]);
  });

  it('lists today’s punches in the order pressed: the time in 12 hours, the place, the accuracy and the flags', () => {
    const punches: PunchView[] = [
      { kind: 'out', at: '2026-10-19T14:10:00.000Z', place: 'unknown', accuracyMetres: null, flags: [] },
      { kind: 'in', at: '2026-10-19T06:05:00.000Z', place: 'remote', accuracyMetres: 18, flags: ['outside_office'] },
    ];
    expect(punchRows(punches)).toEqual([
      { key: expect.any(String), label: 'Check-in', time: '9:05 AM', place: 'Remote', accuracy: '±18 m', flags: ['Checked in outside the office on an office day'], map: null },
      { key: expect.any(String), label: 'Check-out', time: '5:10 PM', place: 'Location unknown', accuracy: null, flags: [], map: null },
    ]);
    // the spot kept since 20 October 2026 ("Yes, keep the spot"): their own press opens on a map
    expect(punchRows([{ ...punches[1], latitude: 30.0601, longitude: 31.3465, pointFrom: 'press' }])[0].map).toEqual({
      href: 'https://www.google.com/maps?q=30.060100,31.346500',
      title: 'Within 18 m',
    });
    expect([placeLabel('office'), placeLabel(null)]).toEqual(['Office', '—']);
    expect(flagLabels(['location_unknown', 'location_unknown', 'other'])).toEqual(['Location unknown on an office day']);
  });

  it('names a sub-location: "Remote - Studio" on the press and the day, and where a locked person may check in (20 October 2026)', () => {
    const punches: PunchView[] = [
      { kind: 'in', at: '2026-10-19T06:05:00.000Z', place: 'remote', accuracyMetres: 11, flags: [], locationName: 'Studio' },
      { kind: 'out', at: '2026-10-19T14:10:00.000Z', place: 'remote', accuracyMetres: 20, flags: [], locationName: null },
    ];
    expect(punchRows(punches).map((r) => r.place)).toEqual(['Remote - Studio', 'Remote']);
    expect([placeLabel('remote', 'Client X'), placeLabel('office', 'Head office'), placeLabel('remote', ' ')]).toEqual(['Remote - Client X', 'Office', 'Remote']);
    expect(dayPlaceLabel({ place: 'remote' }, [...punches].reverse())).toBe('Remote - Studio');
    expect(dayPlaceLabel({ place: 'office' }, [])).toBe('Office');
    expect(networkNote({ ownPlaces: ['Studio'] })).toBe(`${NETWORK_NEEDED_TEXT} At your own check-in place (Studio) you can check in off it.`);
    expect([networkNote({}), networkNote({ ownPlaces: [] })]).toEqual([NETWORK_NEEDED_TEXT, NETWORK_NEEDED_TEXT]);
  });

  it('tells the employee the spot is kept, on the website and in the app (owner, 20 October 2026: "Yes, keep the spot")', () => {
    expect(LOCATION_NOTE).toBe('Each press asks your browser for your location to tell the office from remote. Each check-in keeps the spot where you pressed, read only then; HR can see it.');
    expect(LOCATION_NOTE_IN_APP).toContain('Each check-in keeps the spot where you pressed, read only then; HR can see it.');
    expect(`${LOCATION_NOTE} ${LOCATION_NOTE_IN_APP}`).not.toMatch(/never where you are/);
  });

  it('says the day so far, its hours, and the day it is for', () => {
    expect(dayTimesText({ checkIn: '2026-10-19T06:05:00.000Z', checkOut: '2026-10-19T14:10:00.000Z' })).toBe('9:05 AM → 5:10 PM');
    expect(dayTimesText({ checkIn: '2026-10-19T06:05:00.000Z', checkOut: null })).toBe('9:05 AM → not checked out yet');
    expect(dayTimesText({ checkIn: null, checkOut: '2026-10-19T14:10:00.000Z' })).toBe('No check-in → 5:10 PM');
    expect(dayHoursText({ checkIn: '2026-10-19T06:05:00.000Z', checkOut: '2026-10-19T14:10:00.000Z', hoursCounted: 7.25 })).toBe('7:15 counted');
    expect(dayHoursText({ checkIn: '2026-10-19T06:05:00.000Z', checkOut: null, hoursCounted: 0 })).toBe('Counted once you check out');
    expect(dayHoursText({ checkIn: null, checkOut: '2026-10-19T14:10:00.000Z', hoursCounted: 0 })).toBe('No hours counted without a check-in');
    expect(dayTitle('2026-10-19')).toBe('Monday 19/10/2026');
  });
});

// The check-in counter (owner, 20 October 2026: "employees need to see a checkin counter after their checkin"), on the
// MORNING shift: 9 hours to work within 9:00 AM to 7:00 PM, 15 minutes' grace, so hours count until 7:15 PM (owner, 19
// October 2026: "if the employee checked in 10:15 he can check out till 7:15 and the 9 hours are counted"). Cairo is
// three hours ahead of UTC on 20 October 2026 (summer time until the 29th).
describe('the check-in counter', () => {
  const DATE = '2026-10-20';
  const at = (time: string, day = DATE) => Date.parse(`${day}T${time}+03:00`);
  const MORNING = { startTime: '09:00', endTime: '19:00', hoursPerDay: 9, graceMinutes: 15 };
  const rule = countRuleOf(DATE, MORNING);
  const count = (checkIn: string, now: string, r = rule) => checkInCount({ ...r, checkIn: at(checkIn), now: at(now) })!;
  const words = (checkIn: string, now: string, r = rule) => counterWords(count(checkIn, now, r));
  /** Today's view, checked in at `checkIn` and not checked out. */
  const open = (checkIn: string, shift: CheckInTodayView['shift'] = MORNING): CheckInTodayView => ({
    ...TODAY,
    date: DATE,
    next: 'out',
    shift,
    day: { checkIn: new Date(at(checkIn)).toISOString(), checkOut: null, place: 'office', flags: [], hoursCounted: 0 },
  });

  it('takes today’s rule from the shift: its window’s start, its end with the grace, its hours; no extra time', () => {
    expect(rule).toEqual({ windowStart: at('09:00:00'), countUntil: at('19:15:00'), hoursToWork: 9, extraCounts: false });
    // a fixed shift: its whole window is the hours to work, its end still moved by the grace
    expect(countRuleOf(DATE, { startTime: '09:00', endTime: '17:00', hoursPerDay: null, graceMinutes: 15 })).toEqual({
      windowStart: at('09:00:00'),
      countUntil: at('17:15:00'),
      hoursToWork: 8,
      extraCounts: false,
    });
    // a night shift's window runs into the next day
    expect(countRuleOf(DATE, { startTime: '22:00', endTime: '06:00', hoursPerDay: null, graceMinutes: 0 })).toMatchObject({
      windowStart: at('22:00:00'),
      countUntil: at('06:00:00', '2026-10-21'),
      hoursToWork: 8,
    });
    // no shift, or one whose window can't be told: a plain clock, never a wrong target
    expect(countRuleOf(DATE, null)).toEqual(PLAIN_COUNT);
    expect(countRuleOf(DATE, undefined)).toEqual(PLAIN_COUNT);
    expect(countRuleOf(DATE, { startTime: '09:00', endTime: '09:00', hoursPerDay: 9, graceMinutes: 0 })).toEqual(PLAIN_COUNT);
  });

  it('checked in early: waits for the shift’s start, then counts from it', () => {
    expect(count('08:30:00', '08:45:00')).toMatchObject({ phase: 'before_start', countedMs: 0, fromWindowStart: true, doneAt: at('18:00:00') });
    expect(words('08:30:00', '08:45:00')).toEqual({
      value: '0:00:00',
      note: 'Counting from 9:00 AM, when your shift starts',
      status: 'Your 9 hours are done at 6:00 PM',
    });
    expect(words('08:30:00', '12:12:45')).toEqual({
      value: '3:12:45',
      note: 'Counting from 9:00 AM, when your shift starts',
      status: 'Your 9 hours are done at 6:00 PM',
    });
  });

  it('in the middle of the day: ticks from the check-in and says when the hours are done', () => {
    expect(count('09:15:00', '12:27:45')).toMatchObject({ phase: 'counting', countedMs: (3 * 3600 + 12 * 60 + 45) * 1000, fromWindowStart: false });
    expect(words('09:15:00', '12:27:45')).toEqual({ value: '3:12:45', note: null, status: 'Your 9 hours are done at 6:15 PM' });
    // to the second: a part second isn't shown
    expect(checkInCount({ ...rule, checkIn: at('09:15:00'), now: at('09:15:01') + 999 })!.countedMs).toBe(1000);
  });

  it('at the grace: hours done by 7:15 PM are counted; later ones count until it, then stop', () => {
    // in at 10:15 AM: the 9 hours end just at 7:15 PM
    expect(words('10:15:00', '19:10:00')).toEqual({ value: '8:55:00', note: null, status: 'Your 9 hours are done at 7:15 PM' });
    expect(count('10:15:00', '19:15:00')).toMatchObject({ phase: 'done', countedMs: 9 * 3_600_000 });
    // in at 10:30 AM: they can't be done by 7:15 PM, so the latest counted time is said
    expect(count('10:30:00', '19:00:00')).toMatchObject({ phase: 'counting', doneAt: null });
    expect(words('10:30:00', '19:00:00')).toEqual({ value: '8:30:00', note: null, status: 'Hours count until 7:15 PM' });
    expect(words('10:30:00', '19:40:00')).toEqual({ value: '8:45:00', note: null, status: 'Hours counted until 7:15 PM' });
    expect(count('10:30:00', '19:40:00').phase).toBe('stopped');
  });

  it('checked in after the window: nothing counts', () => {
    expect(count('19:30:00', '20:00:00')).toMatchObject({ phase: 'after_limit', countedMs: 0 });
    expect(words('19:30:00', '20:00:00')).toEqual({ value: '0:00:00', note: null, status: 'Hours count only until 7:15 PM, so none are counted after it' });
  });

  it('past 9 hours: stops at them and says they are done', () => {
    expect(count('09:00:00', '18:30:00')).toMatchObject({ phase: 'done', hoursDone: true, countedMs: 9 * 3_600_000 });
    expect(words('09:00:00', '18:30:00')).toEqual({ value: '9:00:00', note: null, status: 'Your 9 hours are done' });
    // checked in early and stayed late: still 9
    expect(words('08:00:00', '20:30:00')).toEqual({ value: '9:00:00', note: 'Counting from 9:00 AM, when your shift starts', status: 'Your 9 hours are done' });
  });

  it('on a shift that counts hours until a time (making up short hours): ticks past the hours, then stops at the limit', () => {
    // owner, 20 October 2026: "no working hours to be counted after 8 PM even if the check out was 11 PM"; the shift's
    // "Count hours until", as GET /me/attendance/today sends it
    const UNTIL_8PM = { ...MORNING, countUntil: '20:00' };
    const makeUp = countRuleOf(DATE, UNTIL_8PM);
    expect(makeUp).toEqual({ windowStart: at('09:00:00'), countUntil: at('20:00:00'), hoursToWork: 9, extraCounts: true });
    // none (null, or left out by an API from before it): today's rule
    expect(countRuleOf(DATE, { ...MORNING, countUntil: null })).toEqual(rule);
    expect(count('09:00:00', '18:30:00', makeUp)).toMatchObject({ phase: 'extra', countedMs: 9.5 * 3_600_000 });
    expect(words('09:00:00', '18:30:00', makeUp)).toEqual({ value: '9:30:00', note: null, status: 'Your 9 hours are done. Extra time until 8:00 PM fills short hours this month' });
    expect(count('09:00:00', '23:00:00', makeUp)).toMatchObject({ phase: 'stopped', countedMs: 11 * 3_600_000 });
    expect(words('09:00:00', '23:00:00', makeUp).status).toBe('Your 9 hours are done. Extra time until 8:00 PM fills short hours this month');
    // short of the hours when the limit comes
    expect(words('12:00:00', '21:00:00', makeUp)).toEqual({ value: '8:00:00', note: null, status: 'Hours counted until 8:00 PM' });
    expect(counterShows(open('09:00:00', UNTIL_8PM), at('18:30:00'))).toEqual({
      kind: 'live',
      value: '9:30:00',
      note: null,
      status: 'Your 9 hours are done. Extra time until 8:00 PM fills short hours this month',
    });
    // as attendance counts the day once they check out then: until 8:00 PM, past the 9 hours
    const cases: [string, string, number][] = [
      ['09:00', '23:00', 11],
      ['10:00', '19:30', 9.5],
      ['12:00', '21:00', 8],
      ['08:00', '18:00', 9],
    ];
    for (const [checkIn, checkOut, hours] of cases) {
      const punches = [
        { kind: 'in' as const, at: new Date(at(`${checkIn}:00`)).toISOString(), place: 'office' as const },
        { kind: 'out' as const, at: new Date(at(`${checkOut}:00`)).toISOString(), place: 'office' as const },
      ];
      expect(dayFromPunches(DATE, punches, UNTIL_8PM).hoursCounted).toBeCloseTo(hours, 6);
      expect(count(`${checkIn}:00`, `${checkOut}:00`, makeUp).countedMs / 3_600_000).toBeCloseTo(hours, 6);
    }
  });

  it('with no shift: the time since the check-in, with no target', () => {
    expect(words('09:15:00', '12:27:45', PLAIN_COUNT)).toEqual({ value: '3:12:45', note: null, status: null });
    expect(words('09:15:00', '23:15:00', PLAIN_COUNT)).toEqual({ value: '14:00:00', note: null, status: null });
    // a device clock behind the check-in: 0, not below
    expect(words('09:15:00', '09:00:00', PLAIN_COUNT).value).toBe('0:00:00');
    expect(counterShows(open('09:15:00', null), at('12:27:45'))).toEqual({ kind: 'live', value: '3:12:45', note: null, status: null });
  });

  it('counts as attendance will once they check out at that moment (to the minute)', () => {
    const cases: [string, string][] = [
      ['08:30', '17:45'],
      ['09:15', '12:27'],
      ['10:15', '19:15'],
      ['10:30', '19:40'],
      ['19:30', '20:00'],
      ['09:00', '22:00'],
    ];
    for (const [checkIn, checkOut] of cases) {
      const kept = dayFromPunches(
        DATE,
        [
          { kind: 'in', at: new Date(at(`${checkIn}:00`)).toISOString(), place: 'office' },
          { kind: 'out', at: new Date(at(`${checkOut}:00`)).toISOString(), place: 'office' },
        ],
        MORNING,
      );
      expect(count(`${checkIn}:00`, `${checkOut}:00`).countedMs / 3_600_000).toBeCloseTo(kept.hoursCounted, 6);
    }
  });

  it('shows the counter while checked in, the day’s total once checked out, and nothing before a check-in', () => {
    expect(counterShows(open('09:15:00'), at('12:27:45'))).toEqual({ kind: 'live', value: '3:12:45', note: null, status: 'Your 9 hours are done at 6:15 PM' });
    const out: CheckInTodayView = {
      ...open('09:05:00'),
      next: 'in',
      day: { checkIn: new Date(at('09:05:00')).toISOString(), checkOut: new Date(at('17:57:00')).toISOString(), place: 'office', flags: [], hoursCounted: 8 + 52 / 60 },
    };
    expect(counterShows(out, at('18:30:00'))).toEqual({ kind: 'total', text: 'Worked 8:52 today' });
    // checked in again after checking out, from an API from before the pairs (25 October 2026): from the first check-in, as then
    const again: CheckInTodayView = { ...out, next: 'out' };
    expect(counterShows(again, at('18:00:00'))).toMatchObject({ kind: 'live', value: '8:55:00' });
    // a day off, a holiday or leave: no check-in, nothing new
    expect(counterShows({ ...TODAY, day: null }, at('12:00:00'))).toBeNull();
    // a check-out without a check-in: nothing (the panel says no hours are counted)
    expect(counterShows({ ...out, day: { ...out.day!, checkIn: null } }, at('18:30:00'))).toBeNull();
  });

  it('says the time counted and the hours to work', () => {
    expect([durationClock(0), durationClock(-5000), durationClock(59_999), durationClock(3_600_000 * 11 + 61_000), durationClock(Number.NaN)]).toEqual([
      '0:00:00',
      '0:00:00',
      '0:00:59',
      '11:01:01',
      '0:00:00',
    ]);
    expect([hoursToWorkText(9), hoursToWorkText(1), hoursToWorkText(8.5)]).toEqual(['9 hours', '1 hour', '8:30 hours']);
    expect(counterWords(checkInCount({ ...rule, hoursToWork: 1, checkIn: at('09:00:00'), now: at('11:00:00') })!).status).toBe('Your 1 hour is done');
    expect(checkInCount({ ...rule, checkIn: Number.NaN, now: at('11:00:00') })).toBeNull();
  });

  it('keeps the server’s clock from the newest view seen, so a page shown again from before doesn’t set it back', () => {
    const start = { newest: Number.NEGATIVE_INFINITY, skew: 0 };
    // the server 3 seconds ahead of this device
    const seen = noteServerTime(start, 10_000, 7_000);
    expect(seen).toEqual({ newest: 10_000, skew: 3_000 });
    // an older view shown again later: the skew stays
    expect(noteServerTime(seen, 9_000, 60_000)).toBe(seen);
    // a newer one: measured again
    expect(noteServerTime(seen, 20_000, 18_000)).toEqual({ newest: 20_000, skew: 2_000 });
    expect(noteServerTime(seen, Number.NaN, 1)).toBe(seen);
  });
});

// A day as the sum of its pairs (owner, 25 October 2026: "the working hours to be calculated between the checkin and out
// only, not the first and last"; "Count the closed pairs, flag the open one"), on the MORNING shift as above.
describe('today’s pairs on the panel and the counter', () => {
  const DATE = '2026-10-20';
  const at = (time: string) => Date.parse(`${DATE}T${time}+03:00`);
  const iso = (time: string) => new Date(at(time)).toISOString();
  const MORNING = { startTime: '09:00', endTime: '19:00', hoursPerDay: 9, graceMinutes: 15 };
  const pressesOf = (...p: [kind: 'in' | 'out', time: string][]) => p.map(([kind, time]) => ({ kind, at: iso(`${time}:00`), place: 'office' as const }));
  /** Today's view after these presses, the day as the API keeps it (dayFromPunches). */
  const viewAfter = (...p: [kind: 'in' | 'out', time: string][]): CheckInTodayView => {
    const punches = pressesOf(...p);
    return { ...TODAY, date: DATE, shift: MORNING, next: p.at(-1)?.[0] === 'in' ? 'out' : 'in', day: dayFromPunches(DATE, punches, MORNING) };
  };

  it('says today so far as its pairs, the break and a check-in since', () => {
    const day = viewAfter(['in', '09:02'], ['out', '13:10'], ['in', '14:00'], ['out', '18:05']).day!;
    expect(dayTimesText(day)).toBe('9:02 AM–1:10 PM · 2:00 PM–6:05 PM');
    expect(dayHoursText(day)).toBe('8:13 counted');
    expect(dayBreakText(day)).toBe('Break 50 min');
    const open = viewAfter(['in', '09:00'], ['out', '13:00'], ['in', '14:00']).day!;
    expect(dayTimesText(open)).toBe('9:00 AM–1:00 PM · 2:00 PM → not checked out yet');
    expect(dayHoursText(open)).toBe('4:00 counted so far');
    expect(dayBreakText(open)).toBe('Break 1 h');
    // one pair, or only a check-in: as before
    expect(dayTimesText(viewAfter(['in', '09:05'], ['out', '17:10']).day!)).toBe('9:05 AM → 5:10 PM');
    expect(dayTimesText(viewAfter(['in', '09:05']).day!)).toBe('9:05 AM → not checked out yet');
    expect(dayBreakText(viewAfter(['in', '09:05'], ['out', '17:10']).day!)).toBeNull();
  });

  it('counts the closed pairs and the time since the last check-in, never the break', () => {
    const view = viewAfter(['in', '09:00'], ['out', '13:00'], ['in', '14:00']);
    expect(counterShows(view, at('16:30:00'))).toEqual({
      kind: 'live',
      value: '6:30:00',
      note: 'Counting since 2:00 PM, with 4:00 from earlier today; the break isn’t counted',
      status: 'Your 9 hours are done at 7:00 PM',
    });
    // as the API counts the day once they check out at that moment
    const out = dayFromPunches(DATE, pressesOf(['in', '09:00'], ['out', '13:00'], ['in', '14:00'], ['out', '16:30']), MORNING);
    expect(out.hoursCounted).toBe(6.5);
  });

  it('stops at the hours to work and at the window’s end, with the pairs before', () => {
    const view = viewAfter(['in', '09:00'], ['out', '13:00'], ['in', '14:00'], ['out', '18:00'], ['in', '18:30']);
    // 8 hours counted already, the 9th can't be done by 7:15 PM
    expect(counterShows(view, at('19:00:00'))).toMatchObject({ kind: 'live', value: '8:30:00', status: 'Hours count until 7:15 PM' });
    expect(counterShows(view, at('19:40:00'))).toMatchObject({ kind: 'live', value: '8:45:00', status: 'Hours counted until 7:15 PM' });
    // done before the break was over: the hours to work, no more
    const long = viewAfter(['in', '08:00'], ['out', '17:30'], ['in', '18:00']);
    expect(long.day!.hoursCounted).toBe(8.5);
    expect(counterShows(long, at('18:45:00'))).toMatchObject({ kind: 'live', value: '9:00:00', status: 'Your 9 hours are done' });
    // once checked out: the day's total, its pairs together
    expect(counterShows(viewAfter(['in', '09:00'], ['out', '13:00'], ['in', '14:00'], ['out', '18:00']), at('18:30:00'))).toEqual({ kind: 'total', text: 'Worked 8:00 today' });
  });

  it('counts a closed pair from the time before, as checkInCount’s `before`', () => {
    const rule = countRuleOf(DATE, MORNING);
    expect(checkInCount({ ...rule, checkIn: at('14:00:00'), now: at('15:00:00'), before: 4 * 3_600_000 })).toMatchObject({ countedMs: 5 * 3_600_000, phase: 'counting', doneAt: at('19:00:00'), before: 4 * 3_600_000 });
    // none: as before
    expect(checkInCount({ ...rule, checkIn: at('14:00:00'), now: at('15:00:00') })).toMatchObject({ countedMs: 3_600_000, before: 0 });
  });
});

describe('exempt from check-in today (owner, 25 October 2026: "Optional check-in")', () => {
  const exempt: CheckInTodayView = { ...TODAY, exemption: { startDate: '2026-10-01', endDate: null }, network: { locked: true }, gps: { locked: true } };

  it('shows the badge with the period, says checking in is optional, and no lock', () => {
    expect(exemptToday(exempt)).toEqual({ label: 'Exempt', title: 'Exempt from check-in', when: 'From 01/10/2026, no end date' });
    expect(expectedTextOf(exempt)).toBe(EXEMPT_CHECK_IN_TEXT);
    expect(lockNote(exempt)).toBeNull();
    // not exempt (or an API from before it): as before
    expect([exemptToday(TODAY), exemptToday({ ...TODAY, exemption: null })]).toEqual([null, null]);
    expect(expectedTextOf(TODAY)).toBe(TODAY.expectedText);
    expect(lockNote({ ...exempt, exemption: null })).not.toBeNull();
  });
});

// The design's Today card (owner, 30 October 2026: the Figma "PeopleTrendlix", desktop): the Dashboard's ring and badge,
// My Attendance's "Ready to start?", from the view only. On the MORNING shift as above.
describe('the Today card’s words (30 October 2026)', () => {
  const DATE = '2026-10-27';
  const at = (time: string) => Date.parse(`${DATE}T${time}+03:00`);
  const iso = (time: string) => new Date(at(time)).toISOString();
  const MORNING = { startTime: '09:00', endTime: '19:00', hoursPerDay: 9, graceMinutes: 15 };
  const before: CheckInTodayView = { ...TODAY, date: DATE, shift: MORNING };
  const checkedIn: CheckInTodayView = {
    ...before,
    next: 'out',
    punches: [{ kind: 'in', at: iso('08:57:00'), place: 'office', accuracyMetres: 12, flags: [], locationName: 'Head office' }],
    day: { checkIn: iso('08:57:00'), checkOut: null, place: 'office', flags: [], hoursCounted: 0 },
  };
  const checkedOut: CheckInTodayView = {
    ...checkedIn,
    next: 'in',
    punches: [...checkedIn.punches, { kind: 'out', at: iso('18:05:00'), place: 'office', accuracyMetres: 15, flags: [] }],
    day: { checkIn: iso('08:57:00'), checkOut: iso('18:05:00'), place: 'office', flags: [], hoursCounted: 9 },
  };

  it('titles the day as the Dashboard does', () => {
    expect([longDayTitle('2026-10-27'), longDayTitle('2026-01-01')]).toEqual(['Tuesday, 27 October', 'Thursday, 1 January']);
  });

  it('badges and heads the day: not checked in, checked in where, checked out', () => {
    expect([todayBadge(before), todayHeadline(before)]).toEqual([{ label: 'Not checked in', strong: false }, 'Ready to start?']);
    expect([todayBadge(checkedIn), todayHeadline(checkedIn)]).toEqual([{ label: 'In office', strong: true }, 'Checked in at 8:57 AM']);
    expect([todayBadge(checkedOut), todayHeadline(checkedOut)]).toEqual([{ label: 'Checked out', strong: false }, 'Checked out at 6:05 PM']);
    const remote = { ...checkedIn, punches: [{ ...checkedIn.punches[0], place: 'remote' as const, locationName: null }] };
    expect(todayBadge(remote).label).toBe('Remote');
    expect(todayBadge({ ...checkedIn, punches: [{ ...checkedIn.punches[0], place: 'unknown' as const }] }).label).toBe('Checked in');
  });

  it('says the work location: where the check-in was, else where they are expected', () => {
    expect(workLocationText(checkedIn)).toBe('Office · Head office');
    expect(workLocationText(checkedOut)).toBe('Office · Head office');
    expect(workLocationText({ ...checkedIn, punches: [{ ...checkedIn.punches[0], place: 'remote', locationName: 'Studio' }] })).toBe('Remote - Studio');
    expect(workLocationText(before)).toBe('Office');
    expect(workLocationText({ ...before, expected: 'anywhere' })).toBe('Anywhere');
    expect(workLocationText({ ...before, expected: 'anywhere', workingFromHome: true })).toBe('Home');
    expect(workLocationText({ ...before, officialDuty: { requestId: 'r1', fullDay: true, fromTime: null, toTime: null, now: true } })).toBe('Official duty');
    expect(workLocationText({ ...before, expected: null })).toBeNull();
  });

  it('fills the ring with the work time, as the counter counts it', () => {
    expect(workTime(before, at('08:00:00'))).toEqual({ value: '0:00', seconds: null, share: 0, of: 'of 9 hours', label: 'Work time 0:00 of 9 hours' });
    // checked in at 8:57: counted from the shift's start at 9:00
    expect(workTime(checkedIn, at('11:35:12'))).toEqual({ value: '2:35', seconds: ':12', share: (2 * 3600 + 35 * 60 + 12) / (9 * 3600), of: 'of 9 hours', label: 'Work time 2:35:12 of 9 hours' });
    expect(workTime(checkedOut, at('18:30:00'))).toMatchObject({ value: '9:00', seconds: null, share: 1 });
    // no shift: the time, no target
    expect(workTime({ ...checkedIn, shift: null }, at('09:57:00'))).toMatchObject({ value: '1:00', seconds: ':00', share: 0, of: null, label: 'Work time 1:00:00' });
  });
});
