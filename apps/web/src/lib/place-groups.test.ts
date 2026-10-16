import { describe, expect, it } from 'vitest';
import { groupByPlace, peopleCount, placeOf, showsDepartment } from './place-groups';

const row = (name: string, department: string | null) => ({ name, department });
const group = (rows: ReturnType<typeof row>[]) => groupByPlace(rows, (r) => r.department);
const shape = (groups: ReturnType<typeof group>) =>
  groups.map((g) => [g.department, g.count, g.teams.map((t) => [t.team, t.rows.map((r) => r.name)])]);

describe('placeOf', () => {
  it('splits a team from its department', () => {
    expect(placeOf('Marketing Department › Content Creation Team')).toEqual({ department: 'Marketing Department', team: 'Content Creation Team' });
  });

  it('takes a department alone, and nothing as no department', () => {
    expect(placeOf('Sales')).toEqual({ department: 'Sales', team: null });
    expect(placeOf(null)).toEqual({ department: null, team: null });
    expect(placeOf('  ')).toEqual({ department: null, team: null });
  });
});

describe('groupByPlace', () => {
  it('groups by department, then by team, keeping the order within a team', () => {
    const rows = [
      row('Marina', 'Marketing Department › Account Management Team'),
      row('Yasmine', 'Marketing Department › Account Management Team'),
      row('Habiba', 'Marketing Department › Content Creation Team'),
      row('Maryam', 'Marketing Department › Content Creation Team'),
    ];
    expect(shape(group(rows))).toEqual([
      [
        'Marketing Department',
        4,
        [
          ['Account Management Team', ['Marina', 'Yasmine']],
          ['Content Creation Team', ['Habiba', 'Maryam']],
        ],
      ],
    ]);
  });

  it('puts departments by name, those without one last, and a department’s own people before its teams', () => {
    const rows = [
      row('Omar', null),
      row('Nada', 'Sales › Field Team'),
      row('Hazem', 'Marketing Department'),
      row('Ali', 'Sales'),
      row('Sara', 'Marketing Department › Content Creation Team'),
    ];
    expect(shape(group(rows))).toEqual([
      [
        'Marketing Department',
        2,
        [
          [null, ['Hazem']],
          ['Content Creation Team', ['Sara']],
        ],
      ],
      [
        'Sales',
        2,
        [
          [null, ['Ali']],
          ['Field Team', ['Nada']],
        ],
      ],
      [null, 1, [[null, ['Omar']]]],
    ]);
  });

  it('gives nothing for no rows', () => {
    expect(group([])).toEqual([]);
  });
});

describe('showsDepartment', () => {
  it('leaves out a lone No Department heading, but not one beside other departments', () => {
    const alone = group([row('Omar', null), row('Ali', null)]);
    expect(showsDepartment(alone, alone[0])).toBe(false);
    const mixed = group([row('Omar', null), row('Ali', 'Sales')]);
    expect(mixed.map((g) => showsDepartment(mixed, g))).toEqual([true, true]);
  });
});

describe('peopleCount', () => {
  it('counts people', () => {
    expect(peopleCount(1)).toBe('1 employee');
    expect(peopleCount(4)).toBe('4 employees');
  });
});
