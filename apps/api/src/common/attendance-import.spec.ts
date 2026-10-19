import {
  attendanceMonth,
  figuresBefore,
  importedInputRefusal,
  importedInputsChanged,
  matchPerson,
  nameKey,
  nameSimilarity,
  nameWords,
  OFFICE_ADDRESS_DEFAULTS,
  officeAddressesProblems,
  placeOf,
  wordSound,
  zohoStatusKind,
  zonedMoment,
  type AttendanceMonthInput,
  type ImportedDay,
} from '@trendlix/shared';

// Attendance from Zoho People (owner, 19 October 2026: "Import Zoho now, replace it later"): office or remote, people
// matched by name, and a person's month by the system's rules (packages/shared attendance-import.ts). Every name and
// place here is invented.

const at = (day: string, time: string) => new Date(zonedMoment(day, time)).toISOString();

describe('office or remote', () => {
  it('is office at Al Doctor Al Mahrouqi Street 13, 15 or 17, or Trendlix; remote anywhere else; none without a place', () => {
    const office = (n: number) => `${n}, Al Doctor Al Mahrouqi Street, El Golf, Nasr City, Cairo, 11765, Egypt`;
    expect(placeOf(office(15), null, OFFICE_ADDRESS_DEFAULTS)).toBe('office');
    expect(placeOf(office(13), null, OFFICE_ADDRESS_DEFAULTS)).toBe('office');
    expect(placeOf(office(17), null, OFFICE_ADDRESS_DEFAULTS)).toBe('office');
    expect(placeOf(`Trendlix, ${office(15)}`, null, OFFICE_ADDRESS_DEFAULTS)).toBe('office');
    expect(placeOf('TRENDLIX HQ', null, OFFICE_ADDRESS_DEFAULTS)).toBe('office');
    // another number on the street, and a number that only ends like the office's
    expect(placeOf(office(21), null, OFFICE_ADDRESS_DEFAULTS)).toBe('remote');
    expect(placeOf(office(115), null, OFFICE_ADDRESS_DEFAULTS)).toBe('remote');
    expect(placeOf('7, Invented Street, Maadi, Cairo', null, OFFICE_ADDRESS_DEFAULTS)).toBe('remote');
    // the check-out's place when the check-in has none
    expect(placeOf('-', office(15), OFFICE_ADDRESS_DEFAULTS)).toBe('office');
    expect(placeOf(' ', '', OFFICE_ADDRESS_DEFAULTS)).toBeNull();
    expect(placeOf(office(15), null, [])).toBe('remote');
  });

  it('takes HR’s office addresses: at most 20, each 2 to 120 characters, none twice', () => {
    expect(officeAddressesProblems([...OFFICE_ADDRESS_DEFAULTS])).toEqual([]);
    expect(officeAddressesProblems(['Trendlix', 'trendlix'])).toEqual(['"trendlix" is there twice: keep it once.']);
    expect(officeAddressesProblems(['x'])).toEqual(['Enter each office address as 2 to 120 characters, e.g. 15, Al Doctor Al Mahrouqi Street.']);
    expect(officeAddressesProblems(Array.from({ length: 21 }, (_, i) => `Office ${i}`))).toEqual(['Enter at most 20 office addresses.']);
  });
});

