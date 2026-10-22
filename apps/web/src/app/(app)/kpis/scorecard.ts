import {
  KPI_ACTION_LABELS,
  KPI_COMMENT_MAX,
  KPI_STATUS_LABELS,
  kpiMonthAdd,
  kpiMonthName,
  kpiPercentText,
  kpiScore,
  kpiStepDeadline,
  type KpiCalibrateInput,
  type KpiLevel,
  type KpiPicksInput,
  type KpiScorecardAttendance,
  type KpiScorecardMetric,
  type KpiScorecardSummary,
  type KpiScorecardView,
  type KpiScorer,
  type KpiScoreResult,
  type KpiSignInput,
  type KpiStatus,
  type KpiStepKind,
  type Role,
} from '@trendlix/shared';
import { formatDate } from '../../../lib/format';
import { KPI_PATHS } from '../../../lib/kpi-paths';
import { hasRole } from '../../../lib/roles';

// A KPI scorecard as the pages word and show it (owner, 21 October 2026: "Full framework per role"; "Self, manager, HR,
// sign-off"; "Attendance: Yes, as the sheet"; "Last month's KPI, this pay"): the level's and the step's colours, where it
// stands and what waits for whom, the picks a form starts from and what it sends (the self-rating's and the scoring's
// picks, HR's calibration with a reason for each change, the sign-off's "I've read it"), the live score while picking
// (shared kpiScore) and what the page says once something is done. The rules are @trendlix/shared's kpis.ts, which the
// API enforces; these only word what it sent and read the forms. Pure code, tested; relative imports, as vitest doesn't
// know the "@/" paths.

// ---------- levels and steps, in colour ----------

/**
 * Each level's badge (the prototype's lv-above … lv-unacc, teal to orange): Meets expectations and Needs improvement are
 * the app's own ok and warn colours, the others the prototype's tints between and beyond them.
 */
export const LEVEL_BADGE: Record<KpiLevel, string> = {
  above: 'bg-[#bfe5de] text-[#063f3a]',
  meets: 'bg-ok-soft text-ok',
  needs_improvement: 'bg-warn-soft text-warn',
  unsatisfactory: 'bg-[#fad3b5] text-[#7a3406]',
  unacceptable: 'bg-[#f2b48c] text-[#5c2604]',
};

/** Each level's solid colour, for the distribution's bar and its legend (the prototype's). */
export const LEVEL_BAR: Record<KpiLevel, string> = {
  above: 'bg-ok',
  meets: 'bg-[#5fb3a8]',
  needs_improvement: 'bg-[#f2a35e]',
  unsatisfactory: 'bg-[#c2560c]',
  unacceptable: 'bg-[#7a3406]',
};

/** The levels from the top down, as the distribution lists them. */
export const LEVELS_DOWN: readonly KpiLevel[] = ['above', 'meets', 'needs_improvement', 'unsatisfactory', 'unacceptable'];

/** Each step's badge: the employee's turn and the sign-off in blue, the scorer's and HR's in amber, final in green. */
export const STATUS_BADGE: Record<KpiStatus, string> = {
  self_rating: 'bg-accent-soft text-accent',
  manager: 'bg-warn-soft text-warn',
  hr: 'bg-warn-soft text-warn',
  sign_off: 'bg-accent-soft text-accent',
  final: 'bg-ok-soft text-ok',
};

/** Each step by its name, for the overview's counts and the filters (sentence case: labels). */
export const KPI_STEP_NAMES: Record<KpiStatus, string> = {
  self_rating: 'Self-rating',
  manager: 'Scoring',
  hr: 'HR calibration',
  sign_off: 'Sign-off',
  final: 'Final',
};

/**
 * Where a scorecard stands, by who scores it: "With the manager", or with HR when nobody is in charge, the CEO for a
 * C-level person, a Super Admin for the CEO's own (owner, 21 October 2026: "For C-level people the CEO scores"); the
 * other steps as shared names them.
 */
