import type { Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import type { PendingRaise } from '../../../lib/raise-types';
import { decidesRaises, followsRaises, pendingRaiseView, raisesLabel } from './raises';

const as = (...roles: Role[]) => ({ roles });

/** A raise waiting for the CEO as HR and the CEO are sent it, with what a test changes. */
function pending(over: Partial<PendingRaise> = {}): PendingRaise {
  return {
    id: 'c3',
    number: 'CON-2026-0001-A1',
    version: 3,
    form: 'fixed',
    startDate: '2026-11-01',
    endDate: '2027-02-28',
    durationMonths: null,
    probationMonths: 0,
    probationEnd: null,
    grossSalary: 12_500,
    basicPercent: 80,
    basicSalary: 10_000,
    variableSalary: 2_500,
    netSalary: null,
    insuredSalary: null,
    jobTitleEn: 'Designer',
    jobTitleAr: null,
    gradeCode: 'G3',
    departmentName: 'Marketing',
    shiftCode: 'A',
    status: 'draft',
    signedOn: null,
    insuranceFiledOn: null,
    labourOfficeFiledOn: null,
    note: null,
    nonRenewalNoticeBy: null,
    payBasis: 'monthly',
    hourlyRate: null,
    hoursPerWeek: null,
    daysPerWeek: null,
    allowances: [],
    allowancesTotal: 1_000,
    totalSalary: 13_500,
    kind: 'amendment',
    stage: 'pending_ceo',
    raise: {
      reason: 'promotion',
      approval: 'pending_ceo',
      sentAt: '2026-10-16T12:00:00.000Z',
      approvedBy: null,
      approvedAt: null,
      returnedReason: null,
      newJobTitle: { id: 't2', titleEn: 'Senior Designer', titleAr: null },
      newGrade: { id: 'g4', code: 'G4' },
      form2From: null,
      insuredWageFrom: '2027-01-01',
      requestId: 'q1',
    },
    change: 'amendment',
    employee: { id: 'e1', employeeCode: 'TL-0007', fullNameEn: 'Omar Khaled' },
    employmentId: 'm1',
    previous: {
      id: 'c2',
      number: 'CON-2026-0001',
      version: 2,
      startDate: '2026-03-01',
      endDate: '2027-02-28',
      payBasis: 'monthly',
      grossSalary: 10_000,
      hourlyRate: null,
      allowancesTotal: 500,
      totalSalary: 10_500,
    },
    ...over,
  };
}

describe('who sees pay raises on Approvals', () => {
  it('is HR, to follow them, and the CEO, who alone decides', () => {
    expect(followsRaises(as('hr'))).toBe(true);
    expect(followsRaises(as('ceo'))).toBe(true);
    expect(followsRaises(as('finance', 'admin', 'super_admin', 'manager'))).toBe(false);
    expect(decidesRaises(as('ceo'))).toBe(true);
    expect(decidesRaises(as('hr', 'super_admin'))).toBe(false);
  });
});

describe('a pending raise', () => {
  it('shows its kind, the pay from → to with the change, why, the promotion and when it was sent', () => {
    expect(pendingRaiseView(pending())).toEqual({
      kind: 'Amendment',
      reference: 'CON-2026-0001-A1 · version 3',
      effective: 'From 01/11/2026',
      gross: 'EGP 10,000.00 → EGP 12,500.00',
      change: '+EGP 2,500.00 (+25%)',
      allowances: 'EGP 500.00 → EGP 1,000.00',
      total: 'EGP 10,500.00 → EGP 13,500.00',
      hourly: null,
      reason: 'Promotion',
      promotion: 'Senior Designer, grade G4',
      sentAt: '16/10/2026, 3:00 PM', // Cairo, on summer time (UTC+3)
      confirmApprove: "Approve Omar Khaled's new pay, EGP 12,500.00 a month from 01/11/2026? HR then has CON-2026-0001-A1 signed.",
    });
  });

  it('shows a renewal with its term, and pay by the hour with its rates', () => {
    const v = pendingRaiseView(
      pending({
        change: 'renewal',
        number: 'CON-2027-0004',
        startDate: '2027-03-01',
        endDate: '2028-02-29',
        payBasis: 'hourly',
        hourlyRate: 175,
        raise: { ...pending().raise!, newJobTitle: null, newGrade: null, reason: 'annual' },
        previous: { ...pending().previous!, hourlyRate: 150, payBasis: 'hourly' },
      }),
    );
    expect(v.kind).toBe('Renewal');
    expect(v.effective).toBe('01/03/2027 – 29/02/2028');
    expect(v.hourly).toBe('EGP 150.00 → EGP 175.00 an hour; the gross is the monthly estimate');
    expect(v.promotion).toBeNull();
    expect(v.reason).toBe('Annual raise');
  });

  it('shows the pay alone without the version before it', () => {
    const v = pendingRaiseView(pending({ previous: null }));
    expect(v.gross).toBe('EGP 12,500.00');
    expect(v.change).toBeNull();
    expect(raisesLabel(1)).toBe('1 raise');
    expect(raisesLabel(2)).toBe('2 raises');
  });
});
