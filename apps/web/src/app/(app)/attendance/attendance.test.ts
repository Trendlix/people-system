import { describe, expect, it } from 'vitest';
import { attendanceDayView, attendanceFigures, NO_ATTENDANCE_FIGURES } from '@trendlix/shared';
import { undoConfirmText } from '../payroll/[id]/attendance/attendance';
import { addMonths } from '../payroll/list';
import {
  apiMonthPath,
  apiSummaryExcelPath,
  attendanceMonthChoices,
  attendancePeriodTitle,
  canSeeAttendance,
  checkInCell,
  correctedNote,
  dailyHref,
  dayFlagTexts,
  daySourceText,
  figureTiles,
  filtered,
  hoursText,
  importCountsText,
  importHref,
  importMonthChoices,
  importStateText,
  importsAttendance,
  importTarget,
  importWay,
  lockedText,
  noAttendanceText,
  notImportedYetText,
  personHref,
  punchesText,
  quickSummaryPeriods,
  readAttendanceMonth,
  readFilters,
  readSummaryPeriod,
  reviewsImports,
  runWay,
  sourceText,
  suggestedImportMonth,
  summaryExcelHref,
  summaryHref,
  teamAttendanceHref,
} from './attendance';
import { notLoaded } from './not-loaded';
import { ATTENDANCE_SECTIONS } from './sections';

// The Attendance section (owner, 19 October 2026: "is the attendance module active?", then "the attendance is not active
// in the side menu", and for importing "where am i going to import the sheets?"). Everyone here is invented.

const TODAY = '2026-10-19';
const ID = '0b8f2c1e-1111-4222-8333-444455556666';

describe('who sees the Attendance section', () => {
  it('is HR, the CEO and Finance; HR imports; HR and the CEO open an import’s review', () => {
    for (const role of ['hr', 'ceo', 'finance'] as const) expect(canSeeAttendance({ roles: [role] })).toBe(true);
    for (const role of ['employee', 'manager', 'admin', 'super_admin'] as const) expect(canSeeAttendance({ roles: [role] })).toBe(false);
    expect([importsAttendance({ roles: ['hr'] }), importsAttendance({ roles: ['ceo'] }), importsAttendance({ roles: ['finance'] })]).toEqual([true, false, false]);
    expect([reviewsImports({ roles: ['hr'] }), reviewsImports({ roles: ['ceo'] }), reviewsImports({ roles: ['finance'] })]).toEqual([true, true, false]);
    expect(ATTENDANCE_SECTIONS.find((s) => s.key === 'import')?.roles).toEqual(['hr']);
    // the corrections HR and the CEO decide (19 October 2026: "Attendance corrections with approval")
    expect(ATTENDANCE_SECTIONS.find((s) => s.key === 'corrections')).toMatchObject({ href: '/attendance/corrections', roles: ['hr', 'ceo'] });
  });
});

describe('a corrected day and its presses (19 October 2026)', () => {
  it('says what a corrected day was corrected from, and nothing of another', () => {
    const from = { source: 'system' as const, status: 'worked' as const, checkIn: '2026-10-12T06:30:00.000Z', checkOut: null, place: 'office' as const };
    expect(correctedNote({ source: 'correction', correctedFrom: from })).toBe('Corrected from 9:30 AM – no check-out');
    expect(correctedNote({ source: 'correction', correctedFrom: null })).toBe('Corrected from no day on record');
    expect(correctedNote({ source: 'system', correctedFrom: from })).toBeNull();
  });

  it('lists a day’s presses in order, in 12-hour time with their place', () => {
    const punches = [
      { date: '2026-10-12', kind: 'out', at: '2026-10-12T10:00:00.000Z', place: 'remote' },
      { date: '2026-10-12', kind: 'in', at: '2026-10-12T06:05:00.000Z', place: 'office' },
      { date: '2026-10-13', kind: 'in', at: '2026-10-13T06:00:00.000Z', place: 'unknown' },
    ];
    expect(punchesText(punches, '2026-10-12')).toBe('In 9:05 AM (office) · Out 1:00 PM (remote)');
    expect(punchesText(punches, '2026-10-13')).toBe('In 9:00 AM (location unknown)');
    expect(punchesText(punches, '2026-10-14')).toBeNull();
  });
});

