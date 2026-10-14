import { fromTimeOfDay, TIME_OF_DAY, toTimeOfDay } from './time-of-day.js';

describe('time of day', () => {
  it('round-trips HH:mm', () => {
    for (const t of ['00:00', '09:00', '18:30', '23:59']) expect(fromTimeOfDay(toTimeOfDay(t))).toBe(t);
  });

  it('accepts only 24-hour HH:mm', () => {
    expect(TIME_OF_DAY.test('09:00')).toBe(true);
    expect(TIME_OF_DAY.test('9:00')).toBe(false);
    expect(TIME_OF_DAY.test('24:00')).toBe(false);
    expect(TIME_OF_DAY.test('12:60')).toBe(false);
  });
});
