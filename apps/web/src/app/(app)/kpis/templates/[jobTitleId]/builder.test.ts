import { KPI_DEFAULT_PILLAR_SET, kpiSample, kpiTemplateProblems, type KpiPillarSet, type KpiTemplateContent } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  aboveTarget,
  addCriterion,
  addMetric,
  canMove,
  chooseDuty,
  contentFromJson,
  contentOf,
  DUTY_TYPED,
  dutyChoice,
  formGroups,
  formOf,
  moveMetric,
  onlyForPublishing,
  pillarGroups,
  pillarsFromJson,
  removeCriterion,
  removeMetric,
  updateCriterion,
  updateMetric,
} from './builder';

// owner, 21 October 2026: "Full framework per role", "Templates: HR"; the HR Specialist sample of the framework
const sample = kpiSample('HR-SP v3')!;
const DUTIES = ['Run recruitment end to end', 'Prepare payroll inputs'];
const FOUR = KPI_DEFAULT_PILLAR_SET;
/** Three pillars of HR's (owner, 21 October 2026: "Fully flexible"), the Attendance metric in Growth. */
const THREE: KpiPillarSet = {
  pillars: [
    { key: 'delivery', name: 'Delivery', short: 'Delivery', weight: 50 },
    { key: 'quality', name: 'Quality of Work', short: 'Quality', weight: 30 },
    { key: 'growth', name: 'Growth', short: 'Growth', weight: 20 },
  ],
  attendancePillar: 'growth',
};

const content: KpiTemplateContent = {
  attendancePoints: 20,
  metrics: [
    {
      id: 'q1',
      pillar: 'quality',
      name: 'Monthly payroll accuracy',
      definition: 'Payroll inputs correct',
      howMeasured: null,
      jdDuty: 'Prepare payroll inputs',
      targetPoints: 50,
      criteria: [
        { label: '0 errors', points: 50 },
        { label: '1–2 errors', points: 40 },
      ],
    },
    {
      id: 'd1',
      pillar: 'delivery',
      name: 'Time-to-hire',
      definition: null,
      howMeasured: 'Days to offer',
      jdDuty: 'Something typed',
      targetPoints: 35,
      criteria: [
        { label: 'No delays', points: 35 },
        { label: '1–2 delays', points: 30 },
        { label: '3+ delays', points: 20 },
      ],
    },
  ],
};

describe('the draft as the form holds it', () => {
  it('starts from the content in pillar order, numbers as text, a duty not in the JD as typed', () => {
    const form = formOf(content, DUTIES, FOUR);
    expect(form.attendancePoints).toBe('20');
    expect(form.metrics.map((m) => [m.key, m.id, m.pillar, m.name, m.jdDuty, m.dutyTyped, m.targetPoints])).toEqual([
      ['m0', 'd1', 'delivery', 'Time-to-hire', 'Something typed', true, '35'],
      ['m1', 'q1', 'quality', 'Monthly payroll accuracy', 'Prepare payroll inputs', false, '50'],
    ]);
    expect(form.metrics[0].criteria).toEqual([
      { key: 'm0c0', label: 'No delays', points: '35' },
      { key: 'm0c1', label: '1–2 delays', points: '30' },
      { key: 'm0c2', label: '3+ delays', points: '20' },
    ]);
    expect(form.metrics[0].definition).toBe('');
  });

  it('gives back the content, trimmed, empty texts as none, in pillar order', () => {
    const form = formOf(content, DUTIES, FOUR);
    expect(contentOf(form)).toEqual({ attendancePoints: 20, metrics: [content.metrics[1], content.metrics[0]] });
    const typed = updateMetric(form, 'm0', { name: '  Time-to-hire  ', definition: '   ', jdDuty: '' });
    expect(contentOf(typed).metrics[0]).toMatchObject({ name: 'Time-to-hire', definition: null, jdDuty: null });
  });

  it('starts from a sample as it is, its duties typed when they aren’t the JD’s rows', () => {
    const form = formOf(sample, DUTIES, FOUR);
    expect(form.metrics).toHaveLength(8);
    expect(contentOf(form)).toEqual({ attendancePoints: 20, metrics: sample.metrics });
    expect(kpiTemplateProblems(contentOf(form), { publishing: true })).toEqual([]);
    // two of its duties are the JD's rows here
    expect(form.metrics.filter((m) => !m.dutyTyped).map((m) => m.jdDuty)).toEqual(['Run recruitment end to end', 'Prepare payroll inputs']);
    expect(form.metrics.filter((m) => m.dutyTyped)).toHaveLength(6);
  });

  it('sends numbers not whole as NaN, which the rules refuse', () => {
    const form = updateMetric(formOf(content, DUTIES, FOUR), 'm0', { targetPoints: '3.5' });
    const sent = contentOf({ ...form, attendancePoints: '' });
    expect(Number.isNaN(sent.attendancePoints)).toBe(true);
    expect(Number.isNaN(sent.metrics[0].targetPoints)).toBe(true);
    expect(kpiTemplateProblems(sent)).toEqual([
      'Give the Attendance metric whole points from 1 to 200.',
      'Metric 1 (Time-to-hire): give its target whole points from 1 to 200.',
    ]);
  });

  it('reads the content a form sent, and nothing else', () => {
    expect(contentFromJson(JSON.stringify(content))).toEqual(content);
    for (const bad of [undefined, 3, '', 'not json', '[]', 'null', '{"attendancePoints":20}', '{"attendancePoints":20,"metrics":[{"name":"x"}]}']) {
      expect(contentFromJson(bad)).toBeNull();
    }
  });

  it('reads the pillars a form sent, and nothing else', () => {
    expect(pillarsFromJson(JSON.stringify(THREE))).toEqual(THREE);
    for (const bad of [undefined, '', 'nope', '{"pillars":[],"attendancePillar":"x"}', '{"pillars":[{"key":"a"}],"attendancePillar":"a"}', '{"pillars":[{"key":"a","name":"A","weight":100}]}']) {
      expect(pillarsFromJson(bad)).toBeNull();
    }
  });
});

