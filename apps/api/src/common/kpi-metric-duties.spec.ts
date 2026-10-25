import {
  KPI_LIBRARY,
  KPI_SAMPLE_TEMPLATES,
  KPI_TEMPLATE_LIMITS,
  kpiMetricDuties,
  kpiSameDuty,
  kpiTemplateProblems,
  kpiTidyDuties,
  type KpiMetric,
} from '@trendlix/shared';
import { contentOf } from '../kpis/kpi-templates.service.js';
import { metricView } from '../kpis/kpi-views.js';

// A KPI metric linked to several JD duties (owner, 25 October 2026, on the template draft's "JD duty (optional)": "can
// i select 2 job descriptions?", then "Yes, several duties"; packages/shared kpis.ts KpiMetric.jdDuties): any of the
// job description's duty rows and duties typed, each trimmed and once (in any case), at most 10, each at most 300
// characters; a metric saved before with its one `jdDuty` read as a list of it, so nothing had to be migrated. Invented
// duties.

const metric = (over: Partial<KpiMetric> = {}): KpiMetric => ({
  pillar: 'delivery',
  name: 'Designs on time',
  definition: null,
  howMeasured: null,
  jdDuties: [],
  targetPoints: 30,
  criteria: [
    { label: 'All on time', points: 30 },
    { label: '1 late', points: 15 },
  ],
  ...over,
});

const problems = (m: Partial<KpiMetric> & Record<string, unknown>) => kpiTemplateProblems({ attendancePoints: 20, metrics: [metric(m as Partial<KpiMetric>)] });

