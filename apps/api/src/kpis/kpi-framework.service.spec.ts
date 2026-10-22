import { KPI_DEFAULT_PILLAR_SET, type KpiPillar } from '@trendlix/shared';
import { ownOn, pillarsResolver, topDepartmentOf, type FrameworkVersion } from './kpi-framework.service.js';

// Which pillars a job title takes (owner, 22 October 2026: "but i need pillars to each department / wights can be
// changed for each department and Job title"): its department's newest own pillars (a team's job titles their
// department's), else the company's newest; a department back on the company's from a later month holds them back to it.

const SALES: KpiPillar[] = [
  { key: 'revenue', name: 'Revenue', short: 'Revenue', weight: 60 },
  { key: 'clients', name: 'Clients & Teamwork', short: 'Clients', weight: 40 },
];

const version = (v: Partial<FrameworkVersion> & Pick<FrameworkVersion, 'id' | 'version' | 'appliesFrom'>): FrameworkVersion => ({
  departmentId: null,
  followsCompany: false,
  set: { pillars: [...KPI_DEFAULT_PILLAR_SET.pillars], attendancePillar: KPI_DEFAULT_PILLAR_SET.attendancePillar },
  ...v,
});

const COMPANY = [version({ id: 'c1', version: 1, appliesFrom: '2000-01' }), version({ id: 'c2', version: 2, appliesFrom: '2026-11' })];
const DEPARTMENTS = [
  { id: 'sales', nameEn: 'Sales', parentId: null },
  { id: 'field', nameEn: 'Field Sales', parentId: 'sales' },
  { id: 'web', nameEn: 'Web', parentId: null },
  { id: 'ops', nameEn: 'Operations', parentId: null },
];

describe('which pillars a job title takes', () => {
  it('finds a team’s department, and a department itself', () => {
    const topOf = topDepartmentOf(DEPARTMENTS);
    expect(topOf('field')?.id).toBe('sales');
    expect(topOf('sales')?.id).toBe('sales');
    expect(topOf('nowhere')).toBeNull();
  });

  it('takes the company’s newest without pillars of its department’s own', () => {
    const of = pillarsResolver(COMPANY, [], DEPARTMENTS);
    expect(of('web')).toEqual({ framework: COMPANY[1], appliesFrom: '2026-11', department: null });
  });

  it('takes its department’s newest own pillars, a team’s job titles too', () => {
    const sales = [
      version({ id: 's1', version: 1, appliesFrom: '2026-11', departmentId: 'sales', set: { pillars: SALES, attendancePillar: 'clients' } }),
      version({ id: 's2', version: 2, appliesFrom: '2026-12', departmentId: 'sales', set: { pillars: SALES.map((p) => ({ ...p, weight: 50 })), attendancePillar: 'clients' } }),
    ];
    const of = pillarsResolver(COMPANY, [sales[1], sales[0]], DEPARTMENTS);
    expect(of('sales')).toEqual({ framework: sales[1], appliesFrom: '2026-12', department: { id: 'sales', nameEn: 'Sales' } });
    expect(of('field')).toEqual({ framework: sales[1], appliesFrom: '2026-12', department: { id: 'sales', nameEn: 'Sales' } });
    expect(of('web').framework.id).toBe('c2');
  });

  it('takes the company’s again once its department goes back to them, from the later month', () => {
    const ops = [
      version({ id: 'o1', version: 1, appliesFrom: '2026-06', departmentId: 'ops', set: { pillars: SALES, attendancePillar: 'clients' } }),
      version({ id: 'o2', version: 2, appliesFrom: '2027-01', departmentId: 'ops', followsCompany: true, set: { pillars: [], attendancePillar: '' } }),
    ];
    expect(pillarsResolver(COMPANY, ops, DEPARTMENTS)('ops')).toEqual({ framework: COMPANY[1], appliesFrom: '2027-01', department: null });
    // back on them from before the company's newest: the company's month
    const early = [{ ...ops[1], appliesFrom: '2026-10' }];
    expect(pillarsResolver(COMPANY, early, DEPARTMENTS)('ops')).toEqual({ framework: COMPANY[1], appliesFrom: '2026-11', department: null });
  });
});

describe('a department’s own versions on a day', () => {
  const versions = [{ appliesFrom: '2026-08' }, { appliesFrom: '2026-09' }, { appliesFrom: '2026-11' }];

  it('the one applied is the newest before this month; the next is from this month on', () => {
    expect(ownOn(versions, '2026-10-22')).toEqual({ applied: versions[1], next: versions[2] });
    expect(ownOn(versions, '2026-11-01')).toEqual({ applied: versions[1], next: versions[2] });
    expect(ownOn(versions, '2026-12-01')).toEqual({ applied: versions[2], next: null });
  });

  it('none applied yet, or none at all', () => {
    expect(ownOn([{ appliesFrom: '2026-11' }], '2026-10-22')).toEqual({ applied: null, next: { appliesFrom: '2026-11' } });
    expect(ownOn([], '2026-10-22')).toEqual({ applied: null, next: null });
  });
});
