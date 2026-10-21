'use client';

import { startTransition, useActionState, useState } from 'react';
import {
  KPI_ATTENDANCE_METRIC,
  KPI_COMMENT_MAX,
  KPI_LEVEL_LABELS,
  kpiPast,
  kpiPercentText,
  type KpiPillarScore,
  type KpiScorecardMetric,
  type KpiScorecardPillar,
  type KpiScorecardView,
  type KpiScoreResult,
} from '@trendlix/shared';
import { FormErrors, useFieldIds, useKeptForm } from '@/components/form';
import { SurfaceField } from '@/components/surface';
import { formatDate, titleCase } from '@/lib/format';
import type { FormState } from '@/lib/types';
import {
  allMetrics,
  attendanceText,
  COMMENT_FIELD,
  countedChoice,
  isChange,
  liveScore,
  NOTE_FIELD,
  PICK_FIELD,
  pickText,
  pointsText,
  REASON_FIELD,
  startingComment,
  startingNotes,
  startingPicks,
  SUBMIT_FIELD,
  targetIndex,
  unpicked,
  type SheetMode,
} from '../../scorecard';
import { LevelBadge } from '../../ui';

// A KPI scorecard's pillars and metrics, and the forms of its steps (owner, 21 October 2026: "Full framework per role";
// "Self, manager, HR, sign-off"): its pillars with their weights (its template version's, as it was published: owner,
// 21 October 2026, "Fully flexible"), each metric with its definition, how it is measured, the JD duty it comes from and
// its criteria scale (the target marked), and the automatic Attendance metric read-only in its pillar (Discipline &
// Growth unless the framework chose another). Read as it stands, or as the caller's step: the employee's self-rating, the scorer's
// scoring with the self-rating beside each metric, HR's calibration (the manager's pick preselected, a reason required
// for each change), each as radio choices with the final %, the pillars' % and the level worked out live as they are
// picked (shared kpiScore). The sign-off is "I've read it", with an optional comment. The API checks everything again.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const optional = <span className="font-normal text-muted">(optional)</span>;

const CHOICE =
  'flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-line bg-white px-3 py-2 text-left text-sm has-checked:border-accent has-checked:bg-accent-soft has-focus-visible:ring-2 has-focus-visible:ring-accent/30';
const SHOWN = 'flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm';

