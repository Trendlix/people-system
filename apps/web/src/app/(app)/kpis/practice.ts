import {
  KPI_PRACTICE_STEP_FOR,
  KPI_PRACTICE_STEPS,
  isKpiPracticeStep,
  kpiMonthName,
  kpiPracticeStepLabel,
  kpiStandInWho,
  startsKpiPractice,
  type KpiPracticeChoice,
  type KpiPracticeInfo,
  type KpiPracticeRow,
  type KpiPracticeStartInput,
  type KpiPracticeStep,
  type KpiPracticeTemplateChoice,
  type KpiScorecardView,
  type KpiUserRef,
} from '@trendlix/shared';
import { formatDateTime } from '../../../lib/format';
import { KPI_PATHS } from '../../../lib/kpi-paths';
import type { SheetMode } from './scorecard';
import { joinShown } from '../../../lib/hidden';

// Practice KPI scorecards as the pages word and read them (owner, 22 October 2026: "i want to test the KPI's .. and it
// is locked to dates, HR and Admin.. how?", choosing "Practice scorecards": "I or HR start a practice scorecard for any
// employee and month, from a draft or published template"; "Every step can be done by me, or through View as"; "It's
// marked Practice everywhere, notifies nobody, never reaches payroll, reports or exports, and deletes in one click"):
// who sees the Practice tab, the step a starter or a Super Admin stands in for (?as=), whom they act for, what the page
// says once a step is done, the start form's choices and what it sends, the list's texts, and the draft editor's
// warnings. The rules are @trendlix/shared's kpi-practice.ts, which the API enforces. Pure code, tested; relative imports,
// as vitest doesn't know the "@/" paths.

// ---------- who ----------

/** Who has the Practice tab on All KPIs, and starts practice scorecards: HR and a Super Admin (the API checks it again). */
export const seesKpiPractice = (user: { roles: readonly string[] }): boolean => startsKpiPractice(user);

// ---------- the step stood in for ----------

type Query = Record<string, string | string[] | undefined>;

/** The address field choosing the step a starter stands in for: "/kpis/scorecards/<id>?as=score". */
export const PRACTICE_AS = 'as';

/** The steps open to the caller to stand in for, in the flow's order. */
export const openPracticeSteps = (standIn: KpiScorecardView['standIn']): KpiPracticeStep[] => (standIn ? KPI_PRACTICE_STEPS.filter((s) => standIn[s]) : []);

/** The step shown: the one asked for (?as=) when it is open, else the first open; null when none is open to the caller. */
export function practiceStep(query: Query, standIn: KpiScorecardView['standIn']): KpiPracticeStep | null {
  const open = openPracticeSteps(standIn);
  const asked = typeof query[PRACTICE_AS] === 'string' ? query[PRACTICE_AS] : '';
  if (isKpiPracticeStep(asked) && open.includes(asked)) return asked;
  return open[0] ?? null;
}

/** A step's address on the scorecard's page. */
export const practiceStepHref = (id: string, step: KpiPracticeStep) => `${KPI_PATHS.scorecard(id)}?${PRACTICE_AS}=${step}`;

/** The form a step is taken with: the self-rating's, the scoring's, HR's calibration, or the sign-off (null). */
export function practiceMode(step: KpiPracticeStep): Exclude<SheetMode, 'view'> | null {
  if (step === 'self_rate') return 'self';
  if (step === 'score') return 'score';
  if (step === 'calibrate') return 'calibrate';
  return null;
}

/** The side a sign-off step signs for. */
export const practiceSignAs = (step: KpiPracticeStep): 'employee' | 'manager' | null => (step === 'sign_employee' ? 'employee' : step === 'sign_manager' ? 'manager' : null);

type Card = Pick<KpiScorecardView, 'employee' | 'scorer'>;

const partiesOf = (v: Card) => ({ employeeName: v.employee.fullNameEn, scorer: v.scorer.kind });

/** A step-in button: "Rate as Omar (practice)", "Score as the manager", "Calibrate as HR", "Sign as Omar", "Sign as the manager". */
export const practiceStepLabel = (step: KpiPracticeStep, v: Card) => kpiPracticeStepLabel(step, partiesOf(v));

/** Whom the caller acts for at a step: "Omar Ali", "the manager", "HR". */
export const practiceWho = (step: KpiPracticeStep, v: Card) => kpiStandInWho(KPI_PRACTICE_STEP_FOR[step], partiesOf(v));

