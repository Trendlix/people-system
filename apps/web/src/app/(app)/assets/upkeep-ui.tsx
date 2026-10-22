'use client';

import {
  ACCESSORY_LIMITS,
  DISPOSAL_METHOD_LABELS,
  DISPOSAL_METHODS,
  DISPOSAL_TEXT_LIMITS,
  MAINTENANCE_KIND_LABELS,
  MAINTENANCE_KINDS,
  MAINTENANCE_TEXT_LIMITS,
  STOCK_NOTE_MAX,
  type AccessoryView,
  type AssetGroup,
  type StockMoveKind,
} from '@trendlix/shared';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, valueOf } from '@/components/form';
import { Select } from '@/components/select';
import type { FormState } from '@/lib/types';
import { accessoryField, ACCESSORY_ROWS_MAX } from './upkeep';
import { addMaintenance, addToKit, attachAsset, attachItemTo, disposeAsset, moveStock, removeFromKit, saveAccessories, saveDisposalAmount } from './upkeep-actions';

// Assets step 4's forms on an asset's page and the Kits page (the owner's build order, 21 October 2026: "kits / stock /
// repairs / disposal"; owner, 22 October 2026: "like laptop charger under the charger, DJI ronin accessories"; "Both
// kinds"): the accessories' checklist edited in place, attaching an asset to a main one (or one to this), Use and
// Restock, a maintenance entry by hand, disposal with its confirmation, the amount a disposal received, and a kit's
// assets added by their codes or taken out. Each checks what it can before sending; the API checks everything again.

const optional = <span className="font-normal text-muted">(optional)</span>;

/** A submit button in a style of its own (SubmitButton is always the primary one). */
function Send({ children, className }: { children: React.ReactNode; className: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? 'Saving…' : children}
    </button>
  );
}

function Done({ state }: { state: FormState }) {
  if (!state.message) return null;
  return (
    <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
      {state.message}
    </p>
  );
}

// ---------- the accessories' checklist ----------

/** The checklist, edited as a whole: a line each (name, how many, serial, notes), lines added up to 30. */
export function AccessoriesEditor({ code, group, accessories, onClose }: { code: string; group: AssetGroup; accessories: AccessoryView[]; onClose: () => void }) {
  const [state, formAction] = useActionState(saveAccessories.bind(null, code, group), {});
  const fid = useFieldIds();
  const [rows, setRows] = useState(Math.min(ACCESSORY_ROWS_MAX, Math.max(1, accessories.length + 1)));
  if (state.message) {
    return (
      <div className="space-y-2">
        <Done state={state} />
        <button type="button" onClick={onClose} className="btn btn-secondary">
          Close
        </button>
      </div>
    );
  }
  return (
    <form action={formAction} aria-label="Accessories" className="space-y-3 rounded-lg border border-line bg-canvas p-4">
      <FormErrors errors={state.errors} />
      <input type="hidden" name="rows" value={rows} />
      <ol className="space-y-3">
        {Array.from({ length: rows }, (_, i) => {
          const saved = accessories[i];
          const v = (part: 'name' | 'quantity' | 'serial' | 'notes', fallback: string) => valueOf(state, accessoryField(i, part), fallback);
          return (
            <li key={i} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_5rem_9rem_minmax(0,1fr)]">
              <div>
                <label htmlFor={fid(accessoryField(i, 'name'))} className="label">
                  Accessory {i + 1}
                </label>
                <input id={fid(accessoryField(i, 'name'))} name={accessoryField(i, 'name')} maxLength={ACCESSORY_LIMITS.name} defaultValue={v('name', saved?.name ?? '')} placeholder="E.g. Charger" className="input" />
              </div>
              <div>
                <label htmlFor={fid(accessoryField(i, 'quantity'))} className="label">
                  How many
                </label>
                <input
                  id={fid(accessoryField(i, 'quantity'))}
                  name={accessoryField(i, 'quantity')}
                  inputMode="numeric"
                  autoComplete="off"
                  defaultValue={v('quantity', saved ? String(saved.quantity) : '1')}
                  className="input tabular-nums"
                />
              </div>
              <div>
                <label htmlFor={fid(accessoryField(i, 'serial'))} className="label">
                  Serial {optional}
                </label>
                <input id={fid(accessoryField(i, 'serial'))} name={accessoryField(i, 'serial')} maxLength={ACCESSORY_LIMITS.serial} defaultValue={v('serial', saved?.serial ?? '')} className="input font-mono" />
              </div>
              <div>
                <label htmlFor={fid(accessoryField(i, 'notes'))} className="label">
                  Notes {optional}
                </label>
                <input id={fid(accessoryField(i, 'notes'))} name={accessoryField(i, 'notes')} maxLength={ACCESSORY_LIMITS.notes} defaultValue={v('notes', saved?.notes ?? '')} className="input" />
              </div>
            </li>
          );
        })}
      </ol>
      <p className="hint">Leave a line empty to take it off. Each goes out with the asset on a handover and is ticked when it comes back.</p>
      <div className="flex flex-wrap gap-2">
        <SubmitButton>Save accessories</SubmitButton>
        {rows < ACCESSORY_ROWS_MAX && (
          <button type="button" onClick={() => setRows((n) => Math.min(ACCESSORY_ROWS_MAX, n + 1))} className="btn btn-secondary">
            Add a line
          </button>
        )}
        <button type="button" onClick={onClose} className="btn btn-secondary">
          Close
        </button>
      </div>
    </form>
  );
}

