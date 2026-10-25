'use client';

import { DISPOSAL_METHOD_LABELS, DISPOSAL_METHODS, DISPOSAL_TEXT_LIMITS, type BulkDeleteResult, type BulkDisposeResult, type BulkSkipped } from '@trendlix/shared';
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { Select } from '@/components/select';
import { formatDate } from '@/lib/format';
import { deleteSelectedAssets, disposeSelectedAssets, type BulkState } from './bulk-actions';
import {
  assetsText,
  bracketed,
  bulkDoneText,
  deleteConfirmText,
  deleteForecast,
  disposableSkipped,
  disposeConfirmText,
  disposeForecast,
  disposeTheseText,
  needsTypedDelete,
  pageTicks,
  skippedText,
  ticked,
  tickedPage,
  tickedRows,
  typedDelete,
  TYPE_TO_DELETE,
  type BulkForecast,
  type BulkRow,
} from './bulk';

// Ticking assets on All Assets (owner, 25 October 2026: "can i delete multiple assets at one?"; "Never-in-custody
// only"): a tick box a row and "Select all on this page" (AssetTable puts them in, inside BulkSelection); while some are
// ticked, a bar kept at the bottom of the screen with how many, Delete selected (a Super Admin), Dispose selected (an
// Assets manager) and Clear. Each opens its confirm in a pop-up window saying how many will be done and which will be
// skipped and why (Delete asks for DELETE typed for more than 10); then a result panel above the list says what was done
// and skipped, with "Dispose these N" after a delete for those it skipped. The list is read again after each, its
// filters and page kept; the ticks are this page's.

interface Ticks {
  selected: ReadonlySet<string>;
  codes: readonly string[];
  tick: (code: string, on: boolean) => void;
  tickPage: (on: boolean) => void;
}

const TicksContext = createContext<Ticks | null>(null);

type Done = { kind: 'delete'; result: BulkDeleteResult; disposable: string[] } | { kind: 'dispose'; result: BulkDisposeResult };
type Open = { kind: 'delete' } | { kind: 'dispose'; codes: string[] } | null;

/** The page's register with its ticks, the bar, the confirms and the result. `rows`: the page's, in its order. */
export function BulkSelection({ rows, can, children }: { rows: BulkRow[]; can: { delete: boolean; dispose: boolean }; children: React.ReactNode }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [open, setOpen] = useState<Open>(null);
  const [done, setDone] = useState<Done | null>(null);
  const codes = rows.map((r) => r.code);
  const chosen = tickedRows(rows, selected);

  const ticks: Ticks = {
    selected,
    codes,
    tick: (code, on) => setSelected((s) => ticked(s, code, on)),
    tickPage: (on) => setSelected((s) => tickedPage(s, codes, on)),
  };

  function finished(next: Done) {
    setOpen(null);
    setSelected(new Set());
    setDone(next);
  }

  const disposeRows = open?.kind === 'dispose' ? rows.filter((r) => open.codes.includes(r.code)) : [];

  return (
    <TicksContext.Provider value={ticks}>
      <div className="space-y-4">
        {done && (
          <ResultPanel
            key={JSON.stringify(done.result)}
            done={done}
            onDispose={can.dispose ? (list) => setOpen({ kind: 'dispose', codes: list }) : null}
            onClose={() => setDone(null)}
          />
        )}
        {children}
        {chosen.length > 0 && (
          <div role="region" aria-label="Selected assets" className="sticky bottom-4 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-card p-3 shadow-lg">
            <p className="mr-auto px-1 text-sm font-semibold tabular-nums" aria-live="polite">
              {chosen.length} selected
            </p>
            {can.delete && (
              <button type="button" aria-haspopup="dialog" onClick={() => setOpen({ kind: 'delete' })} className="btn btn-danger">
                Delete selected
              </button>
            )}
            {can.dispose && (
              <button type="button" aria-haspopup="dialog" onClick={() => setOpen({ kind: 'dispose', codes: chosen.map((r) => r.code) })} className="btn btn-secondary">
                Dispose selected
              </button>
            )}
            <button type="button" onClick={() => setSelected(new Set())} className="btn btn-secondary">
              Clear
            </button>
          </div>
        )}
      </div>
      {open?.kind === 'delete' && (
        <DeleteWindow
          rows={chosen}
          onDispose={can.dispose ? (list) => setOpen({ kind: 'dispose', codes: list }) : null}
          onDone={(result) => finished({ kind: 'delete', result, disposable: disposableSkipped(result, rows) })}
          onClosed={() => setOpen((o) => (o?.kind === 'delete' ? null : o))}
        />
      )}
      {open?.kind === 'dispose' && (
        <DisposeWindow rows={disposeRows} onDone={(result) => finished({ kind: 'dispose', result })} onClosed={() => setOpen((o) => (o?.kind === 'dispose' ? null : o))} />
      )}
    </TicksContext.Provider>
  );
}

