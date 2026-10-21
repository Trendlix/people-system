import type { KpiScorecardSummary } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { kpiApprovalRows, kpiScorecardsLabel, seesKpiApprovals } from './kpis';

// owner, 21 October 2026: "The KPI items waiting for someone are counted in the sidebar and on Approvals"
const ME = 'e-me';

const card = (over: Partial<KpiScorecardSummary>): KpiScorecardSummary => ({
  id: 'k1',
  month: '2026-09',
  employee: { id: 'e1', employeeCode: 'TLX-0007', fullNameEn: 'Mona Adel' },
  jobTitle: 'Senior Frontend Developer',
  department: 'Frontend · Web Development',
  departmentId: 'd1',
  status: 'manager',
  templateVersion: 1,
  scorer: { kind: 'manager', name: 'Karim Fathy' },
  finalPercent: null,
  level: null,
  selfMissed: false,
  calibrated: 0,
  signed: { employee: false, manager: false },
  unsigned: false,
  action: 'score',
  deadline: '2026-10-06',
  confidential: false,
  ...over,
});

describe('the KPI scorecards on Approvals', () => {
  it('are for those who see Approvals: HR, the CEO, Admin and the Super Admin', () => {
    for (const role of ['hr', 'ceo', 'admin', 'super_admin'] as const) expect(seesKpiApprovals({ roles: [role] })).toBe(true);
    for (const role of ['employee', 'manager', 'finance'] as const) expect(seesKpiApprovals({ roles: [role] })).toBe(false);
  });

  it('list each waiting for the user with its month, step, deadline and action, linking to the scorecard', () => {
    expect(kpiApprovalRows([card({})], { employeeId: ME })).toEqual([
      {
        id: 'k1',
        person: 'Mona Adel',
        employeeCode: 'TLX-0007',
        jobTitle: 'Senior Frontend Developer',
        month: 'September 2026',
        step: 'With the manager',
        deadline: '06/10/2026',
        action: 'Score',
        href: '/kpis/scorecards/k1',
        confidential: false,
      },
    ]);
    const [hr, sign] = kpiApprovalRows(
      [card({ id: 'k2', status: 'hr', action: 'calibrate', deadline: '2026-10-08' }), card({ id: 'k3', status: 'sign_off', action: 'sign', deadline: null })],
      { employeeId: ME },
    );
    expect(hr).toMatchObject({ step: 'With HR', action: 'Calibrate', deadline: '08/10/2026' });
    expect(sign).toMatchObject({ step: 'Sign-off', action: 'Sign', deadline: null });
  });

  it('leave out the user’s own scorecard, and any with nothing for them to do, in the order they came', () => {
    const rows = kpiApprovalRows(
      [
        card({ id: 'own', employee: { id: ME, employeeCode: 'TLX-0001', fullNameEn: 'Me' }, status: 'self_rating', action: 'self_rate' }),
        card({ id: 'b' }),
        card({ id: 'none', action: null }),
        card({ id: 'a' }),
      ],
      { employeeId: ME },
    );
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
    // without a profile of their own, nothing is theirs
    expect(kpiApprovalRows([card({ id: 'x', employee: { id: ME, employeeCode: 'TLX-0001', fullNameEn: 'Me' } })], { employeeId: null })).toHaveLength(1);
  });

  it('count them in words', () => {
    expect(kpiScorecardsLabel(1)).toBe('1 KPI scorecard');
    expect(kpiScorecardsLabel(3)).toBe('3 KPI scorecards');
  });
});
