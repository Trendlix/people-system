// The KPI framework (owner, 21 October 2026: "am i able to edit the pillars of the KPIs?", then "Fully flexible": "add
// or remove pillars, with names and weights; it applies from next month; templates must place their metrics in the new
// pillars"). The pillars and their weights were fixed (kpis.ts KPI_PILLARS); now they are a versioned framework HR (and
// the Super Admin) edit in KPI Settings, audited:
// - Pillars: an ordered list of { key, name, short, weight }, from 1 to 8, the names different, the weights whole
//   percents adding up to 100; and "Attendance counts in": the pillar of the automatic Attendance metric (Discipline &
//   Growth by default).
// - "Applies from": a scorecard month, next month unless chosen (that month's scorecards open on the 1st of the month
//   after), never a month whose scorecards are open already. The next framework can be changed until it applies; one
//   at a time. The first version is the four of the plan, put in force by the migration, so nothing changed until HR
//   edited it.
// - Templates: each template version keeps the pillars it was published with (its KpiPillarSet), its metrics in their
//   keys, and its scorecards are scored with them, so past and open scorecards never change. A draft is placed in the
//   newest framework's pillars by name (kpiPlaceMetrics; a renamed pillar keeps its key, so by that too); a metric whose
//   pillar is gone goes to Unplaced, which must be emptied before publishing; publishing takes the newest framework's
//   pillars, and applies from the later of next month and the framework's first opening. A template whose newest
//   version has other pillars (kpiSamePillars) is marked "Uses the old pillars: update it"; until it is, its scorecards
//   keep opening on that version and its pillars, so nobody is left without a scorecard. The samples and the role
//   library are written for the four of the plan, and are placed the same way.
// - The month's overview and its Excel: the pillars of the month's scorecards, by name when they differ
//   (kpiPillarColumns): "Pillars changed this month: averages by name".
// Pure code: the API enforces these rules, the web shows them live. Tested in apps/api/src/common/kpi-framework.spec.ts.

import { kpiMonthAdd, kpiMonthName, kpiPillarOf, type KpiMetric, type KpiPillar, type KpiPillarColumn, type KpiPillarSet, type KpiUserRef } from './kpis.js';

// ---------- the pillars ----------

/** The limits of a framework (owner's brief, 21 October 2026: "From 1 to 8 pillars"). */
export const KPI_FRAMEWORK_LIMITS = {
  pillarsMin: 1,
  pillarsMax: 8,
  name: 60,
  short: 16,
  /** A pillar's key: lower-case letters and digits, a dash between. */
  key: 40,
  /** How many months ahead a framework may apply from. */
  monthsAhead: 12,
} as const;

const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Whether a text is a pillar's key ("delivery", "client-care-2"). */
export const isKpiPillarKey = (value: unknown): value is string => typeof value === 'string' && value.length <= KPI_FRAMEWORK_LIMITS.key && KEY.test(value);

/**
 * A pillar's name as names are compared (two pillars may not share one, and a template's metrics are placed by it):
 * lower case, "&" as "and", anything but letters and digits a single space.
 */
export function kpiPillarNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** A key for a new pillar from its name ("Client Care" → "client-care"), not one `taken` (a dash and a number added). */
export function kpiPillarKeyFor(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const slug =
    name
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, KPI_FRAMEWORK_LIMITS.key - 4)
      .replace(/-+$/g, '') || 'pillar';
  if (!used.has(slug)) return slug;
  for (let n = 2; ; n++) if (!used.has(`${slug}-${n}`)) return `${slug}-${n}`;
}

/** A pillar's short name when none is given: its name's first word ("Delivery" of "Delivery & Timeliness"), cut to fit. */
export function kpiShortOf(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? '';
  return first.slice(0, KPI_FRAMEWORK_LIMITS.short);
}

/** A pillar as the form (or a request) sends it: the short name may be left out. */
export interface KpiPillarInput {
  key: string;
  name: string;
  short?: string | null;
  weight: number;
}

/** POST /kpis/framework: the next framework's pillars, the Attendance metric's pillar and the month they apply from. */
export interface KpiFrameworkInput {
  /** YYYY-MM: the first month whose scorecards are scored with them. */
  appliesFrom: string;
  /** The key of the pillar the Attendance metric counts in. */
  attendancePillar: string;
  pillars: KpiPillarInput[];
}

