import { describe, expect, it } from 'vitest';
import type { KpiScorecardSummary } from '@trendlix/shared';
import type { AttendanceCorrectionView } from '../../../../lib/correction-types';
import type { HomeLocationView } from '../../../../lib/home-location-types';
import type { PendingRaise, RaiseRequest } from '../../../../lib/raise-types';
import type { LeaveRequestView, PermissionRequestView, ReimbursementClaimView } from '../../../../lib/types';
import type { WfhRequestView } from '../../../../lib/wfh-types';
import type { OdRequestView } from '../../../../lib/od-types';
import type { CompensatoryRequestView } from '../../../../lib/compensatory-types';
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

  // owner, 20 October 2026: "allow other users to request to add their home locations when working from home"
  it('lists the home locations at HR’s step or the CEO’s, opening each under To Approve', () => {
    const home = { id: ID(7), employee: nour, stage: 'hr', latitude: 30.1, longitude: 31.3, label: 'Home, Nasr City', radiusMetres: 100 } as unknown as HomeLocationView;
    const ceoStep = { ...home, id: ID(8), stage: 'ceo', label: null, radiusMetres: 150 } as HomeLocationView;
    const [homes] = waitingSections({ homes: [home, ceoStep] });
    expect(homes).toMatchObject({ key: 'home', title: 'Check-in Locations', failed: false });
    expect(homes.rows.map((r) => [r.href, r.name, r.line])).toEqual([
      [`/app/approve/home/${ID(7)}`, 'Nour Adel', 'HR’s step · Home, Nasr City · 100 m'],
      [`/app/approve/home/${ID(8)}`, 'Nour Adel', 'The CEO’s step · Point on the map · 150 m'],
    ]);
    // a client location by its type and name (24 October 2026)
    expect(waitingSections({ homes: [{ ...home, id: ID(9), type: 'client', label: 'Acme' } as HomeLocationView] })[0].rows[0].line).toBe('HR’s step · Client location: Acme · 100 m');
    expect(waitingSections({ homes: null })).toMatchObject([{ key: 'home', failed: true }]);
    expect(waitingSections({ homes: [] })).toEqual([]);
  });

  // owner, 21 October 2026: "Self, manager, HR, sign-off": the manager's scoring and sign-off, HR's calibration
  it('lists the KPI scorecards waiting for the caller’s step, opening each under To Approve', () => {
    const scorecard = (id: string, action: KpiScorecardSummary['action'], deadline: string) =>
      ({ id, month: '2026-10', employee: { id: 'e1', employeeCode: 'EMP-0001', fullNameEn: 'Mona Adel' }, status: action === 'calibrate' ? 'hr' : 'manager', action, deadline }) as unknown as KpiScorecardSummary;
    const [kpis] = waitingSections({ kpis: [scorecard(ID(9), 'score', '2026-11-06'), scorecard(ID(10), 'calibrate', '2026-11-08')] });
    expect(kpis).toMatchObject({ key: 'kpi', title: 'KPI Scorecards', failed: false });
    expect(kpis.rows.map((r) => [r.href, r.name, r.line, r.action])).toEqual([
      [`/app/approve/kpi/${ID(9)}`, 'Mona Adel', 'October 2026 · Score by 06/11/2026', 'Score'],
      [`/app/approve/kpi/${ID(10)}`, 'Mona Adel', 'October 2026 · Calibrate by 08/11/2026', 'Calibrate'],
    ]);
    expect(waitingSections({ kpis: null })).toMatchObject([{ key: 'kpi', failed: true }]);
    expect(waitingSections({ kpis: [] })).toEqual([]);
    // the other sections' rows say Decide
    expect(waitingSections({ claims: [claim] })[0].rows[0].action).toBeUndefined();
  });

  // owner, 21 October 2026: "Manager, then HR"
  it('lists the work from home requests waiting for the caller after leave, opening each under To Approve', () => {
    const wfh = { id: ID(11), kind: 'wfh', employee: nour, date: '2026-11-02', status: 'with_manager' } as unknown as WfhRequestView;
    const sections = waitingSections({ leave: [leave], permissions: [], wfh: [wfh], claims: [claim] });
    expect(sections.map((s) => s.key)).toEqual(['leave', 'wfh', 'reimbursement']);
    expect(sections[1]).toMatchObject({ title: 'Work From Home', failed: false });
    expect(sections[1].rows.map((r) => [r.href, r.name, r.line, r.action])).toEqual([[`/app/approve/wfh/${ID(11)}`, 'Nour Adel', 'Work from home · Monday 02/11/2026', undefined]]);
    expect(waitingTotal(sections)).toBe(3);
    expect(waitingSections({ wfh: null })).toMatchObject([{ key: 'wfh', failed: true }]);
    expect(waitingSections({ wfh: [] })).toEqual([]);
  });

  // owner, 23 October 2026: "Official duty (OD) requests", "Manager, then HR"
  it('lists the official duty requests waiting for the caller after working from home, opening each under To Approve', () => {
    const od = { id: ID(12), kind: 'od', employee: nour, startDate: '2026-11-02', endDate: '2026-11-04', fullDay: true, fromTime: null, toTime: null, status: 'with_hr' } as unknown as OdRequestView;
    const wfh = { id: ID(11), kind: 'wfh', employee: nour, date: '2026-11-02', status: 'with_manager' } as unknown as WfhRequestView;
    const sections = waitingSections({ leave: [leave], permissions: [], wfh: [wfh], od: [od], claims: [claim] });
    expect(sections.map((s) => s.key)).toEqual(['leave', 'wfh', 'od', 'reimbursement']);
    expect(sections[2]).toMatchObject({ title: 'Official Duty', failed: false });
    expect(sections[2].rows.map((r) => [r.href, r.name, r.line])).toEqual([[`/app/approve/od/${ID(12)}`, 'Nour Adel', 'Official duty · Monday 02/11/2026 – Wednesday 04/11/2026']]);
    expect(waitingSections({ od: null })).toMatchObject([{ key: 'od', failed: true }]);
    expect(waitingSections({ od: [] })).toEqual([]);
  });

  // owner, 26 October 2026: "WFH and compensatory pages in the phone app"; "Manager, then HR"
  it('lists the compensatory day requests waiting for the caller right after working from home, opening each under To Approve', () => {
    const wfh = { id: ID(11), kind: 'wfh', employee: nour, date: '2026-11-02', status: 'with_manager' } as unknown as WfhRequestView;
    const od = { id: ID(12), kind: 'od', employee: nour, startDate: '2026-11-02', endDate: '2026-11-04', fullDay: true, fromTime: null, toTime: null, status: 'with_hr' } as unknown as OdRequestView;
    const compensatory = { id: ID(13), kind: 'compensatory', employee: nour, dayWorked: '2026-11-06', dayOff: '2026-11-10', outcome: null, status: 'with_hr', stage: 'hr' } as unknown as CompensatoryRequestView;
    const sections = waitingSections({ leave: [leave], permissions: [], wfh: [wfh], compensatory: [compensatory], od: [od], claims: [claim] });
    expect(sections.map((s) => s.key)).toEqual(['leave', 'wfh', 'compensatory', 'od', 'reimbursement']);
    expect(sections[2]).toMatchObject({ title: 'Compensatory Days', failed: false });
    expect(sections[2].rows.map((r) => [r.href, r.name, r.line, r.action])).toEqual([
      [`/app/approve/compensatory/${ID(13)}`, 'Nour Adel', 'Worked Friday 06/11/2026 · day off Tuesday 10/11/2026', undefined],
    ]);
    expect(waitingTotal(sections)).toBe(5);
    expect(waitingSections({ compensatory: null })).toMatchObject([{ key: 'compensatory', failed: true }]);
    expect(waitingSections({ compensatory: [] })).toEqual([]);
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
