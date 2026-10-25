import { describe, expect, it } from 'vitest';
import { HISTORY_FIGURE_DEFINITIONS, type HistoryBin, type HistoryFigures, type HistoryTrendPoint, type HistoryWeekday } from '@trendlix/shared';
import {
  EXEMPT_DAYS_DEFINITION,
  binsChart,
  columnPath,
  countTicks,
  hasRehireGap,
  historyApiExcelPath,
  historyApiPath,
  historyExcelHref,
  historyFilterChoices,
  historyHref,
  historyMonthHref,
  historyTiles,
  lateText,
  logDateText,
  rangeText,
  readHistoryQuery,
  seesAttendanceHistory,
  trendCell,
  trendChart,
  weekdayChart,
} from './history';

// A person's attendance history on the profile (owner, 23 October 2026: "Attendance history on the profile. Since
// joining: on-time %, average check-in time, late days by weekday and trends; an Excel export"; "HR, CEO and Finance
// only"): the tab's addresses, the figures as tiles, and the three charts drawn to scale.

const ID = '7c1f1b8e-3a4d-4f5e-9a6b-1c2d3e4f5a6b';

const FIGURES: HistoryFigures = {
  daysOnRecord: 64,
  expectedDays: 44,
  attendedDays: 41,
  attendanceRate: 41 / 44,
  measuredDays: 40,
  onTimeDays: 34,
  lateDays: 6,
  onTimeRate: 34 / 40,
  averageCheckIn: 9 * 60 + 7,
  averageHours: 8.5,
  hoursCounted: 340,
  daysCounted: 40,
  absences: 3,
  leaveDays: 2,
  zohoLeaveDays: 1,
  wfhDays: 4,
  odDays: 2,
  exemptDays: 0,
  extraHours: 1.5,
  offDaysWorked: 1,
  lateMinutes: 95,
};

const point = (key: string, label: string, onTimeDays: number, measuredDays: number): HistoryTrendPoint => ({
  key,
  label,
  from: `${key}-01`,
  to: `${key}-28`,
  measuredDays,
  onTimeDays,
  onTimeRate: measuredDays ? onTimeDays / measuredDays : null,
  expectedDays: measuredDays,
  attendedDays: measuredDays,
  attendanceRate: measuredDays ? 1 : null,
});

describe('who sees the tab', () => {
  it('is HR, the CEO, Finance and the Super Admin; never a manager or an employee', () => {
    expect(seesAttendanceHistory({ roles: ['hr'] })).toBe(true);
    expect(seesAttendanceHistory({ roles: ['ceo'] })).toBe(true);
    expect(seesAttendanceHistory({ roles: ['finance'] })).toBe(true);
    expect(seesAttendanceHistory({ roles: ['super_admin'] })).toBe(true);
    expect(seesAttendanceHistory({ roles: ['employee', 'manager'] })).toBe(false);
    expect(seesAttendanceHistory({ roles: ['admin'] })).toBe(false);
  });
});

describe('the tab’s addresses', () => {
  it('reads the period, a custom range as typed or in the API’s form, the filter and the page', () => {
    expect(readHistoryQuery({})).toEqual({ period: 'this_month', from: null, to: null, only: null, page: 1 });
    expect(readHistoryQuery({ period: 'since_joining', only: 'late', page: '3' })).toEqual({ period: 'since_joining', from: null, to: null, only: 'late', page: 3 });
    expect(readHistoryQuery({ period: 'custom', from: '01/08/2026', to: '2026-10-23' })).toMatchObject({ period: 'custom', from: '2026-08-01', to: '2026-10-23' });
    // the wrong way round: swapped; half a range, or a day that isn't one: this month
    expect(readHistoryQuery({ period: 'custom', from: '23/10/2026', to: '01/08/2026' })).toMatchObject({ from: '2026-08-01', to: '2026-10-23' });
    expect(readHistoryQuery({ period: 'custom', from: '01/08/2026' })).toMatchObject({ period: 'this_month', from: null, to: null });
    expect(readHistoryQuery({ period: 'custom', from: '31/02/2026', to: '01/03/2026' }).period).toBe('this_month');
    expect(readHistoryQuery({ period: 'decade', only: 'sleepy', page: '-2' })).toEqual({ period: 'this_month', from: null, to: null, only: null, page: 1 });
  });

  it('builds the tab, the API’s, the Excel’s and the month page’s addresses', () => {
    expect(historyHref(ID)).toBe(`/employees/${ID}?tab=attendance`);
    expect(historyHref(ID, { period: 'last_3_months', only: 'od', page: 2 })).toBe(`/employees/${ID}?tab=attendance&period=last_3_months&only=od&page=2`);
    const custom = { period: 'custom' as const, from: '2026-08-01', to: '2026-10-23', only: 'late' as const, page: 4 };
    expect(historyApiPath(ID, custom)).toBe(`/attendance/employees/${ID}/history?period=custom&from=2026-08-01&to=2026-10-23&only=late&page=4`);
    // the Excel has the whole period: no filter, no page
    expect(historyExcelHref(ID, custom)).toBe(`/attendance/${ID}/history/excel?period=custom&from=2026-08-01&to=2026-10-23`);
    expect(historyApiExcelPath(ID, { period: 'this_year' })).toBe(`/attendance/employees/${ID}/history.xlsx?period=this_year`);
    expect(historyApiPath(ID)).toBe(`/attendance/employees/${ID}/history`);
    expect(historyMonthHref(ID, { to: '2026-10-23' })).toBe(`/attendance/${ID}?month=2026-10`);
  });
});