/** A small tag on a criterion: the target, or whose pick it was. */
function Tag({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'accent' | 'warn' }) {
  const colours = tone === 'accent' ? 'bg-accent-soft text-accent' : tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-line-soft text-muted';
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${colours}`}>{children}</span>;
}

// ---------- the score ----------

/** "92% · Meets expectations". */
const scoreLine = (s: KpiScoreResult) => `${kpiPercentText(s.finalPercent)} · ${KPI_LEVEL_LABELS[s.level]}`;

/**
 * The final % big with its level, the pillars' % under it, and a line saying whose score it is; a dash when there is
 * none to show (not scored, or not shown to the employee before the sign-off).
 */
function ScoreSummary({ title, score, notes }: { title: string; score: KpiScoreResult | null; notes: (string | null | false)[] }) {
  const lines = notes.filter((n): n is string => !!n);
  return (
    <section aria-labelledby="kpi-score-heading" className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="kpi-score-heading" className="font-semibold">
            {title}
          </h2>
          <div role="status" aria-live="polite" className="mt-2 flex flex-wrap items-baseline gap-3">
            <span className="text-5xl font-semibold tracking-tight tabular-nums">{score ? kpiPercentText(score.finalPercent) : '—'}</span>
            {score && <LevelBadge level={score.level} className="px-3 py-1 text-sm" />}
          </div>
          {lines.map((l) => (
            <p key={l} className="mt-1 text-sm text-muted">
              {l}
            </p>
          ))}
        </div>
        {score && (
          <dl className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
            {score.pillars.map((p) => (
              <div key={p.key} className="rounded-lg bg-canvas px-3 py-2 sm:min-w-28">
                <dt className="text-xs text-muted" title={p.name}>
                  {p.short} · {p.weight}%
                </dt>
                <dd className="text-lg font-semibold tabular-nums">{kpiPercentText(p.percent)}</dd>
                <dd className="text-[11px] text-muted tabular-nums">
                  {p.achieved} / {pointsText(p.max)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  );
}

// ---------- a metric ----------

/** What earlier steps picked and said on a metric, as the caller may see them: "Self-rating: No delays · 35 pts". */
function EarlierPicks({ metric: m, mode }: { metric: KpiScorecardMetric; mode: SheetMode }) {
  const lines: { who: string; pick: string | null; comment: string | null; tone?: 'warn' }[] = [];
  if (mode !== 'self' && m.self && (m.self.choice !== null || m.self.comment)) lines.push({ who: 'Self-rating', pick: pickText(m, m.self.choice), comment: m.self.comment });
  if (mode !== 'score' && m.manager && (m.manager.choice !== null || m.manager.comment)) lines.push({ who: 'Manager', pick: pickText(m, m.manager.choice), comment: m.manager.comment });
  if (mode !== 'calibrate' && m.hr && m.hr.choice !== null) lines.push({ who: 'Calibrated by HR', pick: pickText(m, m.hr.choice), comment: m.hr.comment, tone: 'warn' });
  if (!lines.length) return null;
  return (
    <ul className="mt-3 space-y-1.5 text-sm">
      {lines.map((l) => (
        <li key={l.who} className={l.tone === 'warn' ? 'text-warn' : undefined}>
          <span className="font-medium">{l.who}:</span> {l.pick ?? <span className="text-muted">not picked</span>}
          {l.comment && <span className="block whitespace-pre-line text-muted">“{l.comment}”</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * A metric: its name and what it is, its criteria scale (the target marked; the self-rating's and the manager's picks
 * tagged where the caller sees them), and its points of its target. With `onPick`, the scale is the caller's radio
 * choices, with their comment (or HR's reason for a change).
 */
function MetricRow({
  metric: m,
  mode,
  pick,
  onPick,
  note,
  onNote,
  fid,
}: {
  metric: KpiScorecardMetric;
  mode: SheetMode;
  pick: number | null;
  onPick?: (choice: number) => void;
  note?: string;
  onNote?: (text: string) => void;
  fid: (name: string) => string;
}) {
  const target = targetIndex(m);
  const managerPick = m.manager?.choice ?? null;
  const changed = mode === 'calibrate' && isChange(managerPick, pick);
  const points = typeof pick === 'number' ? (m.criteria[pick]?.points ?? null) : mode === 'view' ? m.points : null;
  const editable = !!onPick;
  // the comment box starts open when there is one already; after that it is the person's to open and close (it stays
  // open while they clear it)
  const [noteOpen] = useState(() => !!note);

  function tags(i: number) {
    return (
      <span className="flex flex-wrap justify-end gap-1">
        {i === target && <Tag>Target</Tag>}
        {mode !== 'self' && m.self?.choice === i && <Tag tone="accent">Self-rating</Tag>}
        {(mode === 'calibrate' || (mode === 'view' && m.hr?.choice !== null && m.hr?.choice !== undefined)) && managerPick === i && <Tag>Manager</Tag>}
      </span>
    );
  }

  return (
    <div className="border-t border-line-soft px-5 py-4">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.5fr)_5rem]">
        <div className="min-w-0 space-y-1">
          <h3 className="font-semibold">{titleCase(m.name)}</h3>
          {m.definition && <p className="text-sm text-muted">{m.definition}</p>}
          {m.howMeasured && (
            <p className="text-xs text-muted">
              <span className="font-semibold">How it’s measured:</span> {m.howMeasured}
            </p>
          )}
          {m.jdDuty && (
            <p className="text-xs text-accent">
              <span className="font-semibold">From the JD:</span> {m.jdDuty}
            </p>
          )}
        </div>

        <div className="min-w-0">
          {editable ? (
            <fieldset>
              <legend className="mb-1.5 text-xs font-semibold text-muted">
                {mode === 'self' ? 'Pick how you did' : mode === 'calibrate' ? 'The manager’s pick, or yours' : 'Pick one'}
                <span className="sr-only"> for {m.name}</span>
              </legend>
              <div className="space-y-1.5">
                {m.criteria.map((c, i) => (
                  <label key={i} className={CHOICE}>
                    <span className="flex min-w-0 items-center gap-2.5">
                      <input type="radio" name={PICK_FIELD(m.id)} value={i} checked={pick === i} onChange={() => onPick!(i)} className="size-4 shrink-0 accent-accent" />
                      <span className="min-w-0 break-words">{c.label}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {tags(i)}
                      <span className="text-xs font-semibold text-muted tabular-nums">{pointsText(c.points)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : (
            <ul aria-label={`Criteria for ${m.name}`} className="space-y-1.5">
              {m.criteria.map((c, i) => {
                const chosen = pick === i;
                return (
                  <li key={i} className={`${SHOWN} ${chosen ? 'border-accent bg-accent-soft font-semibold' : 'border-line bg-white'}`}>
                    <span className="min-w-0 break-words">
                      {chosen && <span className="sr-only">Counted: </span>}
                      {c.label}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {tags(i)}
                      <span className="text-xs font-semibold text-muted tabular-nums">{pointsText(c.points)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <EarlierPicks metric={m} mode={mode} />

          {editable && mode !== 'calibrate' && (
            <details className="mt-2" open={noteOpen}>
              <summary className="cursor-pointer text-sm font-semibold text-accent">Comment {optional}</summary>
              <label htmlFor={fid(`note-${m.id}`)} className="sr-only">
                Comment on {m.name}
              </label>
              <textarea
                id={fid(`note-${m.id}`)}
                name={NOTE_FIELD(m.id)}
                rows={2}
                maxLength={KPI_COMMENT_MAX}
                value={note ?? ''}
                onChange={(e) => onNote?.(e.target.value)}
                className="input mt-1.5"
              />
            </details>
          )}
          {editable && changed && (
            <div className="mt-2">
              <label htmlFor={fid(`reason-${m.id}`)} className="label">
                Reason for the change
              </label>
              <textarea
                id={fid(`reason-${m.id}`)}
                name={REASON_FIELD(m.id)}
                rows={2}
                required
                maxLength={KPI_COMMENT_MAX}
                value={note ?? ''}
                onChange={(e) => onNote?.(e.target.value)}
                aria-describedby={fid(`reason-${m.id}-hint`)}
                className="input"
              />
              <p id={fid(`reason-${m.id}-hint`)} className="hint">
                Required: the manager&apos;s pick was {pickText(m, managerPick) ?? 'none'}. The employee and the manager read it, and it is logged.
              </p>
            </div>
          )}
        </div>

        <div className="text-left md:text-right">
          <span className="text-xl font-semibold tabular-nums">{points ?? '—'}</span>
          <span className="block text-xs text-muted tabular-nums">of {pointsText(m.targetPoints)}</span>
        </div>
      </div>
    </div>
  );
}

/** The automatic Attendance metric, read-only in its pillar (owner, 21 October 2026: "Attendance: Yes, as the sheet"). */
function AttendanceRow({ view }: { view: Pick<KpiScorecardView, 'attendance'> }) {
  const a = view.attendance;
  const t = attendanceText(a);
  return (
    <div className="border-t border-line-soft bg-canvas/60 px-5 py-4">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.5fr)_5rem]">
        <div className="min-w-0 space-y-1">
          <h3 className="flex flex-wrap items-center gap-2 font-semibold">
            {KPI_ATTENDANCE_METRIC} <Tag>Automatic</Tag>
          </h3>
          <p className="text-sm text-muted">The month&apos;s worked hours against the expected, as payroll counts them. Filled in by the system; nobody picks it.</p>
        </div>
        <div className="min-w-0 space-y-1 text-sm">
          <p>{t.detail}</p>
          <p className="text-xs text-muted">{t.source}</p>
        </div>
        <div className="text-left md:text-right">
          <span className="text-xl font-semibold tabular-nums">{a.achieved}</span>
          <span className="block text-xs text-muted tabular-nums">of {pointsText(a.points)}</span>
        </div>
      </div>
    </div>
  );
}

/** A pillar: its number, weight, points and %, and its metrics (the Attendance metric's pillar with it). */
function PillarCard({
  pillar,
  number,
  score,
  view,
  children,
}: {
  pillar: KpiScorecardPillar;
  number: number;
  score: KpiPillarScore | null;
  view: Pick<KpiScorecardView, 'attendance' | 'attendancePillar'>;
  children: React.ReactNode;
}) {
  const attendance = pillar.key === view.attendancePillar;
  return (
    <section aria-labelledby={`kpi-pillar-${pillar.key}`} className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-canvas/60 px-5 py-4">
        <div>
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">
            Pillar {number} · weight {pillar.weight}%
          </p>
          <h2 id={`kpi-pillar-${pillar.key}`} className="mt-0.5 font-semibold">
            {pillar.name}
          </h2>
        </div>
        <div className="flex items-baseline gap-4">
          <span className="text-sm text-muted tabular-nums">{score ? `${score.achieved} / ${pointsText(score.max)}` : `of ${pointsText(pillar.max)}`}</span>
          <span className="text-2xl font-semibold tabular-nums">{score ? kpiPercentText(score.percent) : '—'}</span>
        </div>
      </div>
      {children}
      {attendance && <AttendanceRow view={view} />}
      {pillar.metrics.length === 0 && !attendance && <p className="border-t border-line-soft px-5 py-4 text-sm text-muted">No metrics in this pillar.</p>}
    </section>
  );
}

// ---------- the scorecard, read or as the caller's step ----------

/** What the score card says while nobody picks (the scorecard as the caller may see it). */
function shownSummary(view: KpiScorecardView, own: boolean): { title: string; score: KpiScoreResult | null; notes: (string | null | false)[] } {
  if (view.score) {
    return {
      title: view.status === 'final' ? 'Final Score' : 'Score',
      score: view.score,
      notes: [
        view.status === 'hr' && 'The manager’s scoring, before HR’s calibration.',
        view.calibrated > 0 && `HR changed ${view.calibrated === 1 ? 'one pick' : `${view.calibrated} picks`}, each with its reason.`,
        view.score.capped && 'Capped at 110%.',
        view.selfScore && `Self-rating: ${scoreLine(view.selfScore)}.`,
      ],
    };
  }
  if (view.selfScore) {
    return {
      title: own ? 'Your Self-rating' : 'Self-rating',
      score: view.selfScore,
      notes: [own ? 'Your own rating. The score that counts shows here from the sign-off.' : 'The employee’s own rating; not scored yet.'],
    };
  }
  return { title: 'Score', score: null, notes: [own ? 'The score that counts shows here from the sign-off.' : 'Not scored yet.'] };
}

/** The scorecard's pillars as it stands, with its score: no form. */
export function ScorecardView({ view, own }: { view: KpiScorecardView; own: boolean }) {
  const fid = useFieldIds();
  const summary = shownSummary(view, own);
  const shownPillars = view.score?.pillars ?? null;
  return (
    <div className="space-y-4">
      <ScoreSummary {...summary} />
      {view.pillars.map((p, i) => (
        <PillarCard key={p.key} pillar={p} number={i + 1} view={view} score={shownPillars?.find((s) => s.key === p.key) ?? null}>
          {p.metrics.map((m) => (
            <MetricRow key={m.id} metric={m} mode="view" pick={countedChoice(m)} fid={fid} />
          ))}
        </PillarCard>
      ))}
    </div>
  );
}

const COMMENT_LABELS: Record<Exclude<SheetMode, 'view'>, { label: string; hint: string }> = {
  self: { label: 'Your comment on the month', hint: 'What went well, and what held you back. Your manager reads it.' },
  score: { label: 'Your comments and areas of focus', hint: 'What went well, and what to focus on next month. The employee reads it at the sign-off.' },
  calibrate: { label: 'HR’s comment', hint: 'Said to both at the sign-off, with your reasons.' },
};

/**
 * The caller's step on the scorecard: the self-rating, the scoring (the self-rating beside each metric) or HR's
 * calibration (the manager's pick preselected; a reason required for each change). Every pick moves the score at the
 * top. Save keeps the picks for later; Send (every metric picked) sends them on; HR's one button calibrates and sends
 * it for sign-off with only the changed picks. `today` (YYYY-MM-DD, Cairo): a scorer sends once the self-rating is in,
 * or its day has passed.
 */
export function ScorecardForm({ view, mode, action, today }: { view: KpiScorecardView; mode: Exclude<SheetMode, 'view'>; action: Action; today: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const [picks, setPicks] = useState(() => startingPicks(view, mode));
  const [notes, setNotes] = useState(() => startingNotes(view, mode));
  const [comment, setComment] = useState(() => startingComment(view, mode));
  const [sending, setSending] = useState<'0' | '1' | null>(null);

  const metrics = allMetrics(view);
  const score = liveScore(view, picks);
  const left = unpicked(metrics, picks);
  const managerPicks = Object.fromEntries(metrics.map((m) => [m.id, m.manager?.choice ?? null]));
  const changes = mode === 'calibrate' ? metrics.filter((m) => isChange(managerPicks[m.id], picks[m.id])) : [];
  const reasonsLeft = changes.filter((m) => !notes[m.id]?.trim()).map((m) => m.name);
  // the scorer may save while the self-rating is open, and send once it is in or its day has passed (the API's rule)
  const waitsForSelf = mode === 'score' && view.status === 'self_rating' && !kpiPast(view.deadlines.selfRating, today);
  const canSend = mode === 'calibrate' ? reasonsLeft.length === 0 : left.length === 0 && !waitsForSelf;
  const c = COMMENT_LABELS[mode];

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const fd = new FormData(e.currentTarget, submitter instanceof HTMLButtonElement ? submitter : null);
    const submit = mode === 'calibrate' || fd.get(SUBMIT_FIELD) === '1';
    if (submit) {
      const ask =
        mode === 'self'
          ? 'Send your self-rating? You can’t change it once it is sent.'
          : mode === 'score'
            ? `Send your scoring of ${view.employee.fullNameEn}? You can’t change it once it is sent.`
            : changes.length
              ? `Calibrate with ${changes.length === 1 ? 'one change' : `${changes.length} changes`} and send for sign-off?`
              : 'Send for sign-off with the manager’s picks as they are?';
      if (!window.confirm(ask)) return;
    }
    setSending(mode === 'calibrate' ? '1' : fd.get(SUBMIT_FIELD) === '1' ? '1' : '0');
    startTransition(() => formAction(fd));
  }

  const scoreNotes = [
    left.length ? `${left.length === 1 ? 'One metric' : `${left.length} metrics`} not picked yet: ${left.length === 1 ? 'it counts' : 'they count'} 0 until picked.` : null,
    score.capped && 'Capped at 110%.',
    mode !== 'self' && view.selfScore && `Self-rating: ${scoreLine(view.selfScore)}.`,
    mode === 'calibrate' && view.score && `The manager’s score: ${scoreLine(view.score)}.`,
  ];

  return (
    <form action={formAction} onSubmit={onSubmit} aria-label={mode === 'self' ? 'Your self-rating' : mode === 'score' ? 'Your scoring' : 'HR’s calibration'} className="space-y-4">
      <SurfaceField />
      <ScoreSummary
        title={mode === 'self' ? 'Your Self-rating' : mode === 'score' ? 'Your Scoring' : 'Calibrated Score'}
        score={score}
        notes={['Worked out as you pick.', ...scoreNotes]}
      />
      {view.pillars.map((p, i) => (
        <PillarCard key={p.key} pillar={p} number={i + 1} view={view} score={score.pillars.find((s) => s.key === p.key) ?? null}>
          {p.metrics.map((m) => (
            <MetricRow
              key={m.id}
              metric={m}
              mode={mode}
              pick={picks[m.id] ?? null}
              onPick={(choice) => setPicks((all) => ({ ...all, [m.id]: choice }))}
              note={notes[m.id]}
              onNote={(text) => setNotes((all) => ({ ...all, [m.id]: text }))}
              fid={fid}
            />
          ))}
        </PillarCard>
      ))}

      <section className="card space-y-4 p-5">
        <div>
          <label htmlFor={fid('comment')} className="label">
            {/* the manager's comments go with the scoring (owner's brief, 21 October 2026: "The manager scores with comments") */}
            {c.label} {mode === 'score' ? <span className="font-normal text-muted">(needed to send)</span> : optional}
          </label>
          <textarea
            id={fid('comment')}
            name={COMMENT_FIELD}
            rows={3}
            maxLength={KPI_COMMENT_MAX}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            aria-describedby={fid('comment-hint')}
            className="input"
          />
          <p id={fid('comment-hint')} className="hint">
            {c.hint} Up to {KPI_COMMENT_MAX} characters.
          </p>
        </div>

        <FormErrors errors={state.errors} />
        <div role="status" aria-live="polite" className="text-sm">
          {mode === 'calibrate' ? (
            reasonsLeft.length ? (
              <p className="text-warn">Give the reason for each change: {reasonsLeft.join(', ')}.</p>
            ) : (
              <p className="text-muted">
                {changes.length
                  ? `${changes.length === 1 ? 'One pick changed' : `${changes.length} picks changed`} from the manager’s, each with its reason.`
                  : 'No pick changed: the manager’s scoring goes to the sign-off as it is.'}
              </p>
            )
          ) : waitsForSelf ? (
            <p className="text-muted">
              The self-rating is due by {formatDate(view.deadlines.selfRating)}. Save your scoring now; send it once the self-rating is in, or after that day.
            </p>
          ) : left.length ? (
            <p className="text-muted">Pick a criterion for every metric to send it. Still to pick: {left.join(', ')}.</p>
          ) : (
            <p className="text-ok">Every metric is picked: ready to send.</p>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          {mode === 'calibrate' ? (
            <button type="submit" disabled={pending || !canSend} className="btn btn-primary">
              {pending ? 'Sending…' : 'Calibrate and send for sign-off'}
            </button>
          ) : (
            <>
              <button type="submit" name={SUBMIT_FIELD} value="1" disabled={pending || !canSend} className="btn btn-primary">
                {pending && sending === '1' ? 'Sending…' : mode === 'self' ? 'Send self-rating' : 'Send scoring'}
              </button>
              <button type="submit" name={SUBMIT_FIELD} value="0" disabled={pending} className="btn btn-secondary">
                {pending && sending === '0' ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
        </div>
      </section>
    </form>
  );
}

/**
 * The sign-off (owner's brief, 21 October 2026: "Sign-off by both, the employee and the manager: a digital "I've read
 * it" with an optional comment"). `as`: whose side the caller signs.
 */
export function SignForm({ action, as, deadline }: { action: Action; as: 'employee' | 'manager'; deadline: string }) {
  // the comment typed stays when the API refuses the signature
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();
  return (
    <form {...form} aria-label="Sign the scorecard" className="space-y-4">
      <SurfaceField />
      <p className="text-sm text-muted">
        {as === 'employee'
          ? 'Read the scorecard above: the score, the picks and the comments. Signing says you have read it.'
          : 'Read the scorecard as it goes to the employee. Signing says you have read it, as their manager.'}{' '}
        Not signed by {formatDate(deadline)}, it is final anyway, and that is noted.
      </p>
      <div>
        <label htmlFor={fid('sign-comment')} className="label">
          Comment {optional}
        </label>
        <textarea id={fid('sign-comment')} name={COMMENT_FIELD} rows={2} maxLength={KPI_COMMENT_MAX} className="input" />
      </div>
      <FormErrors errors={state.errors} />
      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? 'Signing…' : 'I’ve read it'}
      </button>
    </form>
  );
}
