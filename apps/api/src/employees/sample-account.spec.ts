import { describe, expect, it } from 'vitest';
import { weekday } from '../common/date-only.js';
import { clockPlus, samplePlan } from './sample-account.js';

// The sample account's history (owner, 7 November 2026: "allow apple testers to see some dummy data"): the last two
// months and this one so far, worked on the shift's days, with leave, permission and a request waiting.

const SHIFT = { startTime: '09:00', endTime: '18:00', workingDays: [0, 1, 2, 3, 4] };

describe('samplePlan', () => {
  const plan = samplePlan('2026-11-07', SHIFT, new Set(['2026-10-06']));

  it('starts two months back and stops before today, on working days only', () => {
    expect(plan.from).toBe('2026-09-01');
    expect(plan.days[0].date >= '2026-09-01').toBe(true);
    expect(plan.days.at(-1)!.date < '2026-11-07').toBe(true);
    expect(plan.days.every((d) => SHIFT.workingDays.includes(weekday(d.date)))).toBe(true);
    expect(plan.days.some((d) => d.date === '2026-10-06')).toBe(false);
  });

  it('takes two days of annual leave and a casual day, and asks for two more ahead', () => {
    const [annual, casual, asked] = plan.leave;
    expect(annual).toMatchObject({ key: 'annual', status: 'approved', days: 2 });
    expect(annual.startDate.startsWith('2026-10')).toBe(true);
    expect(casual).toMatchObject({ key: 'casual', status: 'approved', days: 1 });
    expect(casual.startDate.startsWith('2026-09')).toBe(true);
    expect(asked).toMatchObject({ key: 'annual', status: 'with_hr', days: 2, askedOn: '2026-11-06' });
    expect(asked.startDate > '2026-11-24').toBe(true);
    // nothing worked on a day of leave
    const worked = new Set(plan.days.map((d) => d.date));
    expect(worked.has(annual.startDate) || worked.has(annual.endDate) || worked.has(casual.startDate)).toBe(false);
  });

  it('checks in two hours late on the permission day, and a few minutes either side of the shift otherwise', () => {
    const [p] = plan.permissions;
    expect(p).toMatchObject({ fromTime: '09:00', toTime: '11:00', hours: 2, status: 'approved' });
    expect(plan.days.find((d) => d.date === p.date)!.in >= '11:00').toBe(true);
    const usual = plan.days.filter((d) => d.date !== p.date && d.in < '09:30');
    expect(usual.length).toBe(plan.days.length - 2);
    expect(usual.every((d) => d.in >= '08:48' && d.in <= '09:09' && d.out >= '18:00' && d.out <= '18:45')).toBe(true);
  });

  it('is the same on every refresh of the same day', () => {
    expect(samplePlan('2026-11-07', SHIFT, new Set(['2026-10-06']))).toEqual(plan);
  });
});

describe('clockPlus', () => {
  it('moves a time round the clock', () => {
    expect(clockPlus('09:00', -12)).toBe('08:48');
    expect(clockPlus('23:30', 45)).toBe('00:15');
  });
});