describe('the month, the filters and the period in the address', () => {
  it('reads the month, this month without one it can read', () => {
    expect(readAttendanceMonth({ month: '2026-09' }, TODAY)).toBe('2026-09');
    expect(readAttendanceMonth({}, TODAY)).toBe('2026-10');
    expect(readAttendanceMonth({ month: '2026-13' }, TODAY)).toBe('2026-10');
    expect(readAttendanceMonth({ month: '1999-01' }, TODAY)).toBe('2026-10');
  });

  it('reads the filters, leaving out one it can’t read', () => {
    expect(readFilters({ department: ID, employee: 'x', only: 'absences' })).toEqual({ departmentId: ID, employeeId: null, only: 'absences' });
    expect(readFilters({ only: 'everyone' })).toEqual({ departmentId: null, employeeId: null, only: null });
    expect(filtered(readFilters({}))).toBe(false);
    expect(filtered(readFilters({ only: 'remote' }))).toBe(true);
  });

  it('keeps them in the links, and asks the API with its own names', () => {
    expect(dailyHref('2026-09')).toBe('/attendance?month=2026-09');
    expect(dailyHref('2026-09', { departmentId: ID, only: 'short_hours' })).toBe(`/attendance?month=2026-09&department=${ID}&only=short_hours`);
    expect(apiMonthPath('2026-09', { departmentId: ID, employeeId: ID })).toBe(`/attendance?month=2026-09&departmentId=${ID}&employeeId=${ID}`);
    expect(personHref(ID, '2026-09')).toBe(`/attendance/${ID}?month=2026-09`);
    expect(teamAttendanceHref('2026-09')).toBe('/my-team/attendance?month=2026-09');
    expect(importHref('2026-09')).toBe('/attendance/import?month=2026-09');
    expect(importHref()).toBe('/attendance/import');
  });

  it('reads the Summary’s period: a month alone, a range, or this month; a month alone as ?month= in its links', () => {
    expect(readSummaryPeriod({}, TODAY)).toEqual({ from: '2026-10', to: '2026-10' });
    expect(readSummaryPeriod({ month: '2026-09' }, TODAY)).toEqual({ from: '2026-09', to: '2026-09' });
    expect(readSummaryPeriod({ from: '2026-06', to: '2026-01' }, TODAY)).toEqual({ from: '2026-01', to: '2026-06' });
    expect(summaryHref({ from: '2026-09', to: '2026-09' })).toBe('/attendance/summary?month=2026-09');
    expect(summaryHref({ from: '2026-01', to: '2026-06' })).toBe('/attendance/summary?from=2026-01&to=2026-06');
    expect(summaryExcelHref({ from: '2026-01', to: '2026-06' })).toBe('/attendance/summary/excel?from=2026-01&to=2026-06');
    expect(apiSummaryExcelPath({ from: '2026-09', to: '2026-09' })).toBe('/attendance/summary.xlsx?month=2026-09');
    expect(attendancePeriodTitle({ from: '2026-09', to: '2026-09' })).toBe('September 2026');
    expect(attendancePeriodTitle({ from: '2026-01', to: '2026-06' })).toBe('January to June 2026');
    expect(attendancePeriodTitle({ from: '2025-11', to: '2026-02' })).toBe('November 2025 to February 2026');
  });

  it('offers this month back two years, and the month chosen outside them; a few periods a click away', () => {
    const months = attendanceMonthChoices(TODAY, '2020-01');
    expect(months[0]).toEqual({ value: '2026-10', label: 'October 2026' });
    expect(months).toHaveLength(26);
    expect(months.at(-1)?.value).toBe('2020-01');
    expect(quickSummaryPeriods(TODAY).map((q) => [q.label, q.period.from, q.period.to])).toEqual([
      ['This month', '2026-10', '2026-10'],
      ['Last month', '2026-09', '2026-09'],
      ['Last 3 months', '2026-08', '2026-10'],
      ['This year', '2026-01', '2026-10'],
    ]);
  });
});