describe('the pillars', () => {
  it('group the metrics with their numbers and max points, Attendance’s in Discipline & Growth', () => {
    const groups = pillarGroups(content.metrics, 20, FOUR);
    expect(groups.map((g) => [g.pillar?.name, g.pillar?.weight, g.attendance, g.metrics.map((m) => [m.number, m.name]), g.max])).toEqual([
      ['Delivery & Timeliness', 30, false, [[1, 'Time-to-hire']], 35],
      ['Quality of Work', 25, false, [[2, 'Monthly payroll accuracy']], 50],
      ['Clients & Teamwork', 25, false, [], 0],
      ['Discipline & Growth', 20, true, [], 20],
    ]);
    // the sample: Discipline & Growth's 50 + 50 and Attendance's 20
    expect(pillarGroups(sample.metrics, sample.attendancePoints, FOUR).map((g) => g.max)).toEqual([65, 75, 55, 120]);
  });

  it('group them in other pillars, Attendance in the chosen one, those in no pillar last in Unplaced', () => {
    const metrics = [...content.metrics, { ...content.metrics[0], id: 'c1', name: 'Client feedback', pillar: null, wasIn: 'Clients & Teamwork' }];
    const groups = pillarGroups(metrics, 20, THREE);
    expect(groups.map((g) => [g.pillar?.key ?? null, g.attendance, g.metrics.map((m) => [m.number, m.name]), g.max])).toEqual([
      ['delivery', false, [[1, 'Time-to-hire']], 35],
      ['quality', false, [[2, 'Monthly payroll accuracy']], 50],
      ['growth', true, [], 20],
      [null, false, [[3, 'Client feedback']], 50],
    ]);
    // no Unplaced group when every metric has a pillar
    expect(pillarGroups(content.metrics, 20, THREE).map((g) => g.pillar?.key)).toEqual(['delivery', 'quality', 'growth']);
  });

  it('number the form’s metrics as the problems do, a target not whole counting 0', () => {
    const form = updateMetric(formOf(content, DUTIES, FOUR), 'm1', { targetPoints: 'x' });
    const groups = formGroups(form);
    expect(groups.map((g) => g.metrics.map((m) => [m.number, m.form.key]))).toEqual([[[1, 'm0']], [[2, 'm1']], [], []]);
    expect(groups.map((g) => g.max)).toEqual([35, 0, 0, 20]);
  });

  it('say when a criterion is worth more than the target: allowed, up to the 110% cap', () => {
    expect(aboveTarget('40', '35')).toBe(true);
    expect(aboveTarget(35, 35)).toBe(false);
    expect(aboveTarget('', '35')).toBe(false);
    expect(aboveTarget('40', '')).toBe(false);
  });
});

