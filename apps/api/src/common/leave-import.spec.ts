import {
  ALREADY_AT_BALANCE,
  alreadyImportedText,
  balanceRowProblems,
  belowZeroText,
  daysMismatchText,
  defaultZohoType,
  holidaysHint,
  importDate,
  importedLeaveFindings,
  importNumber,
  importPersonKey,
  importsLeaveFor,
  isHalfDays,
  isZohoLeaveHeadings,
  LAW_LEAVE_TYPES,
  matchImportPerson,
  matchNeedsConfirming,
  monthDays,
  monthsOf,
  noShowsToLeaveText,
  notInPayrollText,
  rowNoShowsText,
  openingAdjustment,
  sameFileText,
  signedDays,
  ZOHO_COMP_OFF_NOTE,
  ZOHO_WFH_NOTE,
  zohoApproval,
  zohoDayDifferences,
  zohoDayDifferencesText,
  zohoEmployee,
  zohoLeaveDays,
  withLeaveNow,
  type ImportLeaveType,
  type SourcedDay,
  type LeaveTypeRules,
} from '@trendlix/shared';

// Importing leave in bulk (owner, 21 October 2026: "how to import bulk leaves?"; "Both" and "Our Excel template"; Zoho
// People's leave export too, and "make sure there will be no duplicates from the previous imported files"): reading a
// cell's text and Zoho's columns, the default types, matching people, a row's checks (problems block, the type's limits
// only warn on history) and the balance's figures. Every name is invented.

const law = (key: string): LeaveTypeRules => {
  const t = LAW_LEAVE_TYPES.find((x) => x.key === key)!;
  return { ...t };
};

const TYPES: ImportLeaveType[] = [
  { id: 't-annual', key: 'annual', kind: 'annual', nameEn: 'Annual leave', active: true },
  { id: 't-casual', key: 'casual', kind: 'casual', nameEn: 'Casual leave', active: true },
  { id: 't-sick', key: 'sick', kind: 'sick', nameEn: 'Sick leave', active: true },
  { id: 't-unpaid', key: 'unpaid', kind: 'unpaid', nameEn: 'Unpaid leave', active: true },
  { id: 't-childcare', key: 'childcare', kind: 'childcare', nameEn: 'Childcare leave', active: false },
];

describe('reading a cell', () => {
  it('reads a day written DD/MM/YYYY, YYYY-MM-DD or as Zoho writes it, Arabic digits too; null for anything else', () => {
    expect(importDate('05/03/2026')).toBe('2026-03-05');
    expect(importDate('5-3-2026')).toBe('2026-03-05');
    expect(importDate('2026-10-21')).toBe('2026-10-21');
    expect(importDate('21-Oct-2026')).toBe('2026-10-21');
    expect(importDate('٢١/١٠/٢٠٢٦')).toBe('2026-10-21');
    expect(importDate('21/10/2026 00:00')).toBe('2026-10-21');
    expect(importDate('31/02/2026')).toBeNull();
    expect(importDate('next week')).toBeNull();
    expect(importDate('')).toBeNull();
  });

  it('reads a number with a trailing space, a comma or Arabic digits', () => {
    expect(importNumber('1.0 ')).toBe(1);
    expect(importNumber('7,5')).toBe(7.5);
    expect(importNumber('٢')).toBe(2);
    expect(importNumber('two')).toBeNull();
    expect(isHalfDays(2.5)).toBe(true);
    expect(isHalfDays(2.3)).toBe(false);
  });
});