describe('a month’s figures in words', () => {
  const days = [
    attendanceDayView({ date: '2026-09-01', status: 'worked', checkIn: '2026-09-01T07:00:00Z', checkOut: '2026-09-01T15:30:00Z', place: 'office', zohoStatus: null, permissionHours: 0, hoursCounted: 8.5 }, 9),
    attendanceDayView({ date: '2026-09-02', status: 'absent', checkIn: null, checkOut: null, place: null, zohoStatus: 'Absent', permissionHours: 0, hoursCounted: 0 }, 9),
    attendanceDayView({ date: '2026-09-03', status: 'zoho_leave', checkIn: null, checkOut: null, place: null, zohoStatus: 'Annual Leave', permissionHours: 0, hoursCounted: 0 }, 9),
  ];

  it('are tiles: days worked, hours (with the average), absent days, short hours against the shift, permission, leave, missing check-outs', () => {
    const tiles = figureTiles(attendanceFigures(days), { averageHours: 8.5, hoursADay: 9, permissionFrom: 'system' });
    expect(tiles.map((t) => [t.label, t.value, t.note, t.tone])).toEqual([
      ['Days worked', '1', '1 at the office · 0 remote', null],
      ['Hours counted', '8:30', '8:30 a day on average', null],
      ['Absent days', '1', "The payroll's no-show days", 'danger'],
      ['Short hours', '0:30', "Against the shift's 9:00 a day", 'warn'],
      ['Permission hours', '0:00', 'Approved in the system', null],
      ['Leave days', '0', 'And 1 day of leave in Zoho only, to record', 'warn'],
      ['Missing check-outs', '0', 'A check-in without a check-out: no hours', null],
    ]);
    expect(figureTiles(NO_ATTENDANCE_FIGURES, { averageHours: null }).find((t) => t.key === 'hours')?.note).toBeNull();
    // no one checks in on the system, and none missing or flagged: no tiles for them
    expect(tiles.map((t) => t.key)).not.toContain('checkins');
    expect(tiles.map((t) => t.key)).not.toContain('flagged');
    expect([hoursText(0), hoursText(0, true), hoursText(null), hoursText(9.25)]).toEqual(['0:00', '—', '—', '9:15']);
  });
});

describe('where the days came from, and a month without any', () => {
  const source = {
    importId: 'i1',
    runId: 'r1',
    month: '2026-09',
    runStatus: 'draft' as const,
    createdAt: '2026-10-19T14:42:00.000Z',
    createdBy: 'Hana Invented',
    appliedAt: '2026-10-19T15:00:00.000Z',
    appliedBy: 'Hana Invented',
    files: ['everyone.xlsx'],
  };

  it('says each import: read, applied, its files', () => {
    expect(sourceText(source)).toBe('Read 19/10/2026, 5:42 PM by Hana Invented · applied 19/10/2026, 6:00 PM by Hana Invented · everyone.xlsx');
    expect(sourceText({ ...source, createdBy: null, appliedAt: null, files: ['a', 'b', 'c', 'd'] })).toBe('Read 19/10/2026, 5:42 PM · not applied since · 4 files');
  });

  it('says none is imported yet, and points HR to Import, the CEO and Finance to the month’s run or Payroll', () => {
    expect(noAttendanceText('2026-10')).toBe(
      "No attendance for October 2026 yet: no one has checked in on the system, and Zoho People's attendance isn't imported — import it on the month's payroll run.",
    );
    expect(notImportedYetText('2026-10')).toBe(
      "No attendance for October 2026 yet. Check-ins on the system show here as they are made, and HR imports Zoho People's attendance with the month's payroll.",
    );
    expect(importWay({ roles: ['hr'] }, '2026-10', null)).toEqual({ href: '/attendance/import?month=2026-10', label: "Import October 2026's attendance" });
    expect(importWay({ roles: ['ceo'] }, '2026-10', { id: 'r1', status: 'draft' })).toEqual({ href: '/payroll/r1', label: 'Open the October 2026 payroll' });
    expect(importWay({ roles: ['finance'] }, '2026-10', null)).toEqual({ href: '/payroll', label: 'Payroll' });
    // HR's second way: the month's run
    expect(runWay('2026-10', { id: 'r1', status: 'draft' })).toEqual({ href: '/payroll/r1', label: 'Open the October 2026 payroll' });
  });

  it('words what couldn’t be loaded', () => {
    expect(notLoaded({ kind: 'forbidden' }, 'attendance')).toBe("Only HR, Finance and the CEO see everyone's attendance; a manager sees their team's on My Team.");
    expect(notLoaded({ kind: 'failed', messages: ['Down.'] }, 'attendance')).toBe('The attendance could not be loaded. Down.');
  });
});