describe('matching people by name', () => {
  it('writes a name alike whatever its case, spaces and punctuation, and its common spellings', () => {
    expect(nameKey('  Mohammed   EL-Sayed ')).toBe('mohamed elsayed');
    expect(nameKey('Muhammad Al Sayed')).toBe('mohamed elsayed');
    expect(nameKey('Abd El Rahman Youssef')).toBe(nameKey('Abdulrahman Yousef'));
    expect(nameKey('Abdel-Rahman Yusuf')).toBe('abdelrahman youssef');
    expect(nameKey('Abd Allah Magdi')).toBe('abdallah magdy');
    expect(nameWords('Mina Gerges')).toEqual(nameWords('Mina Girgis'));
    expect(wordSound('gerges')).toBe(wordSound('guirguis'));
  });

  it('says how alike two names are, the first names first', () => {
    expect(nameSimilarity('Rania Samir Invented', 'Rania Samir Invented')).toBe(1);
    expect(nameSimilarity('Rania Samir Gerges', 'Rania Samir Fawzy Botros Girgis')).toBe(0.75);
    expect(nameSimilarity('Rania Samir', 'Dalia Samir')).toBe(0);
  });

  const employees = [
    { id: 'e1', fullNameEn: 'Rania Samir Fawzy Girgis', zohoPeopleId: null },
    { id: 'e2', fullNameEn: 'Mohamed Elsayed', zohoPeopleId: null },
    { id: 'e3', fullNameEn: 'Omar Invented', zohoPeopleId: '903' },
    { id: 'e4', fullNameEn: 'Dalia Samir', zohoPeopleId: null },
  ];

  it('matches by the remembered Zoho ID first, then the same name', () => {
    expect(matchPerson({ zohoId: '903', name: 'Someone Else Entirely' }, employees)).toEqual({ kind: 'linked', employeeId: 'e3', candidates: [] });
    expect(matchPerson({ zohoId: '904', name: 'Muhammad El-Sayed' }, employees)).toEqual({ kind: 'exact', employeeId: 'e2', candidates: [] });
  });

  it('takes the common spellings as the same name (Gerges and Girgis), asks HR about a close one, finds none for a stranger', () => {
    expect(matchPerson({ zohoId: '905', name: 'Rania Samir Fawzy Gerges' }, employees)).toEqual({ kind: 'exact', employeeId: 'e1', candidates: [] });
    // spelt otherwise again: close, for HR to confirm ("Did you mean …?")
    expect(matchPerson({ zohoId: '905', name: 'Rania Samyr Fawzi Girges' }, employees)).toEqual({ kind: 'close', employeeId: null, candidates: [{ id: 'e1', similarity: 1 }] });
    expect(matchPerson({ zohoId: '905', name: 'Rania Samir Gerges' }, employees).candidates).toEqual([{ id: 'e1', similarity: 0.86 }]);
    expect(matchPerson({ zohoId: null, name: 'Karim Unknown' }, employees)).toEqual({ kind: 'none', employeeId: null, candidates: [] });
  });

  it('asks HR to choose between two people of the same name', () => {
    const twins = [...employees, { id: 'e5', fullNameEn: 'Mohammed El Sayed', zohoPeopleId: null }];
    const m = matchPerson({ zohoId: null, name: 'Mohamed Elsayed' }, twins);
    expect(m.kind).toBe('close');
    expect(m.candidates.map((c) => c.id).sort()).toEqual(['e2', 'e5']);
  });
});

describe('Zoho’s statuses', () => {
  it('reads present, leave, weekend, holiday and absent', () => {
    expect(['Present', 'Present / Regularized', 'On Duty'].map(zohoStatusKind)).toEqual(['present', 'present', 'present']);
    expect(['Annual Leave', 'Sick Leave', 'leave'].map(zohoStatusKind)).toEqual(['leave', 'leave', 'leave']);
    expect(['Weekend', 'Holiday', 'Absent', '', 'Half day'].map(zohoStatusKind)).toEqual(['weekend', 'holiday', 'absent', 'other', 'other']);
  });
});

