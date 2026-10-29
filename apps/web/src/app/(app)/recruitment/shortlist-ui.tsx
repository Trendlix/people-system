'use client';

import { SUGGESTION_NOTE_MAX } from '@trendlix/shared';
import { createContext, useActionState, useCallback, useContext, useState, useTransition } from 'react';
import { FormErrors, useFieldIds } from '@/components/form';
import { reviewShortlist, shortlistApplicants, type BatchState } from './shortlist-actions';
import { allTicks, reviewLabel, shortlistLabel, ticked, tickedAll, tickedIds } from './shortlist';

// Ticking applicants to act on together (owner, 29 October 2026: "HR Filteration and shortlisting - Manager view the
// shortlisted and accept or reject them"; asked, "Tick several at once"), as All Assets ticks assets: the tables put a
// tick box on each row that may be ticked and a "Select all" on their titles (BatchTick, BatchTickAll), inside
// ShortlistSelection (a vacancy's list, for HR: "Shortlist (N)" in a bar kept at the bottom of the screen while some are
// ticked) or ReviewSelection (My Hiring, for the hiring manager: a note, "Accept (N)" and "Reject (N)"). The ticks live
// here, so the rows' own forms (Delete applicant) are never nested in another; what a batch did is said above the list
// (or by its buttons) once the page is read again.

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
 * A vacancy's list with HR's ticks (those at Applied, never one filtered out: `ids`): "Shortlist (N)" shortlists those
 * ticked together, the hiring manager told once; what was done and skipped said above the list.
 */
export function ShortlistSelection({ vacancyId, ids, children }: { vacancyId: string; ids: readonly string[]; children: React.ReactNode }) {
  const { ticks, chosen, clear } = useTicks(ids);
  const [state, setState] = useState<BatchState>({});
  const [pending, startTransition] = useTransition();
  const n = chosen.length;

  function send() {
    setState({});
    startTransition(async () => {
      const r = await shortlistApplicants(vacancyId, chosen);
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
          <div role="region" aria-label="Applicants ticked" className="sticky bottom-4 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-card p-3 shadow-lg">
            <p className="mr-auto px-1 text-sm font-semibold tabular-nums" aria-live="polite">
              {n} selected
            </p>
            <button type="button" onClick={send} disabled={pending} className="btn btn-primary">
              {pending ? 'Shortlisting…' : shortlistLabel(n)}
            </button>
            <button type="button" onClick={clear} disabled={pending} className="btn btn-secondary">
              Clear
            </button>
          </div>
        )}
      </div>
    </TicksContext.Provider>
  );
}

/**
 * A vacancy's shortlist on My Hiring with the hiring manager's ticks (`ids`: every one shown): a note, then "Accept (N)"
 * or "Reject (N)" for those ticked together; HR told once. A rejection is HR's to confirm.
 */
export function ReviewSelection({ vacancyId, ids, children }: { vacancyId: string; ids: readonly string[]; children: React.ReactNode }) {
  const { ticks, chosen, clear } = useTicks(ids);
  const [note, setNote] = useState('');
  const fid = useFieldIds();
  const [state, formAction, pending] = useActionState(async (prev: BatchState, fd: FormData) => {
    const next = await reviewShortlist(vacancyId, prev, fd);
    if (next.result) {
      clear();
      setNote('');
    }
    return next;
  }, {});
  const n = chosen.length;
  return (
    <TicksContext.Provider value={ticks}>
      <div className="space-y-3">
        {children}
        <form action={formAction} className="space-y-3 px-4 pb-4">
          <FormErrors errors={state.errors} />
          {chosen.map((id) => (
            <input key={id} type="hidden" name="applicationIds" value={id} />
          ))}
          <div>
            <label htmlFor={fid('note')} className="label">
              Note for HR <span className="font-normal text-muted">(optional)</span>
            </label>
            <textarea id={fid('note')} name="note" rows={2} maxLength={SUGGESTION_NOTE_MAX} value={note} onChange={(e) => setNote(e.currentTarget.value)} className="input" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" name="decision" value="next" disabled={pending || n === 0} className="btn btn-primary">
              {reviewLabel('next', n)}
            </button>
            <button type="submit" name="decision" value="reject" disabled={pending || n === 0} className="btn btn-secondary">
              {reviewLabel('reject', n)}
            </button>
            {n === 0 && !state.message && <span className="text-sm text-muted">Tick the applicants first.</span>}
            <Said state={state} />
          </div>
        </form>
      </div>
    </TicksContext.Provider>
  );
}