export function statusText(status: KpiStatus, scorer: KpiScorer): string {
  if (status !== 'manager') return KPI_STATUS_LABELS[status] ?? status;
  if (scorer === 'hr') return 'With HR';
  if (scorer === 'ceo') return 'With the CEO';
  if (scorer === 'super_admin') return 'With a Super Admin';
  return KPI_STATUS_LABELS.manager;
}

/** Who scores it, as the scorecard's header says: "Sara Ali (manager)", "HR", "The CEO". */
export function scorerText(scorer: KpiScorecardSummary['scorer']): string {
  const name = scorer.name?.trim() || null;
  switch (scorer.kind) {
    case 'manager':
      return name ? `${name} (manager)` : 'The manager';
    case 'hr':
      return name ? `${name} (HR)` : 'HR: nobody is in charge of this person';
    case 'ceo':
      return name ? `${name} (the CEO)` : 'The CEO';
    case 'super_admin':
      return name ? `${name} (Super Admin)` : 'A Super Admin';
    default:
      return name ?? String(scorer.kind);
  }
}

/** Who scores it, starting a sentence for the employee: "Your manager", "HR", "The CEO", "A Super Admin". */
const scorerSubject = (scorer: KpiScorer) => (scorer === 'manager' ? 'Your manager' : scorer === 'hr' ? 'HR' : scorer === 'ceo' ? 'The CEO' : 'A Super Admin');

/** A percent as the screens write it ("86%", "89.6%"); a dash when there is none (not scored, or not shown yet). */
export const percentText = (percent: number | null | undefined) => (typeof percent === 'number' && Number.isFinite(percent) ? kpiPercentText(percent) : '—');

// ---------- what waits, and for whom ----------

type Waiting = Pick<KpiScorecardSummary, 'action' | 'status' | 'deadline' | 'employee'>;

/** Whether a scorecard is the caller's own (their employee profile's). */
export const isOwn = (s: Pick<KpiScorecardSummary, 'employee'>, employeeId: string | null | undefined) => !!employeeId && s.employee.id === employeeId;

/** The caller's own scorecards waiting for them: to rate themself, or to sign (Home, My Requests and My KPIs on the phone). */
export const ownWaiting = <S extends Waiting>(list: readonly S[], employeeId: string | null | undefined): S[] => list.filter((s) => s.action && isOwn(s, employeeId));

/** Other people's scorecards waiting for the caller: to score, calibrate or sign as the manager (To Approve, Team KPIs). */
export const othersWaiting = <S extends Waiting>(list: readonly S[], employeeId: string | null | undefined): S[] => list.filter((s) => s.action && !isOwn(s, employeeId));

/** Those the caller scores or signs as their manager (Team KPIs): HR's calibrations are on All KPIs and Approvals. */
export const teamWaiting = <S extends Waiting>(list: readonly S[], employeeId: string | null | undefined): S[] =>
  othersWaiting(list, employeeId).filter((s) => s.action === 'score' || s.action === 'sign');

/**
 * What the caller is to do on it, and by when: "Score by 06/11/2026", "Rate yourself by 03/11/2026", "Calibrate by …",
 * "Sign by …". A scorer may start while the self-rating is still open (it is sent once that is in, or due): said so.
 * Null when nothing waits for them.
 */
export function actionText(s: Pick<KpiScorecardSummary, 'action' | 'status' | 'deadline'>): string | null {
  if (!s.action) return null;
  const date = s.deadline ? formatDate(s.deadline) : null;
  if (s.action === 'score' && s.status === 'self_rating') return date ? `Self-rating due ${date}, then score` : 'Score once the self-rating is in';
  return `${KPI_ACTION_LABELS[s.action] ?? s.action}${date ? ` by ${date}` : ''}`;
}

/**
 * The employee's own card on the phone's Home and My Requests: "Your October 2026 KPI: rate yourself by 03/11/2026",
 * "Your October 2026 KPI: ready to sign by 10/11/2026".
 */
