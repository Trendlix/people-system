import {
  attendanceDayView,
  attendanceFigures,
  attendanceLineInputs,
  checkInFlags,
  checkInPlace,
  checkInRefusal,
  dayFromPunches,
  daysByPrecedence,
  distanceMetres,
  expectedPlace,
  expectedPlaceText,
  importedInputRefusal,
  matchesAttendanceFilter,
  monthDays,
  nextPunch,
  officeLocationProblems,
  officeLocationSet,
  punchMessages,
  shiftDayOf,
  zonedMoment,
  type PunchLike,
  type SourcedDay,
} from '@trendlix/shared';

// Checking in on the system (owner, 19 October 2026, "Proceed with those": "Check-in through the system (phone or web
// with the office location check, or a device) to replace Zoho"; packages/shared check-in.ts): office, remote or unknown
// by the office's point and radius, the rules by work arrangement and their flags, a day from its punches, the working
// day of a punch on a night shift, who checks in, a month's days from every source with the days gone by without a
// check-in, and what a payroll line takes from them.

// the office, at an invented point in Cairo, and points around it
const OFFICE = { latitude: 30.0596, longitude: 31.3462, radiusMetres: 150 };
const NEAR = { latitude: 30.0601, longitude: 31.3465, accuracy: 18.4 }; // about 60 m away
const FAR = { latitude: 30.0444, longitude: 31.2357, accuracy: 25 }; // downtown, about 10 km away
// the MORNING shift: 9 hours within 9:00–19:00, 15 minutes' grace
const MORNING = { startTime: '09:00', endTime: '19:00', hoursPerDay: 9, graceMinutes: 15 };
const at = (day: string, time: string) => new Date(zonedMoment(day, time)).toISOString();
const punch = (kind: 'in' | 'out', day: string, time: string, more: Partial<PunchLike> = {}): PunchLike => ({ kind, at: at(day, time), place: 'office', ...more });

describe('where a check-in was', () => {
  it('measures the distance between two points in metres', () => {
    expect(distanceMetres(OFFICE, OFFICE)).toBe(0);
    expect(distanceMetres(OFFICE, NEAR)).toBeGreaterThan(50);
    expect(distanceMetres(OFFICE, NEAR)).toBeLessThan(70);
    expect(Math.round(distanceMetres(OFFICE, FAR) / 1000)).toBe(11);
  });

  it('is the office within the radius, remote outside it, keeping only the accuracy in whole metres', () => {
    expect(checkInPlace(NEAR, OFFICE)).toEqual({ place: 'office', accuracyMetres: 18 });
    expect(checkInPlace(FAR, OFFICE)).toEqual({ place: 'remote', accuracyMetres: 25 });
    // a radius that leaves the near point outside
    expect(checkInPlace(NEAR, { ...OFFICE, radiusMetres: 20 }).place).toBe('remote');
    expect(checkInPlace({ latitude: NEAR.latitude, longitude: NEAR.longitude }, OFFICE)).toEqual({ place: 'office', accuracyMetres: null });
  });

  it('is unknown when the location is refused or unavailable, isn’t a point, or the office’s point isn’t set', () => {
    expect(checkInPlace(null, OFFICE)).toEqual({ place: 'unknown', accuracyMetres: null });
    expect(checkInPlace({ latitude: 120, longitude: 31 }, OFFICE).place).toBe('unknown');
    expect(checkInPlace({ latitude: Number.NaN, longitude: 31 }, OFFICE).place).toBe('unknown');
    expect(checkInPlace(NEAR, { latitude: null, longitude: null, radiusMetres: 150 })).toEqual({ place: 'unknown', accuracyMetres: 18 });
  });

  it('checks the office’s location: both or neither, in range, the radius in whole metres from 20 to 5,000', () => {
    expect(officeLocationProblems(OFFICE)).toEqual([]);
    expect(officeLocationProblems({ latitude: null, longitude: null, radiusMetres: 150 })).toEqual([]);
    expect(officeLocationProblems({ latitude: 30, longitude: null, radiusMetres: 150 })).toEqual(["Enter both the office's latitude and longitude, or neither."]);
    expect(officeLocationProblems({ latitude: 91, longitude: 200, radiusMetres: 150 })).toHaveLength(2);
    expect(officeLocationProblems({ ...OFFICE, radiusMetres: 10 })[0]).toContain('from 20 to 5,000');
    expect(officeLocationProblems({ ...OFFICE, radiusMetres: 150.5 })).toHaveLength(1);
    expect(officeLocationSet(OFFICE)).toBe(true);
    expect(officeLocationSet({ latitude: null, longitude: 31 })).toBe(false);
  });
});

