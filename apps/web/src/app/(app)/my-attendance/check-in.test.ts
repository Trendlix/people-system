import { describe, expect, it } from 'vitest';
import { checkInRefusal } from '@trendlix/shared';
import type { CheckInTodayView, PunchView } from '../../../lib/attendance-types';
import {
  accuracyText,
  buttonLabel,
  checkInShows,
  dayHoursText,
  dayTimesText,
  dayTitle,
  flagLabels,
  latestView,
  LOCATION_OPTIONS,
  locationErrorOf,
  placeLabel,
  punchBody,
  punchBodyFrom,
  punchErrors,
  punchRows,
  readingOf,
  readLocation,
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
      { key: expect.any(String), label: 'Check-in', time: '9:05 AM', place: 'Remote', accuracy: '±18 m', flags: ['Checked in outside the office on an office day'] },
      { key: expect.any(String), label: 'Check-out', time: '5:10 PM', place: 'Location unknown', accuracy: null, flags: [] },
    ]);
    expect([placeLabel('office'), placeLabel(null)]).toEqual(['Office', '—']);
    expect(flagLabels(['location_unknown', 'location_unknown', 'other'])).toEqual(['Location unknown on an office day']);
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