describe('the Import page (owner, 19 October 2026: "where am i going to import the sheets?")', () => {
  const runs = [
    { id: 'oct', month: '2026-10', status: 'draft' as const },
    { id: 'sep', month: '2026-09', status: 'pending_ceo' as const },
    { id: 'aug', month: '2026-08', status: 'paid' as const },
    { id: 'jul', month: '2026-07', status: 'approved' as const },
  ];

  it('uploads into the month’s draft run, makes the run first when there is none, and refuses a locked month', () => {
    expect(importTarget('2026-10', runs)).toEqual({ kind: 'upload', runId: 'oct' });
    expect(importTarget('2026-06', runs)).toEqual({ kind: 'create' });
    expect(importTarget('2026-09', runs)).toEqual({ kind: 'locked', runId: 'sep', status: 'pending_ceo' });
    expect(lockedText('2026-09', 'pending_ceo')).toBe("September 2026 is locked: its payroll is with the CEO, so it can't take an import.");
    expect(lockedText('2026-08', 'paid')).toBe("August 2026 is locked: its payroll is paid, so it can't take an import.");
    expect(lockedText('2026-07', 'approved')).toBe("July 2026 is locked: its payroll is approved, so it can't take an import.");
  });

  it('offers this month back 12 months, each saying what its payroll is, the locked ones not to be chosen', () => {
    const months = importMonthChoices(TODAY, runs);
    expect(months).toHaveLength(13);
    expect(months.slice(0, 5).map((m) => [m.label, m.locked])).toEqual([
      ['October 2026 (draft payroll)', false],
      ['September 2026 (locked: with the CEO)', true],
      ['August 2026 (locked: paid)', true],
      ['July 2026 (locked: approved)', true],
      ['June 2026 (no payroll yet: a draft is made)', false],
    ]);
    expect(months.at(-1)?.month).toBe('2025-10');
  });

  it('offers the month asked for when it is open, else last month, else this month, else the newest open one', () => {
    const months = importMonthChoices(TODAY, runs);
    expect(suggestedImportMonth(months, TODAY, '2026-06')).toBe('2026-06');
    // September is locked: this month
    expect(suggestedImportMonth(months, TODAY, '2026-09')).toBe('2026-10');
    expect(suggestedImportMonth(importMonthChoices(TODAY, []), TODAY)).toBe('2026-09');
    const all = importMonthChoices(
      TODAY,
      Array.from({ length: 13 }, (_, n) => ({ id: `r${n}`, month: addMonths('2026-10', -n), status: 'paid' as const })),
    );
    expect(suggestedImportMonth(all, TODAY)).toBeNull();
  });
});

describe('Import History', () => {
  const row = { people: 3, counts: { matched: 1, toConfirm: 0, notFound: 1, skipped: 1 }, appliedAt: '2026-10-19T15:00:00.000Z', appliedBy: 'Hana Invented', undoneAt: null };

  it('says how many people, and where each import stands', () => {
    expect(importCountsText(row)).toBe('3 people: 1 matched, 1 not found, 1 skipped');
    expect(importCountsText({ people: 1, counts: { matched: 1, toConfirm: 0, notFound: 0, skipped: 0 } })).toBe('1 person: 1 matched');
    expect(importStateText(row)).toBe('Applied 19/10/2026, 6:00 PM by Hana Invented');
    expect(importStateText({ ...row, appliedAt: null, undoneAt: '2026-10-19T16:00:00.000Z' })).toBe('Undone 19/10/2026, 7:00 PM');
    expect(importStateText({ ...row, appliedAt: null })).toBe('Not applied yet');
  });

  it('asks before undoing an import, saying what it does (owner, 19 October 2026: "imported data shouldn\'t be editable")', () => {
    expect(undoConfirmText({ undoable: 2 })).toBe(
      'Undo this import on 2 lines? The worked hours, no-show days and permission hours go back to what was typed before it was applied (empty if nothing was), and the days it kept are removed.',
    );
    expect(undoConfirmText({ undoable: 1 })).toContain('on 1 line?');
  });
});

