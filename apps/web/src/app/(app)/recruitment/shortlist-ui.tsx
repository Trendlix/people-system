'use client';

import { APPLICATION_STAGE_LABELS, isDecisionStep, rejectReasonsOf, STEP_OUTCOME_LABELS, STEP_OUTCOME_NOTES, STEP_OUTCOMES_OF, type ApplicationStage, type DecisionStep, type StepOutcome } from '@trendlix/shared';
import { createContext, useCallback, useContext, useState, useTransition } from 'react';
import { FormErrors, useFieldIds } from '@/components/form';
import { decideBatch, sendToReview, type BatchState } from './shortlist-actions';
import { allTicks, outcomeLabel, sendLabel, sharedStage, ticked, tickedAll, tickedIds } from './shortlist';
import { FeedbackField, ReasonPicker } from './tree-ui';

// Ticking applicants to act on together (owner, 29 October 2026: "Tick several at once"; the recruitment tree, 3 November
// 2026), as All Assets ticks assets: the tables put a tick box on each row that may be ticked and a "Select all" on their
// titles (BatchTick, BatchTickAll), inside VacancySelection (a vacancy's list: "Send to Review 1 (N)" for those at
// Applicants, or the step's outcomes for those ticked at one step the caller decides, in a bar kept at the bottom of the
// screen while some are ticked) or ReviewSelection (My Hiring: a review's Pass or Reject, with the reasons and the
// feedback). The ticks live here, so the rows' own forms (Delete applicant) are never nested in another; what a batch did
// is said above the list once the page is read again.

interface Ticks {
  selected: ReadonlySet<string>;
  /** Those that may be ticked, in the list's order. */
  ids: readonly string[];
  tick: (id: string, on: boolean) => void;
  tickAll: (on: boolean) => void;
}

const TicksContext = createContext<Ticks | null>(null);

function useTicks(ids: readonly string[]) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const ticks: Ticks = {
    selected,
    ids,
    tick: (id, on) => setSelected((s) => ticked(s, id, on)),
    tickAll: (on) => setSelected(tickedAll(ids, on)),
  };
  return { ticks, chosen: tickedIds(ids, selected), clear: () => setSelected(new Set()) };
}

const tickBox = 'flex size-11 cursor-pointer items-center justify-center';
const box = 'size-4 cursor-pointer accent-accent';

/** A row's tick box: only inside a selection, and only on a row that may be ticked. */
export function BatchTick({ id, label }: { id: string; label: string }) {
  const ticks = useContext(TicksContext);
  if (!ticks?.ids.includes(id)) return null;
  return (
    <label className={tickBox}>
      <input type="checkbox" checked={ticks.selected.has(id)} onChange={(e) => ticks.tick(id, e.currentTarget.checked)} aria-label={`Select ${label}`} className={box} />
    </label>
  );
}

/** "Select all": every row that may be ticked, or none; half ticked while only some are. */
export function BatchTickAll({ label }: { label: string }) {
  const ticks = useContext(TicksContext);
  const state = ticks ? allTicks(ticks.selected, ticks.ids) : 'none';
  const set = useCallback(
    (el: HTMLInputElement | null) => {
      if (el) el.indeterminate = state === 'some';
    },
    [state],
  );
  if (!ticks?.ids.length) return null;
  return (
    <label className={tickBox}>
      <input ref={set} type="checkbox" checked={state === 'all'} onChange={(e) => ticks.tickAll(e.currentTarget.checked)} aria-label={label} className={box} />
    </label>
  );
}

/** What a batch did, in words: green when some were done, amber when none were. */
function Said({ state }: { state: BatchState }) {
  if (!state.message || state.errors) return null;
  return (
    <p role="status" className={`text-sm ${state.result?.done.length ? 'text-ok' : 'text-warn'}`}>
      {state.message}
    </p>
  );
}

/**
 * A step's decision for those ticked: the outcome (the step's own), the reasons once Reject is chosen, the feedback, and
 * the button for them all ("Pass (3)"). What it did goes to `done`, said by the list's selection.
 */