const tickBox = 'flex size-11 cursor-pointer items-center justify-center';
const box = 'size-4 cursor-pointer accent-accent';

/** A row's tick box (only inside BulkSelection). */
export function RowTick({ code, name }: { code: string; name: string }) {
  const ticks = useContext(TicksContext);
  if (!ticks) return null;
  return (
    <label className={tickBox}>
      <input type="checkbox" checked={ticks.selected.has(code)} onChange={(e) => ticks.tick(code, e.currentTarget.checked)} aria-label={`Select ${code} ${name}`} className={box} />
    </label>
  );
}

/** "Select all on this page": every row of it, or none; half ticked while only some are. */
export function TickAll() {
  const ticks = useContext(TicksContext);
  const state = ticks ? pageTicks(ticks.selected, ticks.codes) : 'none';
  const set = useCallback((el: HTMLInputElement | null) => {
    if (el) el.indeterminate = state === 'some';
  }, [state]);
  if (!ticks) return null;
  return (
    <label className={tickBox}>
      <input ref={set} type="checkbox" checked={state === 'all'} onChange={(e) => ticks.tickPage(e.currentTarget.checked)} aria-label="Select all on this page" className={box} />
    </label>
  );
}

// ---------- the pop-up window ----------

/** A modal window over the page (Esc or Close closes it; the focus stays in it). */
function Window({ title, children, onClosed, dialogRef }: { title: string; children: React.ReactNode; onClosed: () => void; dialogRef: React.RefObject<HTMLDialogElement | null> }) {
  const titleId = useId();
  const attach = useCallback(
    (el: HTMLDialogElement | null) => {
      dialogRef.current = el;
      if (el && !el.open) el.showModal();
    },
    [dialogRef],
  );
  return createPortal(
    <dialog
      ref={attach}
      aria-labelledby={titleId}
      onClose={onClosed}
      className="m-auto max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-lg overflow-hidden rounded-xl bg-card p-0 text-ink shadow-xl backdrop:bg-black/70 open:flex open:flex-col sm:max-h-[calc(100dvh-4rem)]"
    >
      <div className="flex items-start justify-between gap-4 border-b border-line py-2 pr-2 pl-5">
        <h2 id={titleId} className="min-w-0 self-center font-semibold break-words">
          {title}
        </h2>
        <button
          type="button"
          aria-label="Close"
          onClick={() => dialogRef.current?.close()}
          className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-canvas hover:text-ink"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-5">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      </div>
      <div className="min-h-0 flex-auto space-y-4 overflow-y-auto px-5 py-4">{children}</div>
    </dialog>,
    document.body,
  );
}

/** Those to be skipped, each with its reason. */
function SkippedList({ skipped, label }: { skipped: readonly BulkSkipped[]; label: string }) {
  if (!skipped.length) return null;
  return (
    <ul aria-label={label} className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-line-soft bg-canvas px-3 py-2 text-sm">
      {skipped.map((s) => (
        <li key={s.code} className="break-words">
          <span className="font-mono text-xs">{s.code}</span> <span className="text-muted">({bracketed(s.reason)})</span>
        </li>
      ))}
    </ul>
  );
}

