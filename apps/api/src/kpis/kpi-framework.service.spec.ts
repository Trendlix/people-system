import { KPI_DEFAULT_PILLAR_SET, type KpiPillar } from '@trendlix/shared';
import { departmentChain, ownOn, pillarsResolver, topDepartmentOf, type FrameworkVersion } from './kpi-framework.service.js';

// Which pillars a job title takes (owner, 22 October 2026: "but i need pillars to each department / wights can be
// changed for each department and Job title", then "Yes, add team pillars"): the newest own pillars of the nearest level
// that has them, team → department → company; a level back on the one above's from a later month holds them back to it.

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

  it('reads a team’s line up: itself, its department, nothing unknown', () => {
    const chainOf = departmentChain(DEPARTMENTS);
    expect(chainOf('field').map((d) => d.id)).toEqual(['field', 'sales']);
    expect(chainOf('sales').map((d) => d.id)).toEqual(['sales']);
    expect(chainOf('nowhere')).toEqual([]);
    // a loop, which the organisation never has, is cut
    expect(departmentChain([{ id: 'a', nameEn: 'A', parentId: 'b' }, { id: 'b', nameEn: 'B', parentId: 'a' }])('a').map((d) => d.id)).toEqual(['a', 'b']);
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

// Team pillars (owner, 22 October 2026: "where is the pillars for team?", then "Yes, add team pillars").
describe('which pillars a team’s job title takes', () => {
  const FIELD: KpiPillar[] = [
    { key: 'visits', name: 'Visits', short: 'Visits', weight: 70 },
    { key: 'clients', name: 'Clients & Teamwork', short: 'Clients', weight: 30 },
  ];
  const sales = version({ id: 's1', version: 1, appliesFrom: '2026-11', departmentId: 'sales', set: { pillars: SALES, attendancePillar: 'clients' } });
  const field = version({ id: 'f1', version: 1, appliesFrom: '2026-12', departmentId: 'field', set: { pillars: FIELD, attendancePillar: 'clients' } });
  const fieldBack = version({ id: 'f2', version: 2, appliesFrom: '2027-02', departmentId: 'field', followsCompany: true, set: { pillars: [], attendancePillar: '' } });
  const salesBack = version({ id: 's2', version: 2, appliesFrom: '2027-01', departmentId: 'sales', followsCompany: true, set: { pillars: [], attendancePillar: '' } });

  it('its team’s own; the department’s own job titles keep the department’s', () => {
    const of = pillarsResolver(COMPANY, [sales, field], DEPARTMENTS);
    expect(of('field')).toEqual({ framework: field, appliesFrom: '2026-12', department: { id: 'field', nameEn: 'Field Sales' } });
    expect(of('sales')).toEqual({ framework: sales, appliesFrom: '2026-11', department: { id: 'sales', nameEn: 'Sales' } });
  });

  it('its department’s when the team has none, or goes back to them, from the later month', () => {
    expect(pillarsResolver(COMPANY, [sales], DEPARTMENTS)('field')).toEqual({ framework: sales, appliesFrom: '2026-11', department: { id: 'sales', nameEn: 'Sales' } });
    expect(pillarsResolver(COMPANY, [sales, field, fieldBack], DEPARTMENTS)('field')).toEqual({ framework: sales, appliesFrom: '2027-02', department: { id: 'sales', nameEn: 'Sales' } });
  });

  it('the company’s when neither has its own, or the department goes back to them: the latest month of the line', () => {
    expect(pillarsResolver(COMPANY, [], DEPARTMENTS)('field')).toEqual({ framework: COMPANY[1], appliesFrom: '2026-11', department: null });
    expect(pillarsResolver(COMPANY, [sales, salesBack], DEPARTMENTS)('field')).toEqual({ framework: COMPANY[1], appliesFrom: '2027-01', department: null });
    expect(pillarsResolver(COMPANY, [sales, salesBack, field, fieldBack], DEPARTMENTS)('field')).toEqual({ framework: COMPANY[1], appliesFrom: '2027-02', department: null });
  });

  it('a team with its own isn’t held back by its department’s change', () => {
    expect(pillarsResolver(COMPANY, [sales, salesBack, field], DEPARTMENTS)('field')).toEqual({ framework: field, appliesFrom: '2026-12', department: { id: 'field', nameEn: 'Field Sales' } });
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