function BatchDecide({ vacancyId, stage, chosen, done, className = '' }: { vacancyId: string; stage: DecisionStep; chosen: readonly string[]; done: (state: BatchState) => void; className?: string }) {
  const [outcome, setOutcome] = useState<StepOutcome | ''>('');
  const [errors, setErrors] = useState<string[] | undefined>();
  const [pending, startTransition] = useTransition();
  const fid = useFieldIds();
  const n = chosen.length;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setErrors(undefined);
        startTransition(async () => {
          const r = await decideBatch(vacancyId, {}, fd);
          if (r.errors) return setErrors(r.errors);
          setOutcome('');
          done(r);
        });
      }}
      className={`space-y-3 ${className}`}
    >
      <FormErrors errors={errors} />
      {chosen.map((id) => (
        <input key={id} type="hidden" name="applicationIds" value={id} />
      ))}
      <input type="hidden" name="stage" value={stage} />
      <fieldset>
        <legend className="label">Decide {APPLICATION_STAGE_LABELS[stage]}</legend>
        <div className="flex flex-wrap gap-2">
          {STEP_OUTCOMES_OF[stage].map((o) => (
            <label key={o} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-card px-3 text-sm has-checked:border-accent has-checked:bg-accent-soft">
              <input type="radio" name="outcome" value={o} checked={outcome === o} onChange={() => setOutcome(o)} className="size-4 accent-accent" />
              <span>
                {STEP_OUTCOME_LABELS[o]}
                {STEP_OUTCOME_NOTES[o] && <span className="block text-xs text-muted">{STEP_OUTCOME_NOTES[o]}</span>}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {outcome === 'rejected' && <ReasonPicker reasons={rejectReasonsOf(stage)} />}
      <FeedbackField id={fid('feedback')} />
      <button type="submit" disabled={pending || !outcome || n === 0} className={`btn ${outcome === 'rejected' || outcome === 'declined' ? 'btn-danger' : 'btn-primary'}`}>
        {pending ? 'Saving…' : outcome ? outcomeLabel(outcome, n) : `Choose the outcome (${n})`}
      </button>
    </form>
  );
}

/**
 * A vacancy's list with the caller's ticks (`rows`: those that may be ticked, with their stage): "Send to Review 1 (N)"
 * for those ticked at Applicants (the recruiter told once), or their step's decision for those ticked at one step the
 * caller decides; what was done and skipped said above the list.
 */
export function VacancySelection({ vacancyId, rows, children }: { vacancyId: string; rows: readonly { id: string; stage: ApplicationStage }[]; children: React.ReactNode }) {
  const ids = rows.map((r) => r.id);
  const { ticks, chosen, clear } = useTicks(ids);
  const [state, setState] = useState<BatchState>({});
  const [pending, startTransition] = useTransition();
  const n = chosen.length;
  const stage = sharedStage(chosen, Object.fromEntries(rows.map((r) => [r.id, r.stage])));

  function send() {
    setState({});
    startTransition(async () => {
      const r = await sendToReview(vacancyId, chosen);
      setState(r);
      if (r.result) clear();
    });
  }

  return (
    <TicksContext.Provider value={ticks}>
      <div className="space-y-3">
        <FormErrors errors={state.errors} />
        <Said state={state} />
        {children}
        {n > 0 && (
          <div role="region" aria-label="Applicants ticked" className="sticky bottom-4 z-20 space-y-3 rounded-xl border border-line bg-card p-3 shadow-lg">
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-auto px-1 text-sm font-semibold tabular-nums" aria-live="polite">
                {n} selected{stage ? ` at ${APPLICATION_STAGE_LABELS[stage]}` : ''}
              </p>
              {stage === 'applied' && (
                <button type="button" onClick={send} disabled={pending} className="btn btn-primary">
                  {pending ? 'Sending…' : sendLabel(n)}
                </button>
              )}
              <button type="button" onClick={clear} disabled={pending} className="btn btn-secondary">
                Clear
              </button>
            </div>
            {!stage && <p className="px-1 text-sm text-muted">Tick applicants at one step to act on them together.</p>}
            {stage && isDecisionStep(stage) && (
              <BatchDecide
                key={stage}
                vacancyId={vacancyId}
                stage={stage}
                chosen={chosen}
                done={(r) => {
                  setState(r);
                  if (r.result) clear();
                }}
              />
            )}
          </div>
        )}
      </div>
    </TicksContext.Provider>
  );
}

/**
 * A review's applicants on My Hiring with the reviewer's ticks (`ids`: every one shown, all at `stage`): Pass or Reject
 * for those ticked together, with the reasons and the feedback; HR told once.
 */
export function ReviewSelection({ vacancyId, stage, ids, children }: { vacancyId: string; stage: DecisionStep; ids: readonly string[]; children: React.ReactNode }) {
  const { ticks, chosen, clear } = useTicks(ids);
  const [state, setState] = useState<BatchState>({});
  return (
    <TicksContext.Provider value={ticks}>
      <div className="space-y-3">
        {children}
        <div className="space-y-3 px-4 pb-4">
          <Said state={state} />
          <BatchDecide
            vacancyId={vacancyId}
            stage={stage}
            chosen={chosen}
            done={(r) => {
              setState(r);
              if (r.result) clear();
            }}
          />
        </div>
      </div>
    </TicksContext.Provider>
  );
}
