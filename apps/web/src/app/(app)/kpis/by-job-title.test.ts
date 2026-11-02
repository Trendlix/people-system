import type { KpiScorecardSummary } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { byJobTitle, jobTitleNote, placeOf } from './by-job-title';

// All KPIs by job title under its team (owner, 2 November 2026: "i want KPI's Per Job Title under the team").

const card = (name: string, department: string | null, jobTitle: string | null, finalPercent: number | null) =>
  ({ id: name, employee: { id: name, fullNameEn: name, employeeCode: name }, department, jobTitle, finalPercent }) as unknown as KpiScorecardSummary;

describe('scorecards by job title under the team', () => {
  it('reads the department and the team', () => {
    expect(placeOf('Marketing › Account Management')).toEqual({ department: 'Marketing', team: 'Account Management' });
    expect(placeOf('Marketing')).toEqual({ department: 'Marketing', team: null });
    expect(placeOf(null)).toEqual({ department: null, team: null });
  });

  it('groups by department, team (the department’s own first) and job title, with each job title’s average', () => {
    const groups = byJobTitle([
      card('Zeina', 'Marketing › Account Management', 'Account Manager', 80),
      card('Adel', 'Marketing › Account Management', 'Account Manager', 91),
      card('Mona', 'Marketing › Account Management', 'Account Manager', null),
      card('Hala', 'Marketing', 'Marketing Manager', 95),
      card('Omar', 'Marketing › Content', 'Content Creator', null),
      card('Sara', 'Business Development', 'Business Developer', 70),
      card('Nour', null, null, null),
    ]);
    expect(groups.map((d) => [d.department, d.count])).toEqual([
      ['Business Development', 1],
      ['Marketing', 5],
      [null, 1],
    ]);
    const marketing = groups[1];
    expect(marketing.teams.map((t) => [t.team, t.count])).toEqual([
      [null, 1],
      ['Account Management', 3],
      ['Content', 1],
    ]);
    const managers = marketing.teams[1].jobTitles[0];
    expect(managers).toMatchObject({ jobTitle: 'Account Manager', scored: 2, average: 85.5 });
    expect(managers.scorecards.map((s) => s.employee.fullNameEn)).toEqual(['Adel', 'Mona', 'Zeina']);
    expect(jobTitleNote(managers)).toBe('2 of 3 scored · average 85.5%');
    expect(jobTitleNote(marketing.teams[2].jobTitles[0])).toBe('None scored yet');
  });
});
