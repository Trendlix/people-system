import type { SessionUser } from '../auth/session-user.js';
import { mayEditLeave } from './access.js';
import { leaveEditChanges, leaveEditComment, leaveEditLockProblem, leaveEditMovesBalance, leaveEditMovesPayroll, monthsOfDays, type LeaveEditFacts } from './leave-edit.js';
import { ListLeaveRequestsDto } from './leave.dto.js';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

// A Super Admin editing a leave (owner, 26 October 2026: "as a superadmin i need to edit the leaves").

const base: LeaveEditFacts = {
  typeId: 'annual',
  typeName: 'Annual leave',
  startDate: '2026-11-05',
  endDate: '2026-11-05',
  halfDay: false,
  reason: null,
  coverId: null,
  coverName: null,
};

const user = (extra: Partial<SessionUser>): SessionUser => ({ id: 'u', email: 'x@test.local', roles: ['super_admin'], ...extra }) as SessionUser;

describe('who edits a leave', () => {
  it('a Super Admin in their own session only: never HR, the CEO, a developer, nor one viewing as someone', () => {
    expect(mayEditLeave(user({}))).toBe(true);
    expect(mayEditLeave(user({ roles: ['hr'] }))).toBe(false);
    expect(mayEditLeave(user({ roles: ['ceo'] }))).toBe(false);
    expect(mayEditLeave(user({ roles: ['hr', 'ceo'] }))).toBe(false);
    expect(mayEditLeave(user({ roles: ['hr', 'ceo', 'super_admin'] }))).toBe(true);
    expect(mayEditLeave(user({ developer: true }))).toBe(false);
    expect(mayEditLeave(user({ viewAs: { by: { id: 's', email: 's@test.local' }, act: true } }))).toBe(false);
    expect(mayEditLeave(user({ viewAs: { by: { id: 's', email: 's@test.local' }, act: false } }))).toBe(false);
  });
});

describe('what an edit changes, in words', () => {
  it('lists the dates and the type, the first with a capital', () => {
    const after = { ...base, startDate: '2026-11-06', endDate: '2026-11-06', typeId: 'casual', typeName: 'Casual leave' };
    expect(leaveEditChanges(base, after)).toEqual(['Dates 05/11/2026 → 06/11/2026', 'type Annual leave → Casual leave']);
  });

  it('says a period with both ends, the half day, the reason and who covers', () => {
    const after = { ...base, endDate: '2026-11-08', halfDay: true, reason: 'Family visit', coverId: 'c', coverName: 'Mona Adel' };
    expect(leaveEditChanges({ ...base, reason: 'Trip', coverId: 'd', coverName: 'Omar Khaled' }, after)).toEqual([
      'Dates 05/11/2026 → 05/11/2026–08/11/2026',
      'half day no → yes',
      'reason “Trip” → “Family visit”',
      'covered by Omar Khaled → Mona Adel',
    ]);
    expect(leaveEditChanges(base, { ...base, reason: 'Trip' })).toEqual(['Reason none → “Trip”']);
    expect(leaveEditChanges({ ...base, coverId: 'c', coverName: 'Mona Adel' }, base)).toEqual(['Covered by Mona Adel → nobody']);
  });

  it('nothing changed lists nothing, an empty reason being none either way', () => {
    expect(leaveEditChanges(base, { ...base })).toEqual([]);
    expect(leaveEditChanges({ ...base, reason: null }, { ...base, reason: null })).toEqual([]);
  });

  it('keeps a long reason short', () => {
    const [text] = leaveEditChanges(base, { ...base, reason: 'x'.repeat(200) });
    expect(text.length).toBeLessThan(130);
  });

  it('the step’s comment: the changes, then why when given', () => {
    expect(leaveEditComment(['Dates a → b', 'type c → d'], null)).toBe('Dates a → b; type c → d');
    expect(leaveEditComment(['Dates a → b'], '  Imported with the wrong day ')).toBe('Dates a → b\nWhy: Imported with the wrong day');
    expect(leaveEditComment(['Dates a → b'], '   ')).toBe('Dates a → b');
  });
});