/** The checklist on the asset's page, with Edit for a custodian or a manager. */
export function AccessoriesSection({ code, group, accessories, canEdit }: { code: string; group: AssetGroup; accessories: AccessoryView[]; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="space-y-3">
      {accessories.length ? (
        <ul className="divide-y divide-line-soft">
          {accessories.map((a) => (
            <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 first:pt-0 last:pb-0">
              <span>
                <span className="font-semibold">{a.name}</span>
                {a.serial && <span className="ml-2 font-mono text-xs text-muted">{a.serial}</span>}
                {a.notes && <span className="block text-xs text-muted">{a.notes}</span>}
              </span>
              <span className="text-sm text-muted tabular-nums">× {a.quantity}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No accessories listed. A charger, cables or a case that come with it go here.</p>
      )}
      {canEdit &&
        (editing ? (
          <AccessoriesEditor code={code} group={group} accessories={accessories} onClose={() => setEditing(false)} />
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="btn btn-secondary">
            {accessories.length ? 'Edit accessories' : 'Add accessories'}
          </button>
        ))}
    </div>
  );
}

// ---------- attaching ----------

/** Attach this asset to a main one, by the main one's code. */
export function AttachToForm({ code }: { code: string }) {
  const [state, formAction] = useActionState(attachAsset.bind(null, code, false), {});
  const fid = useFieldIds();
  return (
    <form action={formAction} aria-label="Attach to a main asset" className="space-y-2">
      <FormErrors errors={state.errors} />
      <Done state={state} />
      <label htmlFor={fid('parentCode')} className="label">
        Attach to a main asset
      </label>
      <div className="flex flex-wrap gap-2">
        <input id={fid('parentCode')} name="parentCode" required maxLength={40} defaultValue={valueOf(state, 'parentCode', '')} placeholder="E.g. PK-GMB-0001" className="input max-w-56 font-mono uppercase" />
        <SubmitButton>Attach</SubmitButton>
      </div>
      <p className="hint">It then goes out with the main asset on a handover, and can still be handed over alone.</p>
    </form>
  );
}

/** Attach another asset to this main one, by its code. */
export function AttachItemForm({ code }: { code: string }) {
  const [state, formAction] = useActionState(attachItemTo.bind(null, code), {});
  const fid = useFieldIds();
  return (
    <form action={formAction} aria-label="Attach an asset to this one" className="space-y-2">
      <FormErrors errors={state.errors} />
      <Done state={state} />
      <label htmlFor={fid('itemCode')} className="label">
        Attach an asset to this one
      </label>
      <div className="flex flex-wrap gap-2">
        <input id={fid('itemCode')} name="itemCode" required maxLength={40} defaultValue={valueOf(state, 'itemCode', '')} placeholder="E.g. PK-BAT-0004" className="input max-w-56 font-mono uppercase" />
        <SubmitButton>Attach</SubmitButton>
      </div>
      <p className="hint">For a valuable accessory with its own code and label, e.g. a battery or a monitor.</p>
    </form>
  );
}

/** Detach this asset from its main one. */
export function DetachButton({ code, mainCode }: { code: string; mainCode: string }) {
  const [state, formAction] = useActionState(attachAsset.bind(null, code, true), {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(`Detach ${code} from ${mainCode}? It stays in the register on its own.`)) e.preventDefault();
      }}
      className="space-y-2"
    >
      <FormErrors errors={state.errors} />
      <Done state={state} />
      {!state.message && <Send className="btn btn-secondary">Detach</Send>}
    </form>
  );
}

// ---------- stock ----------

function StockForm({ code, kind, quantity, unit, onClose }: { code: string; kind: StockMoveKind; quantity: number; unit: string | null; onClose: () => void }) {
  const [state, formAction] = useActionState(moveStock.bind(null, code, kind, quantity, unit), {});
  const fid = useFieldIds();
  const label = kind === 'use' ? 'Use' : 'Restock';
  if (state.message) {
    return (
      <div className="space-y-2">
        <Done state={state} />
        <button type="button" onClick={onClose} className="btn btn-secondary">
          Close
        </button>
      </div>
    );
  }
  return (
    <form action={formAction} aria-label={label} className="space-y-3 rounded-lg border border-line bg-canvas p-4">
      <FormErrors errors={state.errors} />
      <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
        <div>
          <label htmlFor={fid('amount')} className="label">
            How many{unit ? ` (${unit})` : ''}
          </label>
          <input id={fid('amount')} name="amount" required inputMode="decimal" autoComplete="off" defaultValue={valueOf(state, 'amount', '')} className="input tabular-nums" />
        </div>
        <div>
          <label htmlFor={fid('note')} className="label">
            Note {optional}
          </label>
          <input id={fid('note')} name="note" maxLength={STOCK_NOTE_MAX} defaultValue={valueOf(state, 'note', '')} placeholder={kind === 'use' ? 'E.g. the client’s shoot' : 'E.g. invoice 1234'} className="input" />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <SubmitButton>{label}</SubmitButton>
        <button type="button" onClick={onClose} className="btn btn-secondary">
          Close
        </button>
      </div>
    </form>
  );
}

/** Use and Restock, each opening its small form in place. */
export function StockActions({ code, quantity, unit }: { code: string; quantity: number; unit: string | null }) {
  const [open, setOpen] = useState<StockMoveKind | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(['use', 'restock'] as const).map((k) => (
          <button key={k} type="button" aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)} className={`btn ${open === k ? 'btn-primary' : 'btn-secondary'}`}>
            {k === 'use' ? 'Use' : 'Restock'}
            <span className="sr-only"> {code}</span>
          </button>
        ))}
      </div>
      {open && <StockForm key={open} code={code} kind={open} quantity={quantity} unit={unit} onClose={() => setOpen(null)} />}
    </div>
  );
}