describe('the rules by work arrangement', () => {
  it('expects the office every day of an office arrangement, the office days of a hybrid one, anywhere else', () => {
    expect(expectedPlace('office', [], 3)).toBe('office');
    // hybrid at the office on Sunday and Tuesday
    expect(expectedPlace('hybrid', [0, 2], 0)).toBe('office');
    expect(expectedPlace('hybrid', [0, 2], 1)).toBe('anywhere');
    for (const a of ['wfh', 'outdoor', 'indoor_outdoor']) expect(expectedPlace(a, [], 0)).toBe('anywhere');
  });

  it('flags a check-in outside the office on an office day, or with its location unknown; never anywhere else', () => {
    expect(checkInFlags('office', 'office')).toEqual([]);
    expect(checkInFlags('office', 'remote')).toEqual(['outside_office']);
    expect(checkInFlags('office', 'unknown')).toEqual(['location_unknown']);
    expect(checkInFlags('anywhere', 'remote')).toEqual([]);
    expect(checkInFlags('anywhere', 'unknown')).toEqual([]);
  });

  it('tells the employee where they are expected', () => {
    expect(expectedPlaceText('office', 'office')).toBe('You work at the office: check in there.');
    expect(expectedPlaceText('hybrid', 'office')).toBe('Today is one of your office days: check in at the office.');
    expect(expectedPlaceText('hybrid', 'anywhere')).toBe('Today is a home day: check in wherever you work from.');
    expect(expectedPlaceText('wfh', 'anywhere')).toBe('You may check in wherever you work today.');
  });
});

describe('a day from its punches', () => {
  const day = '2026-10-18';

  it('is the first check-in to the last check-out, counted by the shift’s rule with the grace', () => {
    // in at 10:15, out for lunch, back, out at 19:20: counted 10:15 to 19:15, at most 9 hours
    const d = dayFromPunches(day, [punch('in', day, '10:15'), punch('out', day, '13:00'), punch('in', day, '14:00', { place: 'remote' }), punch('out', day, '19:20')], MORNING);
    expect(d).toEqual({ checkIn: at(day, '10:15'), checkOut: at(day, '19:20'), place: 'office', flags: [], hoursCounted: 9 });
    // 9:30 to 17:00: 7:30
    expect(dayFromPunches(day, [punch('out', day, '17:00'), punch('in', day, '09:30')], MORNING).hoursCounted).toBe(7.5);
  });

  it('keeps a check-in without a check-out and a check-out without a check-in, with no hours', () => {
    expect(dayFromPunches(day, [punch('in', day, '09:05')], MORNING)).toMatchObject({ checkIn: at(day, '09:05'), checkOut: null, hoursCounted: 0 });
    expect(dayFromPunches(day, [punch('out', day, '18:00', { place: 'remote' })], MORNING)).toMatchObject({ checkIn: null, checkOut: at(day, '18:00'), place: 'remote', hoursCounted: 0 });
    // a check-out before the first check-in isn't the day's check-out
    expect(dayFromPunches(day, [punch('out', day, '08:00'), punch('in', day, '09:00')], MORNING)).toMatchObject({ checkIn: at(day, '09:00'), checkOut: null });
  });

  it('takes the check-ins’ flags once each, and the place of the first check-in', () => {
    const d = dayFromPunches(day, [punch('in', day, '09:00', { place: 'unknown', flags: ['location_unknown'] }), punch('in', day, '11:00', { place: 'remote', flags: ['outside_office', 'location_unknown'] })], MORNING);
    expect(d.place).toBe('unknown');
    expect(d.flags).toEqual(['location_unknown', 'outside_office']);
  });

  it('says what the next press is', () => {
    expect(nextPunch([])).toBe('in');
    expect(nextPunch([punch('in', day, '09:00')])).toBe('out');
    expect(nextPunch([punch('in', day, '09:00'), punch('out', day, '13:00')])).toBe('in');
  });

  it('counts a punch on the day it is in, a night shift’s check-out after midnight on the night before', () => {
    expect(shiftDayOf(at('2026-10-18', '23:30'), MORNING)).toBe('2026-10-18');
    expect(shiftDayOf(at('2026-10-18', '00:30'), null)).toBe('2026-10-18');
    const night = { startTime: '22:00', endTime: '06:00', hoursPerDay: 8, graceMinutes: 15 };
    expect(shiftDayOf(at('2026-10-18', '21:55'), night)).toBe('2026-10-18');
    expect(shiftDayOf(at('2026-10-19', '05:40'), night)).toBe('2026-10-18');
    expect(shiftDayOf(at('2026-10-19', '07:30'), night)).toBe('2026-10-18');
    expect(shiftDayOf(at('2026-10-19', '20:00'), night)).toBe('2026-10-19');
  });

  it('says plainly what was kept: the time and place, a second check-in, a check-out without one, a flag', () => {
    expect(punchMessages({ ...punch('in', day, '09:05'), flags: [] }, [])).toEqual(['Checked in at 9:05 AM, at the office.']);
    expect(punchMessages({ ...punch('in', day, '09:40'), flags: [] }, [punch('in', day, '09:05')])[1]).toBe(
      'You were checked in already since 9:05 AM: this check-in is kept too, and your day still starts at 9:05 AM.',
    );
    expect(punchMessages({ ...punch('in', day, '14:00'), flags: [] }, [punch('in', day, '09:05'), punch('out', day, '13:00')])[1]).toBe(
      'Checked in again: your day still starts at 9:05 AM and ends at your last check-out.',
    );
    expect(punchMessages({ ...punch('out', day, '19:02', { place: 'remote' }), flags: [] }, [])).toEqual([
      'Checked out at 7:02 PM, remote.',
      'You had not checked in today: the check-out is kept, with no hours counted. Ask for a correction to add the time you came in.',
    ]);
    expect(punchMessages({ ...punch('in', day, '09:05', { place: 'remote' }), flags: ['outside_office'] }, [])[1]).toBe(
      'Checked in outside the office on an office day: it is kept, and your manager and HR see it flagged.',
    );
    expect(punchMessages({ ...punch('in', day, '09:05', { place: 'unknown' }), flags: ['location_unknown'] }, [], { locationError: 'denied' })).toEqual([
      'Checked in at 9:05 AM, location unknown.',
      'You didn’t allow the location: the check-in is kept as location unknown.',
      'Location unknown on an office day: it is kept, and your manager and HR see it flagged. Allow the location next time.',
    ]);
    expect(punchMessages({ ...punch('in', day, '09:05', { place: 'unknown' }), flags: [] }, [], { officeSet: false })[1]).toBe(
      'The office’s location isn’t set on the system yet: the check-in is kept as location unknown.',
    );
  });
});

