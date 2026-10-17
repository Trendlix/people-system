import { hoursCountedForDay, mostHoursCountedADay, shiftWindowOn, zonedMoment } from '@trendlix/shared';

// What attendance will count a day (packages/shared/src/attendance.ts; owner, 16 October 2026: "maximum working hours
// to be recorded per day is 9 hours between checkin and check out"): the time between check-in and check-out, at most
// the shift's hours to work a day, never below 0.

describe('attendance: the most hours counted a day', () => {
  it('are the shift’s hours to work a day, else its whole window', () => {
    // the flexible MORNING shift: 9 hours within 9:00 AM to 7:00 PM
    expect(mostHoursCountedADay({ startTime: '09:00', endTime: '19:00', hoursPerDay: 9 })).toBe(9);
    expect(mostHoursCountedADay({ startTime: '09:00', endTime: '18:00', hoursPerDay: null })).toBe(9);
    expect(mostHoursCountedADay({ startTime: '22:00', endTime: '06:00' })).toBe(8);
    expect(mostHoursCountedADay({ startTime: '09:00', endTime: '09:00' })).toBeNull();
  });
});

describe('attendance: the hours a day counts from a check-in and a check-out', () => {
  const at = (time: string, day = '2026-10-18') => `${day}T${time}:00+03:00`;

  it('is the time between them, at most the most hours counted a day', () => {
    // 9:40 AM to 6:55 PM is 9:15: 9 counted
    expect(hoursCountedForDay(at('09:40'), at('18:55'), 9)).toBe(9);
    // 10:15 AM to 6:45 PM is 8:30: all of it
    expect(hoursCountedForDay(at('10:15'), at('18:45'), 9)).toBe(8.5);
    // a whole day and night is still 9
    expect(hoursCountedForDay(at('08:00'), at('08:00', '2026-10-19'), 9)).toBe(9);
    // Dates too
    expect(hoursCountedForDay(new Date(at('09:00')), new Date(at('13:30')), 9)).toBe(4.5);
  });

  it('counts whole minutes, past midnight too, and isn’t capped without a shift', () => {
    expect(hoursCountedForDay(at('09:00'), '2026-10-18T09:20:59+03:00', 9)).toBe(20 / 60);
    expect(hoursCountedForDay(at('22:00'), at('05:30', '2026-10-19'), 8)).toBe(7.5);
    expect(hoursCountedForDay(at('08:00'), at('20:00'), null)).toBe(12);
  });

  it('is never below 0: a check-out at or before the check-in, or a moment that isn’t one, counts nothing', () => {
    expect(hoursCountedForDay(at('18:00'), at('09:00'), 9)).toBe(0);
    expect(hoursCountedForDay(at('09:00'), at('09:00'), 9)).toBe(0);
    expect(hoursCountedForDay('not a time', at('18:00'), 9)).toBe(0);
    expect(hoursCountedForDay(at('09:00'), new Date(Number.NaN), 9)).toBe(0);
    expect(hoursCountedForDay(at('09:00'), at('18:00'), 0)).toBe(0);
  });
});

describe('attendance: only the time within the shift’s window counts', () => {
  // owner, 17 October 2026: "my shift is a flexible shift, i have a window the employee have to fill 9 hours within the window"
  const MORNING = { startTime: '09:00', endTime: '19:00', hoursPerDay: 9 };
  const at = (time: string, day = '2026-10-18') => `${day}T${time}:00+03:00`;
  const window = shiftWindowOn('2026-10-18', MORNING)!;

  it('leaves out coming early and staying late', () => {
    // 7:00 AM to 4:00 PM is 9 hours, but only 9:00 AM to 4:00 PM is in the window: 7
    expect(hoursCountedForDay(at('07:00'), at('16:00'), 9, window)).toBe(7);
    // 10:00 AM to 9:00 PM: 10:00 AM to 7:00 PM in the window is 9
    expect(hoursCountedForDay(at('10:00'), at('21:00'), 9, window)).toBe(9);
    // 11:00 AM to 7:30 PM: 8 hours in the window
    expect(hoursCountedForDay(at('11:00'), at('19:30'), 9, window)).toBe(8);
    // wholly outside it: nothing
    expect(hoursCountedForDay(at('19:30'), at('22:00'), 9, window)).toBe(0);
    // without a window, as before: 9
    expect(hoursCountedForDay(at('07:00'), at('16:00'), 9)).toBe(9);
  });

  it('runs into the next day for a shift past midnight', () => {
    const night = shiftWindowOn('2026-10-18', { startTime: '22:00', endTime: '06:00' })!;
    expect(new Date(night.start).toISOString()).toBe('2026-10-18T19:00:00.000Z');
    expect(new Date(night.end).toISOString()).toBe('2026-10-19T03:00:00.000Z');
    expect(hoursCountedForDay(at('21:00'), at('07:00', '2026-10-19'), 8, night)).toBe(8);
  });

  it('follows Cairo’s clock, summer time included', () => {
    // summer time (UTC+3) until the last Thursday of October 2026
    expect(new Date(zonedMoment('2026-10-18', '09:00')).toISOString()).toBe('2026-10-18T06:00:00.000Z');
    // winter time (UTC+2) after it
    expect(new Date(zonedMoment('2026-11-15', '09:00')).toISOString()).toBe('2026-11-15T07:00:00.000Z');
    expect(new Date(shiftWindowOn('2026-11-15', MORNING)!.end).toISOString()).toBe('2026-11-15T17:00:00.000Z');
    expect(zonedMoment('18/10/2026', '09:00')).toBeNaN();
    expect(shiftWindowOn('2026-10-18', { startTime: '09:00', endTime: '09:00' })).toBeNull();
  });
});
