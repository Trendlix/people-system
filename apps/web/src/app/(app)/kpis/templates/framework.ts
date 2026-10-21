import {
  KPI_FRAMEWORK_LIMITS,
  kpiFrameworkMonthProblems,
  kpiFrameworkOpensFrom,
  kpiMonthAdd,
  kpiMonthName,
  kpiPillarKeyFor,
  kpiPillarSetOf,
  kpiPillarSetProblems,
  kpiShortOf,
  type KpiFrameworkInput,
  type KpiFrameworkVersionView,
  type KpiFrameworkView,
  type KpiPillarSet,
} from '@trendlix/shared';
import { formatDate, formatDateTime } from '../../../../lib/format';
import { userName, wholeOf } from './templates';

// The KPI pillars in KPI Settings (owner, 21 October 2026: "am i able to edit the pillars of the KPIs?", "Fully
// flexible"; packages/shared kpi-framework.ts): the pillars in force and the next ones, as HR (and the Super Admin)
// change them: an ordered list of pillars, each with its name, short name and weight (1 to 8, the weights adding up to
// 100%), the pillar the Attendance metric counts in, and the month they apply from (next month unless chosen; never a
// month whose scorecards are open). The next ones can be changed until they apply. A template on older pillars is
// marked, and its scorecards keep opening on its old version and old pillars until it is updated. The form keeps what
// is typed as text; what it sends, and checks live as the API does, is KpiFrameworkInput. Pure code, tested; relative
// imports, as vitest doesn't know the @/ paths. The API checks every request again.

/** A pillar as typed. `rowKey`: the form's own; `key`: the pillar's, kept when it is renamed ('' for a new one). */
export interface PillarRow {
  rowKey: string;
  key: string;
  name: string;
  short: string;
  weight: string;
}

/** The pillars as typed: in order, the Attendance metric's (a row's `rowKey`) and the month they apply from. */
export interface FrameworkForm {
  pillars: PillarRow[];
  attendance: string;
  appliesFrom: string;
}

/** The form starts from the next pillars when there are some (to change them), else from those in force. */
export function frameworkFormOf(view: Pick<KpiFrameworkView, 'inForce' | 'next' | 'defaultMonth'>): FrameworkForm {
  const base = view.next ?? view.inForce;
  const pillars = base.pillars.map((p, i) => ({ rowKey: `p${i}`, key: p.key, name: p.name, short: p.short, weight: String(p.weight) }));
  return {
    pillars,
    attendance: pillars.find((p) => p.key === base.attendancePillar)?.rowKey ?? '',
    appliesFrom: view.next?.appliesFrom ?? view.defaultMonth,
  };
}

/**
 * What the form sends (PUT /kpis/framework): each new pillar given a key of its own from its name (never one a pillar
 * has had: `usedKeys`), the weights as whole numbers (anything else NaN, which the rules refuse).
 */
export function frameworkInputOf(form: FrameworkForm, usedKeys: readonly string[]): KpiFrameworkInput {
  const taken = new Set([...usedKeys, ...form.pillars.map((p) => p.key).filter(Boolean)]);
  const keys = new Map<string, string>();
  for (const p of form.pillars) {
    if (p.key) keys.set(p.rowKey, p.key);
    else {
      const key = kpiPillarKeyFor(p.name, taken);
      taken.add(key);
      keys.set(p.rowKey, key);
    }
  }
  return {
    appliesFrom: form.appliesFrom,
    attendancePillar: keys.get(form.attendance) ?? '',
    pillars: form.pillars.map((p) => ({ key: keys.get(p.rowKey)!, name: p.name, short: p.short, weight: wholeOf(p.weight) })),
  };
}

/** The pillars sent as the rules read them: names tidied, a short name from the name when none. */
export const pillarSetOfInput = (input: Pick<KpiFrameworkInput, 'pillars' | 'attendancePillar'>): KpiPillarSet => kpiPillarSetOf(input);

/** What stops the pillars being saved, as the API says it (the pillars' rules, then the month's). `today`: YYYY-MM-DD. */
export function frameworkProblems(form: FrameworkForm, usedKeys: readonly string[], today: string): string[] {
  const input = frameworkInputOf(form, usedKeys);
  return [...kpiPillarSetProblems(pillarSetOfInput(input)), ...kpiFrameworkMonthProblems(input.appliesFrom, today)];
}

/** The weights typed, added up (those not whole left out). */
export const weightTotal = (form: Pick<FrameworkForm, 'pillars'>): number => form.pillars.reduce((sum, p) => sum + (Number.isFinite(wholeOf(p.weight)) ? wholeOf(p.weight) : 0), 0);

/** The short name a pillar gets when none is typed: its name's first word. */
export const shortPlaceholder = (name: string): string => kpiShortOf(name) || 'Short name';

// ---------- changing the pillars (each a new form) ----------

/** A new pillar at the end (none past the most, 8). */
export function addPillar(form: FrameworkForm, rowKey: string): FrameworkForm {
  if (form.pillars.length >= KPI_FRAMEWORK_LIMITS.pillarsMax) return form;
  return { ...form, pillars: [...form.pillars, { rowKey, key: '', name: '', short: '', weight: '' }] };
}

