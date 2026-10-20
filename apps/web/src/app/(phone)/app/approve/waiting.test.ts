import { describe, expect, it } from 'vitest';
import type { AttendanceCorrectionView } from '../../../../lib/correction-types';
import type { PendingRaise, RaiseRequest } from '../../../../lib/raise-types';
import type { LeaveRequestView, PermissionRequestView, ReimbursementClaimView } from '../../../../lib/types';
import { waitingSections, waitingTotal } from './waiting';

// The phone pages' To Approve (owner, 20 October 2026: the employee app, "managers and team leads approve from the
// phone"). Every person and request here is invented.

const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const nour = { id: 'e1', employeeCode: 'EMP-0001', fullNameEn: 'Nour Adel', fullNameAr: null, department: null, team: null };

const leave = {
  id: ID(1),
  employee: nour,
  type: { id: 't', nameEn: 'Annual leave', nameAr: 'اعتيادية', paid: 'paid' },
  startDate: '2026-11-02',
  endDate: '2026-11-03',
  halfDay: false,
  days: 2,
  status: 'with_manager',
  createdAt: '2026-10-18T09:00:00.000Z',
} as unknown as LeaveRequestView;

const permission = {
  id: ID(2),
  kind: 'permission',
  employee: nour,
  type: { id: 'p', nameEn: 'Permission', nameAr: 'إذن' },
  date: '2026-10-27',
  startDate: '2026-10-27',
  endDate: '2026-10-27',
  hours: 2,
  fromTime: null,
  toTime: null,
  status: 'with_manager',
  createdAt: '2026-10-19T09:00:00.000Z',
} as unknown as PermissionRequestView;

const claim = {
  id: ID(3),
  employee: nour,
  type: { id: 'r', nameEn: 'Taxi', nameAr: 'تاكسي', receiptRequired: true },
  expenseDate: '2026-10-15',
  amount: 300,
  approvedAmount: 250,
  status: 'with_hr',
} as unknown as ReimbursementClaimView;

const correction = { id: ID(4), employee: nour, date: '2026-10-14', correctionKind: 'forgot_check_out', status: 'with_manager' } as unknown as AttendanceCorrectionView;

const request = { id: ID(5), employee: nour, raiseReason: 'performance', effectiveFrom: '2026-11-01', status: 'with_hr' } as unknown as RaiseRequest;

const payRaise = { id: ID(6), employee: nour, change: 'amendment', startDate: '2026-11-01', grossSalary: 15000 } as unknown as PendingRaise;

describe('what waits for the caller', () => {
  it('puts each in its section, opening its page under To Approve', () => {
    const sections = waitingSections({ leave: [leave], permissions: [permission], claims: [claim], corrections: [correction], raiseRequests: [request], payRaises: [payRaise] });
    expect(sections.map((s) => s.key)).toEqual(['leave', 'reimbursement', 'correction', 'raise', 'pay-raise']);
    expect(sections.map((s) => s.title)).toEqual(['Leave and Permission', 'Reimbursements', 'Attendance Corrections', 'Raise Requests', 'Pay Raises']);
    expect(waitingTotal(sections)).toBe(6);
    const hrefs = sections.flatMap((s) => s.rows.map((r) => r.href));
    expect(hrefs).toEqual([
      `/app/approve/leave/${ID(1)}`,
      `/app/approve/permission/${ID(2)}`,
      `/app/approve/reimbursement/${ID(3)}`,
      `/app/approve/correction/${ID(4)}`,
      `/app/approve/raise/${ID(5)}`,
      `/app/approve/pay-raise/${ID(6)}`,
    ]);
  });

  it('says who and what, the amount it is decided on', () => {
    const [leaves, claims, corrections, raises, pay] = waitingSections({ leave: [leave], permissions: [permission], claims: [claim], corrections: [correction], raiseRequests: [request], payRaises: [payRaise] });
    // the latest day first, as My Team lists them
    expect(leaves.rows.map((r) => r.line)).toEqual(['Annual leave · 02/11/2026 – 03/11/2026 · 2 days', expect.stringMatching(/^Permission · Tuesday 27\/10\/2026 · 2 hours/)]);
    expect(leaves.rows[0].name).toBe('Nour Adel');
    expect(claims.rows[0].line).toMatch(/^Taxi · 15\/10\/2026 · EGP 250\.00$/);
    expect(corrections.rows[0].line).toMatch(/^Wednesday 14\/10\/2026 · /);
    expect(raises.rows[0].line).toBe('Performance raise · effective from November 2026');
    expect(pay.rows[0].line).toMatch(/ · from 01\/11\/2026 · gross EGP 15,000\.00$/);
  });

  it('leaves out what is empty or not the caller’s, and says what couldn’t be read', () => {
    expect(waitingSections({ leave: [], permissions: [], claims: [] })).toEqual([]);
    expect(waitingSections({})).toEqual([]);
    const failed = waitingSections({ leave: null, permissions: [], claims: null });
    expect(failed.map((s) => [s.key, s.failed, s.rows.length])).toEqual([
      ['leave', true, 0],
      ['reimbursement', true, 0],
    ]);
  });
});
