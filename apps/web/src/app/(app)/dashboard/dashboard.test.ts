import { describe, expect, it } from 'vitest';
import type { EmployeeProfile, Holiday, ProfileConfirmation } from '../../../lib/types';
import {
  cairoHour,
  dayEyebrow,
  greetingAt,
  greetingName,
  holidayWhen,
  holidayYears,
  hoursAndMinutes,
  hoursFigure,
  hoursOn,
  inDaysText,
  monthsOf,
  serviceLength,
  shortDay,
  toDoItems,
  upcomingHolidays,
  weekOf,
  weeklyChange,
  workingDaysText,
} from './dashboard';

describe('serviceLength', () => {
  it('says the years and months worked, leaving out a part that is none', () => {
    expect(serviceLength('2024-07-17', '2026-10-17')).toBe('2 years 3 months');
    expect(serviceLength('2025-10-17', '2026-10-17')).toBe('1 year');
    expect(serviceLength('2026-05-17', '2026-10-17')).toBe('5 months');
    expect(serviceLength('2025-09-17', '2026-10-17')).toBe('1 year 1 month');
    expect(serviceLength('2016-10-17', '2026-10-17')).toBe('10 years');
  });

  it('counts a month on the same day of the month, not before it', () => {
    expect(serviceLength('2026-05-18', '2026-10-17')).toBe('4 months');
    expect(serviceLength('2025-10-18', '2026-10-17')).toBe('11 months');
  });

  it('counts a month on the last day of a shorter month', () => {
    expect(serviceLength('2026-01-31', '2026-02-28')).toBe('1 month');
    expect(serviceLength('2026-01-31', '2026-02-27')).toBe('27 days');
    expect(serviceLength('2026-03-31', '2026-04-30')).toBe('1 month');
    expect(serviceLength('2024-01-30', '2024-02-29')).toBe('1 month');
  });

  it('says the days under a month, and the first day', () => {
    expect(serviceLength('2026-10-05', '2026-10-17')).toBe('12 days');
    expect(serviceLength('2026-10-16', '2026-10-17')).toBe('1 day');
    expect(serviceLength('2026-10-17', '2026-10-17')).toBe('First day today');
  });

  it('gives nothing for a join date still to come or one that can’t be read', () => {
    expect(serviceLength('2026-11-01', '2026-10-17')).toBeNull();
    expect(serviceLength('', '2026-10-17')).toBeNull();
    expect(serviceLength('soon', '2026-10-17')).toBeNull();
  });
});

describe('workingDaysText', () => {
  it('says three days or more in a row as a range', () => {
    expect(workingDaysText([0, 1, 2, 3, 4])).toBe('Sun–Thu');
    expect(workingDaysText([4, 3, 2, 1, 0])).toBe('Sun–Thu');
    expect(workingDaysText([1, 2, 3])).toBe('Mon–Wed');
  });

  it('reads a week that starts on Saturday as one run', () => {
    expect(workingDaysText([6, 0, 1, 2, 3])).toBe('Sat–Wed');
    expect(workingDaysText([5, 6, 0])).toBe('Fri–Sun');
  });

  it('lists days apart, and two days in a row, by name', () => {
    expect(workingDaysText([0, 2, 4])).toBe('Sun, Tue, Thu');
    expect(workingDaysText([5, 6])).toBe('Fri, Sat');
    expect(workingDaysText([0, 1, 2, 4])).toBe('Sun–Tue, Thu');
    expect(workingDaysText([3])).toBe('Wed');
  });

  it('says every day for the whole week, and nothing for none', () => {
    expect(workingDaysText([0, 1, 2, 3, 4, 5, 6])).toBe('Every day');
    expect(workingDaysText([])).toBe('');
    expect(workingDaysText([7, -1])).toBe('');
  });
});

describe('holidayYears', () => {
  it('is this year, and next year too from October', () => {
    expect(holidayYears('2026-03-01')).toEqual([2026]);
    expect(holidayYears('2026-09-30')).toEqual([2026]);
    expect(holidayYears('2026-10-01')).toEqual([2026, 2027]);
    expect(holidayYears('2026-12-31')).toEqual([2026, 2027]);
  });
});

