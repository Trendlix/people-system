import { describe, expect, it } from 'vitest';
import type { AttendanceMonthResult } from '@trendlix/shared';
import type { AttendancePersonView } from '../../../../../lib/attendance-types';
import {
  applicable,
  applyConfirmText,
  attendanceReviewHref,
  checkTimesText,
  countChips,
  dayTone,
  fileMonthsNote,
  notAppliedReason,
  permissionText,
  personChoice,
  reviewSections,
  uploadProblems,
} from './attendance';

// The Zoho People attendance import on a run (owner, 19 October 2026: "Import Zoho now, replace it later"). Everyone here
// is invented.

const MONTH: AttendanceMonthResult = {
  days: [],
  daysWorked: 3,
  officeDays: 2,
  remoteDays: 1,
  hoursCounted: 24.25,
  absentDays: 1,
  permissionHours: 2,
  permissionFrom: 'zoho',
  zohoLeaveDays: [],
  missingDays: [],
  outside: 0,
  warnings: [],
};

const person = (over: Partial<AttendancePersonView>): AttendancePersonView => ({
  key: 'id:1',
  zohoId: '1',
  zohoName: 'Rania Invented',
  match: 'exact',
  employee: { id: 'e1', fullNameEn: 'Rania Invented', employeeCode: 'EMP-0001' },
  candidates: [],
  duplicate: false,
  lineId: 'l1',
  editable: true,
  confidential: false,
  rows: 22,
  month: MONTH,
  applied: null,
  ...over,
});

describe('uploading', () => {
  it('takes Zoho’s workbooks, at most 60 of 5 MB each, within one upload’s size', () => {
    expect(uploadProblems([{ name: 'everyone.xlsx', size: 40_000 }])).toEqual([]);
    expect(uploadProblems([])).toEqual(['Choose the attendance entries exported from Zoho People: one file with everyone, or a file per person (.xlsx).']);
    expect(uploadProblems([{ name: 'a.csv', size: 10 }])).toEqual(["a.csv isn't an Excel workbook (.xlsx): export the attendance entries from Zoho People as XLSX."]);
    expect(uploadProblems([{ name: 'big.xlsx', size: 6 * 1024 * 1024 }])).toEqual(['big.xlsx is larger than 5 MB.']);
    expect(uploadProblems(Array.from({ length: 61 }, (_, i) => ({ name: `p${i}.xlsx`, size: 10 })))).toEqual(['Upload at most 60 files at once.']);
    expect(uploadProblems(Array.from({ length: 6 }, (_, i) => ({ name: `p${i}.xlsx`, size: 4.5 * 1024 * 1024 })))).toEqual([
      'These files come to more than 24 MB together: upload them in two or more goes.',
    ]);
  });

  it('says when a file has days of another month', () => {
    expect(fileMonthsNote({ months: ['2026-09'] }, '2026-09')).toBeNull();
    expect(fileMonthsNote({ months: ['2026-08', '2026-09'] }, '2026-09')).toBe('Also has days of August 2026: left out.');
    expect(fileMonthsNote({ months: ['2026-08'] }, '2026-09')).toBe('Has days of August 2026 only, none of September 2026: nothing from it counts.');
  });

  it('opens the review at its address', () => {
    expect(attendanceReviewHref('r1', 'i1')).toBe('/payroll/r1/attendance/i1');
  });
});