// ---------- the maintenance log by hand ----------

/** "Add a maintenance entry": what it was, when, the vendor, notes and (for those who see the values) its cost. */
export function MaintenanceEntry({ code, values }: { code: string; values: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(addMaintenance.bind(null, code, values), {});
  const fid = useFieldIds();
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-secondary">
        Add a maintenance entry
      </button>
    );
  }
  if (state.message) {
    return (
      <div className="space-y-2">
        <Done state={state} />
        <button type="button" onClick={() => setOpen(false)} className="btn btn-secondary">
          Close
        </button>
      </div>
    );
  }
  return (
    <form action={formAction} aria-label="Add a maintenance entry" className="space-y-3 rounded-lg border border-line bg-canvas p-4">
      <FormErrors errors={state.errors} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('kind')} className="label">
            What it was
          </label>
          <Select id={fid('kind')} name="kind" required defaultValue={valueOf(state, 'kind', 'service')} className="input">
            {MAINTENANCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {MAINTENANCE_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor={fid('on')} className="label">
            Date <span className="font-normal text-muted">(today unless set)</span>
          </label>
          <DateInput id={fid('on')} name="on" defaultValue={valueOf(state, 'on', '')} />
        </div>
        <div>
          <label htmlFor={fid('vendor')} className="label">
            Vendor {optional}
          </label>
          <input id={fid('vendor')} name="vendor" maxLength={MAINTENANCE_TEXT_LIMITS.vendor} defaultValue={valueOf(state, 'vendor', '')} className="input" />
        </div>
        {values && (
          <div>
            <label htmlFor={fid('cost')} className="label">
              Cost (EGP) {optional}
            </label>
            <input id={fid('cost')} name="cost" inputMode="decimal" autoComplete="off" defaultValue={valueOf(state, 'cost', '')} className="input tabular-nums" />
          </div>
        )}
      </div>
      <div>
        <label htmlFor={fid('notes')} className="label">
          What was done {optional}
        </label>
        <textarea id={fid('notes')} name="notes" rows={2} maxLength={MAINTENANCE_TEXT_LIMITS.notes} defaultValue={valueOf(state, 'notes', '')} className="input" />
      </div>
      <div className="flex flex-wrap gap-2">
        <SubmitButton>Add entry</SubmitButton>
        <button type="button" onClick={() => setOpen(false)} className="btn btn-secondary">
          Close
        </button>
      </div>
    </form>
  );
}

// ---------- disposal ----------