describe('who checks in', () => {
  it('is someone with a profile and a current employment under a shift, not a freelancer', () => {
    expect(checkInRefusal(true, { employmentType: 'full_time', shiftId: 's1' })).toBeNull();
    expect(checkInRefusal(true, { employmentType: 'intern', shiftId: 's1' })).toBeNull();
    expect(checkInRefusal(false, null)).toContain('no employee profile');
    expect(checkInRefusal(true, null)).toContain('no current employment');
    expect(checkInRefusal(true, { employmentType: 'freelance', shiftId: 's1' })).toContain('A freelancer doesn’t check in');
    expect(checkInRefusal(true, { employmentType: 'part_time', shiftId: null })).toContain('no shift yet');
  });
});

describe('a month’s days from every source', () => {
  const d = (date: string, source: SourcedDay['source'], more: Partial<SourcedDay> = {}): SourcedDay => ({
    date,
    status: 'worked',
    checkIn: null,
    checkOut: null,
    place: null,
    zohoStatus: null,
    permissionHours: 0,
    hoursCounted: 0,
    source,
    ...more,
  });

  it('takes each date from a correction, then the system, then a device, then Zoho', () => {
    const rows = [d('2026-10-04', 'zoho', { hoursCounted: 8 }), d('2026-10-04', 'system', { hoursCounted: 9 }), d('2026-10-05', 'zoho'), d('2026-10-05', 'correction'), d('2026-10-06', 'device'), d('2026-10-06', 'zoho')];
    expect(daysByPrecedence(rows).map((r) => `${r.date} ${r.source}`)).toEqual(['2026-10-04 system', '2026-10-05 correction', '2026-10-06 device']);
  });

  const ctx = {
    month: '2026-10',
    today: '2026-10-15',
    checkInFrom: '2026-10-11',
    workingDays: [0, 1, 2, 3, 4],
    holidays: ['2026-10-06'],
    leaveDays: ['2026-10-13'],
    employedFrom: '2025-01-01',
    employedTo: null,
  };

  it('fills the days gone by since the first check-in: absent on a working day, a rest day, a holiday, leave', () => {
    // Zoho kept the 1st to the 8th; from Sunday the 11th on, the system; the 15th is today
    const rows = [d('2026-10-01', 'zoho', { status: 'worked', hoursCounted: 9 }), d('2026-10-08', 'zoho', { status: 'absent' }), d('2026-10-11', 'system', { hoursCounted: 9 }), d('2026-10-14', 'system', { hoursCounted: 8 })];
    const days = monthDays(rows, ctx);
    expect(days.map((x) => `${x.date.slice(8)} ${x.status} ${x.source}`)).toEqual([
      '01 worked zoho',
      '08 absent zoho',
      '11 worked system',
      '12 absent system',
      '13 leave system',
      '14 worked system',
    ]);
    // a holiday and a rest day gone by after the first check-in
    expect(monthDays([d('2026-10-01', 'system')], { ...ctx, checkInFrom: '2026-10-01', today: '2026-10-04' }).map((x) => `${x.date.slice(8)} ${x.status}`)).toEqual([
      '01 worked',
      '02 rest',
      '03 rest',
    ]);
    expect(monthDays([], { ...ctx, checkInFrom: '2026-10-05', today: '2026-10-07' }).map((x) => `${x.date.slice(8)} ${x.status}`)).toEqual(['05 absent', '06 holiday']);
  });

  it('adds nothing for someone who never checked in on the system, nor before they joined or after they left', () => {
    expect(monthDays([d('2026-10-01', 'zoho')], { ...ctx, checkInFrom: null })).toHaveLength(1);
    expect(monthDays([], { ...ctx, checkInFrom: '2026-09-01', employedFrom: '2026-10-13' }).map((x) => x.date)).toEqual(['2026-10-13', '2026-10-14']);
    expect(monthDays([], { ...ctx, checkInFrom: '2026-09-01', employedTo: '2026-10-01' }).map((x) => x.date)).toEqual(['2026-10-01']);
  });

  it('counts the check-outs without a check-in and the flagged days', () => {
    const views = [
      d('2026-10-11', 'system', { checkOut: '2026-10-11T16:00:00.000Z' }),
      d('2026-10-12', 'system', { checkIn: '2026-10-12T06:00:00.000Z', checkOut: '2026-10-12T15:00:00.000Z', hoursCounted: 9, place: 'remote', flags: ['outside_office'] }),
    ].map((x) => attendanceDayView(x, 9));
    expect(views[0]).toMatchObject({ missingCheckIn: true, missingCheckOut: false, shortHours: 0 });
    expect(views[1].flags).toEqual(['outside_office']);
    const f = attendanceFigures(views);
    expect(f).toMatchObject({ missingCheckIns: 1, flaggedDays: 1, remoteDays: 1 });
    expect(matchesAttendanceFilter(f, 'flagged')).toBe(true);
  });
});

