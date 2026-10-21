import {
  KPI_ATTENDANCE_PILLAR,
  KPI_PILLARS,
  KPI_TEMPLATE_LIMITS,
  type KpiCriterion,
  type KpiMetric,
  type KpiPillar,
  type KpiPillarId,
  type KpiTemplateContent,
} from '@trendlix/shared';
import { wholeOf } from '../templates';

// A job title's KPI template builder (owner, 21 October 2026: "Full framework per role"; "Templates: HR"): the draft as
// HR edits it, its metrics grouped by the four pillars, each with its pillar, name, definition, how it's measured, the
// JD duty it is linked to ("Show the job title's JD next to the builder, so HR can link duties"), its target points and
// its criteria scale ("No delays = 35 / 1–2 delays = 30 / 3+ = 20"), one picked each month; the automatic Attendance
// metric's points in Discipline & Growth. The form keeps what is typed as text, so a number can be typed freely; the
// content sent (and checked live with kpiTemplateProblems) has the metrics in pillar order, so "Metric 3" in a problem
// is the third shown. Pure code, tested; relative imports, as vitest doesn't know the @/ paths.

/** A criterion as typed: its label and points. `key`: the form's own, to keep each row's fields apart. */
export interface CriterionForm {
  key: string;
  label: string;
  points: string;
}

/** A metric as typed. `id`: the saved metric's, kept so the API keeps it. */
export interface MetricForm {
  key: string;
  id?: string;
  pillar: KpiPillarId;
  name: string;
  definition: string;
  howMeasured: string;
  /** The JD duty it is linked to: one of the JD's duty rows, or typed (`dutyTyped`). */
  jdDuty: string;
  dutyTyped: boolean;
  targetPoints: string;
  criteria: CriterionForm[];
}

/** The draft as typed: the Attendance metric's points and the metrics. */
export interface DraftForm {
  attendancePoints: string;
  metrics: MetricForm[];
}

/** In pillar order, each pillar's in the order they came (a stable sort). */
export const inPillarOrder = <M extends { pillar: KpiPillarId }>(metrics: readonly M[]): M[] => [...metrics].sort((a, b) => a.pillar - b.pillar);

/** The Select's choice for a duty typed rather than picked from the JD's rows. */
export const DUTY_TYPED = '__typed__';

/** A saved metric (or a sample's) as the form shows it. */
function metricFormOf(m: KpiMetric, key: string, duties: readonly string[]): MetricForm {
  const duty = m.jdDuty ?? '';
  return {
    key,
    ...(m.id ? { id: m.id } : {}),
    pillar: m.pillar,
    name: m.name,
    definition: m.definition ?? '',
    howMeasured: m.howMeasured ?? '',
    jdDuty: duty,
    dutyTyped: duty !== '' && !duties.includes(duty),
    targetPoints: String(m.targetPoints),
    criteria: m.criteria.map((c, j) => ({ key: `${key}c${j}`, label: c.label, points: String(c.points) })),
  };
}

/** A draft's content as the form starts with it. */
export function formOf(content: Pick<KpiTemplateContent, 'attendancePoints' | 'metrics'>, duties: readonly string[]): DraftForm {
  return {
    attendancePoints: String(content.attendancePoints),
    metrics: inPillarOrder(content.metrics).map((m, i) => metricFormOf(m, `m${i}`, duties)),
  };
}

const textOrNull = (text: string): string | null => (text.trim() ? text.trim() : null);

/** What the form says, as the draft's content to check and save: in pillar order, numbers not whole as NaN. */
export function contentOf(form: DraftForm): KpiTemplateContent {
  return {
    attendancePoints: wholeOf(form.attendancePoints),
    metrics: inPillarOrder(form.metrics).map(
      (m): KpiMetric => ({
        ...(m.id ? { id: m.id } : {}),
        pillar: m.pillar,
        name: m.name.trim(),
        definition: textOrNull(m.definition),
        howMeasured: textOrNull(m.howMeasured),
        jdDuty: textOrNull(m.jdDuty),
        targetPoints: wholeOf(m.targetPoints),
        criteria: m.criteria.map((c): KpiCriterion => ({ label: c.label.trim(), points: wholeOf(c.points) })),
      }),
    ),
  };
}

