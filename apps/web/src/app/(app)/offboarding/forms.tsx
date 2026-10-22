'use client';

import { useActionState, useState } from 'react';
import {
  CLEARANCE_OWNER_LABELS,
  CLEARANCE_OWNERS,
  EXIT_RATING_LABELS,
  EXIT_RATING_SCALE,
  EXIT_RATINGS,
  EXIT_REASON_LABELS,
  EXIT_REASONS,
  EXIT_RECOMMEND_LABELS,
  EXIT_RECOMMENDS,
  type ClearanceDefaultView,
  type ClearanceItemStatus,
  type RehireEligibility,
} from '@trendlix/shared';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { Select } from '@/components/select';
import type { FormState } from '@/lib/types';
import { REHIRE_CHOICES } from './offboarding';

// Offboarding's forms (owner, 22 October 2026: the full module): clearing an item, a one-off item, completing a case (a
// Super Admin's reason when items are pending), rehire eligibility, the exit interview (HR's record, the leaver's own),
// declining it, opening a case by hand, and the default checklist. The API checks each again.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/** Done, Not applicable, or Back to pending, with an optional note. */
export function ItemActions({ action, status, note }: { action: Action; status: ClearanceItemStatus; note: string | null }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  return (
    <form action={formAction} className="space-y-2">
      <FormErrors errors={state.errors} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <label htmlFor={fid('note')} className="sr-only">
            Note
          </label>
          <input id={fid('note')} name="note" defaultValue={note ?? ''} maxLength={500} placeholder="Note (optional)" className="input min-h-9 py-1 text-sm" />
        </div>
        {status === 'pending' ? (
          <>
            <button type="submit" name="status" value="done" disabled={pending} className="btn btn-primary min-h-9 px-3 text-sm">
              Done
            </button>
            <button type="submit" name="status" value="not_applicable" disabled={pending} className="btn btn-secondary min-h-9 px-3 text-sm">
              Not applicable
            </button>
          </>
        ) : (
          <button type="submit" name="status" value="pending" disabled={pending} className="btn btn-secondary min-h-9 px-3 text-sm">
            Back to pending
          </button>
        )}
      </div>
    </form>
  );
}

/** A one-off item on this case. */
export function AddItemForm({ action }: { action: Action }) {
  const { state, form } = useKeptForm(action);
  const fid = useFieldIds();
  return (
    <form {...form} className="space-y-3">
      <FormErrors errors={state.errors} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <label htmlFor={fid('label')} className="label">
            Item
          </label>
          <input id={fid('label')} name="label" maxLength={120} defaultValue={valueOf(state, 'label')} placeholder="e.g. Studio key returned" className="input" />
        </div>
        <div>
          <label htmlFor={fid('owner')} className="label">
            Cleared by
          </label>
          <Select id={fid('owner')} name="owner" defaultValue={valueOf(state, 'owner', 'hr')} className="input min-w-44">
            {CLEARANCE_OWNERS.map((o) => (
              <option key={o} value={o}>
                {CLEARANCE_OWNER_LABELS[o]}
              </option>
            ))}
          </Select>
        </div>
        <SubmitButton pendingText="Adding…">Add item</SubmitButton>
      </div>
      {state.message && (
        <p role="status" className="text-sm text-ok">
          {state.message}
        </p>
      )}
    </form>
  );
}

/** Complete the case; with items pending, a Super Admin gives the reason. */
export function CompleteForm({ action, pending: itemsPending, override }: { action: Action; pending: number; override: boolean }) {
  const { state, form } = useKeptForm(action);
  const fid = useFieldIds();
  const needsReason = itemsPending > 0;
  return (
    <form
      {...form}
      onSubmit={(e) => {
        if (!window.confirm(needsReason ? 'Complete this case with items still pending?' : 'Complete this case? Its items can’t change after.')) {
          e.preventDefault();
          return;
        }
        form.onSubmit(e);
      }}
      className="space-y-3"
    >
      <FormErrors errors={state.errors} />
      {needsReason && override && (
        <div>
          <label htmlFor={fid('overrideReason')} className="label">
            Why complete it with items pending
          </label>
          <textarea id={fid('overrideReason')} name="overrideReason" maxLength={500} rows={2} defaultValue={valueOf(state, 'overrideReason')} className="input" />
        </div>
      )}
      <SubmitButton pendingText="Completing…" disabled={needsReason && !override}>
        {needsReason && override ? 'Complete anyway' : 'Complete the case'}
      </SubmitButton>
      {needsReason && !override && <p className="text-sm text-muted">Every item must be done or not applicable first.</p>}
    </form>
  );
}