/** Said over the step's form: whom the caller acts for, and that it is kept as theirs for them. */
export function standInText(step: KpiPracticeStep, v: Card): string {
  const who = practiceWho(step, v);
  const doing = step === 'self_rate' ? 'rating' : step === 'score' ? 'scoring' : step === 'calibrate' ? 'calibrating' : 'signing';
  return `You’re ${doing} as ${who}. It is kept as done by you for ${who}.`;
}

/** A form's title for a step stood in for: "Rating as Omar Ali", "Scoring as the manager", "Calibrating as HR". */
export function standInTitle(mode: Exclude<SheetMode, 'view'>, who: string): string {
  const doing = mode === 'self' ? 'Rating' : mode === 'score' ? 'Scoring' : 'Calibrating';
  return `${doing} as ${who}`;
}

// ---------- once something is done ----------

/** What was just done on a practice scorecard, said on its page by `?done=`. */
export const PRACTICE_DONE = ['started', 'self_saved', 'self_sent', 'score_saved', 'score_sent', 'calibrated', 'signed', 'moved'] as const;
export type PracticeDone = (typeof PRACTICE_DONE)[number];

/** A practice scorecard's page after something was done on it: "/kpis/scorecards/<id>?done=self_sent". */
export const practiceDoneHref = (id: string, done: PracticeDone) => `${KPI_PATHS.scorecard(id)}?done=${done}`;

/** The step that comes next for the caller, in words: "Next: Score as the manager."; final: said so. */
export function practiceNextText(v: Pick<KpiScorecardView, 'status' | 'standIn' | 'employee' | 'scorer'>): string {
  if (v.status === 'final') return 'It is final now: the practice run is complete.';
  const next = openPracticeSteps(v.standIn);
  if (!next.length) return '';
  return `Next: ${next.map((s) => practiceStepLabel(s, v)).join(' or ')}.`;
}

/** What the page says after `?done=` on a practice scorecard, and in which tone; null for anything else. */
export function practiceDoneText(query: Query, v: Pick<KpiScorecardView, 'status' | 'standIn' | 'employee' | 'scorer'>): { text: string; tone: 'ok' | 'warn' } | null {
  const done = typeof query.done === 'string' ? query.done : '';
  const next = practiceNextText(v);
  const say = (text: string) => ({ text: [text, next].filter(Boolean).join(' '), tone: 'ok' as const });
  switch (done) {
    case 'started':
      return say('Practice scorecard started. Nobody is told of it.');
    case 'self_saved':
      return say('The self-rating is saved, not sent yet.');
    case 'self_sent':
      return say('The self-rating is sent.');
    case 'score_saved':
      return say('The scoring is saved, not sent yet.');
    case 'score_sent':
      return say(v.status === 'hr' ? 'The scoring is sent to HR to calibrate.' : 'The scoring is sent: it is ready to sign.');
    case 'calibrated':
      return say('Calibrated and sent for sign-off.');
    case 'signed':
      return say(v.status === 'final' ? 'Signed. Both have signed.' : 'Signed.');
    case 'moved':
      return { text: 'This practice scorecard has moved on since you opened it. It shows where it stands now.', tone: 'warn' };
    default:
      return null;
  }
}

/** What the Practice list says after a delete (?deleted=): "1 practice scorecard deleted.", "None to delete." */
export function deletedText(query: Query): string | null {
  const raw = typeof query.deleted === 'string' ? query.deleted : '';
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (n === 0) return 'There were no practice scorecards to delete.';
  return `${practiceLabel(n)} deleted.`;
}

/** "1 practice scorecard", "3 practice scorecards". */
export const practiceLabel = (n: number) => `${n} practice ${n === 1 ? 'scorecard' : 'scorecards'}`;

// ---------- the start form ----------

/** The start form's fields. */
export const START_FIELDS = { employee: 'employeeId', month: 'month', template: 'templateId' } as const;

/** A version as the start form offers it: "Version 3 · Draft", "Version 2 · In force", "Version 1". */
export function templateChoiceLabel(t: Pick<KpiPracticeTemplateChoice, 'version' | 'draft' | 'inForce' | 'metrics'>): string {
  const parts = [`Version ${t.version}`, t.draft ? 'Draft' : t.inForce ? 'In force' : null, `${t.metrics} ${t.metrics === 1 ? 'metric' : 'metrics'}`];
  return parts.filter(Boolean).join(' · ');
}

