import { describe, expect, it } from 'vitest';
import { holidayBody, holidaysHref, holidaysYear, weekdayOf, workingMonths } from './holidays';

// Organization → Holidays (owner, 16 October 2026: "make holiday a separate tab"), moved from Payroll Setup.

const form = (values: Record<string, string>) => {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
};

describe('Holidays', () => {
  it('shows the year asked for in the address when it is one, else this year', () => {
    expect(holidaysYear('2027', '2026-10-16')).toBe(2027);
    expect(holidaysYear(['2025', '2027'], '2026-10-16')).toBe(2025);
    for (const asked of [undefined, '', '27', '1999', '2101', 'next']) expect(holidaysYear(asked, '2026-10-16')).toBe(2026);
  });

  it('sends a holiday’s day as YYYY-MM-DD, its names trimmed, an empty Arabic name as none', () => {
    expect(holidayBody(form({ date: '25/04/2027', nameEn: ' Sinai Liberation Day ', nameAr: ' عيد تحرير سيناء ' }))).toEqual({
      body: { date: '2027-04-25', nameEn: 'Sinai Liberation Day', nameAr: 'عيد تحرير سيناء' },
      errors: [],
    });
    expect(holidayBody(form({ date: '٢٥/٤/٢٠٢٧', nameEn: 'Sinai Liberation Day', nameAr: '' })).body).toEqual({ date: '2027-04-25', nameEn: 'Sinai Liberation Day', nameAr: null });
  });

  it('says what is wrong with a holiday', () => {
    expect(holidayBody(form({ date: '30/02/2027', nameEn: ' ', nameAr: '' })).errors).toEqual(['Enter the date as DD/MM/YYYY, e.g. 25/04/2027.', "Enter the holiday's name in English."]);
    expect(holidayBody(form({ date: '', nameEn: 'Labour Day' })).errors).toEqual(['Enter the date as DD/MM/YYYY, e.g. 25/04/2027.']);
    expect(holidayBody(form({ date: '01/05/1999', nameEn: 'Labour Day' })).errors).toEqual(['Enter a date from 2000 to 2100.']);
    expect(holidayBody(form({ date: '01/05/2027', nameEn: 'x'.repeat(101) })).errors).toEqual(['Keep each name to 100 characters or fewer.']);
  });

  it('works out each shift’s working days in each month, less the holidays on them, and the hours they come to', () => {
    const shifts = [
      { code: 'A', startTime: '09:00', endTime: '18:00', workingDays: [0, 1, 2, 3, 4] },
      // a weekend night shift
      { code: 'N', startTime: '22:00', endTime: '06:00', workingDays: [5, 6] },
      { code: 'X', startTime: '09:00', endTime: '09:00', workingDays: [0] },
    ];
    // Thursday 3 and Saturday 5 September 2026
    const months = workingMonths(2026, shifts, [{ date: '2026-09-03' }, { date: '2026-09-05' }]);
    expect(months).toHaveLength(12);
    expect(months[8]).toEqual({
      month: '2026-09',
      name: 'September',
      shifts: [
        { code: 'A', workingDays: 22, holidays: 1, hours: 189 },
        { code: 'N', workingDays: 8, holidays: 1, hours: 56 },
        // the same start and end: its hours can't be told
        { code: 'X', workingDays: 4, holidays: 0, hours: null },
      ],
    });
    expect(months[1].shifts[0]).toEqual({ code: 'A', workingDays: 20, holidays: 0, hours: 180 });
  });

  it('counts a flexible shift at its hours to work a day, not its window (owner, 16 October 2026)', () => {
    // the MORNING shift: 9:00 AM to 7:00 PM, 9 hours to work within it
    const morning = { code: 'MORNING', startTime: '09:00', endTime: '19:00', hoursPerDay: 9, workingDays: [0, 1, 2, 3, 4] };
    const [september] = workingMonths(2026, [morning, { ...morning, code: 'WINDOW', hoursPerDay: null }], [{ date: '2026-09-03' }]).slice(8);
    expect(september.shifts).toEqual([
      { code: 'MORNING', workingDays: 22, holidays: 1, hours: 189 },
      // no hours to work set: the whole window, 10 hours
      { code: 'WINDOW', workingDays: 22, holidays: 1, hours: 210 },
    ]);
  });

  it('links to the tab for a year, and names the weekday of a day', () => {
    expect(holidaysHref()).toBe('/organization/holidays');
    expect(holidaysHref(2027)).toBe('/organization/holidays?year=2027');
    expect(weekdayOf('2027-04-25')).toBe('Sunday');
  });
});