describe('Zoho People’s leave export', () => {
  it('is told by its headings', () => {
    expect(isZohoLeaveHeadings(['ZOHO_LINK_ID', 'Employee ID', 'Leave type', 'From', 'To', 'Days/Hours Taken', 'Approval Status', 'Date - Duration and Session'])).toBe(true);
    expect(isZohoLeaveHeadings(['Employee code', 'Employee name', 'Leave type', 'From', 'To', 'Days', 'Notes'])).toBe(false);
  });

  it('reads the Employee ID as the name and the Zoho number ending it; a number inside it is a hint only', () => {
    expect(zohoEmployee('Rana Adel Fawzy 401')).toEqual({ name: 'Rana Adel Fawzy', zohoId: '401', hint: null });
    expect(zohoEmployee('  Omar   Samy  12  ')).toEqual({ name: 'Omar Samy', zohoId: '12', hint: null });
    expect(zohoEmployee('Mona Saad Ali 10023 - HRM')).toEqual({ name: 'Mona Saad Ali', zohoId: null, hint: '10023' });
    expect(zohoEmployee('Karim Nabil')).toEqual({ name: 'Karim Nabil', zohoId: null, hint: null });
  });

  it('reads each day’s duration: a full day, a half (with its session), a holiday or weekend', () => {
    expect(zohoLeaveDays('{Date:21-Oct-2026,Duration:Full Day},{Date:22-Oct-2026,Duration:Holiday/Weekend}')).toEqual([
      { date: '2026-10-21', kind: 'full', portion: 1, session: null },
      { date: '2026-10-22', kind: 'off', portion: 0, session: null },
    ]);
    expect(zohoLeaveDays('{Date:22-Jun-2026,Duration:Half Day,Session:2nd Half}')).toEqual([{ date: '2026-06-22', kind: 'half', portion: 0.5, session: '2nd Half' }]);
    expect(zohoLeaveDays('')).toBeNull();
    expect(zohoLeaveDays('{Date:22-Jun-2026,Duration:2 Hrs}')).toBeNull();
    expect(zohoLeaveDays('{Date:soon,Duration:Full Day}')).toBeNull();
  });

  it('reads the five statuses: Approved and System Approved are approved', () => {
    expect(zohoApproval('Approved')).toBe('approved');
    expect(zohoApproval('System Approved')).toBe('approved');
    expect(zohoApproval('Pending')).toBe('pending');
    expect(zohoApproval('Rejected')).toBe('rejected');
    expect(zohoApproval('Cancelled')).toBe('cancelled');
    expect(zohoApproval('Maybe')).toBeNull();
  });

  it('maps its types by default: annual, sick, casual to the law’s; Working from home and Compensatory Off skipped, unless a type is added for the latter', () => {
    expect(defaultZohoType('Annual Leave', TYPES)).toEqual({ typeId: 't-annual', note: null });
    expect(defaultZohoType('Sick Leave', TYPES)).toEqual({ typeId: 't-sick', note: null });
    expect(defaultZohoType('Casual leave (Exceptional)', TYPES)).toEqual({ typeId: 't-casual', note: null });
    expect(defaultZohoType('Working from home - Bi Weekly', TYPES)).toEqual({ typeId: null, note: ZOHO_WFH_NOTE });
    expect(defaultZohoType('Compensatory Off', TYPES)).toEqual({ typeId: null, note: ZOHO_COMP_OFF_NOTE });
    const withOwn = [...TYPES, { id: 't-comp', key: 'custom-compensatory-day-off', kind: 'custom', nameEn: 'Compensatory day off', active: true }];
    expect(defaultZohoType('Compensatory Off', withOwn)).toEqual({ typeId: 't-comp', note: null });
    // a type turned off isn't chosen; one of the same name is
    expect(defaultZohoType('Childcare leave', TYPES).typeId).toBeNull();
    expect(defaultZohoType('Marriage', TYPES).typeId).toBeNull();
  });
});