/** A draft's content as the form sent it (JSON), or null when it isn't one. */
export function contentFromJson(text: unknown): KpiTemplateContent | null {
  if (typeof text !== 'string') return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Partial<KpiTemplateContent>;
  if (!Array.isArray(v.metrics) || !v.metrics.every((m) => m && typeof m === 'object' && Array.isArray(m.criteria))) return null;
  return { attendancePoints: v.attendancePoints as number, metrics: v.metrics };
}

// ---------- the pillars ----------

/** A pillar with its metrics (in their order) and its max points: its targets added up, Attendance's in Discipline & Growth. */
export interface PillarGroup<M> {
  pillar: KpiPillar;
  metrics: M[];
  max: number;
}

const pointsOrZero = (n: number) => (Number.isFinite(n) ? n : 0);

/**
 * The four pillars with their metrics and max points (pillar % = achieved ÷ max points; owner, 21 October 2026), each
 * metric with its number in the template: Metric 1 the first of Delivery & Timeliness.
 */
export function pillarGroups<M extends { pillar: KpiPillarId; targetPoints: number }>(metrics: readonly M[], attendancePoints: number): PillarGroup<M & { number: number }>[] {
  const numbered = inPillarOrder(metrics).map((m, i) => ({ ...m, number: i + 1 }));
  return KPI_PILLARS.map((pillar) => {
    const inIt = numbered.filter((m) => m.pillar === pillar.id);
    const targets = inIt.reduce((sum, m) => sum + pointsOrZero(m.targetPoints), 0);
    return { pillar, metrics: inIt, max: targets + (pillar.id === KPI_ATTENDANCE_PILLAR ? pointsOrZero(attendancePoints) : 0) };
  });
}

/** The form's metrics by pillar, as the content numbers them, each with its max points. */
export function formGroups(form: DraftForm): PillarGroup<{ form: MetricForm; number: number }>[] {
  const content = contentOf(form);
  const sorted = inPillarOrder(form.metrics);
  return pillarGroups(
    sorted.map((m, i) => ({ form: m, pillar: m.pillar, targetPoints: content.metrics[i].targetPoints })),
    content.attendancePoints,
  ).map((g) => ({ ...g, metrics: g.metrics.map((m) => ({ form: m.form, number: m.number })) }));
}

/** Whether a criterion is worth more than its metric's target: allowed (a final % may reach 110%), and said. */
export function aboveTarget(points: string | number, target: string | number): boolean {
  const [p, t] = [typeof points === 'number' ? points : wholeOf(points), typeof target === 'number' ? target : wholeOf(target)];
  return Number.isFinite(p) && Number.isFinite(t) && p > t;
}

// ---------- changing the draft (each a new form, the old one left as it was) ----------

const L = KPI_TEMPLATE_LIMITS;

/** A new metric in a pillar, after its others, with three empty criteria to fill (from 2 to 6). */
export function addMetric(form: DraftForm, pillar: KpiPillarId, key: string): DraftForm {
  const metric: MetricForm = {
    key,
    pillar,
    name: '',
    definition: '',
    howMeasured: '',
    jdDuty: '',
    dutyTyped: false,
    targetPoints: '',
    criteria: [0, 1, 2].map((j) => ({ key: `${key}c${j}`, label: '', points: '' })),
  };
  return { ...form, metrics: [...inPillarOrder(form.metrics), metric] };
}

export function removeMetric(form: DraftForm, key: string): DraftForm {
  return { ...form, metrics: form.metrics.filter((m) => m.key !== key) };
}

