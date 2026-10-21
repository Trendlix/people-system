import { describe, expect, it } from 'vitest';
import { heatCell, latestOf, levelRows, levelsLabel, monthShort, scoredText } from './heatmap';

// The KPI heatmap and the level distribution (owner's brief, 21 October 2026: "a team overview heatmap (people × months,
// final % coloured by level) with the level distribution"). Every person here is invented.

const ID = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';

describe('a heatmap cell', () => {
  it('shows the final % coloured by its level, opening the scorecard', () => {
    expect(heatCell({ id: ID, finalPercent: 86, level: 'needs_improvement', status: 'final' }, '2026-09', 'Mona Adel')).toEqual({
      href: `/kpis/scorecards/${ID}`,
      text: '86%',
      className: 'bg-warn-soft text-warn',
      label: 'Mona Adel, September 2026: 86%, Needs improvement',
    });
    expect(heatCell({ id: ID, finalPercent: 104.25, level: 'above', status: 'sign_off' }, '2026-10', 'Mona Adel').text).toBe('104.3%');
  });

  it('shows the step of one not scored yet, in grey', () => {
    const c = heatCell({ id: ID, finalPercent: null, level: null, status: 'self_rating' }, '2026-10', 'Mona Adel');
    expect(c).toMatchObject({ href: `/kpis/scorecards/${ID}`, text: 'Self', className: 'bg-line-soft text-muted' });
    expect(c.label).toBe('Mona Adel, October 2026: self-rating, not scored yet');
    expect(heatCell({ id: ID, finalPercent: null, level: null, status: 'manager' }, '2026-10', 'Mona Adel').text).toBe('Scoring');
  });

  it('leaves a month without a scorecard empty', () => {
    expect(heatCell(null, '2026-08', 'Mona Adel')).toEqual({ href: null, text: '', className: 'bg-canvas', label: 'Mona Adel, August 2026: no scorecard' });
  });

  it('names the months short', () => {
    expect(monthShort('2026-10')).toBe('Oct 2026');
    expect(monthShort('2027-01')).toBe('Jan 2027');
  });
});

describe('a person’s latest level', () => {
  it('takes the last scored month and the change from the scored one before', () => {
    const cells = [
      { id: 'a', finalPercent: 82, level: 'needs_improvement' as const, status: 'final' as const },
      null,
      { id: 'b', finalPercent: 91.5, level: 'meets' as const, status: 'final' as const },
      { id: 'c', finalPercent: null, level: null, status: 'manager' as const },
    ];
    expect(latestOf(cells)).toEqual({ level: 'meets', percent: 91.5, change: '+9.5' });
    expect(latestOf([cells[2], { id: 'd', finalPercent: 88, level: 'needs_improvement', status: 'final' }])?.change).toBe('−3.5');
    expect(latestOf([cells[2], cells[2]])?.change).toBe('±0');
    expect(latestOf([cells[0]])?.change).toBeNull();
    expect(latestOf([null, cells[3]])).toBeNull();
  });
});

describe('the level distribution', () => {
  it('counts each level from the top down, with its share of those scored', () => {
    const rows = levelRows({ above: 1, meets: 2, needs_improvement: 1, unsatisfactory: 0, unacceptable: 0 });
    expect(rows.map((r) => [r.level, r.count, r.share])).toEqual([
      ['above', 1, 25],
      ['meets', 2, 50],
      ['needs_improvement', 1, 25],
      ['unsatisfactory', 0, 0],
      ['unacceptable', 0, 0],
    ]);
    expect(rows[0]).toMatchObject({ label: 'Above expectations', range: 'Above 100%' });
    expect(levelsLabel(rows)).toBe('Above expectations 1, Meets expectations 2, Needs improvement 1, Unsatisfactory 0, Unacceptable 0');
  });

  it('shares nothing when none is scored', () => {
    expect(levelRows({}).every((r) => r.count === 0 && r.share === 0)).toBe(true);
    expect(levelRows({ meets: 1, above: 2 }).map((r) => r.share)).toEqual([66.7, 33.3, 0, 0, 0]);
  });

  it('says how many are scored', () => {
    expect(scoredText(4, 6)).toBe('4 of 6 scored');
  });
});