/** A month as the start form offers it: "October 2026 (this month: attendance so far)". */
export const monthChoiceLabel = (month: string, current: string) => (month === current ? `${kpiMonthName(month)} (this month: attendance so far)` : kpiMonthName(month));

/** Someone as the start form offers them: "Omar Ali · TLX-0007 · Data Analyst"; without what is hidden from a developer. */
export const personChoiceLabel = (c: Pick<KpiPracticeChoice, 'employee' | 'jobTitle'>) => joinShown([c.employee.fullNameEn, c.employee.employeeCode, c.jobTitle.titleEn]);

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * The start form as the API takes it (POST /kpis/practice): whom (one of the people offered), which month (one of
 * theirs; this month when none is chosen) and which version (one of their job title's; the newest when none is
 * chosen). The API checks them again.
 */
export function startBody(fd: Pick<FormData, 'get'>, people: readonly Pick<KpiPracticeChoice, 'employee' | 'months' | 'templates'>[]): { body: KpiPracticeStartInput | null; errors: string[] } {
  const text = (key: string) => String(fd.get(key) ?? '').trim();
  const employeeId = text(START_FIELDS.employee);
  const person = UUID.test(employeeId) ? people.find((p) => p.employee.id === employeeId) : undefined;
  if (!person) return { body: null, errors: ['Choose the employee.'] };
  const errors: string[] = [];
  const month = text(START_FIELDS.month);
  if (month && !(MONTH.test(month) && person.months.includes(month))) errors.push(`Choose one of ${person.employee.fullNameEn}’s months.`);
  const templateId = text(START_FIELDS.template);
  if (templateId && !person.templates.some((t) => t.id === templateId)) errors.push('Choose one of the job title’s template versions.');
  if (errors.length) return { body: null, errors };
  return { body: { employeeId, month: month || null, templateId: templateId || null }, errors: [] };
}

// ---------- the list ----------

/** A user as the list names them: their name, else their email. */
const userText = (u: KpiUserRef | null) => u?.name?.trim() || u?.email || 'Someone';

/** Who started it and when: "Hazem Magdy · 22/10/2026, 5:42 PM". */
export const startedText = (p: Pick<KpiPracticeInfo, 'startedBy' | 'startedAt'>) => `${userText(p.startedBy)} · ${formatDateTime(p.startedAt)}`;

/** On its page: "Started by Hazem Magdy on 22/10/2026, 5:42 PM, on the draft of version 3." */
export function startedSentence(p: Pick<KpiPracticeInfo, 'startedBy' | 'startedAt' | 'draft'>, version: number): string {
  return `Started by ${userText(p.startedBy)} on ${formatDateTime(p.startedAt)}, on ${p.draft ? `the draft of version ${version}` : `version ${version}`}.`;
}

/** A draft's metrics left out of a practice scorecard, being in Unplaced; null with none. */
export const unplacedText = (n: number | null | undefined): string | null =>
  n ? `${n === 1 ? 'One metric' : `${n} metrics`} of the draft ${n === 1 ? 'is' : 'are'} in Unplaced, so left out until placed in a pillar.` : null;

/** Its template version in a list: "Version 3", with whether it is a draft (shown as a badge). */
export const rowTemplateText = (r: Pick<KpiPracticeRow, 'template'>) => `Version ${r.template.version}`;

// ---------- the draft editor ----------

/** Over a draft with practice scorecards: "2 practice scorecards use this draft; saving a change starts them again from the self-rating." */
export const draftPracticeWarning = (n: number): string | null =>
  n > 0 ? `${practiceLabel(n)} ${n === 1 ? 'uses' : 'use'} this draft; saving a change starts ${n === 1 ? 'it' : 'them'} again from the self-rating.` : null;

/** Added to Discard's question: the practice scorecards on the draft are deleted with it. */
export const discardPracticeText = (n: number) => (n > 0 ? ` Its ${practiceLabel(n)} ${n === 1 ? 'is' : 'are'} deleted too.` : '');

/** Added to Publish's question: the practice scorecards carry on, on the published version. */
export const publishPracticeText = (n: number) => (n > 0 ? ` Its ${practiceLabel(n)} ${n === 1 ? 'carries' : 'carry'} on, on the published version.` : '');
