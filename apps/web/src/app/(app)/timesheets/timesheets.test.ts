import { describe, expect, it } from 'vitest';
import {
  blankLine,
  clientGroups,
  dayHead,
  entriesOf,
  hoursUploadProblem,
  MY_TIMESHEET_UPLOAD_API,
  MY_TIMESHEET_UPLOAD_PATH,
  replacedText,
  TIMESHEET_TEMPLATE_API,
  TIMESHEET_TEMPLATE_HREF,
  TIMESHEETS_UPLOAD_API,
  TIMESHEETS_UPLOAD_PATH,
  uploadDoneText,
  uploadedWeeks,
  uploadsHoursForOthers,
  lineTotals,
  lineWhat,
  linesOf,
  myTimesheetHref,
  parseHours,
  readTimesheetsQuery,
  timesheetHref,
  timesheetsApi,
  timesheetsHref,
  timesheetTone,
  weekFrom,
  type TimesheetLine,
} from './timesheets';

// Timesheets on the site (owner, 4 November 2026: "Timesheet in app/website", "Direct manager, weekly").

const WEEK = '2026-11-01'; // a Sunday
const line = (over: Partial<TimesheetLine>): TimesheetLine => ({ ...blankLine('2026-11-02', 'k'), ...over });

describe('the addresses', () => {
  it('opens a week by any of its days, this week without one', () => {
    expect(myTimesheetHref(null)).toBe('/my-timesheet');
    expect(myTimesheetHref(WEEK)).toBe('/my-timesheet?week=2026-11-01');
    expect(timesheetHref('a b')).toBe('/timesheets/a%20b');
    expect(weekFrom('2026-11-04')).toBe(WEEK);
    expect(weekFrom(['2026-11-07'])).toBe(WEEK);
    expect(weekFrom('2026-02-30')).toBeNull();
    expect(weekFrom(undefined)).toBeNull();
  });

  it('reads the list’s filters, waiting unless another is asked for', () => {
    expect(readTimesheetsQuery({})).toEqual({ status: 'waiting', week: null });
    expect(readTimesheetsQuery({ status: 'approved', week: '2026-11-03' })).toEqual({ status: 'approved', week: WEEK });
    expect(readTimesheetsQuery({ status: 'maybe' }).status).toBe('waiting');
    expect(timesheetsApi({ status: 'all', week: WEEK })).toBe('/timesheets?status=all&week=2026-11-01');
    expect(timesheetsHref({ status: 'waiting' })).toBe('/timesheets');
    expect(timesheetsHref({ status: 'rejected', week: WEEK })).toBe('/timesheets?status=rejected&week=2026-11-01');
  });

  it('colours a status', () => {
    expect(timesheetTone('approved')).toBe('bg-ok-soft text-ok');
    expect(timesheetTone('submitted')).toBe('bg-warn-soft text-warn');
    expect(timesheetTone('rejected')).toBe('bg-danger-soft text-danger');
    expect(timesheetTone(null)).toBe('bg-canvas text-muted');
  });
});

describe('the hours', () => {
  it('reads them in quarter hours, as a number or a clock', () => {
    expect(parseHours('1.5')).toBe(1.5);
    expect(parseHours('1,5')).toBe(1.5);
    expect(parseHours('7:45')).toBe(7.75);
    expect(parseHours(' 8 ')).toBe(8);
    expect(parseHours('0.25')).toBe(0.25);
    expect(parseHours('1.1')).toBeNull();
    expect(parseHours('0')).toBeNull();
    expect(parseHours('25')).toBeNull();
    expect(parseHours('two')).toBeNull();
    expect(parseHours('')).toBeNull();
  });
});

describe('the form’s lines', () => {
  const ctx = { weekStart: WEEK, today: '2026-11-04' };

  it('sends the lines filled in, a blank one left out', () => {
    const { entries, errors } = entriesOf(
      [line({ clientAccountId: 'c1', hours: '3', note: ' Shoot ' }), line({ date: '2026-11-03', task: ' Design ', hours: '7:30' }), line({})],
      ctx,
    );
    expect(errors).toEqual([]);
    expect(entries).toEqual([
      { date: '2026-11-02', clientAccountId: 'c1', task: null, hours: 3, note: 'Shoot' },
      { date: '2026-11-03', clientAccountId: null, task: 'Design', hours: 7.5, note: null },
    ]);
  });

  it('says what is wrong, in words', () => {
    expect(entriesOf([line({ clientAccountId: 'c1', hours: '1.1' })], ctx).errors).toEqual(['Enter the hours from 0.25 to 24, in quarter hours, e.g. 1.5, 7.75 or 7:45.']);
    expect(entriesOf([line({ hours: '2' })], ctx).errors).toEqual(['Choose the client, or write the task, on each line.']);
    expect(entriesOf([line({ date: '2026-11-06', task: 'X', hours: '2' })], ctx).errors).toEqual(['06/11/2026 hasn’t come yet: log hours once they are worked.']);
    expect(entriesOf([line({ task: 'A', hours: '20' }), line({ task: 'B', hours: '5' })], ctx).errors).toEqual(['02/11/2026 has 25 hours: a day has 24 hours at most.']);
  });

  it('adds up each day as typed, and starts from what was saved', () => {
    const totals = lineTotals([line({ hours: '2' }), line({ hours: '1:30' }), line({ hours: 'x' }), line({ date: '2026-11-03', hours: '4' })]);
    expect(Object.fromEntries(totals)).toEqual({ '2026-11-02': 3.5, '2026-11-03': 4 });
    expect(linesOf([{ id: 'e1', date: '2026-11-02', client: { id: 'c1', name: 'Acme' }, task: null, hours: 7.5, note: null }])).toEqual([
      { key: 'e1', date: '2026-11-02', clientAccountId: 'c1', task: '', hours: '7.5', note: '' },
    ]);
  });
});