/** A pillar removed (none below the fewest, 1); the Attendance metric's then has to be chosen again. */
export function removePillar(form: FrameworkForm, rowKey: string): FrameworkForm {
  if (form.pillars.length <= KPI_FRAMEWORK_LIMITS.pillarsMin) return form;
  return { ...form, pillars: form.pillars.filter((p) => p.rowKey !== rowKey), attendance: form.attendance === rowKey ? '' : form.attendance };
}

export function updatePillar(form: FrameworkForm, rowKey: string, patch: Partial<Omit<PillarRow, 'rowKey' | 'key'>>): FrameworkForm {
  return { ...form, pillars: form.pillars.map((p) => (p.rowKey === rowKey ? { ...p, ...patch } : p)) };
}

/** A pillar moved up (-1) or down (1): the order the scorecards show them in. */
export function movePillar(form: FrameworkForm, rowKey: string, step: -1 | 1): FrameworkForm {
  const at = form.pillars.findIndex((p) => p.rowKey === rowKey);
  const to = at + step;
  if (at < 0 || to < 0 || to >= form.pillars.length) return form;
  const pillars = [...form.pillars];
  [pillars[at], pillars[to]] = [pillars[to], pillars[at]];
  return { ...form, pillars };
}

// ---------- the months ----------

/** "Applies from": each month from the earliest (this month) to the latest (a year ahead), by name. */
export function monthChoices(earliest: string, latest: string): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (let m = earliest; m <= latest; m = kpiMonthAdd(m, 1)) out.push({ value: m, label: kpiMonthName(m) });
  return out;
}

/** Under "Applies from": "November 2026's scorecards open on 01/12/2026." */
export const appliesFromHint = (month: string): string => `${kpiMonthName(month)}’s scorecards open on ${formatDate(kpiFrameworkOpensFrom(month))}.`;

// ---------- in words ----------

/** "1 pillar", "5 pillars". */
export const pillarsLabel = (n: number): string => `${n} ${n === 1 ? 'pillar' : 'pillars'}`;

/** When the pillars in force started: the first version from the start, the others from their first month. */
export const inForceText = (v: Pick<KpiFrameworkVersionView, 'version' | 'appliesFrom'>): string =>
  v.version === 1 ? 'In force from the start: the plan’s pillars.' : `In force since ${kpiMonthName(v.appliesFrom)}’s scorecards.`;

/** "Apply from November 2026's scorecards, which open on 01/12/2026. They can be changed until then." */
export const nextText = (v: Pick<KpiFrameworkVersionView, 'appliesFrom' | 'opensFrom'>): string =>
  `Apply from ${kpiMonthName(v.appliesFrom)}’s scorecards, which open on ${formatDate(v.opensFrom)}. They can be changed until then.`;

/** "Saved by Mona Adel on 21/10/2026, 5:42 PM"; null for the first version, which nobody saved. */
export function frameworkChangedText(v: Pick<KpiFrameworkVersionView, 'updatedAt' | 'updatedBy' | 'createdBy'>): string | null {
  const who = userName(v.updatedBy ?? v.createdBy);
  return who ? `Saved by ${who} on ${formatDateTime(v.updatedAt)}` : null;
}

/** What Save asks first: when they apply, and what it means for the templates. */
export function frameworkConfirmText(appliesFrom: string, changingNext: boolean): string {
  return `${changingNext ? 'Save the changes to the next pillars?' : 'Save these pillars?'} They apply from ${kpiMonthName(appliesFrom)}’s scorecards, which open on ${formatDate(kpiFrameworkOpensFrom(appliesFrom))}. Every template must then be updated to place its metrics in them; until it is, its scorecards keep opening on its old version and old pillars. The scorecards opened already keep theirs.`;
}

/** What the page says once saved. */
export const frameworkSavedText = (appliesFrom: string): string =>
  `Saved. The new pillars apply from ${kpiMonthName(appliesFrom)}’s scorecards: update each template marked “Uses the old pillars”.`;

/** On a template on older pillars than the framework's newest. */
export const OLD_PILLARS_BADGE = 'Uses the old pillars: update it';

/**
 * The banner over the job titles when templates use older pillars (owner's brief, 21 October 2026: "with a count
 * banner … Until a template is updated, its scorecards keep opening on its old version and old pillars, so nobody is
 * left without a scorecard. Say so on the banner"); null when none does.
 */
export function oldPillarsBanner(count: number, next: Pick<KpiFrameworkVersionView, 'appliesFrom' | 'opensFrom'> | null): { head: string; body: string } | null {
  if (!count) return null;
  const head = count === 1 ? '1 template uses the old pillars: update it.' : `${count} templates use the old pillars: update them.`;
  const when = next ? ` The new pillars apply from ${kpiMonthName(next.appliesFrom)}’s scorecards, which open on ${formatDate(next.opensFrom)}.` : '';
  return {
    head,
    body: `Open each one marked, start a draft from its version and place its metrics in the new pillars, then publish it.${when} Until a template is updated, its scorecards keep opening on its old version and old pillars, so nobody is left without a scorecard.`,
  };
}