describe('matching people', () => {
  const employees = [
    { id: 'e1', employeeCode: 'EMP-0001', fullNameEn: 'Rana Adel Fawzy', zohoPeopleId: '401' },
    { id: 'e2', employeeCode: 'EMP-0002', fullNameEn: 'Abdel Rahman Samy', zohoPeopleId: null },
    { id: 'e3', employeeCode: 'EMP-0003', fullNameEn: 'Mohamed Ali Hassan', zohoPeopleId: null },
  ];

  it('by code first, whatever the case; else by name, a template’s name to confirm, a Zoho row’s name written alike matched', () => {
    expect(matchImportPerson({ code: 'emp-0002', name: 'Someone Else', zohoId: null }, employees)).toMatchObject({ kind: 'code', employeeId: 'e2' });
    const byName = matchImportPerson({ code: null, name: 'Abd El-Rahman Samy', zohoId: null }, employees);
    expect(byName).toMatchObject({ kind: 'exact', employeeId: 'e2' });
    expect(matchNeedsConfirming(byName.kind, 'template')).toBe(true);
    expect(matchNeedsConfirming(byName.kind, 'zoho')).toBe(false);
    // an unknown code falls back on the name
    expect(matchImportPerson({ code: 'EMP-9999', name: 'Rana Adel Fawzy', zohoId: null }, employees)).toMatchObject({ kind: 'exact', employeeId: 'e1' });
  });

  it('by the remembered Zoho id; a close name is to confirm; else not found', () => {
    expect(matchImportPerson({ code: null, name: 'R. Fawzy', zohoId: '401' }, employees)).toMatchObject({ kind: 'linked', employeeId: 'e1' });
    const close = matchImportPerson({ code: null, name: 'Mohammed Aly', zohoId: null }, employees);
    expect(close.kind).toBe('close');
    expect(close.candidates[0].id).toBe('e3');
    expect(matchNeedsConfirming('close', 'zoho')).toBe(true);
    expect(matchImportPerson({ code: null, name: 'Nobody Known', zohoId: '999' }, employees)).toMatchObject({ kind: 'none', employeeId: null });
  });

  it('keys a person by code, else Zoho id, else name', () => {
    expect(importPersonKey({ code: 'emp-1', name: 'X', zohoId: '4' })).toBe('code:EMP-1');
    expect(importPersonKey({ code: null, name: 'X', zohoId: '4' })).toBe('zoho:4');
    expect(importPersonKey({ code: null, name: 'Abd El Rahman', zohoId: null })).toBe(importPersonKey({ code: null, name: 'Abdelrahman', zohoId: null }));
  });

  it('HR imports for everyone but the C-level people, the CEO for those, HR with Super Admin for both', () => {
    expect(importsLeaveFor({ roles: ['hr'] }, false)).toBe(true);
    expect(importsLeaveFor({ roles: ['hr'] }, true)).toBe(false);
    expect(importsLeaveFor({ roles: ['ceo'] }, true)).toBe(true);
    expect(importsLeaveFor({ roles: ['ceo'] }, false)).toBe(false);
    expect(importsLeaveFor({ roles: ['hr', 'super_admin'] }, true)).toBe(true);
    expect(importsLeaveFor({ roles: ['finance'] }, false)).toBe(false);
  });
});

