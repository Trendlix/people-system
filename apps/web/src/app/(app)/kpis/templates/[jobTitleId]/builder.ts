import { KPI_TEMPLATE_LIMITS, kpiWeightsProblems, type KpiCriterion, type KpiMetric, type KpiPillar, type KpiPillarSet, type KpiTemplateContent } from '@trendlix/shared';
import { wholeOf } from '../templates';

// A job title's KPI template builder (owner, 21 October 2026: "Full framework per role"; "Templates: HR"): the draft as
// HR edits it, its metrics grouped by the pillars, each with its pillar, name, definition, how it's measured, the
// JD duty it is linked to ("Show the job title's JD next to the builder, so HR can link duties"), its target points and
// its criteria scale ("No delays = 35 / 1–2 delays = 30 / 3+ = 20"), one picked each month; the automatic Attendance
// metric's points in its pillar. The form keeps what is typed as text, so a number can be typed freely; the
// content sent (and checked live with kpiTemplateProblems) has the metrics in pillar order, so "Metric 3" in a problem
// is the third shown. Pure code, tested; relative imports, as vitest doesn't know the @/ paths.
// The pillars (owner, 21 October 2026: "Fully flexible"): the KPI framework's newest, which the API placed the draft's
// metrics in by name, with the Attendance metric in the pillar it chose; a metric whose pillar is gone is in Unplaced
// (no pillar, with the one it was in), shown last, to be moved into a pillar or removed before publishing. A published
// version is shown in its own pillars.
// A job title's own weights (owner, 22 October 2026: "wights can be changed for each department and Job title"): each
// pillar's weight is typed on its header, the total shown, "Use the department's weights" puts the department's (or
// the company's) back. Saved with the draft (`weights`: null when they are the department's), published with it, so
// they apply from next month like any change; the pillars themselves are the department's (KPI Pillars).

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
  /** Its pillar's key; null: in Unplaced. */
  pillar: string | null;
  /** In Unplaced: the pillar it was in; null otherwise. */
  wasIn: string | null;
  name: string;
  definition: string;
  howMeasured: string;
  /** The JD duty it is linked to: one of the JD's duty rows, or typed (`dutyTyped`). */
  jdDuty: string;
  dutyTyped: boolean;
  targetPoints: string;
  criteria: CriterionForm[];
}

/** The draft as typed: the Attendance metric's points, the metrics, and the pillars they are placed in. */
export interface DraftForm {
  attendancePoints: string;
  metrics: MetricForm[];
  pillars: KpiPillarSet;
  /** Each pillar's weight as typed, by its key: the job title's own when they differ from `baseWeights`. */
  weights: Record<string, string>;
  /**
   * The department's (or the company's) weights for these pillars, by key: own weights equal to them are none. null:
   * the API doesn't take a job title's own weights (one from before them), so none are typed or sent.
   */
  baseWeights: Record<string, number> | null;
}

/** A pillar's place in the set's order; Unplaced (or a pillar not in the set) after them all. */
const orderOf = (set: Pick<KpiPillarSet, 'pillars'>, pillar: string | null): number => {
  const at = set.pillars.findIndex((p) => p.key === pillar);
  return at < 0 ? set.pillars.length : at;
};

/** In pillar order, each pillar's in the order they came (a stable sort), Unplaced last. */
export const inPillarOrder = <M extends { pillar: string | null }>(metrics: readonly M[], set: Pick<KpiPillarSet, 'pillars'>): M[] =>
  [...metrics].sort((a, b) => orderOf(set, a.pillar) - orderOf(set, b.pillar));

/** The Select's choice for a duty typed rather than picked from the JD's rows. */
export const DUTY_TYPED = '__typed__';

/** A saved metric (or a sample's) as the form shows it. */
function metricFormOf(m: KpiMetric, key: string, duties: readonly string[]): MetricForm {
  const duty = m.jdDuty ?? '';
  return {
    key,
    ...(m.id ? { id: m.id } : {}),
    pillar: m.pillar,
    wasIn: m.pillar === null ? (m.wasIn ?? null) : null,
    name: m.name,
    definition: m.definition ?? '',
    howMeasured: m.howMeasured ?? '',
    jdDuty: duty,
    dutyTyped: duty !== '' && !duties.includes(duty),
    targetPoints: String(m.targetPoints),
    criteria: m.criteria.map((c, j) => ({ key: `${key}c${j}`, label: c.label, points: String(c.points) })),
  };
}