/** A metric's fields changed. */
export function updateMetric(form: DraftForm, key: string, patch: Partial<Omit<MetricForm, 'key' | 'id' | 'criteria'>>): DraftForm {
  const moved = patch.pillar !== undefined && form.metrics.some((m) => m.key === key && m.pillar !== patch.pillar);
  const metrics = form.metrics.map((m) => (m.key === key ? { ...m, ...patch } : m));
  // moved to another pillar: last of its new pillar's
  if (!moved) return { ...form, metrics };
  const metric = metrics.find((m) => m.key === key)!;
  return { ...form, metrics: [...inPillarOrder(metrics.filter((m) => m.key !== key)), metric] };
}

/** Whether a metric can move up (-1) or down (1) within its pillar. */
export function canMove(form: DraftForm, key: string, step: -1 | 1): boolean {
  const sorted = inPillarOrder(form.metrics);
  const at = sorted.findIndex((m) => m.key === key);
  const next = sorted[at + step];
  return at >= 0 && !!next && next.pillar === sorted[at].pillar;
}

/** A metric moved up or down within its pillar (the metrics' order is the template's). */
export function moveMetric(form: DraftForm, key: string, step: -1 | 1): DraftForm {
  if (!canMove(form, key, step)) return form;
  const sorted = inPillarOrder(form.metrics);
  const at = sorted.findIndex((m) => m.key === key);
  [sorted[at], sorted[at + step]] = [sorted[at + step], sorted[at]];
  return { ...form, metrics: sorted };
}

const withCriteria = (form: DraftForm, key: string, change: (criteria: CriterionForm[]) => CriterionForm[]): DraftForm => ({
  ...form,
  metrics: form.metrics.map((m) => (m.key === key ? { ...m, criteria: change(m.criteria) } : m)),
});

/** A criterion added at the end of a metric's scale; none past the most (6). */
export function addCriterion(form: DraftForm, key: string, criterionKey: string): DraftForm {
  return withCriteria(form, key, (criteria) => (criteria.length >= L.criteriaMax ? criteria : [...criteria, { key: criterionKey, label: '', points: '' }]));
}

/** A criterion removed; none below the fewest (2). */
export function removeCriterion(form: DraftForm, key: string, criterionKey: string): DraftForm {
  return withCriteria(form, key, (criteria) => (criteria.length <= L.criteriaMin ? criteria : criteria.filter((c) => c.key !== criterionKey)));
}

export function updateCriterion(form: DraftForm, key: string, criterionKey: string, patch: Partial<Omit<CriterionForm, 'key'>>): DraftForm {
  return withCriteria(form, key, (criteria) => criteria.map((c) => (c.key === criterionKey ? { ...c, ...patch } : c)));
}

// ---------- the JD duty ----------

/** The duty Select's value: one of the JD's rows, typed, or none (''). */
export function dutyChoice(metric: Pick<MetricForm, 'jdDuty' | 'dutyTyped'>, duties: readonly string[]): string {
  if (metric.dutyTyped) return DUTY_TYPED;
  return duties.includes(metric.jdDuty) ? metric.jdDuty : '';
}

/** What choosing in the duty Select changes: a JD row, none, or typing one (starting from the duty there was). */
export function chooseDuty(metric: Pick<MetricForm, 'jdDuty'>, value: string): Pick<MetricForm, 'jdDuty' | 'dutyTyped'> {
  if (value === DUTY_TYPED) return { dutyTyped: true, jdDuty: metric.jdDuty };
  return { dutyTyped: false, jdDuty: value };
}

// ---------- the problems ----------

/**
 * What stops the draft being published that doesn't stop it being saved (kpiTemplateProblems with publishing, less the
 * problems already said for saving).
 */
export const onlyForPublishing = (publishing: readonly string[], saving: readonly string[]): string[] => publishing.filter((p) => !saving.includes(p));