describe('a metric’s JD duties', () => {
  it('are tidied: trimmed, empty ones left out, one given twice in any case or spacing kept once, the first', () => {
    expect(kpiTidyDuties(['  Create designs ', 'Revise designs based on internal or client feedback', '', '   ', 'create  DESIGNS', 'Present concepts'])).toEqual([
      'Create designs',
      'Revise designs based on internal or client feedback',
      'Present concepts',
    ]);
    expect(kpiTidyDuties([])).toEqual([]);
    expect(kpiSameDuty('Create designs', ' create   designs ')).toBe(true);
    expect(kpiSameDuty('Create designs', 'Create design')).toBe(false);
  });

  it('read a metric saved before with its one duty as a list of it, and the list over it when both are there', () => {
    // as kept before 25 October 2026 (kpi_metrics.jd_duty, no jd_duties yet), or answered by an API from before
    expect(kpiMetricDuties({ jdDuty: 'Create designs' })).toEqual(['Create designs']);
    expect(kpiMetricDuties({ jdDuties: [], jdDuty: ' Create designs ' })).toEqual(['Create designs']);
    expect(kpiMetricDuties({ jdDuties: [], jdDuty: null })).toEqual([]);
    expect(kpiMetricDuties({ jdDuty: '  ' })).toEqual([]);
    expect(kpiMetricDuties({})).toEqual([]);
    // saved since: the list (its first is kept in jd_duty too)
    expect(kpiMetricDuties({ jdDuties: ['Create designs', 'Present concepts'], jdDuty: 'Create designs' })).toEqual(['Create designs', 'Present concepts']);
    // one duty as text (an old client), and anything not text left out
    expect(kpiMetricDuties({ jdDuties: 'Create designs' })).toEqual(['Create designs']);
    expect(kpiMetricDuties({ jdDuties: ['Create designs', 7, null, 'create designs'] })).toEqual(['Create designs']);
  });

  it('a saved row reads as the pages show it: an old row’s one duty, a new row’s list', () => {
    const row = { id: 'm1', pillar: 'delivery', name: 'Designs on time', definition: null, howMeasured: null, targetPoints: 30, criteria: [{ label: 'All on time', points: 30 }] };
    expect(metricView({ ...row, jdDuty: 'Create designs', jdDuties: [] }).jdDuties).toEqual(['Create designs']);
    expect(metricView({ ...row, jdDuty: 'Create designs', jdDuties: ['Create designs', 'Present concepts'] })).toMatchObject({ jdDuties: ['Create designs', 'Present concepts'] });
    expect(metricView({ ...row, jdDuty: null, jdDuties: [] }).jdDuties).toEqual([]);
    // the one duty of before is no longer answered
    expect('jdDuty' in metricView({ ...row, jdDuty: 'Create designs', jdDuties: [] })).toBe(false);
  });

  it('as sent: a list tidied, one duty as text or an old client’s jdDuty as a list of it, anything else left for the rules', () => {
    const sent = (m: Record<string, unknown>) => contentOf({ attendancePoints: 20, metrics: [{ ...metric(), jdDuties: undefined, ...m }] }).metrics[0].jdDuties;
    expect(sent({ jdDuties: [' Create designs', 'Revise designs based on internal or client feedback', 'CREATE DESIGNS', 'Answer the art director'] })).toEqual([
      'Create designs',
      'Revise designs based on internal or client feedback',
      'Answer the art director',
    ]);
    expect(sent({ jdDuties: 'Create designs' })).toEqual(['Create designs']);
    expect(sent({ jdDuty: ' Create designs ' })).toEqual(['Create designs']);
    expect(sent({ jdDuty: null })).toEqual([]);
    expect(sent({})).toEqual([]);
    expect(sent({ jdDuties: null, jdDuty: 'Create designs' })).toEqual(['Create designs']);
    // an empty list with the old field reads it, as a row kept before does (no client of ours sends both)
    expect(sent({ jdDuties: [], jdDuty: 'Create designs' })).toEqual(['Create designs']);
    expect(sent({ jdDuties: ['Create designs', 5] })).toEqual(['Create designs', 5]);
    expect(sent({ jdDuties: 5 })).toBe(5);
    const refused = contentOf({ attendancePoints: 20, metrics: [{ ...metric(), jdDuties: ['Create designs', { duty: 'x' }] }] });
    expect(kpiTemplateProblems(refused)).toEqual(['Metric 1 (Designs on time): its JD duties must be a list of texts.']);
    expect(kpiTemplateProblems(contentOf({ attendancePoints: 20, metrics: [{ ...metric(), jdDuties: 5 }] }))).toEqual(['Metric 1 (Designs on time): its JD duties must be a list of texts.']);
  });

  it('take at most 10, each at most 300 characters, each said by its number', () => {
    const L = KPI_TEMPLATE_LIMITS;
    expect(L.duties).toBe(10);
    const ten = Array.from({ length: 10 }, (_, i) => `Duty ${i + 1}`);
    expect(problems({ jdDuties: ten })).toEqual([]);
    expect(problems({ jdDuties: [...ten, 'Duty 11'] })).toEqual(['Metric 1 (Designs on time): link it to at most 10 JD duties.']);
    // the same one twice counts once
    expect(problems({ jdDuties: [...ten, 'duty 10'] })).toEqual([]);
    expect(problems({ jdDuties: ['Create designs', 'x'.repeat(L.duty)] })).toEqual([]);
    expect(problems({ jdDuties: ['Create designs', 'x'.repeat(L.duty + 1)] })).toEqual(['Metric 1 (Designs on time): its JD duty 2 can be at most 300 characters.']);
    expect(problems({ jdDuties: 'Create designs' as unknown as string[] })).toEqual(['Metric 1 (Designs on time): its JD duties must be a list of texts.']);
    // a metric of before, its one duty: checked as a list of it
    expect(problems({ jdDuties: undefined, jdDuty: 'x'.repeat(L.duty + 1) })).toEqual(['Metric 1 (Designs on time): its JD duty 1 can be at most 300 characters.']);
    expect(problems({ jdDuties: undefined, jdDuty: 'Create designs' })).toEqual([]);
  });

  it('the samples and the role library give each metric its one duty as a list of it', () => {
    for (const s of KPI_SAMPLE_TEMPLATES) for (const m of s.metrics) expect({ m: m.name, duties: m.jdDuties.length, old: 'jdDuty' in m }).toEqual({ m: m.name, duties: 1, old: false });
    for (const t of KPI_LIBRARY) for (const m of t.metrics) expect({ m: m.name, duties: m.jdDuties.length, old: 'jdDuty' in m }).toEqual({ m: m.name, duties: 1, old: false });
  });
});