/**
 * A draft's content as the form starts with it, in `pillars` (the draft's: the KPI framework's newest, with the job
 * title's own weights when it has them), and the department's weights for them (`baseWeights`; none: the API doesn't
 * take own weights).
 */
export function formOf(
  content: Pick<KpiTemplateContent, 'attendancePoints' | 'metrics'>,
  duties: readonly string[],
  pillars: KpiPillarSet,
  baseWeights: Record<string, number> | null = null,
): DraftForm {
  return {
    attendancePoints: String(content.attendancePoints),
    metrics: inPillarOrder(content.metrics, pillars).map((m, i) => metricFormOf(m, `m${i}`, duties)),
    pillars,
    weights: Object.fromEntries(pillars.pillars.map((p) => [p.key, String(p.weight)])),
    baseWeights: baseWeights ? Object.fromEntries(pillars.pillars.map((p) => [p.key, baseWeights[p.key] ?? p.weight])) : null,
  };
}

const textOrNull = (text: string): string | null => (text.trim() ? text.trim() : null);

/**
 * What the form says, as the draft's content to check and save: in pillar order, numbers not whole as NaN; the job
 * title's own weights (null: the department's), when the API takes them.
 */
export function contentOf(form: DraftForm): KpiTemplateContent {
  return {
    ...(form.baseWeights && { weights: ownWeightsOf(form) }),
    attendancePoints: wholeOf(form.attendancePoints),
    metrics: inPillarOrder(form.metrics, form.pillars).map(
      (m): KpiMetric => ({
        ...(m.id ? { id: m.id } : {}),
        pillar: m.pillar,
        ...(m.pillar === null ? { wasIn: m.wasIn } : {}),
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

/** A draft's content as the form sent it (JSON), or null when it isn't one; its weights only when it sent them. */
export function contentFromJson(text: unknown): KpiTemplateContent | null {
  const value = parsed(text);
  if (!value) return null;
  const v = value as Partial<KpiTemplateContent>;
  if (!Array.isArray(v.metrics) || !v.metrics.every((m) => m && typeof m === 'object' && Array.isArray(m.criteria))) return null;
  const weights = v.weights === null ? null : v.weights && typeof v.weights === 'object' && !Array.isArray(v.weights) ? v.weights : undefined;
  return { ...(weights !== undefined && { weights }), attendancePoints: v.attendancePoints as number, metrics: v.metrics };
}

/** The pillars a draft is placed in, as the form sent them (JSON), or null when they aren't. */
export function pillarsFromJson(text: unknown): KpiPillarSet | null {
  const value = parsed(text) as Partial<KpiPillarSet> | null;
  if (!value || !Array.isArray(value.pillars) || typeof value.attendancePillar !== 'string') return null;
  const pillars = value.pillars.filter((p): p is KpiPillar => !!p && typeof p.key === 'string' && typeof p.name === 'string' && typeof p.weight === 'number');
  return pillars.length === value.pillars.length && pillars.length ? { pillars, attendancePillar: value.attendancePillar } : null;
}

function parsed(text: unknown): Record<string, unknown> | null {
  if (typeof text !== 'string') return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ---------- the pillars' weights ----------

/** The weights typed, by key, as numbers (not whole: NaN). */
export const typedWeights = (form: Pick<DraftForm, 'pillars' | 'weights'>): Record<string, number> =>
  Object.fromEntries(form.pillars.pillars.map((p) => [p.key, wholeOf(form.weights[p.key] ?? String(p.weight))]));

/** Whether the weights typed are the department's (or the company's); always so when the API doesn't take own ones. */
export function weightsAreBase(form: Pick<DraftForm, 'pillars' | 'weights' | 'baseWeights'>): boolean {
  const base = form.baseWeights;
  if (!base) return true;
  const typed = typedWeights(form);
  return form.pillars.pillars.every((p) => typed[p.key] === base[p.key]);
}

/** The job title's own weights to send: null when they are the department's. */
export const ownWeightsOf = (form: Pick<DraftForm, 'pillars' | 'weights' | 'baseWeights'>): Record<string, number> | null =>
  weightsAreBase(form) ? null : typedWeights(form);

/** What is wrong with the weights typed (kpiWeightsProblems); none when the API doesn't take own ones. */
export const weightsProblems = (form: Pick<DraftForm, 'pillars' | 'weights' | 'baseWeights'>): string[] =>
  form.baseWeights ? kpiWeightsProblems(form.pillars, typedWeights(form)) : [];

/** The weights typed, added up (those not whole left out). */
export const draftWeightTotal = (form: Pick<DraftForm, 'pillars' | 'weights'>): number =>
  Object.values(typedWeights(form)).reduce((sum, w) => sum + (Number.isFinite(w) ? w : 0), 0);

/** The pillars with the weights typed (one not whole keeps the one it had), as the metric's pillar choice shows them. */
export const weightedPillars = (form: Pick<DraftForm, 'pillars' | 'weights'>): KpiPillarSet => {
  const typed = typedWeights(form);
  return { ...form.pillars, pillars: form.pillars.pillars.map((p) => ({ ...p, weight: Number.isFinite(typed[p.key]) ? typed[p.key] : p.weight })) };
};

/** A pillar's weight typed. */
export const setPillarWeight = (form: DraftForm, key: string, weight: string): DraftForm => ({ ...form, weights: { ...form.weights, [key]: weight } });

/** The department's (or the company's) weights back. */
export const resetWeights = (form: DraftForm): DraftForm =>
  form.baseWeights ? { ...form, weights: Object.fromEntries(form.pillars.pillars.map((p) => [p.key, String(form.baseWeights![p.key] ?? p.weight)])) } : form;

/**
 * Whose pillars a template has, in words: "Production’s pillars" (a department's own, its name as headings show it) or
 * "The company’s pillars"; null when the API doesn't say (one from before department pillars).
 */
export function pillarsFromText(pillarsFrom: { nameEn: string } | null | undefined, name: (text: string) => string = (t) => t): string | null {
  if (pillarsFrom === undefined) return null;
  return pillarsFrom ? `${name(pillarsFrom.nameEn)}’s pillars` : 'The company’s pillars';
}

/** Who the base weights are: "Production" or "Company", before a weight ("Production: 30%"). */
export const baseWeightLabel = (pillarsFrom: { nameEn: string } | null | undefined, name: (text: string) => string = (t) => t): string =>
  pillarsFrom ? name(pillarsFrom.nameEn) : 'Company';

/** Over a draft whose own weights were dropped, its pillars having gained or lost one: the department's, or the company's. */
export function weightsResetNote(pillarsFrom: { nameEn: string } | null | undefined): string {
  const whose = pillarsFrom ? 'department’s' : 'company’s';
  return `The ${whose} pillars changed (a pillar was added or removed), so this job title’s own weights were reset to the ${whose}. Set them again if needed, then save.`;
}

// ---------- the pillars ----------

/**
 * A pillar with its metrics (in their order) and its max points: its targets added up, the Attendance metric's in its
 * pillar. `pillar` null: Unplaced, whose metrics count nowhere until placed.
 */
export interface PillarGroup<M> {
  pillar: KpiPillar | null;
  /** It has the Attendance metric. */
  attendance: boolean;
  metrics: M[];
  max: number;
}

const pointsOrZero = (n: number) => (Number.isFinite(n) ? n : 0);

/**
 * The pillars with their metrics and max points (pillar % = achieved ÷ max points; owner, 21 October 2026), each
 * metric with its number in the template: Metric 1 the first of the first pillar; Unplaced last, when a metric is in it.
 */
export function pillarGroups<M extends { pillar: string | null; targetPoints: number }>(
  metrics: readonly M[],
  attendancePoints: number,
  set: KpiPillarSet,
): PillarGroup<M & { number: number }>[] {
  const numbered = inPillarOrder(metrics, set).map((m, i) => ({ ...m, number: i + 1 }));
  const known = new Set(set.pillars.map((p) => p.key));
  const groups: PillarGroup<M & { number: number }>[] = set.pillars.map((pillar) => {
    const inIt = numbered.filter((m) => m.pillar === pillar.key);
    const attendance = pillar.key === set.attendancePillar;
    const targets = inIt.reduce((sum, m) => sum + pointsOrZero(m.targetPoints), 0);
    return { pillar, attendance, metrics: inIt, max: targets + (attendance ? pointsOrZero(attendancePoints) : 0) };
  });
  const unplaced = numbered.filter((m) => m.pillar === null || !known.has(m.pillar));
  if (unplaced.length) groups.push({ pillar: null, attendance: false, metrics: unplaced, max: unplaced.reduce((sum, m) => sum + pointsOrZero(m.targetPoints), 0) });
  return groups;
}

/** The form's metrics by pillar, as the content numbers them, each with its max points; Unplaced last. */
export function formGroups(form: DraftForm): PillarGroup<{ form: MetricForm; number: number }>[] {
  const content = contentOf(form);
  const sorted = inPillarOrder(form.metrics, form.pillars);
  return pillarGroups(
    sorted.map((m, i) => ({ form: m, pillar: m.pillar, targetPoints: content.metrics[i].targetPoints })),
    content.attendancePoints,
    form.pillars,
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
export function addMetric(form: DraftForm, pillar: string, key: string): DraftForm {
  const metric: MetricForm = {
    key,
    pillar,
    wasIn: null,
    name: '',
    definition: '',
    howMeasured: '',
    jdDuty: '',
    dutyTyped: false,
    targetPoints: '',
    criteria: [0, 1, 2].map((j) => ({ key: `${key}c${j}`, label: '', points: '' })),
  };
  return { ...form, metrics: inPillarOrder([...inPillarOrder(form.metrics, form.pillars), metric], form.pillars) };
}

export function removeMetric(form: DraftForm, key: string): DraftForm {
  return { ...form, metrics: form.metrics.filter((m) => m.key !== key) };
}

/** A metric's fields changed; given a pillar, it leaves Unplaced. */
export function updateMetric(form: DraftForm, key: string, patch: Partial<Omit<MetricForm, 'key' | 'id' | 'criteria' | 'wasIn'>>): DraftForm {
  const moved = patch.pillar !== undefined && form.metrics.some((m) => m.key === key && m.pillar !== patch.pillar);
  const metrics = form.metrics.map((m) => (m.key === key ? { ...m, ...patch, ...(patch.pillar ? { wasIn: null } : {}) } : m));
  // moved to another pillar: last of its new pillar's
  if (!moved) return { ...form, metrics };
  const metric = metrics.find((m) => m.key === key)!;
  return { ...form, metrics: inPillarOrder([...inPillarOrder(metrics.filter((m) => m.key !== key), form.pillars), metric], form.pillars) };
}

/** Whether a metric can move up (-1) or down (1) within its pillar (or within Unplaced). */
export function canMove(form: DraftForm, key: string, step: -1 | 1): boolean {
  const sorted = inPillarOrder(form.metrics, form.pillars);
  const at = sorted.findIndex((m) => m.key === key);
  const next = sorted[at + step];
  return at >= 0 && !!next && next.pillar === sorted[at].pillar;
}

/** A metric moved up or down within its pillar (the metrics' order is the template's). */
export function moveMetric(form: DraftForm, key: string, step: -1 | 1): DraftForm {
  if (!canMove(form, key, step)) return form;
  const sorted = inPillarOrder(form.metrics, form.pillars);
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

/** The Unplaced group's heading and what it says. */
export const UNPLACED_TITLE = 'Unplaced';
export const UNPLACED_NOTE =
  'These metrics were in pillars the KPI framework no longer has. Choose a pillar for each, or remove it: the draft can’t be published until this group is empty.';

/** Over a draft whose metrics were written for other pillars than the framework's newest. */
export const PILLARS_CHANGED_NOTE =
  'The KPI pillars changed since this draft was made: its metrics were placed in the new pillars by name. Check them, then save; those whose pillar is gone are in Unplaced, at the end.';