export function ownCardText(s: Pick<KpiScorecardSummary, 'action' | 'month' | 'deadline'>): string {
  const head = `Your ${kpiMonthName(s.month)} KPI`;
  const by = s.deadline ? ` by ${formatDate(s.deadline)}` : '';
  if (s.action === 'self_rate') return `${head}: rate yourself${by}`;
  if (s.action === 'sign') return `${head}: ready to sign${by}`;
  return head;
}

/** A scorecard in a list, in a line: "October 2026 · Score by 06/11/2026" (To Approve's rows). */
export function waitingLine(s: Pick<KpiScorecardSummary, 'action' | 'status' | 'deadline' | 'month'>): string {
  return [kpiMonthName(s.month), actionText(s)].filter(Boolean).join(' · ');
}

/** The button on a row waiting for the caller: Rate yourself, Score, Calibrate, Sign; Open otherwise. */
export const actionButton = (s: Pick<KpiScorecardSummary, 'action'>) => (s.action ? (KPI_ACTION_LABELS[s.action] ?? 'Open') : 'Open');

/** The deadline of the step it is at, as the header says it ("Score by 06/11/2026"); null once final. */
export function stepDeadlineText(view: Pick<KpiScorecardView, 'status' | 'deadlines' | 'scorer'>): string | null {
  const deadline = kpiStepDeadline(view.status, view.deadlines);
  if (!deadline) return null;
  const date = formatDate(deadline);
  switch (view.status) {
    case 'self_rating':
      return `Self-rating by ${date}`;
    case 'manager':
      return `Scoring by ${date}`;
    case 'hr':
      return `HR's calibration by ${date}`;
    case 'sign_off':
      return `Sign-off by ${date}; final then even if not signed`;
    default:
      return null;
  }
}

/** "Counts in the November 2026 payroll" (owner, 21 October 2026: "Last month's KPI, this pay"). */
export const payrollText = (payrollMonth: string) => `Counts in the ${kpiMonthName(payrollMonth)} payroll`;

/**
 * Where a scorecard's page goes back to on the site: My KPIs for the caller's own; All KPIs for HR, the CEO and a Super
 * Admin; Team KPIs for the manager.
 */
export function scorecardBack(user: { roles: readonly Role[]; employeeId?: string | null }, s: Pick<KpiScorecardSummary, 'employee'>): { href: string; label: string } {
  if (isOwn(s, user.employeeId)) return { href: KPI_PATHS.mine, label: 'My KPIs' };
  if (hasRole(user, 'hr', 'ceo') || user.roles.includes('super_admin')) return { href: KPI_PATHS.all, label: 'All KPIs' };
  return { href: KPI_PATHS.team, label: 'Team KPIs' };
}

/** Who sees All KPIs: HR, the CEO and a Super Admin (the API checks it again). */
export const seesAllKpis = (user: { roles: readonly Role[] }) => hasRole(user, 'hr', 'ceo') || user.roles.includes('super_admin');

// ---------- the automatic Attendance metric ----------

/**
 * The Attendance metric in words (owner, 21 October 2026: "Attendance: Yes, as the sheet"): where it was read, and the
 * month's hours and score; not counted for the month (no shift, no hours, paid by the hour), it counts as full.
 */
export function attendanceText(a: Pick<KpiScorecardAttendance, 'ratio' | 'score' | 'source'>): { source: string; detail: string } {
  const source = a.source === 'payroll' ? "From the month's payroll line" : a.source === 'attendance' ? "From the month's attendance" : 'Not counted: full points';
  if (a.ratio === null && a.score === null) return { source, detail: "Attendance isn't counted for this month, so it counts as full." };
  const parts = [
    a.ratio !== null ? `Worked ${kpiPercentText(a.ratio * 100)} of the expected hours` : null,
    a.score !== null ? `attendance score ${kpiPercentText(a.score * 100)}` : null,
  ].filter(Boolean);
  const text = parts.join(', ');
  return { source, detail: `${text.charAt(0).toUpperCase()}${text.slice(1)}.` };
}

// ---------- the picks ----------

