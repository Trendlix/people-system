import { NOTICE_UNITS } from '@trendlix/shared';
import { addDays } from '../common/date-only.js';
import { latestNoticeDay, meetsLegalMinimum, noticeEnds, workingWeek } from './notice.js';

// 15 October 2026 is a Thursday.
const SUN_THU = [0, 1, 2, 3, 4];
const MON_FRI = [1, 2, 3, 4, 5];

describe('notice periods', () => {
  it('counts days, weeks and calendar months; no notice ends the same day', () => {
    expect(noticeEnds('2026-10-15', 14, 'days')).toBe('2026-10-29');
    expect(noticeEnds('2026-10-15', 2, 'weeks')).toBe('2026-10-29');
    expect(noticeEnds('2026-10-15', 3, 'months')).toBe('2027-01-15');
    expect(noticeEnds('2026-11-30', 3, 'months')).toBe('2027-02-28'); // the month's last day
    expect(noticeEnds('2026-10-15', 0, 'working_days')).toBe('2026-10-15');
  });

  it('counts working days after the day notice is given, by the shift (Sunday to Thursday without one)', () => {
    // Wednesday 14 October: Thursday 15 and Sunday 18 with a Sunday–Thursday week, Thursday 15 and Friday 16 Monday–Friday
    expect(noticeEnds('2026-10-14', 2, 'working_days', SUN_THU)).toBe('2026-10-18');
    expect(noticeEnds('2026-10-14', 2, 'working_days', MON_FRI)).toBe('2026-10-16');
    expect(noticeEnds('2026-10-14', 2, 'working_days', null)).toBe('2026-10-18');
    expect(noticeEnds('2026-10-14', 2, 'working_days', [])).toBe('2026-10-18');
    // 45 working days are 9 weeks of five: from Thursday 15 October to Thursday 17 December
    expect(noticeEnds('2026-10-15', 45, 'working_days', SUN_THU)).toBe('2026-12-17');
    expect(workingWeek(undefined)).toEqual(SUN_THU);
  });

  it('counts back to the last day notice can be given, the latest day whose notice runs out by the end date', () => {
    expect(latestNoticeDay('2027-01-14', 45, 'working_days', SUN_THU)).toBe('2026-11-14'); // a Saturday, before Sunday 15 November
    expect(noticeEnds('2026-11-14', 45, 'working_days', SUN_THU)).toBe('2027-01-14');
    expect(noticeEnds('2026-11-15', 45, 'working_days', SUN_THU)).toBe('2027-01-17');
    expect(latestNoticeDay('2027-02-28', 1, 'months')).toBe('2027-01-31');
    expect(latestNoticeDay('2027-03-31', 1, 'months')).toBe('2027-02-28');
    expect(latestNoticeDay('2027-01-14', 0, 'days')).toBe('2027-01-14');

    // for every unit and a spread of end dates and amounts, the day found works and the day after does not
    for (const unit of NOTICE_UNITS) {
      for (const amount of [1, 2, 3, 13, 45]) {
        for (let i = 0; i < 40; i += 3) {
          const end = addDays('2027-01-01', i * 5);
          for (const week of [SUN_THU, MON_FRI]) {
            const by = latestNoticeDay(end, amount, unit, week);
            expect(noticeEnds(by, amount, unit, week) <= end).toBe(true);
            expect(noticeEnds(addDays(by, 1), amount, unit, week) > end).toBe(true);
          }
        }
      }
    }
  });

  it('holds resignation and company notice to the law’s three months, compared in each unit', () => {
    expect(meetsLegalMinimum(3, 'months')).toBe(true);
    expect(meetsLegalMinimum(2, 'months')).toBe(false);
    expect(meetsLegalMinimum(90, 'days')).toBe(true);
    expect(meetsLegalMinimum(89, 'days')).toBe(false);
    expect(meetsLegalMinimum(13, 'weeks')).toBe(true);
    expect(meetsLegalMinimum(12, 'weeks')).toBe(false);
    expect(meetsLegalMinimum(65, 'working_days')).toBe(true);
    expect(meetsLegalMinimum(64, 'working_days')).toBe(false);
  });
});