describe('the figures', () => {
  it('are tiles in the brief’s order, each with its definition', () => {
    const tiles = historyTiles({ figures: FIGURES, definitions: HISTORY_FIGURE_DEFINITIONS });
    expect(tiles.map((t) => t.label)).toEqual([
      'Attendance rate',
      'On time',
      'Average check-in',
      'Average hours a day',
      'Late days',
      'Absences',
      'Leave days',
      'Work from home days',
      'Official duty days',
      'Overtime (extra time)',
    ]);
    expect(tiles.map((t) => t.value).slice(0, 5)).toEqual(['93%', '85%', '9:07 AM', '8:30', '6']);
    expect(tiles.find((t) => t.key === 'rate')?.note).toBe('41 of 44 days expected');
    expect(tiles.find((t) => t.key === 'late')).toMatchObject({ note: '1 h 35 min late in all', tone: 'warn' });
    expect(tiles.find((t) => t.key === 'absent')?.tone).toBe('danger');
    expect(tiles.find((t) => t.key === 'leave')?.note).toBe('And 1 day of leave in Zoho only');
    expect(tiles.every((t) => t.definition.length > 20)).toBe(true);
    expect(tiles.find((t) => t.key === 'od')?.definition).toBe(HISTORY_FIGURE_DEFINITIONS.odDays);
  });

  it('adds an Exempt days tile only with exempt days (owner, 25 October 2026: "trat them as if they achived their full working hours")', () => {
    expect(historyTiles({ figures: FIGURES, definitions: HISTORY_FIGURE_DEFINITIONS }).map((t) => t.key)).not.toContain('exempt');
    const tiles = historyTiles({ figures: { ...FIGURES, exemptDays: 5 }, definitions: HISTORY_FIGURE_DEFINITIONS });
    expect(tiles.find((t) => t.key === 'exempt')).toEqual({ key: 'exempt', label: 'Exempt days', value: '5', note: null, definition: EXEMPT_DAYS_DEFINITION, tone: null });
    expect(tiles.map((t) => t.key).indexOf('exempt')).toBe(tiles.map((t) => t.key).indexOf('od') + 1);
  });

  it('says none as a dash', () => {
    const none = historyTiles({ figures: { ...FIGURES, attendanceRate: null, onTimeRate: null, averageCheckIn: null, averageHours: null }, definitions: HISTORY_FIGURE_DEFINITIONS });
    expect(none.slice(0, 4).map((t) => t.value)).toEqual(['—', '—', '—', '—']);
  });

  it('gives the log’s filters their counts', () => {
    expect(historyFilterChoices(FIGURES).map((f) => [f.value, f.count])).toEqual([
      [null, 64],
      ['late', 6],
      ['wfh', 4],
      ['od', 2],
      ['leave', 3],
      ['absent', 3],
    ]);
  });

  it('words late minutes, days and ranges', () => {
    expect(lateText(0)).toBe('');
    expect(lateText(25)).toBe('25 min');
    expect(lateText(65)).toBe('1 h 05 min');
    expect(logDateText({ date: '2026-10-18', weekday: 0 })).toBe('Sun 18/10/2026');
    expect(rangeText({ from: '2026-08-01', to: '2026-10-23' })).toBe('01/08/2026 to 23/10/2026');
    expect(rangeText({ from: '2026-10-23', to: '2026-10-23' })).toBe('23/10/2026');
    expect(trendCell(point('2026-10', 'Oct 2026', 17, 20))).toBe('85% (17 of 20)');
    expect(trendCell(point('2026-09', 'Sep 2026', 0, 0))).toBe('No day measured');
    expect(hasRehireGap({ employments: [{ joinDate: '2024-01-01', endDate: '2025-01-31' }, { joinDate: '2025-06-01', endDate: null }] })).toBe(true);
    expect(hasRehireGap({ employments: [{ joinDate: '2024-01-01', endDate: null }] })).toBe(false);
  });
});