/** What the caller does with the scorecard's metrics: reads them, rates themself, scores them, or calibrates the scoring. */
export type SheetMode = 'view' | 'self' | 'score' | 'calibrate';

/** The form the caller gets, by what they may do now (the view's `can`; the API checks it again). */
export function sheetMode(can: Pick<KpiScorecardView['can'], 'selfRate' | 'score' | 'calibrate'>): SheetMode {
  if (can.selfRate) return 'self';
  if (can.score) return 'score';
  if (can.calibrate) return 'calibrate';
  return 'view';
}

/**
 * Over the department averages when the month's scorecards don't all have the same pillars (owner's brief, 21 October
 * 2026: "say 'Pillars changed this month: averages by name'"); since the pillars can differ by department and job
 * title (owner, 22 October 2026: "but i need pillars to each department / wights can be changed for each department and
 * Job title"), said as differing.
 */
export const PILLARS_CHANGED_THIS_MONTH =
  'Pillars differ between this month’s scorecards (by department, job title or a change): averages by name. A pillar’s weight shows when every scorecard with it has the same.';

/** Every metric the caller may pick, in the order of the pillars (never the Attendance metric: the system's). */
export const allMetrics = (view: Pick<KpiScorecardView, 'pillars'>): KpiScorecardMetric[] => view.pillars.flatMap((p) => p.metrics);

/** The pick that counts, as the caller sees it: HR's change, else the manager's; null for none. */
export const countedChoice = (m: Pick<KpiScorecardMetric, 'manager' | 'hr'>): number | null => m.hr?.choice ?? m.manager?.choice ?? null;

/** A criterion's index when it is one of the metric's; else null. */
const validChoice = (m: Pick<KpiScorecardMetric, 'criteria'>, choice: number | null | undefined): number | null =>
  typeof choice === 'number' && Number.isInteger(choice) && choice >= 0 && choice < m.criteria.length ? choice : null;

/**
 * The picks a form starts from: the caller's own so far (the self-rating's, the scoring's), or for HR's calibration the
 * manager's pick, preselected (owner's brief, 21 October 2026: "HR calibrates: may change a manager's pick").
 */
export function startingPicks(view: Pick<KpiScorecardView, 'pillars'>, mode: SheetMode): Record<string, number | null> {
  const picks: Record<string, number | null> = {};
  for (const m of allMetrics(view)) {
    const choice = mode === 'self' ? m.self?.choice : mode === 'score' ? m.manager?.choice : mode === 'calibrate' ? (m.hr?.choice ?? m.manager?.choice) : countedChoice(m);
    picks[m.id] = validChoice(m, choice);
  }
  return picks;
}

/** The comments a form starts from, by metric: the caller's own so far (HR's: the reason of a change already made). */
export function startingNotes(view: Pick<KpiScorecardView, 'pillars'>, mode: SheetMode): Record<string, string> {
  const notes: Record<string, string> = {};
  for (const m of allMetrics(view)) {
    const pick = mode === 'self' ? m.self : mode === 'score' ? m.manager : mode === 'calibrate' ? m.hr : null;
    notes[m.id] = pick?.comment ?? '';
  }
  return notes;
}

/** The step's overall comment a form starts from: the caller's own so far. */
export function startingComment(view: Pick<KpiScorecardView, 'comments'>, mode: SheetMode): string {
  if (mode === 'self') return view.comments.self ?? '';
  if (mode === 'score') return view.comments.manager ?? '';
  if (mode === 'calibrate') return view.comments.hr ?? '';
  return '';
}

/**
 * The score of the picks so far, live as the radios change (shared kpiScore, with the Attendance metric's points), in
 * the scorecard's own pillars (its template version's: owner, 21 October 2026, "Fully flexible").
 */
export function liveScore(view: Pick<KpiScorecardView, 'pillars' | 'attendance' | 'attendancePillar'>, picks: Readonly<Record<string, number | null>>): KpiScoreResult {
  return kpiScore(allMetrics(view), picks, { points: view.attendance.points, achieved: view.attendance.achieved }, { pillars: view.pillars, attendancePillar: view.attendancePillar });
}