describe('the review', () => {
  const people = [
    person({ key: 'a', zohoName: 'Zed Close', match: 'close', employee: null, month: null, candidates: [{ id: 'e2', fullNameEn: 'Zed Closer', employeeCode: 'EMP-0002', similarity: 0.9 }] }),
    person({ key: 'b', zohoName: 'Amy None', match: 'none', employee: null, month: null }),
    person({ key: 'c', zohoName: 'Rania Invented' }),
    person({ key: 'd', zohoName: 'Omar Twice', match: 'confirmed', duplicate: true, employee: { id: 'e3', fullNameEn: 'Omar Invented', employeeCode: 'EMP-0003' } }),
    person({ key: 'e', zohoName: 'Nadia Off', lineId: null, employee: { id: 'e4', fullNameEn: 'Nadia Off', employeeCode: 'EMP-0004' } }),
    person({ key: 'f', zohoName: 'Karim Skipped', match: 'skipped', employee: null, month: null }),
    person({ key: 'g', zohoName: 'Cleo Chief', confidential: true, editable: false, employee: { id: 'e5', fullNameEn: 'Cleo Chief', employeeCode: 'EMP-0005' } }),
  ];

  it('puts each person in their section: to confirm, not found, matched (by employee), skipped', () => {
    const s = reviewSections(people);
    expect(s.toConfirm.map((p) => p.key)).toEqual(['a']);
    expect(s.notFound.map((p) => p.key)).toEqual(['b']);
    expect(s.matched.map((p) => p.employee?.fullNameEn)).toEqual(['Cleo Chief', 'Nadia Off', 'Omar Invented', 'Rania Invented']);
    expect(s.skipped.map((p) => p.key)).toEqual(['f']);
  });

  it('applies only those matched once, on the run and the user’s to fill, and says why the others aren’t', () => {
    expect(applicable(people).map((p) => p.key)).toEqual(['c']);
    expect(applyConfirmText({ people })).toBe('Fill the worked hours, no-show days and permission hours of 1 line from Zoho People? What was typed on that line is replaced.');
    expect(notAppliedReason(people[3], true)).toBe('Matched twice: choose who is who before applying.');
    expect(notAppliedReason(people[4], true)).toBe('Not on this payroll: refresh the payroll once their contract is signed.');
    expect(notAppliedReason(people[6], true)).toBe('C-level: the CEO fills their line.');
    expect(notAppliedReason(people[2], true)).toBeNull();
    expect(notAppliedReason(people[0], true)).toBeNull();
  });

  it('counts each section, the hidden C-level people with the matched', () => {
    expect(countChips({ counts: { matched: 4, toConfirm: 1, notFound: 1, skipped: 1, notOnRun: 1 }, hidden: { count: 2, label: '' } }).map((c) => [c.label, c.count])).toEqual([
      ['Matched', 6],
      ['To confirm', 1],
      ['Not found', 1],
      ['Skipped', 1],
      ['Not on this payroll', 1],
    ]);
  });

  it('says where the permission hours come from', () => {
    expect(permissionText(MONTH)).toBe('2:00 from Zoho');
    expect(permissionText({ permissionHours: null, permissionFrom: 'system' })).toBe('The requests approved in the system (the line has them)');
    expect(permissionText({ permissionHours: null, permissionFrom: null })).toBe('None');
  });

  it('shows a day’s check-in and check-out on Cairo’s clock, and its tone', () => {
    // 07:23Z is 10:23 in Cairo on summer time (September 2026)
    expect(checkTimesText({ checkIn: '2026-09-01T07:23:00.000Z', checkOut: '2026-09-01T15:31:00.000Z' })).toBe('10:23 AM – 6:31 PM');
    expect(checkTimesText({ checkIn: '2026-09-01T07:23:00.000Z', checkOut: null })).toBe('10:23 AM – no check-out');
    expect(checkTimesText({ checkIn: null, checkOut: null })).toBe('No check-in');
    expect([dayTone('absent'), dayTone('zoho_leave'), dayTone('worked')]).toEqual(['danger', 'warn', null]);
  });

  it('reads a person’s choice: an employee, skip, or back to the match by name', () => {
    const fd = (o: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(o)) f.set(k, v);
      return f;
    };
    expect(personChoice(fd({ key: 'a', employeeId: '00000000-0000-4000-8000-000000000001' }))).toEqual({ key: 'a', employeeId: '00000000-0000-4000-8000-000000000001' });
    expect(personChoice(fd({ key: 'a', choice: 'skip' }))).toEqual({ key: 'a', skipped: true });
    expect(personChoice(fd({ key: 'a', choice: 'undo' }))).toEqual({ key: 'a', employeeId: null, skipped: false });
    expect(personChoice(fd({ key: 'a', employeeId: 'x' }))).toBeNull();
    expect(personChoice(fd({ employeeId: '00000000-0000-4000-8000-000000000001' }))).toBeNull();
  });
});