const day = (date: string, nameEn: string, nameAr: string | null = null): Holiday => ({ id: `h-${date}`, date, nameEn, nameAr });

describe('upcomingHolidays', () => {
  const list = [
    day('2026-10-06', 'Armed Forces Day', 'عيد القوات المسلحة'),
    day('2027-01-07', 'Coptic Christmas', 'عيد الميلاد المجيد'),
    day('2027-01-25', 'Revolution Day'),
    day('2027-03-20', 'Eid al-Fitr', 'عيد الفطر'),
    day('2027-03-21', 'Eid al-Fitr'),
    day('2027-03-22', 'Eid al-Fitr'),
    day('2027-04-25', 'Sinai Liberation Day'),
    day('2027-05-01', 'Labour Day'),
    day('2027-06-30', 'June 30 Revolution'),
  ];

  it('gives the next ones from today, soonest first, at most five, whatever the order given', () => {
    const next = upcomingHolidays([...list].reverse(), '2026-10-17');
    expect(next.map((h) => [h.from, h.nameEn, h.inDays])).toEqual([
      ['2027-01-07', 'Coptic Christmas', 82],
      ['2027-01-25', 'Revolution Day', 100],
      ['2027-03-20', 'Eid al-Fitr', 154],
      ['2027-04-25', 'Sinai Liberation Day', 190],
      ['2027-05-01', 'Labour Day', 196],
    ]);
    expect(upcomingHolidays(list, '2026-10-17', 2)).toHaveLength(2);
  });

  it('makes days in a row with the same name one holiday, its Arabic name from any of them', () => {
    const eid = upcomingHolidays(list, '2027-03-01').find((h) => h.nameEn === 'Eid al-Fitr')!;
    expect(eid).toEqual({ from: '2027-03-20', to: '2027-03-22', days: 3, nameEn: 'Eid al-Fitr', nameAr: 'عيد الفطر', inDays: 19 });
    // the same name with a day between them isn't one
    const apart = upcomingHolidays([day('2027-03-20', 'Eid'), day('2027-03-22', 'Eid')], '2027-03-01');
    expect(apart.map((h) => h.days)).toEqual([1, 1]);
    // another name the next day isn't one either
    expect(upcomingHolidays([day('2027-04-25', 'Sinai Liberation Day'), day('2027-04-26', 'Sham El-Nessim')], '2027-04-01')).toHaveLength(2);
  });

  it('counts today’s holiday, and one that has started, as today', () => {
    expect(upcomingHolidays(list, '2027-01-07')[0]).toMatchObject({ nameEn: 'Coptic Christmas', inDays: 0 });
    expect(upcomingHolidays(list, '2027-03-21')[0]).toMatchObject({ nameEn: 'Eid al-Fitr', from: '2027-03-20', inDays: 0 });
    expect(upcomingHolidays(list, '2027-03-23')[0].nameEn).toBe('Sinai Liberation Day');
  });

  it('gives none when every holiday on file has passed', () => {
    expect(upcomingHolidays(list, '2027-07-01')).toEqual([]);
    expect(upcomingHolidays([], '2026-10-17')).toEqual([]);
  });
});

describe('holidayWhen and inDaysText', () => {
  it('says the weekday with the day, and both ends of days in a row', () => {
    expect(holidayWhen({ from: '2027-04-25', to: '2027-04-25' })).toBe('Sunday 25/04/2027');
    expect(holidayWhen({ from: '2027-03-20', to: '2027-03-22' })).toBe('Saturday 20/03/2027 – Monday 22/03/2027');
  });

  it('says how far off a day is', () => {
    expect(inDaysText(0)).toBe('Today');
    expect(inDaysText(1)).toBe('Tomorrow');
    expect(inDaysText(5)).toBe('In 5 days');
    expect(inDaysText(-3)).toBe('Passed');
  });
});

type ToDoProfile = Pick<EmployeeProfile, 'confirmation' | 'completeness'>;

const confirmed: ProfileConfirmation = {
  confirmedAt: '2026-10-10T09:00:00.000Z',
  confirmedBy: { email: 'nour@trendlix.com' },
  upToDate: true,
  changedFields: [],
  disclaimerVersion: 1,
};

const profile = (over: Partial<ToDoProfile> = {}): ToDoProfile => ({
  confirmation: confirmed,
  completeness: { percent: 100, missing: [] },
  ...over,
});

