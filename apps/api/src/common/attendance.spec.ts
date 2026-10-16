import { hoursCountedForDay, mostHoursCountedADay } from '@trendlix/shared';

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