describe('checking in on the system (owner, 19 October 2026: "Check-in through the system (phone or web with the office location check, or a device) to replace Zoho")', () => {
  const unknownPlace = attendanceDayView(
    { date: '2026-10-18', status: 'worked', checkIn: '2026-10-18T06:05:00Z', checkOut: '2026-10-18T14:10:00Z', place: 'unknown', zohoStatus: null, permissionHours: 0, hoursCounted: 8, source: 'system', flags: ['location_unknown'] },
    8,
  );
  const outOnly = attendanceDayView(
    { date: '2026-10-19', status: 'worked', checkIn: null, checkOut: '2026-10-19T14:10:00Z', place: 'office', zohoStatus: null, permissionHours: 0, hoursCounted: 0, source: 'system' },
    8,
  );
  const goneBy = attendanceDayView({ date: '2026-10-15', status: 'absent', checkIn: null, checkOut: null, place: null, zohoStatus: null, permissionHours: 0, hoursCounted: 0, source: 'system' }, 8);
  const zoho = attendanceDayView({ date: '2026-10-01', status: 'worked', checkIn: '2026-10-01T06:00:00Z', checkOut: '2026-10-01T14:00:00Z', place: 'office', zohoStatus: 'Present', permissionHours: 0, hoursCounted: 8 }, 8);

  it('says where each day came from: a working day gone by without a check-in is the system’s', () => {
    expect([daySourceText(unknownPlace), daySourceText(goneBy), daySourceText(zoho), daySourceText({ source: 'device' }), daySourceText({ source: 'correction' })]).toEqual([
      'Checked in on the system',
      'Checked in on the system',
      'Zoho People',
      'Attendance device',
      'Corrected',
    ]);
  });

  it('words the flags, and shows a check-out without a check-in as missing', () => {
    expect(dayFlagTexts(unknownPlace)).toEqual(['Location unknown on an office day']);
    expect(dayFlagTexts({ flags: ['outside_office', 'outside_office', 'other'] })).toEqual(['Checked in outside the office on an office day']);
    expect(dayFlagTexts({})).toEqual([]);
    // the employee app on Android told a mock location (Phase 2, 20 October 2026)
    expect(dayFlagTexts({ flags: ['fake_gps'] })).toEqual(['Fake GPS suspected']);
    expect([checkInCell(unknownPlace), checkInCell(outOnly), checkInCell(goneBy), checkInCell({ checkIn: null })]).toEqual(['time', 'missing', 'none', 'none']);
  });

  it('adds tiles for the missing check-ins and the flagged days, for someone who checks in or a month with any', () => {
    const f = attendanceFigures([unknownPlace, outOnly, goneBy]);
    const tiles = figureTiles(f, { averageHours: 8, hoursADay: 8, checksIn: true });
    expect(tiles.slice(-2).map((t) => [t.key, t.label, t.value, t.note, t.tone])).toEqual([
      ['checkins', 'Missing check-ins', '1', 'A check-out without a check-in: no hours', 'warn'],
      ['flagged', 'Flagged days', '1', "A check-in outside the work arrangement's rule, or on a fake GPS", 'warn'],
    ]);
    // someone who checks in, nothing missing or flagged: shown, plain
    expect(figureTiles(attendanceFigures([zoho]), { averageHours: 8, checksIn: true }).slice(-2).map((t) => [t.value, t.tone])).toEqual([
      ['0', null],
      ['0', null],
    ]);
    // not checking in, but a flagged day (a list's totals): that one alone
    expect(figureTiles({ ...NO_ATTENDANCE_FIGURES, flaggedDays: 2 }, { averageHours: null }).map((t) => t.key).slice(-2)).toEqual(['checkouts', 'flagged']);
  });
});