describe('toDoItems', () => {
  it('is nothing when their details are confirmed and HR has every paper', () => {
    expect(toDoItems(profile())).toEqual([]);
    // an API from before confirmations: nothing to confirm
    expect(toDoItems(profile({ confirmation: undefined }))).toEqual([]);
  });

  it('asks them to confirm their details while they aren’t, in the banner’s words', () => {
    expect(toDoItems(profile({ confirmation: { ...confirmed, confirmedAt: null, confirmedBy: null, upToDate: false } }))).toEqual([
      { key: 'confirm', text: 'Please review and confirm your details.' },
    ]);
    expect(toDoItems(profile({ confirmation: { ...confirmed, upToDate: false, changedFields: ['mobile'] } }))[0]).toMatchObject({ key: 'confirm' });
  });

  it('lists the papers HR still needs, and none of the other missing details', () => {
    const items = toDoItems(
      profile({
        completeness: {
          percent: 70,
          missing: [
            { key: 'mobile', label: 'Mobile', tab: 'basic' },
            { key: 'birth_certificate', label: 'Birth certificate', tab: 'documents' },
            { key: 'shift', label: 'Shift', tab: 'employment' },
            { key: 'criminal_record', label: 'Criminal record certificate', tab: 'documents' },
          ],
        },
      }),
    );
    expect(items).toEqual([{ key: 'papers', papers: ['Birth certificate', 'Criminal record certificate'] }]);
  });

  it('gives both, confirming first', () => {
    const items = toDoItems({
      confirmation: { ...confirmed, upToDate: false },
      completeness: { percent: 90, missing: [{ key: 'photo', label: 'Personal photo', tab: 'documents' }] },
    });
    expect(items.map((i) => i.key)).toEqual(['confirm', 'papers']);
  });
});

describe('greetingName', () => {
  it('is the name they go by, else the first of their English name', () => {
    expect(greetingName({ displayName: 'Hazem Magdy', fullNameEn: 'Hazem Magdy Soliman' })).toBe('Hazem Magdy');
    expect(greetingName({ displayName: null, fullNameEn: 'Nour Adel Hassan' })).toBe('Nour');
    expect(greetingName({ displayName: '  ', fullNameEn: ' Nour Adel ' })).toBe('Nour');
  });
});

describe('the design’s greeting and week (30 October 2026)', () => {
  it('says the day over the greeting, and greets by the hour in Cairo', () => {
    expect(dayEyebrow('2026-10-30')).toBe('Friday · 30 October');
    expect([greetingAt(9), greetingAt(12), greetingAt(16), greetingAt(17)]).toEqual(['Good morning', 'Good afternoon', 'Good afternoon', 'Good evening']);
    // 07:30 UTC is 09:30 in Cairo on 30 October 2026 (UTC+2 after the summer time ended on the 29th)
    expect(cairoHour(new Date('2026-10-30T07:30:00Z'))).toBe(9);
  });

  it('takes the week from Sunday, the months it is in, and the hours counted on its days so far', () => {
    expect(weekOf('2026-10-30')).toEqual(['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']);
    expect(weekOf('2026-11-03', 1)[0]).toBe('2026-10-25');
    expect(monthsOf(weekOf('2026-11-03', 1).concat(weekOf('2026-11-03')))).toEqual(['2026-10', '2026-11']);
    expect(shortDay('2026-10-25')).toBe('Sun 25');
    const days = [
      { date: '2026-10-25', hoursCounted: 8.5 },
      { date: '2026-10-26', hoursCounted: 9 },
      { date: '2026-10-29', hoursCounted: 7 },
      { date: '2026-10-24', hoursCounted: 4 },
    ];
    const hours = hoursOn(days, weekOf('2026-10-30'), '2026-10-28');
    expect([...hours.entries()]).toEqual([
      ['2026-10-25', 8.5],
      ['2026-10-26', 9],
    ]);
    expect(weeklyChange(35.6, 33.45)).toBe(6.4);
    expect(weeklyChange(10, 0)).toBeNull();
    expect([hoursFigure(35.64), hoursAndMinutes(7.12)]).toEqual(['35.6', '7h 07m']);
  });
});