describe('the words', () => {
  it('groups the clients and says a line and a day', () => {
    const groups = clientGroups([
      { id: 'a', name: 'Acme', assigned: true },
      { id: 'b', name: 'Beta', assigned: false },
    ]);
    expect(groups.assigned.map((c) => c.id)).toEqual(['a']);
    expect(groups.others.map((c) => c.id)).toEqual(['b']);
    expect(lineWhat({ client: { id: 'a', name: 'Acme' }, task: 'Edit' })).toBe('Acme · Edit');
    expect(lineWhat({ client: null, task: 'Edit' })).toBe('Edit');
    expect(lineWhat({ client: null, task: null })).toBe('—');
    expect(dayHead('2026-11-01')).toBe('Sun 01/11');
  });
});

describe('uploading hours (5 November 2026: "how to upload a bulk time log?")', () => {
  const week = (name: string, weekStart: string) => ({
    id: `${name}-${weekStart}`,
    employee: { id: name, fullNameEn: name, employeeCode: null },
    weekStart,
    lines: 2,
    totalHours: 8,
    status: 'submitted' as const,
    replaced: 0,
  });

  it('has its pages, the template’s download and the API’s addresses', () => {
    expect(MY_TIMESHEET_UPLOAD_PATH).toBe('/my-timesheet/upload');
    expect(TIMESHEETS_UPLOAD_PATH).toBe('/timesheets/upload');
    expect(TIMESHEET_TEMPLATE_HREF).toBe('/timesheets/template');
    expect(TIMESHEET_TEMPLATE_API).toBe('/timesheets/upload/template');
    expect(MY_TIMESHEET_UPLOAD_API).toBe('/me/timesheet/upload');
    expect(TIMESHEETS_UPLOAD_API).toBe('/timesheets/upload');
  });

  it('checks the file before it is sent: an .xlsx of up to 5 MB', () => {
    expect(hoursUploadProblem(null)).toBe('Choose the hours file to upload (.xlsx).');
    expect(hoursUploadProblem({ name: 'hours.xlsx', size: 0 })).toBe('Choose the hours file to upload (.xlsx).');
    expect(hoursUploadProblem({ name: 'hours.csv', size: 10 })).toMatch(/^Choose an Excel workbook/);
    expect(hoursUploadProblem({ name: 'hours.xlsx', size: 6 * 1024 * 1024 })).toBe('The file must be 5 MB or smaller.');
    expect(hoursUploadProblem({ name: 'Hours Nov.XLSX', size: 1000 })).toBeNull();
  });

  it('is for HR, the CEO and a Super Admin to upload for others', () => {
    expect(uploadsHoursForOthers({ roles: ['hr'] })).toBe(true);
    expect(uploadsHoursForOthers({ roles: ['ceo'] })).toBe(true);
    expect(uploadsHoursForOthers({ roles: ['super_admin'] })).toBe(true);
    expect(uploadsHoursForOthers({ roles: ['employee', 'manager'] })).toBe(false);
    expect(uploadsHoursForOthers({ roles: ['finance'] })).toBe(false);
  });

  it('says what was done, and lists the weeks by person then week', () => {
    expect(uploadDoneText({ weeks: [week('a', WEEK)], totalHours: 8, sent: true })).toBe('Sent 1 week for approval (8 hours).');
    expect(uploadDoneText({ weeks: [week('a', WEEK), week('a', '2026-11-08')], totalHours: 38.5, sent: false })).toBe(
      'Saved 2 weeks (38.5 hours). Send each week for approval from My Timesheet.',
    );
    expect(replacedText(0)).toBeNull();
    expect(replacedText(1)).toBe('Replaced 1 earlier line');
    expect(replacedText(4)).toBe('Replaced 4 earlier lines');
    const sorted = uploadedWeeks({ weeks: [week('Omar', '2026-11-08'), week('Nour', '2026-11-08'), week('Omar', WEEK)] });
    expect(sorted.map((w) => w.id)).toEqual(['Nour-2026-11-08', `Omar-${WEEK}`, 'Omar-2026-11-08']);
  });
});