describe('a person’s month', () => {
  const day = (date: string, more: Partial<ImportedDay> = {}): ImportedDay => ({ date, checkIn: null, checkOut: null, place: null, zohoStatus: null, permissionHours: 0, ...more });
  const worked = (date: string, from: string, to: string | null, more: Partial<ImportedDay> = {}) =>
    day(date, { checkIn: at(date, from), checkOut: to ? at(date, to) : null, place: 'office', zohoStatus: 'Present', ...more });
  // the MORNING shift: 9 hours within 9:00–19:00, Sunday to Thursday
  const MORNING = { startTime: '09:00', endTime: '19:00', hoursPerDay: 9, workingDays: [0, 1, 2, 3, 4] };
  const input = (days: ImportedDay[], more: Partial<AttendanceMonthInput> = {}): AttendanceMonthInput => ({
    month: '2026-09',
    days,
    shift: MORNING,
    holidays: ['2026-09-08'],
    leaveDays: ['2026-09-07'],
    employedFrom: '2024-01-01',
    employedTo: '2026-09-10',
    systemPermissionHours: 0,
    permissionHoursPerMonth: 4,
    ...more,
  });
  const SEPTEMBER = [
    worked('2026-09-01', '10:23', '18:31', { permissionHours: 1.5 }), // Tuesday: 8:08
    worked('2026-09-02', '08:30', '19:30', { place: 'remote', permissionHours: 3 }), // 9:00 within the window, at most 9
    day('2026-09-03', { zohoStatus: 'Absent' }), // Thursday, no check-in: absent
    day('2026-09-04', { zohoStatus: 'Weekend' }), // Friday: a rest day
    day('2026-09-06', { zohoStatus: 'Annual Leave' }), // leave in Zoho, none in the system
    day('2026-09-07', { zohoStatus: 'Absent' }), // leave in the system
    day('2026-09-08', { zohoStatus: 'Absent' }), // an official holiday
    worked('2026-09-09', '09:10', null), // a check-in without a check-out
    day('2026-09-10', { zohoStatus: 'Present' }), // Zoho says present, no check-in
    worked('2026-08-31', '09:00', '18:00'), // another month's
  ];

  it('works each day out by the system’s rules: hours by the shift, absences, rest, holidays, leave', () => {
    const m = attendanceMonth(input(SEPTEMBER));
    expect(m.days.map((d) => [d.date, d.status, d.hoursCounted])).toEqual([
      ['2026-09-01', 'worked', 8 + 8 / 60],
      ['2026-09-02', 'worked', 9],
      ['2026-09-03', 'absent', 0],
      ['2026-09-04', 'rest', 0],
      ['2026-09-06', 'zoho_leave', 0],
      ['2026-09-07', 'leave', 0],
      ['2026-09-08', 'holiday', 0],
      ['2026-09-09', 'worked', 0],
      ['2026-09-10', 'no_check_in', 0],
    ]);
    expect(m).toMatchObject({ daysWorked: 3, officeDays: 2, remoteDays: 1, absentDays: 1, zohoLeaveDays: ['2026-09-06'], missingDays: [], outside: 1 });
    expect(m.hoursCounted).toBeCloseTo(17 + 8 / 60, 9);
    expect(m.warnings).toEqual([
      "1 day is of another month than this payroll's: left out.",
      '1 day has a check-in without a check-out: no hours counted for it.',
      '1 day Zoho says present or on duty without a check-in: not counted as absent, nor any hours.',
      "Zoho has 4:30 of permission this month: 4:00 counted, the month's allowance.",
    ]);
  });

  it('takes Zoho’s permission within the allowance only when the system has none approved', () => {
    expect(attendanceMonth(input(SEPTEMBER))).toMatchObject({ permissionHours: 4, permissionFrom: 'zoho' });
    expect(attendanceMonth(input(SEPTEMBER.slice(0, 1)))).toMatchObject({ permissionHours: 1.5, permissionFrom: 'zoho' });
    const system = attendanceMonth(input(SEPTEMBER, { systemPermissionHours: 2 }));
    expect(system).toMatchObject({ permissionHours: null, permissionFrom: 'system' });
    expect(system.warnings).toContain("The permission requests approved in the system count this month, not Zoho's permission column.");
    expect(attendanceMonth(input([worked('2026-09-01', '09:00', '18:00')]))).toMatchObject({ permissionHours: null, permissionFrom: null });
  });

  it('says which working days have no row, and counts only the days employed', () => {
    const m = attendanceMonth(input([worked('2026-09-01', '09:00', '18:00')], { employedTo: null }));
    // September 2026 from the 2nd: its Sundays to Thursdays, less the holiday on the 8th and the leave on the 7th
    expect(m.missingDays[0]).toBe('2026-09-02');
    expect(m.missingDays).not.toContain('2026-09-07');
    expect(m.missingDays).not.toContain('2026-09-08');
    expect(m.warnings).toContain(`${m.missingDays.length} working days have no row in the files: not counted as absent.`);
    expect(attendanceMonth(input([worked('2026-09-01', '09:00', '18:00')], { employedFrom: '2026-09-02', employedTo: '2026-09-02' })).days).toEqual([]);
  });

  it('counts check-in to check-out without a shift, and says so', () => {
    const m = attendanceMonth(input([worked('2026-09-01', '07:00', '19:30')], { shift: null, employedTo: '2026-09-01' }));
    expect(m.hoursCounted).toBe(12.5);
    expect(m.warnings[0]).toBe('No shift on the employment: the hours are counted from check-in to check-out, Sunday to Thursday taken as the working days.');
  });
});

