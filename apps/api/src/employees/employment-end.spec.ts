import { employmentEnd, employmentEndOf, leavingDayOf } from './employment-end.js';

// A leaver's last day for the payroll and the attendance (owner's report, 27 October 2026). Every date is invented.

const day = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

describe('the employment end for payroll and attendance', () => {
  it('is the end date while there is no approved ending, and null while there is neither', () => {
    expect(employmentEnd(null, null)).toBeNull();
    expect(employmentEnd(null, undefined)).toBeNull();
    expect(employmentEnd('2026-09-30', null)).toBe('2026-09-30');
  });

  it("is an approved ending's last working day while the employment has no end date", () => {
    expect(employmentEnd(null, '2026-07-20')).toBe('2026-07-20');
  });

  it('is the earlier of the two when both are set', () => {
    expect(employmentEnd('2026-07-31', '2026-07-20')).toBe('2026-07-20');
    expect(employmentEnd('2026-07-15', '2026-07-20')).toBe('2026-07-15');
    expect(employmentEnd('2026-07-20', '2026-07-20')).toBe('2026-07-20');
  });

  it('reads the earliest approved ending of a row, and none without endings', () => {
    expect(leavingDayOf({})).toBeNull();
    expect(leavingDayOf({ endings: [] })).toBeNull();
    expect(leavingDayOf({ endings: [{ lastWorkingDay: day('2026-08-05') }, { lastWorkingDay: day('2026-07-20') }] })).toBe('2026-07-20');
    expect(employmentEndOf({ endDate: null, endings: [{ lastWorkingDay: day('2026-07-20') }] })).toBe('2026-07-20');
    expect(employmentEndOf({ endDate: day('2026-07-10'), endings: [{ lastWorkingDay: day('2026-07-20') }] })).toBe('2026-07-10');
    expect(employmentEndOf({ endDate: null })).toBeNull();
  });
});