describe('a leave row’s checks', () => {
  const history = { usedInYear: 0, timesInService: 0, serviceMonths: 24, gender: 'male' as const, usableFrom: '2026-01-01' };
  const input = { startDate: '2026-03-01', endDate: '2026-03-01', halfDay: false, days: 1, fileDays: null, halfDayRefused: null };

  it('problems: no working days, a yearly type running into the next year, the other gender', () => {
    expect(importedLeaveFindings({ ...input, days: 0 }, law('annual'), history).problems).toEqual(['These dates have no working days: rest days and official holidays aren’t counted as leave.']);
    expect(importedLeaveFindings({ ...input, endDate: '2027-01-02', days: 3 }, law('annual'), history).problems[0]).toMatch(/can’t run into the next one/);
    expect(importedLeaveFindings(input, law('maternity'), history).problems).toEqual(['Maternity leave is for female employees only.']);
    expect(importedLeaveFindings(input, law('maternity'), { ...history, gender: null }).problems[0]).toMatch(/record the employee’s gender/);
  });

  it('only warns on history: casual leave’s 2 days at a time and 7 a year, sick leave’s document, annual leave before six months', () => {
    const casual = importedLeaveFindings({ ...input, endDate: '2026-03-03', days: 3 }, law('casual'), { ...history, usedInYear: 6 });
    expect(casual.problems).toEqual([]);
    expect(casual.warnings).toEqual(['Casual leave is at most 2 days at a time; this is 3 days.', 'Takes casual leave to 9 days in 2026, over its 7 days a year.']);
    expect(importedLeaveFindings(input, law('sick'), history)).toEqual({ problems: [], warnings: ['Sick leave needs a document: imported as history without one.'] });
    expect(importedLeaveFindings(input, law('annual'), { ...history, usableFrom: '2026-05-01' }).warnings).toEqual(['Annual leave can be used from 01/05/2026, six months after joining; this was before.']);
    expect(importedLeaveFindings(input, law('hajj'), { ...history, serviceMonths: 12, timesInService: 1 }).warnings).toEqual([
      'Hajj or Jerusalem visit needs 5 years of service first; there were 1 year by its first day.',
      'Hajj or Jerusalem visit can be taken once in service: this is time 2.',
    ]);
  });

  it('says the file’s days against the system’s, and the half day not kept', () => {
    const f = importedLeaveFindings({ ...input, endDate: '2026-03-03', days: 2, fileDays: 3, halfDayRefused: 'Sick leave can’t be taken as a half day: counted as a whole day.' }, law('annual'), history);
    expect(f.warnings).toEqual(['Sick leave can’t be taken as a half day: counted as a whole day.', daysMismatchText(3, 2, false)]);
    expect(daysMismatchText(3, 2, false)).toBe('The file says 3 days; the system counts 2 days (in working days, without rest days and official holidays), and those are used.');
  });

  it('tells Zoho’s holidays and weekends from the system’s working days, and the hint to set the year’s holidays', () => {
    const days = zohoLeaveDays('{Date:01-Oct-2026,Duration:Full Day},{Date:02-Oct-2026,Duration:Holiday/Weekend},{Date:06-Oct-2026,Duration:Holiday/Weekend}')!;
    // the system counts 01/10 and 06/10 (no holiday set on 6 October), not Friday 02/10
    const diff = zohoDayDifferences(days, (d) => d !== '2026-10-02');
    expect(diff).toEqual({ offInZoho: ['2026-10-06'], offHere: [] });
    expect(zohoDayDifferencesText(diff)).toBe('06/10/2026 is a holiday or weekend in Zoho, a working day here.');
    expect(zohoDayDifferencesText({ offInZoho: [], offHere: [] })).toBeNull();
    expect(holidaysHint([2026, 2026])).toMatch(/^Check that 2026’s official holidays are set in Organization → Holidays before applying/);
  });

  it('warns of a balance below 0, as history', () => {
    expect(belowZeroText('Annual leave', -6, 15)).toBe('Brings annual leave to −6 days (entitlement 15).');
  });
});

describe('a balance row', () => {
  it('needs a figure of 0 or more in half days, and As of in the current year or a year of the leave imported', () => {
    const ok = { balance: 7.5, balanceText: '7.5', asOf: '2026-10-01', asOfText: '01/10/2026' };
    expect(balanceRowProblems(ok, 2026, [])).toEqual([]);
    expect(balanceRowProblems({ ...ok, asOf: '2025-12-31' }, 2026, [2025])).toEqual([]);
    expect(balanceRowProblems({ ...ok, asOf: '2024-12-31' }, 2026, [2025])).toEqual(['As of must be in 2025 or 2026: the current year, or a year of the leave in the file.']);
    expect(balanceRowProblems({ ...ok, balance: -1 }, 2026, [])).toEqual(['A balance can’t be below 0: enter 0 or more days.']);
    expect(balanceRowProblems({ ...ok, balance: 2.3 }, 2026, [])).toEqual(['Enter the balance in whole or half days, e.g. 7.5.']);
    expect(balanceRowProblems({ ...ok, balance: null, balanceText: 'lots' }, 2026, [])[0]).toMatch(/isn’t a number of days/);
    expect(balanceRowProblems({ ...ok, asOf: null, asOfText: '' }, 2026, [])).toEqual(['Enter the day the balance is as of (As of), as DD/MM/YYYY.']);
  });

  it('sets the balance with the difference, in half days: none when it is at the figure already', () => {
    expect(openingAdjustment(12, 21)).toBe(-9);
    expect(openingAdjustment(7.5, 5)).toBe(2.5);
    expect(openingAdjustment(10, 10)).toBe(0);
    expect(signedDays(2.5)).toBe('+2.5 days');
    expect(signedDays(-1)).toBe('−1 day');
    expect(ALREADY_AT_BALANCE).toBe('Already at this balance: nothing to change.');
  });
});