/** The pillars sent, tidied: names and short names trimmed, a short name from the name when none. */
export function kpiPillarSetOf(input: { pillars: readonly KpiPillarInput[]; attendancePillar: string }): KpiPillarSet & { pillars: KpiPillar[] } {
  const text = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
  return {
    attendancePillar: text(input.attendancePillar),
    pillars: (Array.isArray(input.pillars) ? input.pillars : []).map((p) => {
      const name = text(p?.name);
      const short = text(p?.short);
      return { key: text(p?.key), name, short: short || kpiShortOf(name), weight: p?.weight as number };
    }),
  };
}

/**
 * What is wrong with a framework's pillars, each in words (none: they can be saved): from 1 to 8 pillars, each with a
 * name (different from the others'), a short name and a key, the weights whole percents from 1 to 100 adding up to
 * 100, and the Attendance metric's pillar one of them.
 */
export function kpiPillarSetProblems(set: Pick<KpiPillarSet, 'pillars' | 'attendancePillar'>): string[] {
  const L = KPI_FRAMEWORK_LIMITS;
  const problems: string[] = [];
  const pillars = Array.isArray(set.pillars) ? set.pillars : [];
  if (pillars.length < L.pillarsMin) problems.push('Add a pillar: a framework has from 1 to 8.');
  if (pillars.length > L.pillarsMax) problems.push(`A framework takes at most ${L.pillarsMax} pillars.`);
  const names = new Map<string, number>();
  const keys = new Set<string>();
  let total = 0;
  let whole = true;
  pillars.forEach((p, i) => {
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    const which = name ? `Pillar ${i + 1} (${name})` : `Pillar ${i + 1}`;
    if (!name) problems.push(`${which}: give it a name.`);
    else if (name.length > L.name) problems.push(`${which}: its name can be at most ${L.name} characters.`);
    else {
      const key = kpiPillarNameKey(name);
      if (!key) problems.push(`${which}: give it a name with letters or digits.`);
      else if (names.has(key)) problems.push(`${which}: pillar ${names.get(key)! + 1} has the same name.`);
      else names.set(key, i);
    }
    const short = typeof p.short === 'string' ? p.short.trim() : '';
    if (!short) problems.push(`${which}: give it a short name.`);
    else if (short.length > L.short) problems.push(`${which}: its short name can be at most ${L.short} characters.`);
    if (!isKpiPillarKey(p.key)) problems.push(`${which}: its key is missing. Reload the page and try again.`);
    else if (keys.has(p.key)) problems.push(`${which}: another pillar has its key. Reload the page and try again.`);
    else keys.add(p.key);
    const w = p.weight;
    if (!(typeof w === 'number' && Number.isInteger(w) && w >= 1 && w <= 100)) {
      problems.push(`${which}: give its weight as a whole percent from 1 to 100.`);
      whole = false;
    } else total += w;
  });
  if (whole && pillars.length && total !== 100) problems.push(`The weights add up to ${total}%: make them add up to 100%.`);
  if (!pillars.some((p) => p.key === set.attendancePillar)) problems.push('Choose the pillar the Attendance metric counts in.');
  return problems;
}

/**
 * What is wrong with the month a new framework applies from (owner's brief, 21 October 2026: "Applies from the next
 * month by default … It can't be set to a month whose scorecards are already open"): a month from this one (last
 * month's opened on the 1st) to a year ahead. `today`: YYYY-MM-DD in Cairo. The API checks no scorecard of it or later
 * is open too.
 */
export function kpiFrameworkMonthProblems(appliesFrom: unknown, today: string): string[] {
  const current = today.slice(0, 7);
  if (typeof appliesFrom !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(appliesFrom)) return ['Choose the month the pillars apply from, e.g. ' + kpiMonthAdd(current, 1) + '.'];
  if (appliesFrom < current) {
    return [`The scorecards of ${kpiMonthName(appliesFrom)} are open already: choose ${kpiMonthName(current)} or a later month.`];
  }
  const latest = kpiMonthAdd(current, KPI_FRAMEWORK_LIMITS.monthsAhead);
  if (appliesFrom > latest) return [`Choose a month within a year: ${kpiMonthName(latest)} at the latest.`];
  return [];
}

