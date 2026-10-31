import { describe, expect, it } from 'vitest';
import { attendanceDayView, attendanceFigures, dayFromPunches, EXEMPT_BADGE, EXEMPTION_LABEL, NO_ATTENDANCE_FIGURES } from '@trendlix/shared';
import { undoConfirmText } from '../payroll/[id]/attendance/attendance';
import { addMonths } from '../payroll/list';
import { dailyHref as dailyHrefOf, readFilters as readFiltersOf, searchedMonth } from './attendance';
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
  dayPairs,
  EXEMPT_DAY_TITLE,
  exemptBadge,
  exemptDaysText,
  exemptionsText,
  daySourceText,
  deletedImportHref,
  deletedImportNotice,
  extraHoursText,
  figureTiles,
  filledText,
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
  allPressesLabel,
  dayEnds,
  dayPunches,
  dayRow,
  endFlags,
  flagBadges,
  morePresses,
  placeBadge,
  pressLabel,
  pressName,
  punchMap,
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
  type PunchRow,
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

  it('lists a day’s presses in order, in 12-hour time', () => {
    const punches = [
      { date: '2026-10-12', kind: 'out', at: '2026-10-12T10:00:00.000Z', place: 'remote' },
      { date: '2026-10-12', kind: 'in', at: '2026-10-12T06:05:00.000Z', place: 'office' },
      { date: '2026-10-13', kind: 'in', at: '2026-10-13T06:00:00.000Z', place: 'unknown' },
    ];
    expect(dayPunches(punches, '2026-10-12').map(pressLabel)).toEqual(['In 9:05 AM', 'Out 1:00 PM']);
    expect(dayPunches(punches, '2026-10-13').map(pressLabel)).toEqual(['In 9:00 AM']);
    expect(dayPunches(punches, '2026-10-14')).toEqual([]);
    expect(pressName(punches[0])).toBe('the check-out at 1:00 PM');
  });
});