/** Rehire eligibility, with the reason (required unless simply eligible). */
export function RehireForm({ action, eligibility, reason }: { action: Action; eligibility: RehireEligibility | null; reason: string | null }) {
  const { state, form } = useKeptForm(action);
  const fid = useFieldIds();
  const [chosen, setChosen] = useState(valueOf(state, 'eligibility', eligibility ?? ''));
  return (
    <form {...form} className="space-y-3">
      <FormErrors errors={state.errors} />
      <fieldset>
        <legend className="label">Could they be hired again?</legend>
        <div className="flex flex-wrap gap-4">
          {REHIRE_CHOICES.map((c) => (
            <label key={c.value} className="inline-flex min-h-9 items-center gap-2 text-sm">
              <input type="radio" name="eligibility" value={c.value} checked={chosen === c.value} onChange={() => setChosen(c.value)} />
              {c.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor={fid('reason')} className="label">
          Reason {chosen === 'eligible' && <span className="font-normal text-muted">(optional)</span>}
        </label>
        <textarea id={fid('reason')} name="reason" maxLength={500} rows={2} defaultValue={valueOf(state, 'reason', reason)} className="input" />
      </div>
      <SubmitButton>Save</SubmitButton>
      {state.message && (
        <p role="status" className="text-sm text-ok">
          {state.message}
        </p>
      )}
    </form>
  );
}

/** The exit interview's questions: the reason for leaving, the five ratings, the recommendation and comments. */
export function ExitInterviewForm({ action, submitLabel, intro }: { action: Action; submitLabel: string; intro?: string }) {
  const { state, form } = useKeptForm(action);
  const fid = useFieldIds();
  return (
    <form {...form} className="space-y-5">
      {intro && <p className="max-w-3xl text-sm text-muted">{intro}</p>}
      <FormErrors errors={state.errors} />
      <div className="max-w-md">
        <label htmlFor={fid('reason')} className="label">
          Main reason for leaving
        </label>
        <Select id={fid('reason')} name="reason" defaultValue={valueOf(state, 'reason')} className="input">
          <option value="">Choose…</option>
          {EXIT_REASONS.map((r) => (
            <option key={r} value={r}>
              {EXIT_REASON_LABELS[r]}
            </option>
          ))}
        </Select>
      </div>
      <fieldset className="space-y-3">
        <legend className="label">How would you rate…</legend>
        {EXIT_RATINGS.map((k) => (
          <div key={k} className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="w-48 text-sm font-medium">{EXIT_RATING_LABELS[k]}</span>
            <div className="flex flex-wrap gap-3" role="radiogroup" aria-label={EXIT_RATING_LABELS[k]}>
              {([1, 2, 3, 4, 5] as const).map((n) => (
                <label key={n} className="inline-flex min-h-9 items-center gap-1.5 text-sm" title={EXIT_RATING_SCALE[n]}>
                  <input type="radio" name={`rating-${k}`} value={n} defaultChecked={valueOf(state, `rating-${k}`) === String(n)} />
                  {n}
                  <span className="sr-only">: {EXIT_RATING_SCALE[n]}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
        <p className="text-xs text-muted">1 is very poor, 5 very good.</p>
      </fieldset>
      <fieldset>
        <legend className="label">Would you recommend working here?</legend>
        <div className="flex flex-wrap gap-4">
          {EXIT_RECOMMENDS.map((r) => (
            <label key={r} className="inline-flex min-h-9 items-center gap-2 text-sm">
              <input type="radio" name="recommend" value={r} defaultChecked={valueOf(state, 'recommend') === r} />
              {EXIT_RECOMMEND_LABELS[r]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="max-w-3xl">
        <label htmlFor={fid('comments')} className="label">
          Anything else <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea id={fid('comments')} name="comments" maxLength={2000} rows={4} defaultValue={valueOf(state, 'comments')} className="input" />
      </div>
      <SubmitButton pendingText="Sending…">{submitLabel}</SubmitButton>
      {state.message && (
        <p role="status" className="text-sm text-ok">
          {state.message}
        </p>
      )}
    </form>
  );
}

/** Declining the exit interview, with an optional note. */
export function DeclineForm({ action, label }: { action: Action; label: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  return (
    <form action={formAction} className="space-y-2">
      <FormErrors errors={state.errors} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <label htmlFor={fid('note')} className="label">
            Note <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id={fid('note')} name="note" maxLength={500} className="input" />
        </div>
        <button type="submit" disabled={pending} className="btn btn-secondary">
          {pending ? 'Saving…' : label}
        </button>
      </div>
    </form>
  );
}

/** Opening a case by hand. */
export function OpenCaseButton({ action, label = 'Open an offboarding case' }: { action: Action; label?: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-2">
      <FormErrors errors={state.errors} />
      <button type="submit" disabled={pending} className="btn btn-secondary">
        {pending ? 'Opening…' : label}
      </button>
    </form>
  );
}

/** The default checklist: rows to rename, give another owner, move, remove and add, saved together. */
export function ChecklistEditor({ action, items }: { action: Action; items: readonly ClearanceDefaultView[] }) {
  const { state, form } = useKeptForm(action);
  const fid = useFieldIds();
  const [rows, setRows] = useState(() => items.map((i, n) => ({ key: `row-${n}`, id: i.id, label: i.label, owner: i.owner as string })));
  const [counter, setCounter] = useState(items.length);
  const move = (index: number, by: number) =>
    setRows((r) => {
      const next = [...r];
      const [row] = next.splice(index, 1);
      next.splice(index + by, 0, row!);
      return next;
    });
  return (
    <form {...form} className="space-y-4">
      <FormErrors errors={state.errors} />
      <ol className="space-y-2">
        {rows.map((r, i) => (
          <li key={r.key} className="flex flex-wrap items-end gap-2 rounded-lg border border-line p-3">
            {r.id && <input type="hidden" name={`id-${i}`} value={r.id} />}
            <div className="min-w-56 flex-1">
              <label htmlFor={fid(`label-${r.key}`)} className="label">
                Item {i + 1}
              </label>
              <input
                id={fid(`label-${r.key}`)}
                name={`label-${i}`}
                value={r.label}
                maxLength={120}
                onChange={(e) => {
                  const label = e.target.value;
                  setRows((all) => all.map((x) => (x.key === r.key ? { ...x, label } : x)));
                }}
                className="input"
              />
            </div>
            <div>
              <label htmlFor={fid(`owner-${r.key}`)} className="label">
                Cleared by
              </label>
              <Select
                id={fid(`owner-${r.key}`)}
                name={`owner-${i}`}
                value={r.owner}
                onChange={(e) => {
                  const owner = e.target.value;
                  setRows((all) => all.map((x) => (x.key === r.key ? { ...x, owner } : x)));
                }}
                className="input min-w-44"
              >
                {CLEARANCE_OWNERS.map((o) => (
                  <option key={o} value={o}>
                    {CLEARANCE_OWNER_LABELS[o]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex gap-1">
              <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="btn btn-secondary min-h-9 px-2.5 text-sm">
                Move up<span className="sr-only"> item {i + 1}</span>
              </button>
              <button type="button" disabled={i === rows.length - 1} onClick={() => move(i, 1)} className="btn btn-secondary min-h-9 px-2.5 text-sm">
                Move down<span className="sr-only"> item {i + 1}</span>
              </button>
              <button type="button" disabled={rows.length <= 1} onClick={() => setRows((all) => all.filter((x) => x.key !== r.key))} className="btn btn-danger min-h-9 px-2.5 text-sm">
                Remove<span className="sr-only"> item {i + 1}</span>
              </button>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={rows.length >= 20}
          onClick={() => {
            setRows((all) => [...all, { key: `row-new-${counter}`, id: '', label: '', owner: 'hr' }]);
            setCounter((c) => c + 1);
          }}
          className="btn btn-secondary"
        >
          Add an item
        </button>
        <SubmitButton>Save the checklist</SubmitButton>
      </div>
    </form>
  );
}