describe('the months an edit touches', () => {
  it('lists the months from the first to the last day', () => {
    expect(monthsOfDays('2026-11-05', '2026-11-05')).toEqual(['2026-11']);
    expect(monthsOfDays('2026-10-30', '2026-12-02')).toEqual(['2026-10', '2026-11', '2026-12']);
    expect(monthsOfDays('2026-12-30', '2027-01-02')).toEqual(['2026-12', '2027-01']);
    expect(monthsOfDays('2026-12-07', '2026-11-05')).toEqual([]);
  });

  it('refuses days in a month whose payroll is with the CEO, approved or paid, naming it', () => {
    const locked = [{ month: '2026-10', status: 'approved' }, { month: '2026-11', status: 'pending_ceo' }];
    expect(leaveEditLockProblem([{ startDate: '2026-10-28', endDate: '2026-10-29' }, { startDate: '2026-12-01', endDate: '2026-12-01' }], locked)).toBe(
      "The October 2026 payroll is approved, so the days of this leave can't change. Ask the CEO to return the payroll to HR first, or leave these days as they are.",
    );
    // the new days
    expect(leaveEditLockProblem([{ startDate: '2026-12-02', endDate: '2026-12-02' }, { startDate: '2026-11-30', endDate: '2026-12-01' }], locked)).toMatch(/^The November 2026 payroll is with the CEO/);
    expect(leaveEditLockProblem([{ startDate: '2026-09-02', endDate: '2026-09-03' }, { startDate: '2026-12-01', endDate: '2026-12-01' }], locked)).toBeNull();
    expect(leaveEditLockProblem([{ startDate: '2026-10-02', endDate: '2026-10-03' }], [{ month: '2026-10', status: 'paid' }])).toMatch(/payroll is paid/);
  });
});

describe('what an edit moves', () => {
  const was = { typeId: 'annual', startDate: '2026-11-05', days: 2 };
  it('the balance moves with the type, the days or the year; not the reason, the cover, nor the same days elsewhere', () => {
    expect(leaveEditMovesBalance(was, { ...was })).toBe(false);
    expect(leaveEditMovesBalance(was, { ...was, startDate: '2026-11-12' })).toBe(false);
    expect(leaveEditMovesBalance(was, { ...was, typeId: 'casual' })).toBe(true);
    expect(leaveEditMovesBalance(was, { ...was, days: 3 })).toBe(true);
    expect(leaveEditMovesBalance(was, { ...was, startDate: '2027-01-05' })).toBe(true);
  });

  it('the payroll reads the type, the days and the half day, not the reason or the cover', () => {
    expect(leaveEditMovesPayroll(base, { ...base, reason: 'x', coverId: 'c', coverName: 'M' })).toBe(false);
    expect(leaveEditMovesPayroll(base, { ...base, endDate: '2026-11-06' })).toBe(true);
    expect(leaveEditMovesPayroll(base, { ...base, typeId: 'unpaid' })).toBe(true);
    expect(leaveEditMovesPayroll(base, { ...base, halfDay: true })).toBe(true);
  });
});

describe('the list’s filters', () => {
  const read = (query: object) => {
    const dto = plainToInstance(ListLeaveRequestsDto, query);
    return { dto, errors: validateSync(dto).flatMap((e) => Object.values(e.constraints ?? {})) };
  };
  it('takes an employee and a type by id with a status, and refuses anything else', () => {
    const id = '0b6f2f5e-8d0e-4c9a-9a39-6f0f5a1d2c3e';
    expect(read({ status: 'approved', employeeId: id, typeId: id }).errors).toEqual([]);
    expect(read({}).errors).toEqual([]);
    expect(read({ typeId: 'permission' }).errors).toEqual(['Choose the leave type.']);
    expect(read({ employeeId: 'ben' }).errors).toEqual(['Choose the employee.']);
  });
});