describe('a payroll line from the attendance days', () => {
  const days = [
    { status: 'worked' as const, hoursCounted: 9, permissionHours: 0, source: 'system' },
    { status: 'worked' as const, hoursCounted: 7.5, permissionHours: 1.5, source: 'zoho' },
    { status: 'absent' as const, hoursCounted: 0, permissionHours: 0, source: 'system' },
    { status: 'rest' as const, hoursCounted: 0, permissionHours: 0, source: 'system' },
  ];

  it('takes the hours counted, the absent days and Zoho’s permission within the allowance', () => {
    expect(attendanceLineInputs(days, { systemPermissionHours: 0, permissionHoursPerMonth: 4, hourly: false })).toEqual({ workedHours: 16.5, noShowDays: 1, permissionHours: 1.5 });
    // the allowance is the most
    expect(attendanceLineInputs(days, { systemPermissionHours: 0, permissionHoursPerMonth: 1, hourly: false }).permissionHours).toBe(1);
  });

  it('leaves the permission to the system’s requests when there are any, and pay by the hour the hours only', () => {
    expect(attendanceLineInputs(days, { systemPermissionHours: 2, permissionHoursPerMonth: 4, hourly: false }).permissionHours).toBeNull();
    expect(attendanceLineInputs(days, { systemPermissionHours: 0, permissionHoursPerMonth: 4, hourly: true })).toEqual({ workedHours: 16.5 });
  });

  it('says why a figure from the attendance days can’t be typed over', () => {
    expect(importedInputRefusal('workedHours', 'Rania Girgis', '2026-10-19T10:00:00.000Z', 'attendance')).toBe(
      'Worked hours for Rania Girgis come from the attendance days (filled 19/10/2026): they change with the attendance itself, by a correction approved or Refresh from attendance.',
    );
    expect(importedInputRefusal('workedHours', 'Rania Girgis', '2026-10-19T10:00:00.000Z')).toContain('came from the Zoho import of 19/10/2026');
  });
});
