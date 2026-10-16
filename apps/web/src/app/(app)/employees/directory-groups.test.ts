import { describe, expect, it } from 'vitest';
import type { EmployeeSummary } from '../../../lib/types';
import { directorySections } from './directory-groups';

type Row = Pick<EmployeeSummary, 'employment'> & { name: string };
const marketing = { id: 'm', nameEn: 'Marketing Department', parent: null };
const team = (nameEn: string) => ({ id: nameEn, nameEn, parent: { id: 'm', nameEn: 'Marketing Department' } });
const employed = (name: string, department: unknown): Row => ({ name, employment: { department } as EmployeeSummary['employment'] });
const notEmployed = (name: string): Row => ({ name, employment: null });

const shape = (rows: Row[]) =>
  directorySections(rows).map((s) => [s.label, s.count, s.groups.map((g) => [g.department, g.teams.map((t) => [t.team, t.rows.map((r) => r.name)])])]);

describe('directorySections', () => {
  it('puts the people employed now under Active and the rest under Inactive, each by department, then team', () => {
    expect(
      shape([
        notEmployed('Salma'),
        employed('Habiba', team('Content Creation Team')),
        employed('Marina', team('Account Management Team')),
        employed('Hazem', marketing),
        employed('Lamiaa', null),
        notEmployed('Ahmed'),
      ]),
    ).toEqual([
      [
        'Active',
        4,
        [
          [
            'Marketing Department',
            [
              [null, ['Hazem']],
              ['Account Management Team', ['Marina']],
              ['Content Creation Team', ['Habiba']],
            ],
          ],
          [null, [[null, ['Lamiaa']]]],
        ],
      ],
      ['Inactive', 2, [[null, [[null, ['Salma', 'Ahmed']]]]]],
    ]);
  });

  it('leaves out a section with nobody in it', () => {
    expect(shape([notEmployed('Salma')]).map(([label]) => label)).toEqual(['Inactive']);
    expect(shape([])).toEqual([]);
  });
});