/** Of those skipped by a confirm, the ones that can be disposed of (Dispose these N), from its forecast. */
const disposableOf = (f: BulkForecast, rows: readonly BulkRow[]) => disposeForecast(rows.filter((r) => f.skipped.some((s) => s.code === r.code))).will.map((r) => r.code);

/** Delete selected's confirm: how many will be deleted and skipped (and why), DELETE typed for more than 10. */
function DeleteWindow({ rows, onDispose, onDone, onClosed }: { rows: BulkRow[]; onDispose: ((codes: string[]) => void) | null; onDone: (r: BulkDeleteResult) => void; onClosed: () => void }) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const typedId = useId();
  const [forecast] = useState(() => deleteForecast(rows));
  const [typed, setTyped] = useState('');
  const [errors, setErrors] = useState<string[] | undefined>();
  const [pending, startTransition] = useTransition();
  const n = forecast.will.length;
  const typing = needsTypedDelete(n);
  const ready = n > 0 && (!typing || typedDelete(typed)) && !pending;
  const disposable = onDispose ? disposableOf(forecast, rows) : [];

  function send() {
    setErrors(undefined);
    startTransition(async () => {
      const r = await deleteSelectedAssets(rows.map((x) => x.code));
      if (r.result) onDone(r.result);
      else setErrors(r.errors ?? ['The assets could not be deleted. Please try again.']);
    });
  }

  return (
    <Window title="Delete Selected Assets" onClosed={onClosed} dialogRef={dialogRef}>
      <FormErrors errors={errors} />
      <p className="text-sm">{deleteConfirmText(forecast)}</p>
      <SkippedList skipped={forecast.skipped} label="Will be skipped" />
      {forecast.skipped.length > 0 && <p className="hint">Those that were in custody are disposed of instead: they stay on record, out of every total and list.</p>}
      {typing && (
        <div>
          <label htmlFor={typedId} className="label">
            Type {TYPE_TO_DELETE} to delete {assetsText(n)}
          </label>
          <input id={typedId} value={typed} onChange={(e) => setTyped(e.currentTarget.value)} autoComplete="off" spellCheck={false} className="input font-mono" />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {n > 0 && (
          <button type="button" disabled={!ready} onClick={send} className="btn btn-danger">
            {pending ? 'Deleting…' : `Delete ${assetsText(n)}`}
          </button>
        )}
        {n === 0 && onDispose && disposable.length > 0 && (
          <button type="button" onClick={() => onDispose(disposable)} className="btn btn-primary">
            {disposeTheseText(disposable.length)}
          </button>
        )}
        <button type="button" disabled={pending} onClick={() => dialogRef.current?.close()} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </Window>
  );
}

/** Dispose selected's form: how, the day (today unless set), who approved it, a note; then its confirm. */
function DisposeWindow({ rows, onDone, onClosed }: { rows: BulkRow[]; onDone: (r: BulkDisposeResult) => void; onClosed: () => void }) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const fid = useFieldIds();
  const [forecast] = useState(() => disposeForecast(rows));
  const [today] = useState(() => formatDate(new Date()));
  const { state, pending, form } = useKeptForm(disposeSelectedAssets.bind(null, rows.map((r) => r.code)));
  const result = (state as BulkState<BulkDisposeResult>).result;
  const n = forecast.will.length;
  const reported = useRef(false);

  useEffect(() => {
    if (!result || reported.current) return;
    reported.current = true;
    onDone(result);
  }, [result, onDone]);

  return (
    <Window title="Dispose of Selected Assets" onClosed={onClosed} dialogRef={dialogRef}>
      <p className="text-sm">{disposeConfirmText(forecast)}</p>
      <SkippedList skipped={forecast.skipped} label="Will be skipped" />
      {n > 0 && (
        <form
          {...form}
          onSubmit={(e) => {
            if (!window.confirm(`Dispose of ${assetsText(n)}? They stay on record but leave every total and list. This can't be undone.`)) {
              e.preventDefault();
              return;
            }
            form.onSubmit(e);
          }}
          aria-label="Dispose of the selected assets"
          className="space-y-3"
        >
          <FormErrors errors={state.errors} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={fid('method')} className="label">
                How
              </label>
              <Select id={fid('method')} name="method" required defaultValue={valueOf(state, 'method', '')} className="input">
                <option value="">Choose how</option>
                {DISPOSAL_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {DISPOSAL_METHOD_LABELS[m]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label htmlFor={fid('on')} className="label">
                Date
              </label>
              <DateInput id={fid('on')} name="on" defaultValue={valueOf(state, 'on', today)} />
            </div>
          </div>
          <div>
            <label htmlFor={fid('approvedBy')} className="label">
              Approved by
            </label>
            <input id={fid('approvedBy')} name="approvedBy" required maxLength={DISPOSAL_TEXT_LIMITS.approvedBy} defaultValue={valueOf(state, 'approvedBy', '')} className="input" />
          </div>
          <div>
            <label htmlFor={fid('notes')} className="label">
              Note <span className="font-normal text-muted">(optional)</span>
            </label>
            <textarea id={fid('notes')} name="notes" rows={2} maxLength={DISPOSAL_TEXT_LIMITS.notes} defaultValue={valueOf(state, 'notes', '')} className="input" />
          </div>
          <p className="hint">Each one&apos;s book value on that day is kept; each leaves its kit, and the assets attached to it are detached. Finance or the CEO can add the amount received later.</p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={pending} className="btn btn-danger">
              {pending ? 'Disposing…' : `Dispose of ${assetsText(n)}`}
            </button>
            <button type="button" disabled={pending} onClick={() => dialogRef.current?.close()} className="btn btn-secondary">
              Cancel
            </button>
          </div>
        </form>
      )}
      {n === 0 && (
        <button type="button" onClick={() => dialogRef.current?.close()} className="btn btn-secondary">
          Close
        </button>
      )}
    </Window>
  );
}

// ---------- the result ----------

/** What was done and what was skipped, above the list; after a delete, "Dispose these N" for those that can be. */
function ResultPanel({ done, onDispose, onClose }: { done: Done; onDispose: ((codes: string[]) => void) | null; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    panel.current?.focus({ preventScroll: true });
  }, []);
  const list = done.kind === 'delete' ? done.result.deleted : done.result.disposed;
  const skipped = done.result.skipped;
  const verb = done.kind === 'delete' ? 'Deleted' : 'Disposed of';
  const heading = done.kind === 'delete' ? 'Deleted' : 'Disposed';
  const disposable = done.kind === 'delete' && onDispose ? done.disposable : [];
  const tone = list.length ? 'border-ok/30 bg-ok-soft' : 'border-warn/30 bg-warn-soft';
  return (
    <div ref={panel} tabIndex={-1} role="status" className={`space-y-3 rounded-lg border px-4 py-3 text-sm outline-none ${tone}`}>
      <p className={list.length ? 'text-ok' : 'text-warn'}>
        {bulkDoneText(verb, list.length, skipped)}
        {done.kind === 'delete' && list.length > 0 ? ' Their codes are never given again.' : ''}
      </p>
      {(list.length > 0 || skipped.length > 5) && (
        <details>
          <summary className="cursor-pointer font-semibold">See each one</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {list.length > 0 && (
              <div>
                <h3 className="font-semibold">{heading}</h3>
                <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto">
                  {list.map((a) => (
                    <li key={a.code} className="break-words">
                      <span className="font-mono text-xs">{a.code}</span> {a.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {skipped.length > 0 && (
              <div>
                <h3 className="font-semibold">Skipped</h3>
                <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto">
                  {skipped.map((s) => (
                    <li key={s.code} className="break-words">
                      {skippedText(s)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </details>
      )}
      <div className="flex flex-wrap gap-2">
        {disposable.length > 0 && onDispose && (
          <button type="button" aria-haspopup="dialog" onClick={() => onDispose(disposable)} className="btn btn-primary">
            {disposeTheseText(disposable.length)}
          </button>
        )}
        <button type="button" onClick={onClose} className="btn btn-secondary">
          Close
        </button>
      </div>
    </div>
  );
}