/** The month a new framework applies from unless chosen: next month (owner, 21 October 2026: "it applies from next month"). */
export const kpiFrameworkDefaultMonth = (today: string): string => kpiMonthAdd(today.slice(0, 7), 1);

/** The 1st (YYYY-MM-DD) the scorecards of a framework's first month open: the month after it. */
export const kpiFrameworkOpensFrom = (appliesFrom: string): string => `${kpiMonthAdd(appliesFrom.slice(0, 7), 1)}-01`;

/**
 * The 1st (YYYY-MM-DD) from which a template version published on `publishedOn` (YYYY-MM-DD, Cairo) is used: the 1st of
 * the next month (kpis.ts), or later, the opening of its pillars' framework's first month, so new pillars never score a
 * month before they apply.
 */
export function kpiTemplateOpensFrom(publishedOn: string, frameworkAppliesFrom: string): string {
  const normal = `${kpiMonthAdd(publishedOn.slice(0, 7), 1)}-01`;
  const framework = kpiFrameworkOpensFrom(frameworkAppliesFrom);
  return framework > normal ? framework : normal;
}

/**
 * Whether two sets of pillars score alike: the same names (as compared) with the same weights, and the Attendance
 * metric in the pillar of the same name. Their keys, short names and order may differ.
 */
export function kpiSamePillars(a: Pick<KpiPillarSet, 'pillars' | 'attendancePillar'>, b: Pick<KpiPillarSet, 'pillars' | 'attendancePillar'>): boolean {
  return pillarsSignature(a) === pillarsSignature(b);
}

function pillarsSignature(set: Pick<KpiPillarSet, 'pillars' | 'attendancePillar'>): string {
  const attendance = kpiPillarOf(set, set.attendancePillar);
  const pillars = set.pillars.map((p) => `${kpiPillarNameKey(p.name)}=${p.weight}`).sort();
  return JSON.stringify([attendance ? kpiPillarNameKey(attendance.name) : null, pillars]);
}

/** The pillars in words: "Delivery & Timeliness 30% · Quality of Work 25% · …". */
export const kpiPillarsText = (set: Pick<KpiPillarSet, 'pillars'>): string => set.pillars.map((p) => `${p.name} ${p.weight}%`).join(' · ');

// ---------- placing a template's metrics in other pillars ----------

/**
 * A template's metrics placed in other pillars (owner's brief, 21 October 2026: "Opening the draft editor maps metrics
 * by pillar name. Metrics whose pillar is gone go to an 'Unplaced' group"): each to the pillar of `to` named as its
 * pillar of `from` (any case and spacing, "&" as "and"), else to the pillar with its key (a renamed pillar keeps it);
 * else Unplaced (`pillar` null), with the name of the pillar it was in (`wasIn`). A metric in Unplaced already is
 * placed by the name it was in, when `to` has it again.
 */
export function kpiPlaceMetrics<M extends Pick<KpiMetric, 'pillar' | 'wasIn'>>(
  metrics: readonly M[],
  from: Pick<KpiPillarSet, 'pillars'>,
  to: Pick<KpiPillarSet, 'pillars'>,
): (Omit<M, 'pillar' | 'wasIn'> & { pillar: string | null; wasIn: string | null })[] {
  const byName = new Map(to.pillars.map((p) => [kpiPillarNameKey(p.name), p.key]));
  const keys = new Set(to.pillars.map((p) => p.key));
  return metrics.map((m) => {
    const source = m.pillar === null || m.pillar === undefined ? null : kpiPillarOf(from, m.pillar);
    const name = source ? source.name : m.pillar === null || m.pillar === undefined ? (m.wasIn ?? null) : null;
    const key = (name ? byName.get(kpiPillarNameKey(name)) : undefined) ?? (typeof m.pillar === 'string' && keys.has(m.pillar) ? m.pillar : undefined);
    return key ? { ...m, pillar: key, wasIn: null } : { ...m, pillar: null, wasIn: name };
  });
}