/** Dispose of it (an Assets manager): how, when, who approved it, notes, and the amount for those who see the values. */
export function DisposeForm({ code, name, values, purchaseDate, inKit, attached }: { code: string; name: string; values: boolean; purchaseDate: string | null; inKit: string | null; attached: number }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(disposeAsset.bind(null, code, values, purchaseDate), {});
  const fid = useFieldIds();
  if (state.message) return <Done state={state} />;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-danger">
        Dispose of it
      </button>
    );
  }
  const also = [inKit ? `it leaves ${inKit}` : null, attached ? `${attached} attached ${attached === 1 ? 'asset is' : 'assets are'} detached` : null].filter(Boolean);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(`Dispose of ${code} ${name}? It stays on record but leaves every total and list. This can't be undone.`)) e.preventDefault();
      }}
      aria-label="Dispose of it"
      className="space-y-3 rounded-lg border border-danger/40 bg-canvas p-4"
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
            Date <span className="font-normal text-muted">(today unless set)</span>
          </label>
          <DateInput id={fid('on')} name="on" defaultValue={valueOf(state, 'on', '')} />
        </div>
        <div>
          <label htmlFor={fid('approvedBy')} className="label">
            Approved by
          </label>
          <input id={fid('approvedBy')} name="approvedBy" required maxLength={DISPOSAL_TEXT_LIMITS.approvedBy} defaultValue={valueOf(state, 'approvedBy', '')} className="input" />
        </div>
        {values && (
          <div>
            <label htmlFor={fid('amount')} className="label">
              Amount received (EGP) {optional}
            </label>
            <input id={fid('amount')} name="amount" inputMode="decimal" autoComplete="off" defaultValue={valueOf(state, 'amount', '')} className="input tabular-nums" />
          </div>
        )}
      </div>
      <div>
        <label htmlFor={fid('notes')} className="label">
          Notes {optional}
        </label>
        <textarea id={fid('notes')} name="notes" rows={2} maxLength={DISPOSAL_TEXT_LIMITS.notes} defaultValue={valueOf(state, 'notes', '')} className="input" />
      </div>
      <p className="hint">
        Its book value on that day is kept.{also.length ? ` Also, ${also.join(' and ')}.` : ''}
        {!values ? ' Finance or the CEO can add the amount received later.' : ''}
      </p>
      <div className="flex flex-wrap gap-2">
        <Send className="btn btn-danger">Dispose of it</Send>
        <button type="button" onClick={() => setOpen(false)} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The amount a disposal received, set or changed later (the CEO, Finance or a Super Admin). */
export function DisposalAmountForm({ code, amount }: { code: string; amount: number | null }) {
  const [state, formAction] = useActionState(saveDisposalAmount.bind(null, code), {});
  const fid = useFieldIds();
  return (
    <form action={formAction} aria-label="Amount received" className="space-y-2">
      <FormErrors errors={state.errors} />
      <Done state={state} />
      <label htmlFor={fid('amount')} className="label">
        Amount received (EGP)
      </label>
      <div className="flex flex-wrap gap-2">
        <input id={fid('amount')} name="amount" inputMode="decimal" autoComplete="off" defaultValue={valueOf(state, 'amount', amount === null ? '' : String(amount))} className="input max-w-40 tabular-nums" />
        <Send className="btn btn-secondary">Save amount</Send>
      </div>
    </form>
  );
}

// ---------- kits ----------

/** Assets put in the kit by their codes, one a line or separated by commas. */
export function KitAddForm({ kitId, kitCode }: { kitId: string; kitCode: string }) {
  const [state, formAction] = useActionState(addToKit.bind(null, kitId), {});
  const fid = useFieldIds();
  return (
    <form action={formAction} aria-label={`Add assets to ${kitCode}`} className="space-y-2">
      <FormErrors errors={state.errors} />
      <Done state={state} />
      <label htmlFor={fid('codes')} className="label">
        Add assets by code
      </label>
      <textarea id={fid('codes')} name="codes" rows={2} defaultValue={valueOf(state, 'codes', '')} placeholder="E.g. PK-CAM-0003, PK-LEN-0007" className="input font-mono uppercase" />
      <p className="hint">Production kit assets only. One in another kit moves to this one.</p>
      <Send className="btn btn-secondary">Add to kit</Send>
    </form>
  );
}

/** An asset taken out of the kit. */
export function KitRemoveButton({ kitId, assetId, code }: { kitId: string; assetId: string; code: string }) {
  const [state, formAction] = useActionState(async () => removeFromKit(kitId, assetId), {});
  return (
    <form action={formAction} className="inline">
      {state.errors?.length ? <span className="text-xs text-danger">{state.errors.join(' ')}</span> : null}
      <Send className="inline-flex min-h-9 items-center rounded-md px-2 text-xs font-semibold text-accent hover:bg-accent-soft">
        Take out<span className="sr-only"> {code}</span>
      </Send>
    </form>
  );
}