// Simpler rows (owner, 20 October 2026, of Tuesday 20/10/2026's row listing a dozen presses: "simplify this, i want to
// view if it is remote or office, and location link"; "Yes, keep the spot", seen by "HR, CEO, Super Admin").
describe('a day’s check-in and check-out, with the place and the Map (20 October 2026)', () => {
  const DATE = '2026-10-20';
  const at = (time: string) => `${DATE}T${time}:00.000Z`; // Cairo is UTC+3 that day
  const press = (kind: 'in' | 'out', time: string, place: string, more: Partial<PunchRow> = {}): PunchRow => ({ date: DATE, kind, at: at(time), place, flags: [], ...more });
  // the owner's day: in at 4:58 PM without a location, out and in again, then out at 7:35 PM at the office
  const presses = [
    press('in', '13:58', 'unknown', { flags: ['location_unknown'], latitude: null, longitude: null, accuracyMetres: null, pointFrom: null }),
    press('out', '14:01', 'unknown'),
    press('in', '14:01', 'remote', { flags: ['outside_office'], latitude: 30.0444, longitude: 31.2357, accuracyMetres: 25, pointFrom: 'press' }),
    press('out', '16:35', 'office', { locationName: 'Head office', latitude: 30.0601, longitude: 31.3465, accuracyMetres: 12, pointFrom: 'press' }),
  ];
  const day = { date: DATE, checkIn: at('13:58'), checkOut: at('16:35'), place: 'unknown', flags: ['location_unknown', 'outside_office'], missingCheckIn: false, missingCheckOut: false };

  it('finds the presses the day’s check-in and check-out are, and none for a time no press made', () => {
    expect(dayEnds(day, presses)).toEqual({ checkIn: presses[0], checkOut: presses[3] });
    // Zoho's day, or a correction's time
    expect(dayEnds({ checkIn: at('06:00'), checkOut: null }, presses)).toEqual({ checkIn: null, checkOut: null });
    // a check-in's time is never a check-out's press
    expect(dayEnds({ checkIn: at('14:01'), checkOut: at('13:58') }, presses)).toEqual({ checkIn: presses[2], checkOut: null });
  });

  it('collapses the presses besides those two in “All presses (N)”', () => {
    expect(morePresses(presses, dayEnds(day, presses))).toBe(true);
    expect(morePresses([presses[0], presses[3]], dayEnds(day, [presses[0], presses[3]]))).toBe(false);
    expect(morePresses([], { checkIn: null, checkOut: null })).toBe(false);
    expect(allPressesLabel(14)).toBe('All presses (14)');
  });

  it('says the place as a badge: Office (with its location or network), Home, Remote, Location unknown', () => {
    expect(placeBadge('office', { locationName: 'Head office', officeNetwork: null })).toEqual({ label: 'Office', tone: 'ok', title: 'Head office' });
    expect(placeBadge('office', { locationName: null, officeNetwork: 'Main office line' })).toEqual({ label: 'Office', tone: 'ok', title: 'On the office network: Main office line' });
    expect(placeBadge('home')).toEqual({ label: 'Home', tone: 'accent', title: null });
    expect(placeBadge('remote')).toEqual({ label: 'Remote', tone: 'accent', title: null });
    expect(placeBadge('unknown')).toEqual({ label: 'Location unknown', tone: 'muted', title: null });
    expect(placeBadge(null)).toBeNull();
  });

  it('says a press within a sub-location as “Remote - Studio” (owner, 20 October 2026: "(Remote - Location name)")', () => {
    expect(placeBadge('remote', { locationName: 'Studio', officeNetwork: null })).toEqual({ label: 'Remote - Studio', tone: 'accent', title: 'Remote, at the sub-location Studio' });
    expect(placeBadge('remote', { locationName: '  ', officeNetwork: null })).toEqual({ label: 'Remote', tone: 'accent', title: null });
    // an office press keeps its word, the main office's name as the title
    expect(placeBadge('office', { locationName: 'Trendlix Al Mahrouki', officeNetwork: null })?.label).toBe('Office');
    // the day's row: the check-in's own press says it
    const sub = press('in', '09:05', 'remote', { locationName: 'Client X', flags: ['not_their_location'] });
    const row = dayRow({ date: sub.date, checkIn: sub.at, checkOut: null, place: 'remote', flags: ['not_their_location'] }, [sub]);
    expect(row.checkIn.badge?.label).toBe('Remote - Client X');
    expect(row.checkIn.flags).toEqual(['not_their_location']);
    expect(flagBadges(['not_their_location'])).toEqual([{ key: 'not_their_location', label: 'Not their location', title: 'Checked in at a sub-location they aren’t linked to' }]);
  });

  it('opens where a press was on Google Maps, the accuracy as the title; none without its spot', () => {
    expect(punchMap(presses[3])).toEqual({ href: 'https://www.google.com/maps?q=30.060100,31.346500', title: 'Within 12 m' });
    expect(punchMap({ ...presses[3], accuracyMetres: null })?.title).toBe('Accuracy not known');
    expect(punchMap({ ...presses[3], accuracyMetres: 1200 })?.title).toBe('Within 1,200 m');
    // an office press from before the spot was kept, at its location's point
    expect(punchMap({ ...presses[3], pointFrom: 'location' })?.title).toBe('Head office’s point: the spot itself wasn’t kept then');
    // no point, or the spot left out for the caller (a manager, Finance)
    expect(punchMap(presses[0])).toBeNull();
    expect(punchMap({ locationName: null })).toBeNull();
  });

  it('puts the flags in a word or two, the full words as their title, by the end they belong to', () => {
    expect(flagBadges(['location_unknown', 'outside_office', 'location_unknown', 'other'])).toEqual([
      { key: 'location_unknown', label: 'No location', title: 'Location unknown on an office day' },
      { key: 'outside_office', label: 'Outside the office', title: 'Checked in outside the office on an office day' },
    ]);
    expect(flagBadges(['fake_gps', 'not_home_or_office']).map((f) => f.label)).toEqual(['Fake GPS suspected', 'Not at home or the office']);
    // the check-in takes its own and a later check-in's; the check-out its own fake GPS
    expect(endFlags(day, dayEnds(day, presses))).toEqual({ checkIn: ['location_unknown', 'outside_office'], checkOut: [] });
    const mocked = { checkIn: presses[0], checkOut: { ...presses[3], flags: ['fake_gps'] } };
    expect(endFlags({ flags: ['location_unknown', 'fake_gps'] }, mocked)).toEqual({ checkIn: ['location_unknown'], checkOut: ['fake_gps'] });
    expect(endFlags({ flags: ['fake_gps'] }, { checkIn: { ...presses[0], flags: ['fake_gps'] }, checkOut: { ...presses[3], flags: ['fake_gps'] } })).toEqual({
      checkIn: ['fake_gps'],
      checkOut: ['fake_gps'],
    });
  });

  it('makes the owner’s row: 4:58 PM location unknown, 7:35 PM at the office with a Map, the rest collapsed', () => {
    const row = dayRow(day, presses);
    expect(row.checkIn).toMatchObject({ shown: 'time', time: '4:58 PM', press: presses[0], badge: { label: 'Location unknown' }, flags: ['location_unknown', 'outside_office'] });
    expect(row.checkOut).toMatchObject({ shown: 'time', time: '7:35 PM', press: presses[3], badge: { label: 'Office', title: 'Head office' }, flags: [] });
    expect(punchMap(row.checkOut.press!)?.href).toBe('https://www.google.com/maps?q=30.060100,31.346500');
    expect(row.presses).toHaveLength(4);
    expect(row.more).toBe(true);
  });

  it('gives a Zoho day its place on the check-in, and a missing end Missing', () => {
    const zoho = dayRow({ date: '2026-10-12', checkIn: '2026-10-12T06:00:00.000Z', checkOut: '2026-10-12T15:00:00.000Z', place: 'remote', flags: [] }, []);
    expect(zoho.checkIn).toMatchObject({ shown: 'time', time: '9:00 AM', press: null, badge: { label: 'Remote' } });
    expect(zoho.checkOut).toMatchObject({ shown: 'time', time: '6:00 PM', press: null, badge: null });
    expect(zoho.more).toBe(false);
    const open = dayRow({ ...day, checkOut: null, missingCheckOut: true }, presses.slice(0, 1));
    expect(open.checkOut).toMatchObject({ shown: 'missing', badge: null });
    const none = dayRow({ date: DATE, checkIn: null, checkOut: null, place: null, flags: [] }, []);
    expect([none.checkIn.shown, none.checkOut.shown]).toEqual(['none', 'none']);
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
      // a missing check-out counts half the shift until corrected (owner, 27 October 2026: "open check ins with half day")
      ['Missing check-outs', '0', 'A check-in without a check-out: counted as half a day until corrected', null],
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

  it('says what a Super Admin deleted, once back on the list (asked, 21 October 2026: "how to delete previous imports")', () => {
    expect(deletedImportHref('2026-09', false)).toBe('/attendance/imports?deleted=2026-09');
    expect(deletedImportHref('2026-09', true)).toBe('/attendance/imports?deleted=2026-09&undone=1');
    expect(deletedImportNotice({ deleted: '2026-09' })).toBe('Deleted the September 2026 import.');
    expect(deletedImportNotice({ deleted: '2026-09', undone: '1' })).toBe(
      'Undid and deleted the September 2026 import: the lines it filled are back to the figures typed before it, and its days are removed.',
    );
    for (const deleted of [undefined, '', 'yes', '2026-13', '<b>9</b>', ['2026-09']]) expect(deletedImportNotice({ deleted })).toBeNull();
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

describe('make-up hours on the Attendance pages (owner, 20 October 2026: "within the same month")', () => {
  // a shift that counts hours until 8:00 PM: a 7-hour day, then an 11-hour day and a 10:30 one, on 9 hours a day
  const worked = (date: string, hoursCounted: number) =>
    attendanceDayView({ date, status: 'worked', checkIn: `${date}T07:00:00.000Z`, checkOut: `${date}T19:00:00.000Z`, place: 'office', zohoStatus: null, permissionHours: 0, hoursCounted }, 9);
  const days = [worked('2026-10-04', 7), worked('2026-10-05', 11), worked('2026-10-06', 10.5)];

  it('says a day’s extra time, "+2:00 extra", and nothing on a day without', () => {
    expect(days.map(extraHoursText)).toEqual([null, '+2:00 extra', '+1:30 extra']);
    // an API from before it has none
    expect(extraHoursText({})).toBeNull();
  });

  it('adds a tile of the short hours the month’s extra time filled, only with extra time', () => {
    const f = attendanceFigures(days);
    expect(f).toMatchObject({ shortHours: 2, extraHours: 3.5, shortHoursFilled: 2 });
    const tiles = figureTiles(f, { averageHours: 9.5, hoursADay: 9 });
    expect(tiles.map((t) => t.key).slice(0, 5)).toEqual(['worked', 'hours', 'absent', 'short', 'filled']);
    expect(tiles.find((t) => t.key === 'filled')).toEqual({
      key: 'filled',
      label: 'Short hours filled by extra time',
      value: '2:00',
      note: "3:30 of extra time this month, past the shift's hours a day",
      tone: null,
    });
    expect(filledText(f)).toBe('2:00 filled by extra time');
    // no extra time: no tile, no note
    expect(figureTiles(NO_ATTENDANCE_FIGURES, { averageHours: null }).map((t) => t.key)).not.toContain('filled');
    expect([filledText(NO_ATTENDANCE_FIGURES), filledText({})]).toEqual([null, null]);
  });
});

describe('a day kept as its pairs (owner, 25 October 2026), counted from its first check-in to its last, breaks included (31 October 2026: "9:00, break included")', () => {
  const DATE = '2026-10-20';
  const at = (time: string) => `${DATE}T${time}:00+03:00`;
  const MORNING = { startTime: '09:00', endTime: '19:00', hoursPerDay: 9, graceMinutes: 15 };
  const presses = (...p: [kind: 'in' | 'out', time: string][]) => p.map(([kind, time]) => ({ kind, at: at(time), place: 'office' as const }));
  /** A kept day from its presses, as the API shows it. */
  const viewOf = (punched: ReturnType<typeof dayFromPunches>) =>
    attendanceDayView({ ...punched, date: DATE, status: 'worked', zohoStatus: null, permissionHours: 0, source: 'system' }, 9);

  it('lists several pairs with the break between them, the hours from the first check-in to the last, the break included', () => {
    const day = viewOf(dayFromPunches(DATE, presses(['in', '09:02'], ['out', '13:10'], ['in', '14:00'], ['out', '18:05']), MORNING));
    // 9:02 AM to 6:05 PM: 9:03, at most the shift's 9, nothing short
    expect(day).toMatchObject({ hoursCounted: 9, breakMinutes: 50, openAt: null, missingCheckOut: false, shortHours: 0 });
    expect(dayPairs(day)).toEqual({ pairs: '9:02 AM–1:10 PM · 2:00 PM–6:05 PM', break: 'Break 50 min', open: null });
  });

  it('says an open last check-in after the pairs, "flag the open one": a missing check-out, counted as half a day until corrected (27 October 2026)', () => {
    const day = viewOf(dayFromPunches(DATE, presses(['in', '09:00'], ['out', '13:00'], ['in', '14:00'], ['out', '18:00'], ['in', '18:30']), MORNING));
    // its 9 hours to the last check-out and half the shift's 9, within the 9: a full day, nothing short
    expect(day).toMatchObject({ hoursCounted: 9, missingCheckOut: true, openHalfDay: true, shortHours: 0, extraHours: 0, openAt: at('18:30') });
    expect(dayPairs(day)).toEqual({ pairs: '9:00 AM–1:00 PM · 2:00 PM–6:00 PM', break: 'Break 1 h 30 min', open: 'Checked in 6:30 PM · not checked out' });
    // one pair, then a check-in not checked out: the pair and the open press
    const one = viewOf(dayFromPunches(DATE, presses(['in', '09:00'], ['out', '13:00'], ['in', '14:00']), MORNING));
    expect(dayPairs(one)).toEqual({ pairs: '9:00 AM–1:00 PM', break: 'Break 1 h', open: 'Checked in 2:00 PM · not checked out' });
  });

  it('adds nothing for a day of one pair, a day with only a check-in, or a day not kept by pairs (Zoho’s, an API from before them)', () => {
    expect(dayPairs(viewOf(dayFromPunches(DATE, presses(['in', '09:00'], ['out', '18:00']), MORNING)))).toBeNull();
    // only a check-in: its check-out shows Missing, as before; half the shift counted until corrected (27 October 2026)
    const open = viewOf(dayFromPunches(DATE, presses(['in', '09:00']), MORNING));
    expect(open).toMatchObject({ missingCheckOut: true, openHalfDay: true, hoursCounted: 4.5, shortHours: 4.5 });
    expect(dayPairs(open)).toBeNull();
    expect(dayPairs({ pairs: null, openAt: null })).toBeNull();
    expect(dayPairs({})).toBeNull();
  });

  it('keeps the day’s check-in and check-out cells as before: the first check-in, the last check-out', () => {
    const day = viewOf(dayFromPunches(DATE, presses(['in', '09:00'], ['out', '13:00'], ['in', '14:00'], ['out', '18:00']), MORNING));
    const row = dayRow(day, []);
    expect([row.checkIn.time, row.checkOut.time, row.checkIn.shown, row.checkOut.shown]).toEqual(['9:00 AM', '6:00 PM', 'time', 'time']);
  });
});

describe('exempt from check-in (owner, 25 October 2026: "trat them as if they achived their full working hours")', () => {
  it('badges an exempt day and a month with exempt days, nothing else', () => {
    expect(exemptBadge({ exempt: true })).toEqual({ label: EXEMPT_BADGE, title: EXEMPT_DAY_TITLE });
    expect(EXEMPT_DAY_TITLE).toBe(`${EXEMPTION_LABEL}: counted as full hours; any presses are kept for reference only`);
    expect(exemptBadge({ exemptDays: 3 })?.label).toBe('Exempt');
    expect([exemptBadge({ exempt: false }), exemptBadge({ exemptDays: 0 }), exemptBadge({})]).toEqual([null, null, null]);
    expect([exemptDaysText({ exemptDays: 3 }), exemptDaysText({ exemptDays: 1 }), exemptDaysText({ exemptDays: 0 }), exemptDaysText({})]).toEqual(['3 exempt days', '1 exempt day', null, null]);
  });

  it('says the month’s periods at its top', () => {
    expect(exemptionsText([{ startDate: '2026-11-01', endDate: '2026-11-30' }])).toBe('Exempt from check-in: from 01/11/2026 until 30/11/2026');
    expect(exemptionsText([{ startDate: '2026-11-01', endDate: '2026-11-10' }, { startDate: '2026-11-20', endDate: null }])).toBe(
      'Exempt from check-in: from 01/11/2026 until 10/11/2026; from 20/11/2026, no end date',
    );
    expect([exemptionsText([]), exemptionsText(undefined)]).toEqual([null, null]);
  });

  it('adds an Exempt days tile only with exempt days, and an exempt day is neither short nor missing a press', () => {
    const exempt = attendanceDayView(
      { date: '2026-11-02', status: 'worked', checkIn: '2026-11-02T08:30:00.000Z', checkOut: null, place: 'remote', zohoStatus: null, permissionHours: 0, hoursCounted: 9, exempt: true, flags: ['outside_office'] },
      9,
    );
    expect(exempt).toMatchObject({ exempt: true, missingCheckOut: false, missingCheckIn: false, shortHours: 0, extraHours: 0, flags: [] });
    const f = attendanceFigures([exempt]);
    expect(f).toMatchObject({ exemptDays: 1, absentDays: 0, missingCheckOuts: 0, hoursCounted: 9 });
    expect(figureTiles(f, { averageHours: 9 }).find((t) => t.key === 'exempt')).toEqual({ key: 'exempt', label: 'Exempt days', value: '1', note: 'Exempt from check-in: counted as full hours', tone: null });
    expect(figureTiles(NO_ATTENDANCE_FIGURES, { averageHours: null }).map((t) => t.key)).not.toContain('exempt');
  });
});

// owner, 31 October 2026, on Daily Attendance: "allow me to search by name"
describe('searching Daily Attendance by name', () => {
  const fig = (daysWorked: number) => ({ ...NO_ATTENDANCE_FIGURES, daysWorked });
  const view = {
    people: [
      { employee: { fullNameEn: 'Lamiaa Essam Mohamed', employeeCode: 'EMP-0006' }, figures: fig(19) },
      { employee: { fullNameEn: 'Hazem Magdy', employeeCode: 'EMP-0033' }, figures: fig(20) },
      { employee: { fullNameEn: 'Mona Essam', employeeCode: 'EMP-0040' }, figures: fig(5) },
    ],
    withoutDays: [{ fullNameEn: 'Essam Ali', employeeCode: 'EMP-0050' }],
    totals: fig(44),
  };

  it('lists only those it matches, their figures together; nothing searched, as it came', () => {
    const found = searchedMonth(view, 'essam');
    expect(found.people.map((p) => p.employee.employeeCode)).toEqual(['EMP-0006', 'EMP-0040']);
    expect(found.withoutDays.map((e) => e.employeeCode)).toEqual(['EMP-0050']);
    expect(found.totals.daysWorked).toBe(24);
    expect(searchedMonth(view, 'emp-0033').people).toHaveLength(1);
    expect(searchedMonth(view, undefined)).toBe(view);
  });

  it('reads it from the address and keeps it in the links', () => {
    expect(readFiltersOf({ q: '  Lamiaa  ' }).q).toBe('Lamiaa');
    expect(readFiltersOf({}).q).toBeUndefined();
    expect(dailyHrefOf('2026-10', { q: 'Lamiaa' })).toBe('/attendance?month=2026-10&q=Lamiaa');
  });
});