/** How many of the metrics have no pillar in `to` once placed (kpiPlaceMetrics): those that go to Unplaced. */
export const kpiUnplacedCount = (metrics: readonly Pick<KpiMetric, 'pillar' | 'wasIn'>[], from: Pick<KpiPillarSet, 'pillars'>, to: Pick<KpiPillarSet, 'pillars'>): number =>
  kpiPlaceMetrics(metrics, from, to).filter((m) => m.pillar === null).length;

// ---------- the month's pillars, by name ----------

/**
 * The pillars of a month's scorecards as the overview's and the Excel's columns (owner's brief, 21 October 2026: "Where
 * scorecards with different frameworks are mixed in one month's overview, group the averages by pillar name"): one
 * per pillar name, those of the pillars most scorecards have first, in their order, then the others'; a weight when
 * every scorecard with that pillar has the same. `changed`: they don't all have the same pillars (kpiSamePillars).
 */
export function kpiPillarColumns(sets: readonly Pick<KpiPillarSet, 'pillars' | 'attendancePillar'>[]): { columns: KpiPillarColumn[]; changed: boolean } {
  const kinds = new Map<string, { set: Pick<KpiPillarSet, 'pillars' | 'attendancePillar'>; count: number; first: number }>();
  sets.forEach((set, i) => {
    const sig = pillarsSignature(set);
    const kind = kinds.get(sig) ?? { set, count: 0, first: i };
    kind.count += 1;
    kinds.set(sig, kind);
  });
  const ordered = [...kinds.values()].sort((a, b) => b.count - a.count || a.first - b.first);
  const columns = new Map<string, KpiPillarColumn & { weights: Set<number> }>();
  for (const { set } of ordered) {
    for (const p of set.pillars) {
      const key = kpiPillarNameKey(p.name);
      const column = columns.get(key) ?? { key, name: p.name, short: p.short, weight: p.weight, weights: new Set<number>() };
      column.weights.add(p.weight);
      columns.set(key, column);
    }
  }
  return {
    columns: [...columns.values()].map(({ weights, ...c }) => ({ ...c, weight: weights.size === 1 ? c.weight : null })),
    changed: kinds.size > 1,
  };
}

/** A scorecard's kept pillar percents (by its pillars' keys) by its pillars' names, as kpiPillarColumns' keys. */
export function kpiPercentsByName(set: Pick<KpiPillarSet, 'pillars'>, percents: Readonly<Record<string, number | null | undefined>>): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const p of set.pillars) {
    const v = percents[p.key];
    out[kpiPillarNameKey(p.name)] = typeof v === 'number' ? v : null;
  }
  return out;
}

// ---------- the API's answers ----------

/** A version of the KPI framework. */
export interface KpiFrameworkVersionView extends KpiPillarSet {
  id: string;
  version: number;
  pillars: KpiPillar[];
  /** YYYY-MM: the first month whose scorecards it scores. */
  appliesFrom: string;
  /** YYYY-MM-DD: the 1st those scorecards open (the month after). */
  opensFrom: string;
  createdAt: string;
  createdBy: KpiUserRef | null;
  updatedAt: string;
  updatedBy: KpiUserRef | null;
}

/** GET and PUT /kpis/framework: the framework in force, the next one (changed until it applies), and what may be chosen. */
export interface KpiFrameworkView {
  /** The one the scorecards opened now are scored with, when their template versions have its pillars. */
  inForce: KpiFrameworkVersionView;
  /** The next one, from a later month; null: none. The newest: template drafts are placed in it and published with it. */
  next: KpiFrameworkVersionView | null;
  /** YYYY-MM: next month, the month a change applies from unless chosen. */
  defaultMonth: string;
  /** YYYY-MM: the earliest it may apply from (this month: last month's scorecards are open). */
  earliestMonth: string;
  /** YYYY-MM: the latest it may apply from. */
  latestMonth: string;
  /** Job titles whose newest published template version uses other pillars than the newest framework's. */
  oldTemplates: number;
  /** HR and a Super Admin change it. */
  canEdit: boolean;
  /** Every key a pillar has had, so a new pillar gets one of its own (kpiPillarKeyFor). */
  usedKeys: string[];
}