describe('duplicates and the payroll', () => {
  it('says where a duplicate was imported from, and the same file again', () => {
    expect(alreadyImportedText('Leave 2026.xlsx', '2026-10-21T09:00:00.000Z')).toBe('Already imported from Leave 2026.xlsx, 21/10/2026.');
    expect(sameFileText('2026-10-21T09:00:00.000Z', 'Hala HR')).toBe('This file was already imported on 21/10/2026 by Hala HR.');
  });

  it('lists the months a leave is in, and says one past its draft counts it in no payroll', () => {
    expect(monthsOf('2026-11-28', '2027-01-03')).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(notInPayrollText('2026-10', 'approved')).toBe('Counted in no payroll: the October 2026 payroll is already approved.');
    expect(notInPayrollText('2026-10', 'pending_ceo')).toBe('Counted in no payroll: the October 2026 payroll is already with the CEO.');
    expect(notInPayrollText('2026-09', 'paid')).toBe('Counted in no payroll: the September 2026 payroll is already paid.');
  });
});

describe('a day of approved leave is never a no-show (21 October 2026)', () => {
  const day = (over: Partial<SourcedDay>): SourcedDay => ({
    date: '2026-09-14',
    status: 'absent',
    checkIn: null,
    checkOut: null,
    place: null,
    zohoStatus: 'Absent',
    permissionHours: 0,
    hoursCounted: 0,
    source: 'zoho',
    ...over,
  });

  it('a Zoho day absent, present without a check-in or Zoho’s own leave is leave once leave is approved on it', () => {
    expect(withLeaveNow(day({}), true).status).toBe('leave');
    expect(withLeaveNow(day({ status: 'no_check_in', zohoStatus: 'Present' }), true).status).toBe('leave');
    expect(withLeaveNow(day({ status: 'zoho_leave', zohoStatus: 'Annual Leave' }), true).status).toBe('leave');
    expect(withLeaveNow(day({}), false).status).toBe('absent');
  });

  it('a Zoho day is what it was kept as once its leave is gone', () => {
    expect(withLeaveNow(day({}), false).status).toBe('absent');
    expect(withLeaveNow(day({ status: 'leave' }), false).status).toBe('leave');
  });

  it('leaves a day with a check-in, a rest day, a holiday, and the system’s own days as they are', () => {
    expect(withLeaveNow(day({ status: 'worked', checkIn: '2026-09-14T06:00:00.000Z' }), true).status).toBe('worked');
    expect(withLeaveNow(day({ status: 'rest' }), true).status).toBe('rest');
    expect(withLeaveNow(day({ status: 'holiday' }), true).status).toBe('holiday');
    expect(withLeaveNow(day({ source: 'system' }), true).status).toBe('absent');
  });

  it('reads a month’s kept days with the leave as it is now', () => {
    const days = monthDays([day({}), day({ date: '2026-09-15' })], {
      month: '2026-09',
      today: '2026-10-21',
      checkInFrom: null,
      workingDays: null,
      holidays: [],
      leaveDays: ['2026-09-15'],
      employedFrom: '2026-01-01',
      employedTo: null,
    });
    expect(days.map((d) => d.status)).toEqual(['absent', 'leave']);
  });

  it('says how many no-shows the leave turns into leave', () => {
    expect(noShowsToLeaveText(3, 2)).toBe('These days were no-shows on a draft payroll and will count as leave once applied (a refresh of the payroll does the same): 3 days, 2 people.');
    expect(rowNoShowsText(1, '2026-09')).toBe('1 of its days is a no-show on the September 2026 draft payroll now: it counts as leave once applied, not a no-show.');
  });
});