/** The names of the metrics not picked yet, in order. */
export const unpicked = (metrics: readonly Pick<KpiScorecardMetric, 'id' | 'name'>[], picks: Readonly<Record<string, number | null | undefined>>): string[] =>
  metrics.filter((m) => typeof picks[m.id] !== 'number').map((m) => m.name);

/** The criterion worth the metric's target (its 100%), marked on the scale; -1 when none is worth exactly that. */
export const targetIndex = (m: Pick<KpiScorecardMetric, 'criteria' | 'targetPoints'>) => m.criteria.findIndex((c) => c.points === m.targetPoints);

/** A pick in words: "No delays · 35 pts"; null for none. */
export function pickText(m: Pick<KpiScorecardMetric, 'criteria'>, choice: number | null | undefined): string | null {
  const c = typeof choice === 'number' ? m.criteria[choice] : undefined;
  return c ? `${c.label} · ${pointsText(c.points)}` : null;
}

/** "35 pts", "1 pt". */
export const pointsText = (n: number) => `${n} ${n === 1 ? 'pt' : 'pts'}`;

// ---------- what the forms send ----------

/** The form's fields: a metric's pick (the criterion's index), its comment, HR's reason for a change. */
export const PICK_FIELD = (metricId: string) => `pick:${metricId}`;
export const NOTE_FIELD = (metricId: string) => `note:${metricId}`;
export const REASON_FIELD = (metricId: string) => `reason:${metricId}`;
/** The step's overall comment. */
export const COMMENT_FIELD = 'comment';
/** Which button sent the form: Send ("1") or Save ("0"). */
export const SUBMIT_FIELD = 'submit';

/** A metric as the actions read its fields: its id, name and how many criteria it has (and the manager's pick, for HR). */
export interface FormMetric {
  id: string;
  name: string;
  criteria: number;
}

export const formMetrics = (view: Pick<KpiScorecardView, 'pillars'>): FormMetric[] => allMetrics(view).map((m) => ({ id: m.id, name: m.name, criteria: m.criteria.length }));

const text = (fd: Pick<FormData, 'get'>, key: string) => String(fd.get(key) ?? '').trim();

/** A criterion's index as sent; null when none (or not one of the metric's). */
function choiceOf(fd: Pick<FormData, 'get'>, m: FormMetric): number | null {
  const raw = text(fd, PICK_FIELD(m.id));
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n < m.criteria ? n : null;
}

const tooLong = (what: string) => `${what} can be at most ${KPI_COMMENT_MAX} characters.`;

/**
 * The self-rating's or the scoring's form as the API takes it (POST …/self, …/score): a pick and an optional comment per
 * metric, the step's comment, and whether it is sent (Send: every metric picked) or saved for later (Save).
 */
export function picksBody(fd: Pick<FormData, 'get'>, metrics: readonly FormMetric[]): { body: KpiPicksInput | null; errors: string[] } {
  const submit = text(fd, SUBMIT_FIELD) === '1';
  const errors: string[] = [];
  const missing: string[] = [];
  const picks = metrics.map((m) => {
    const choice = choiceOf(fd, m);
    if (choice === null) missing.push(m.name);
    const comment = text(fd, NOTE_FIELD(m.id));
    if (comment.length > KPI_COMMENT_MAX) errors.push(tooLong(`The comment on ${m.name}`));
    return { metricId: m.id, choice, comment: comment || null };
  });
  const comment = text(fd, COMMENT_FIELD);
  if (comment.length > KPI_COMMENT_MAX) errors.push(tooLong('The overall comment'));
  if (submit && missing.length) errors.unshift(`Pick a criterion for every metric before sending: ${missing.join(', ')}.`);
  return errors.length ? { body: null, errors } : { body: { picks, comment: comment || null, submit }, errors };
}

/** A metric as HR's calibration reads it: with the manager's pick, which a change is from. */
export interface CalibrationMetric extends FormMetric {
  manager: number | null;
}