describe('the charts', () => {
  it('count ticks from 0 in round steps, and round a column’s data end only', () => {
    expect(countTicks(0)).toEqual([0, 1]);
    expect(countTicks(3)).toEqual([0, 1, 2, 3]);
    expect(countTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(countTicks(37)).toEqual([0, 10, 20, 30, 40]);
    expect(columnPath(10, 20, 20, 100)).toBe('M10 120 V24 Q10 20 14 20 H26 Q30 20 30 24 V120 Z');
    expect(columnPath(10, 20, 20, 0)).toBe('');
    // a column lower than the radius: rounded to its height
    expect(columnPath(0, 0, 20, 2)).toBe('M0 2 V2 Q0 0 2 0 H18 Q20 0 20 2 V2 Z');
  });

  it('draws the on-time trend from 0% to 100%, broken where a month has no day measured', () => {
    expect(trendChart([point('2026-09', 'Sep 2026', 0, 0)], 'month')).toBeNull();
    const c = trendChart(
      [point('2026-06', 'Jun 2026', 18, 20), point('2026-07', 'Jul 2026', 19, 20), point('2026-08', 'Aug 2026', 0, 0), point('2026-09', 'Sep 2026', 15, 20), point('2026-10', 'Oct 2026', 17, 20)],
      'month',
    )!;
    expect(c.yTicks.map((t) => t.label)).toEqual(['0%', '25%', '50%', '75%', '100%']);
    expect(c.yTicks[0].y).toBe(c.plot.bottom);
    expect(c.yTicks[4].y).toBe(c.plot.top);
    // two runs: June–July, then September–October
    expect(c.paths).toHaveLength(2);
    expect(c.points.map((p) => p.key)).toEqual(['2026-06', '2026-07', '2026-09', '2026-10']);
    expect(c.points.at(-1)).toMatchObject({ last: true, text: 'Oct 2026: 85% on time (17 of 20 days)' });
    expect(c.endLabel?.text).toBe('85%');
    expect(c.description).toBe('On-time share by month, Jun 2026 to Oct 2026: from 75% to 95%, 85% in Oct 2026.');
    // evenly spaced, inside the plot
    expect(c.points.every((p) => p.x > c.plot.left && p.x < c.plot.right)).toBe(true);
  });

  it('thins a long trend’s labels and says quarters', () => {
    const many = Array.from({ length: 24 }, (_, i) => point(`2025-${String(i + 1).padStart(2, '0')}`, `P${i + 1}`, 8, 10));
    expect(trendChart(many, 'month')!.xTicks.length).toBeLessThanOrEqual(12);
    const quarters = trendChart([point('2026-Q3', 'Q3 2026', 30, 40), point('2026-Q4', 'Q4 2026', 18, 20)], 'quarter')!;
    expect(quarters.description).toContain('by quarter');
  });

  it('draws the check-in times by 15 minutes, the hours on the axis, the busiest bin labelled', () => {
    expect(binsChart([])).toBeNull();
    const bins: HistoryBin[] = [
      { from: 525, label: '8:45 AM', count: 2 },
      { from: 540, label: '9:00 AM', count: 9 },
      { from: 555, label: '9:15 AM', count: 4 },
      { from: 570, label: '9:30 AM', count: 0 },
      { from: 585, label: '9:45 AM', count: 1 },
      { from: 600, label: '10:00 AM', count: 1 },
    ];
    const c = binsChart(bins)!;
    expect(c.xTicks.map((t) => t.label)).toEqual(['9 AM', '10 AM']);
    expect(c.bars.filter((b) => b.label !== null).map((b) => [b.key, b.label])).toEqual([['540', '9']]);
    expect(c.bars[1].text).toBe('9:00 AM–9:14 AM: 9 check-ins');
    expect(c.bars[3].d).toBe('');
    // at most 24px wide, a gap between neighbours, each hit area its whole band
    const widths = c.bars.map((b) => b.hit.width);
    expect(widths.every((w) => w === widths[0])).toBe(true);
    expect(c.description).toBe('First check-ins by 15 minutes, 8:45 AM to 10:14 AM: 17 in all, most at 9:00 AM (9).');
  });

  it('draws the late days by weekday, each column labelled', () => {
    const none: HistoryWeekday[] = [0, 1, 2, 3, 4].map((w) => ({ weekday: w, label: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'][w], lateDays: 0, measuredDays: 0 }));
    expect(weekdayChart(none)).toBeNull();
    const week = none.map((w) => ({ ...w, lateDays: w.weekday === 0 ? 3 : w.weekday === 4 ? 1 : 0, measuredDays: 8 }));
    const c = weekdayChart(week)!;
    expect(c.xTicks.map((t) => t.label)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu']);
    expect(c.bars.map((b) => b.label)).toEqual(['3', '0', '0', '0', '1']);
    expect(c.bars[0].text).toBe('Sunday: 3 late of 8 days measured');
    expect(c.description).toBe('Late days by weekday: 4 in all, most on Sunday (3).');
    expect(weekdayChart(week.map((w) => ({ ...w, lateDays: 0 })))!.description).toBe('Late days by weekday: none late in this period.');
  });
});
