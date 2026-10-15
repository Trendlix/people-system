import { CONFIRM_FIELD_KEYS } from '@trendlix/shared';
import { toDateOnly } from '../common/date-only.js';
import type { Employee } from '../generated/prisma/client.js';
import { changedFields, confirmValue, snapshotOf } from './views.js';

/** A profile with nothing filled in but the names and the given values. */
const employee = (values: Partial<Employee> = {}) =>
  ({ id: 'e1', employeeCode: 'EMP-0001', fullNameEn: 'Omar Khaled', fullNameAr: 'عمر خالد', ...values }) as Employee;

describe('profile confirmation views', () => {
  it('compares values as saved: dates as YYYY-MM-DD, and nothing or empty text as null', () => {
    expect(confirmValue(toDateOnly('1995-03-12'))).toBe('1995-03-12');
    expect(confirmValue('')).toBeNull();
    expect(confirmValue(undefined)).toBeNull();
    expect(confirmValue(2018)).toBe(2018);
    expect(confirmValue('+201012345678')).toBe('+201012345678');
  });

  it('keeps every confirmed field in the snapshot', () => {
    const snapshot = snapshotOf(employee({ dateOfBirth: toDateOnly('1995-03-12'), graduationYear: 2018 }));
    expect(Object.keys(snapshot)).toEqual([...CONFIRM_FIELD_KEYS]);
    expect(snapshot).toMatchObject({ fullNameEn: 'Omar Khaled', dateOfBirth: '1995-03-12', graduationYear: 2018, mobile: null });
  });

  it('names the fields changed since, in the order they are shown; a field confirmed before it existed counts as empty', () => {
    const confirmed = snapshotOf(employee({ mobile: '+201012345678', city: 'مدينة نصر' }));
    expect(changedFields(confirmed, snapshotOf(employee({ mobile: '+201012345678', city: 'مدينة نصر' })))).toEqual([]);
    expect(changedFields(confirmed, snapshotOf(employee({ city: 'المعادي', mobile: '+201098765432' })))).toEqual(['mobile', 'city']);

    const { city: _city, ...older } = confirmed;
    expect(changedFields(older, snapshotOf(employee({ mobile: '+201012345678' })))).toEqual([]);
    expect(changedFields(older, snapshotOf(employee({ mobile: '+201012345678', city: 'مدينة نصر' })))).toEqual(['city']);
  });
});