export const calibrationMetrics = (view: Pick<KpiScorecardView, 'pillars'>): CalibrationMetric[] =>
  allMetrics(view).map((m) => ({ id: m.id, name: m.name, criteria: m.criteria.length, manager: m.manager?.choice ?? null }));

/** Whether HR's pick changes the manager's: a criterion picked, not the manager's. */
export const isChange = (manager: number | null, pick: number | null | undefined) => typeof pick === 'number' && pick !== manager;

/**
 * HR's calibration as the API takes it (POST …/calibrate): only the picks HR changed from the manager's, each with its
 * reason, required (owner's brief, 21 October 2026: "may change a manager's pick with a required reason"), and HR's
 * optional comment. None changed: the scoring is taken as it is, and goes on to the sign-off.
 */
export function calibrateBody(fd: Pick<FormData, 'get'>, metrics: readonly CalibrationMetric[]): { body: KpiCalibrateInput | null; errors: string[] } {
  const errors: string[] = [];
  const changes: KpiCalibrateInput['changes'] = [];
  for (const m of metrics) {
    const choice = choiceOf(fd, m);
    if (choice === null || !isChange(m.manager, choice)) continue;
    const reason = text(fd, REASON_FIELD(m.id));
    if (!reason) errors.push(`Give the reason for changing the manager's pick on ${m.name}.`);
    else if (reason.length > KPI_COMMENT_MAX) errors.push(tooLong(`The reason on ${m.name}`));
    else changes.push({ metricId: m.id, choice, reason });
  }
  const comment = text(fd, COMMENT_FIELD);
  if (comment.length > KPI_COMMENT_MAX) errors.push(tooLong('Your comment'));
  return errors.length ? { body: null, errors } : { body: { changes, comment: comment || null }, errors };
}

/** The sign-off as the API takes it (POST …/sign): "I've read it", with an optional comment. */
export function signBody(fd: Pick<FormData, 'get'>): { body: KpiSignInput | null; errors: string[] } {
  const comment = text(fd, COMMENT_FIELD);
  if (comment.length > KPI_COMMENT_MAX) return { body: null, errors: [tooLong('Your comment')] };
  return { body: { comment: comment || null }, errors: [] };
}

// ---------- once something is done ----------

/** What was just done on a scorecard, said on its page by `?done=`; `moved`: refused as it had moved on meanwhile (409). */
export const SCORECARD_DONE = ['self_saved', 'self_sent', 'score_saved', 'score_sent', 'calibrated', 'signed', 'moved'] as const;
export type ScorecardDone = (typeof SCORECARD_DONE)[number];

/** A scorecard's page after something was done on it: "/kpis/scorecards/<id>?done=self_sent". */
export const scorecardDoneHref = (id: string, done: ScorecardDone) => `${KPI_PATHS.scorecard(id)}?done=${done}`;

type Query = Record<string, string | string[] | undefined>;

/** What the page says after `?done=`, and in which tone; null for anything else. `view`: the scorecard as it is now. */
export function doneText(query: Query, view: Pick<KpiScorecardView, 'status' | 'scorer' | 'deadlines'>): { text: string; tone: 'ok' | 'warn' } | null {
  const done = typeof query.done === 'string' ? query.done : '';
  switch (done) {
    case 'self_saved':
      return { text: `Your self-rating is saved, not sent yet. Send it by ${formatDate(view.deadlines.selfRating)}.`, tone: 'ok' };
    case 'self_sent':
      return { text: `Your self-rating is sent. ${scorerSubject(view.scorer.kind)} scores the month next; you see the score at the sign-off.`, tone: 'ok' };
    case 'score_saved':
      return { text: `Your scoring is saved, not sent yet. Send it by ${formatDate(view.deadlines.manager)}.`, tone: 'ok' };
    case 'score_sent':
      return {
        text: view.status === 'hr' ? 'Your scoring is sent to HR to calibrate.' : 'Your scoring is sent. The scorecard is ready for the employee and the manager to sign.',
        tone: 'ok',
      };
    case 'calibrated':
      return { text: 'Calibrated and sent for sign-off: the employee and the manager are asked to sign.', tone: 'ok' };
    case 'signed':
      return {
        text: view.status === 'final' ? 'Signed. The scorecard is final.' : `Signed. It is final once both have signed, or after ${formatDate(view.deadlines.signOff)} anyway.`,
        tone: 'ok',
      };
    case 'moved':
      return { text: 'This scorecard has moved on since you opened it. It shows where it stands now.', tone: 'warn' };
    default:
      return null;
  }
}