describe('changing the draft', () => {
  const form = formOf(content, DUTIES, FOUR);

  it('adds a metric last in its pillar, with three empty criteria, and removes one', () => {
    const added = addMetric(form, 'delivery', 'n1');
    expect(added.metrics.map((m) => [m.key, m.pillar])).toEqual([
      ['m0', 'delivery'],
      ['n1', 'delivery'],
      ['m1', 'quality'],
    ]);
    expect(contentOf(added).metrics.map((m) => m.name)).toEqual(['Time-to-hire', '', 'Monthly payroll accuracy']);
    expect(added.metrics.find((m) => m.key === 'n1')!.criteria.map((c) => c.key)).toEqual(['n1c0', 'n1c1', 'n1c2']);
    expect(removeMetric(added, 'm0').metrics.map((m) => m.key)).toEqual(['n1', 'm1']);
    // the form it came from as it was
    expect(form.metrics).toHaveLength(2);
  });

  it('moves a metric within its pillar only', () => {
    const three = addMetric(form, 'delivery', 'n1');
    expect(canMove(three, 'm0', -1)).toBe(false);
    expect(canMove(three, 'm0', 1)).toBe(true);
    // the next is in another pillar
    expect(canMove(three, 'n1', 1)).toBe(false);
    expect(canMove(three, 'm1', -1)).toBe(false);
    expect(contentOf(moveMetric(three, 'm0', 1)).metrics.map((m) => m.name)).toEqual(['', 'Time-to-hire', 'Monthly payroll accuracy']);
    expect(moveMetric(three, 'm0', -1)).toBe(three);
  });

  it('moves a metric given another pillar to the end of that pillar’s', () => {
    const three = addMetric(form, 'quality', 'n1');
    const moved = updateMetric(three, 'm0', { pillar: 'quality' });
    expect(contentOf(moved).metrics.map((m) => [m.pillar, m.name])).toEqual([
      ['quality', 'Monthly payroll accuracy'],
      ['quality', ''],
      ['quality', 'Time-to-hire'],
    ]);
  });

  it('keeps a metric in Unplaced with the pillar it was in, sent last, until it is given a pillar', () => {
    const unplaced = formOf({ ...content, metrics: [{ ...content.metrics[0], pillar: null, wasIn: 'Clients & Teamwork' }, content.metrics[1]] }, DUTIES, THREE);
    expect(unplaced.metrics.map((m) => [m.key, m.pillar, m.wasIn])).toEqual([
      ['m0', 'delivery', null],
      ['m1', null, 'Clients & Teamwork'],
    ]);
    expect(contentOf(unplaced).metrics.map((m) => [m.pillar, m.wasIn])).toEqual([
      ['delivery', undefined],
      [null, 'Clients & Teamwork'],
    ]);
    expect(kpiTemplateProblems(contentOf(unplaced), { pillars: THREE })).toEqual([]);
    expect(kpiTemplateProblems(contentOf(unplaced), { publishing: true, pillars: THREE })).toEqual([
      'Metric 2 (Monthly payroll accuracy) is in Unplaced: its pillar, Clients & Teamwork, is no longer in the KPI framework. Move it into a pillar, or remove it, before publishing.',
      'Add a metric to Quality of Work: every pillar is scored.',
    ]);
    const placed = updateMetric(unplaced, 'm1', { pillar: 'quality' });
    expect(placed.metrics.find((m) => m.key === 'm1')).toMatchObject({ pillar: 'quality', wasIn: null });
    expect(kpiTemplateProblems(contentOf(placed), { publishing: true, pillars: THREE })).toEqual([]);
  });

  it('adds criteria up to 6 and removes them down to 2', () => {
    let f = form;
    for (let i = 0; i < 5; i++) f = addCriterion(f, 'm0', `x${i}`);
    expect(f.metrics[0].criteria).toHaveLength(6);
    f = removeCriterion(f, 'm1', 'm1c0');
    expect(f.metrics[1].criteria).toHaveLength(2);
    f = removeCriterion(f, 'm0', 'm0c1');
    expect(f.metrics[0].criteria.map((c) => c.key)).toEqual(['m0c0', 'm0c2', 'x0', 'x1', 'x2']);
    f = updateCriterion(f, 'm0', 'x0', { label: 'Above', points: '40' });
    expect(f.metrics[0].criteria[2]).toEqual({ key: 'x0', label: 'Above', points: '40' });
  });
});

describe('the JD duty ("so HR can link duties")', () => {
  it('is one of the JD’s rows, typed, or none', () => {
    expect(dutyChoice({ jdDuty: 'Prepare payroll inputs', dutyTyped: false }, DUTIES)).toBe('Prepare payroll inputs');
    expect(dutyChoice({ jdDuty: 'Something typed', dutyTyped: true }, DUTIES)).toBe(DUTY_TYPED);
    expect(dutyChoice({ jdDuty: '', dutyTyped: false }, DUTIES)).toBe('');
    expect(chooseDuty({ jdDuty: 'Prepare payroll inputs' }, DUTY_TYPED)).toEqual({ dutyTyped: true, jdDuty: 'Prepare payroll inputs' });
    expect(chooseDuty({ jdDuty: 'x' }, 'Run recruitment end to end')).toEqual({ dutyTyped: false, jdDuty: 'Run recruitment end to end' });
    expect(chooseDuty({ jdDuty: 'x' }, '')).toEqual({ dutyTyped: false, jdDuty: '' });
  });
});

describe('the problems', () => {
  it('for publishing, leave out those said for saving', () => {
    const blank = contentOf({ attendancePoints: '20', metrics: [], pillars: FOUR });
    const saving = kpiTemplateProblems(blank);
    expect(saving).toEqual([]);
    expect(onlyForPublishing(kpiTemplateProblems(blank, { publishing: true }), saving)).toEqual([
      'Add a metric to Delivery & Timeliness: every pillar is scored.',
      'Add a metric to Quality of Work: every pillar is scored.',
      'Add a metric to Clients & Teamwork: every pillar is scored.',
    ]);
  });
});
