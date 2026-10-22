'use client';

import { ASSET_COUNT_LIMITS, ASSET_STATUS_LABELS, type AssetCountSheetView } from '@trendlix/shared';
import { useActionState, useId, useState } from 'react';
import { FormErrors } from '@/components/form';
import type { FormState } from '@/lib/types';
import { statusTone } from './assets';
import { foundCodes, saveCountQuestion, tickFromText, tickText, untickedCount } from './counts';
import { QrScanner } from './qr-scanner';

// A count's sheet (Assets step 5; owner, 22 October 2026: "stock counts"; spec §5 Counts: "count by group, room or kit"):
// everything the group, room or kit has, ticked as it is seen, by tapping it, typing its code, or scanning its label with
// the camera (where the browser can); those in custody shown out, with who holds them, never ticked (they count as out).
// Tick all and Untick all for a long list. Save asks first when some aren't ticked: they will be counted missing. The
// API checks everything again when the count is saved.

export function CountSheet({ sheet, action, phone = false }: { sheet: AssetCountSheetView; action: (prev: FormState, fd: FormData) => Promise<FormState>; phone?: boolean }) {
  const [ticked, setTicked] = useState<Set<string>>(() => new Set());
  const [typed, setTyped] = useState('');
  const [said, setSaid] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(action, {});
  const ids = useId();
  const items = sheet.items;
  const found = foundCodes(items, ticked);
  const unticked = untickedCount(items, ticked);
  const out = items.filter((i) => i.status === 'custody').length;

  const tick = (text: string) => {
    const { ticked: next, outcome } = tickFromText(text, items, ticked);
    setTicked(next);
    setSaid(tickText(outcome, sheet.scope.label));
  };
  const toggle = (code: string) => {
    const next = new Set(ticked);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setTicked(next);
  };

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const question = saveCountQuestion(unticked);
        if (question && !window.confirm(question)) e.preventDefault();
      }}
      className="space-y-4"
    >
      <input type="hidden" name="found" value={JSON.stringify(found)} />
      <div className={phone ? 'space-y-3' : 'card space-y-3 p-5'}>
        <p className="text-sm font-semibold tabular-nums" aria-live="polite">
          {found.length} of {items.length - out} ticked{out ? ` · ${out} out in custody` : ''}
        </p>
        <QrScanner onCode={tick} />
        <div className="flex gap-2">
          <label htmlFor={`${ids}-code`} className="sr-only">
            Type a code
          </label>
          <input
            id={`${ids}-code`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              if (typed.trim()) tick(typed);
              setTyped('');
            }}
            maxLength={200}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="Type a code, e.g. PK-CAM-0003"
            className="input min-h-12 flex-1 font-mono"
          />
          <button
            type="button"
            onClick={() => {
              if (typed.trim()) tick(typed);
              setTyped('');
            }}
            className="btn btn-secondary min-h-12"
          >
            Tick
          </button>
        </div>
        {said && (
          <p role="status" className="text-sm text-muted">
            {said}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setTicked(new Set(items.filter((i) => i.status !== 'custody').map((i) => i.code)))} className="btn btn-secondary">
            Tick all
          </button>
          <button type="button" onClick={() => setTicked(new Set())} disabled={!found.length} className="btn btn-secondary">
            Untick all
          </button>
        </div>
      </div>

      <ul aria-label={`What ${sheet.scope.label} has`} className={`divide-y divide-line-soft ${phone ? 'rounded-lg border border-line bg-white' : 'card'}`}>
        {items.map((i) => {
          const isOut = i.status === 'custody';
          const id = `${ids}-${i.code}`;
          return (
            <li key={i.code}>
              <label htmlFor={id} className={`flex min-h-14 items-center gap-3 px-4 py-2.5 ${isOut ? 'cursor-default' : 'cursor-pointer hover:bg-canvas'}`}>
                <input id={id} type="checkbox" checked={isOut ? false : ticked.has(i.code)} disabled={isOut} onChange={() => toggle(i.code)} className="size-5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium break-words">{i.name}</span>
                  <span className="mt-0.5 block text-xs text-muted">
                    <span className="font-mono">{i.code}</span>
                    {i.serial ? ` · ${i.serial}` : ''}
                    {isOut ? ` · out with ${i.holder ? i.holder.fullNameEn : 'someone'}: counts as out` : ''}
                  </span>
                </span>
                <span className={`badge shrink-0 ${statusTone(i.status)}`}>{ASSET_STATUS_LABELS[i.status]}</span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="space-y-1">
        <label htmlFor={`${ids}-notes`} className="label">
          Notes <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea id={`${ids}-notes`} name="notes" rows={2} maxLength={ASSET_COUNT_LIMITS.notes} className="input" placeholder="E.g. the tripods were counted in the van" />
      </div>
      <FormErrors errors={state.errors} />
      <button type="submit" disabled={pending} className="btn btn-primary min-h-12">
        {pending ? 'Saving…' : 'Save count'}
      </button>
    </form>
  );
}

/** "Mark lost" on a missing asset of a count (spec §6.5: a deliberate step of its own), asked first. */
export function MarkLostButton({ code, name, action }: { code: string; name: string; action: (prev: FormState, fd: FormData) => Promise<FormState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(`Mark ${code} · ${name} lost? It leaves the available assets until it is found.`)) e.preventDefault();
      }}
      className="flex flex-col items-end gap-1"
    >
      <button type="submit" disabled={pending} className="inline-flex min-h-9 items-center rounded-md px-2.5 text-sm font-semibold text-danger hover:bg-danger-soft disabled:opacity-50">
        {pending ? 'Marking…' : 'Mark lost'}
        <span className="sr-only"> {code}</span>
      </button>
      {state.errors?.length ? (
        <span role="alert" className="text-xs text-danger">
          {state.errors.join(' ')}
        </span>
      ) : null}
    </form>
  );
}