// ---------- the steps ----------

/** A step's mark on the timeline: a missed self-rating, a calibration or a final without every signature in amber, the rest done. */
export function stepTone(kind: KpiStepKind): 'ok' | 'warn' | 'none' {
  if (kind === 'self_missed' || kind === 'calibrated' || kind === 'final_unsigned') return 'warn';
  if (kind === 'opened') return 'none';
  return 'ok';
}

/** "3 steps", "1 step". */
export const stepsLabel = (n: number) => `${n} ${n === 1 ? 'step' : 'steps'}`;

// ---------- All KPIs ----------

/**
 * The month's average against the month before: "+1.8 pts vs September 2026", "Same as September 2026"; none scored the
 * month before: said so. Null with no average.
 */
export function averageChangeText(average: number | null, previous: number | null, month: string): string | null {
  if (average === null) return null;
  const before = kpiMonthName(kpiMonthAdd(month, -1));
  if (previous === null) return `None scored in ${before} to compare`;
  const d = Math.round((average - previous) * 10) / 10;
  if (d === 0) return `Same as ${before}`;
  return `${d > 0 ? '+' : '−'}${Math.abs(d)} pts vs ${before}`;
}

/** "1 scorecard", "12 scorecards". */
export const scorecardsLabel = (n: number) => `${n} ${n === 1 ? 'scorecard' : 'scorecards'}`;

/** What opening a month's scorecards did (POST /kpis/open). */
export function openedText(r: { month: string; opened: number }): string {
  const month = kpiMonthName(r.month);
  if (r.opened === 0) return `No new scorecards for ${month}: everyone with a published template has theirs already.`;
  return `${scorecardsLabel(r.opened)} opened for ${month}. Each person is told to rate themself.`;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** A month in the address (YYYY-MM), when it is one; else null. */
export function readMonth(query: Query): string | null {
  const v = typeof query.month === 'string' ? query.month : '';
  return MONTH.test(v) ? v : null;
}

/** A step in the address, when it is one of the scorecard's; else null (every step). */
export function readStatus(query: Query): KpiStatus | null {
  const v = typeof query.status === 'string' ? query.status : '';
  return (Object.keys(KPI_STEP_NAMES) as KpiStatus[]).includes(v as KpiStatus) ? (v as KpiStatus) : null;
}

const UUID = /^[0-9a-f-]{36}$/i;

/** A department in the address, when it is an id; else null (every department). */
export function readDepartment(query: Query): string | null {
  const v = typeof query.department === 'string' ? query.department : '';
  return UUID.test(v) ? v : null;
}

/** All KPIs' address for a month and its filters (a link keeps them). */
export function allKpisHref(f: { month?: string | null; status?: string | null; department?: string | null }): string {
  const params = new URLSearchParams();
  if (f.month) params.set('month', f.month);
  if (f.status) params.set('status', f.status);
  if (f.department) params.set('department', f.department);
  const qs = params.toString();
  return qs ? `${KPI_PATHS.all}?${qs}` : KPI_PATHS.all;
}

/** The month's workbook, from the API under the web domain (all/excel/route.ts): "/kpis/all/excel?month=2026-10". */
export const kpiExcelHref = (month: string) => `${KPI_PATHS.all}/excel?month=${encodeURIComponent(month)}`;

/** The name the workbook is saved under when the API names none: "KPIs October 2026.xlsx". */
export const kpiExcelName = (month: string) => `KPIs ${kpiMonthName(month)}.xlsx`;