describe('the line’s mark of the import (owner, 19 October 2026: "imported data shouldn\'t be editable")', () => {
  const mark = { source: 'zoho' as const, importId: 'i1', at: '2026-10-19T10:00:00.000Z', fields: ['workedHours' as const, 'noShowDays' as const, 'permissionHours' as const] };

  it('holds the inputs it filled: a change to one of them is refused, the others go ahead', () => {
    expect(importedInputsChanged(mark, ['workedHours', 'expectedHours'])).toEqual(['workedHours']);
    expect(importedInputsChanged(mark, ['expectedHours', 'leaveDays'])).toEqual([]);
    expect(importedInputsChanged({ ...mark, fields: ['workedHours'] }, ['noShowDays'])).toEqual([]);
    expect(importedInputsChanged(null, ['workedHours'])).toEqual([]);
  });

  it('says why, with the day it was applied in Cairo and how to change it', () => {
    expect(importedInputRefusal('workedHours', 'Rania Girgis', mark.at)).toBe(
      'Worked hours for Rania Girgis came from the Zoho import of 19/10/2026: import the month again to change them, or undo that import on its review.',
    );
    // 11:30 PM UTC is the next day in Cairo
    expect(importedInputRefusal('noShowDays', 'Omar', '2026-10-19T22:30:00.000Z')).toContain('No-show days for Omar came from the Zoho import of 20/10/2026');
  });

  it('keeps what the inputs were before it, for Undo: HR’s figures, and for those an earlier import filled what they were before that one', () => {
    expect(figuresBefore(mark.fields, { workedHours: 150, noShowDays: null }, null)).toEqual({ workedHours: 150, noShowDays: null, permissionHours: null });
    const earlier = { ...mark, importId: 'i0', fields: ['workedHours' as const, 'noShowDays' as const], before: { workedHours: 120, noShowDays: 1 } };
    expect(figuresBefore(mark.fields, { workedHours: 170, noShowDays: 0, permissionHours: 2 }, earlier)).toEqual({ workedHours: 120, noShowDays: 1, permissionHours: 2 });
    // a mark from before Undo has nothing kept: those become empty
    expect(figuresBefore(['workedHours'], { workedHours: 170 }, { ...mark, before: undefined })).toEqual({ workedHours: null });
  });
});

describe('a person’s month with the shift’s grace (owner, 19 October 2026: "if the employee checked in 10:15 he can check out till 7:15 and the 9 hours are counted")', () => {
  const day = (date: string, from: string, to: string): ImportedDay => ({ date, checkIn: at(date, from), checkOut: at(date, to), place: 'office', zohoStatus: 'Present', permissionHours: 0 });
  const month = (graceMinutes: number | null) =>
    attendanceMonth({
      month: '2026-09',
      days: [day('2026-09-01', '10:15', '19:15'), day('2026-09-02', '10:30', '19:30'), day('2026-09-03', '09:00', '18:00')],
      shift: { startTime: '09:00', endTime: '19:00', hoursPerDay: 9, workingDays: [0, 1, 2, 3, 4], graceMinutes },
      holidays: [],
      leaveDays: [],
      employedFrom: '2026-09-01',
      employedTo: '2026-09-03',
      systemPermissionHours: 0,
      permissionHoursPerMonth: 4,
    });

  it('counts each day until 7:15 PM, at most 9 hours', () => {
    expect(month(15).days.map((d) => d.hoursCounted)).toEqual([9, 8.75, 9]);
    expect(month(15).hoursCounted).toBe(26.75);
    // without grace, until 7:00 PM
    expect(month(0).days.map((d) => d.hoursCounted)).toEqual([8.75, 8.5, 9]);
  });
});
