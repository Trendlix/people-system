'use client';

import {
  ASSET_CONDITION_LABELS,
  ASSET_CONDITIONS,
  CUSTODY_KIND_HINTS,
  CUSTODY_KIND_LABELS,
  CUSTODY_KINDS,
  CUSTODY_TEXT_LIMITS,
  type CustodyKind,
  type HandoverAssetChoice,
  type HandoverChoices,
  type KitSkip,
} from '@trendlix/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, useFieldIds } from '@/components/form';
import { Select } from '@/components/select';
import { APP_CUSTODY_PATHS, CUSTODY_PATHS } from '@/lib/asset-paths';
import { handOverAssets } from '../custody-actions';
import { assetOptionText, attachedText, handoverBody, kitAdd, kitAddText, skipText } from '../custody';

// New handover (Assets step 3; the spec's New handover: "Type (shoot / long-term), employee, return date (shoot only),
// purpose, kit quick-add, asset picker (available only), handed over by, notes"): a custodian or a manager chooses a
// current employee (C-level people only for those who see them, as the API lists them), a shoot with its return date or
// a long-term assignment, the purpose, who handed it over (the signed-in person unless changed: the name is written on
// the form), notes, and the assets: only available ones that aren't consumables (spec §6.1), each with the condition it
// goes out in and its accessories; "Add a kit" adds a kit's available assets and lists the others with why (§6.3). The
// shared checks run before it is sent; the API checks everything again, gives the record its code (CUS-0042) and the
// terms in force. Once saved, the record's page opens (the phone pages' on the phone pages): its form is printed, signed
// on paper and attached there. Step 4 (owner, 22 October 2026: accessories, "Both kinds"): each asset's checklist, all
// ticked to go (untick what stays behind), the assets attached to it that go with it (and those that stay, with why),
// and ?kit= from a kit's card, added to start with.

const optional = <span className="font-normal text-muted">(optional)</span>;

export function HandoverForm({
  choices,
  startEmployeeId,
  startAssetCode,
  startKitId = null,
  today,
  surface,
  cancelHref,
}: {
  choices: HandoverChoices;
  startEmployeeId: string | null;
  startAssetCode: string | null;
  /** Step 4: a kit's card's "Hand over this kit". */
  startKitId?: string | null;
  /** YYYY-MM-DD in Cairo. */
  today: string;
  surface: 'site' | 'app';
  cancelHref: string;
}) {
  const router = useRouter();
  const fid = useFieldIds();
  const startAsset = startAssetCode ? (choices.assets.find((a) => a.code === startAssetCode) ?? null) : null;
  const startKit = startKitId ? (choices.kits.find((k) => k.id === startKitId) ?? null) : null;
  const startKitAdd = startKit ? kitAdd(startKit, new Set(startAsset ? [startAsset.id] : []), choices.assets) : null;
  const [kind, setKind] = useState<CustodyKind>(startAsset?.group === 'it' ? 'assignment' : 'shoot');
  const [items, setItems] = useState<HandoverAssetChoice[]>([...(startAsset ? [startAsset] : []), ...(startKitAdd?.added ?? [])]);
  const [kitId, setKitId] = useState('');
  const [kitNote, setKitNote] = useState<{ text: string; skipped: KitSkip[] } | null>(
    startKit && startKitAdd ? { text: kitAddText(startKit, startKitAdd.added.length, startKitAdd.skipped.length), skipped: startKitAdd.skipped } : null,
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, start] = useTransition();
  const chosen = new Set(items.map((i) => i.id));
  const pickable = choices.assets.filter((a) => !chosen.has(a.id));
  const people = startEmployeeId && !choices.people.some((p) => p.id === startEmployeeId) ? null : startEmployeeId;

  function addAsset(id: string) {
    const asset = choices.assets.find((a) => a.id === id);
    if (asset && !chosen.has(id)) setItems((list) => [...list, asset]);
  }

  function addKit() {
    const kit = choices.kits.find((k) => k.id === kitId);
    if (!kit) return;
    const { added, skipped } = kitAdd(kit, chosen, choices.assets);
    setItems((list) => [...list, ...added.filter((a) => !list.some((x) => x.id === a.id))]);
    setKitNote({ text: kitAddText(kit, added.length, skipped.length), skipped });
    setKitId('');
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    const fd = new FormData(e.currentTarget);
    const text = (k: string) => String(fd.get(k) ?? '');
    const { body, problems } = handoverBody(
      {
        employeeId: text('employeeId'),
        kind: text('kind'),
        dueDate: text('dueDate'),
        purpose: text('purpose'),
        handedOverBy: text('handedOverBy'),
        notes: text('notes'),
        items: items.map((i) => ({
          assetId: i.id,
          conditionOut: text(`condition-${i.id}`),
          accessories: text(`accessories-${i.id}`),
          // step 4: the checklist's lines ticked to go
          ...(i.accessories?.length && { accessoryIds: fd.getAll(`accgo-${i.id}`).map(String) }),
        })),
      },
      today,
    );
    if (problems.length) {
      setErrors(problems);
      return;
    }
    setErrors([]);
    start(async () => {
      const result = await handOverAssets(body);
      if (!result.code) {
        setErrors(result.errors?.length ? result.errors : ['The handover could not be saved. Please try again.']);
        return;
      }
      const skipped = [...(kitNote?.skipped ?? []), ...(result.skipped ?? [])].map((s) => s.code);
      const page = surface === 'app' ? APP_CUSTODY_PATHS.record(result.code) : CUSTODY_PATHS.record(result.code);
      router.push(`${page}?done=handed${skipped.length ? `&skipped=${encodeURIComponent([...new Set(skipped)].join(','))}` : ''}`);
    });
  }

  return (
    <form onSubmit={submit} noValidate aria-label="New handover" className="card space-y-6 p-5">
      <FormErrors errors={errors} />

      {startAssetCode && !startAsset && (
        <p role="status" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          {startAssetCode} can&apos;t be handed over now: only available assets that aren&apos;t consumables are.
        </p>
      )}

      <section className="space-y-4">
        <h2 className="font-semibold">Employee and Purpose</h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor={fid('employeeId')} className="label">
              Employee
            </label>
            <Select id={fid('employeeId')} name="employeeId" required defaultValue={people ?? ''} aria-describedby={fid('employee-hint')} className="input">
              <option value="">Choose the employee</option>
              {choices.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullNameEn} · {p.employeeCode}
                  {p.department ? ` · ${p.department}` : ''}
                </option>
              ))}
            </Select>
            <p id={fid('employee-hint')} className="hint">
              Current employees only.
            </p>
          </div>
          <fieldset className="sm:col-span-2">
            <legend className="label">Kind</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {CUSTODY_KINDS.map((k) => (
                <label key={k} className={`flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${kind === k ? 'border-accent bg-accent-soft' : 'border-line'}`}>
                  <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="mt-0.5" />
                  <span>
                    <span className="block font-semibold">{CUSTODY_KIND_LABELS[k]}</span>
                    <span className="block text-muted">{CUSTODY_KIND_HINTS[k]}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {kind === 'shoot' && (
            <div>
              <label htmlFor={fid('dueDate')} className="label">
                Return date
              </label>
              <DateInput id={fid('dueDate')} name="dueDate" defaultValue="" required aria-describedby={fid('dueDate-hint')} />
              <p id={fid('dueDate-hint')} className="hint">
                Overdue once it has passed and the record isn&apos;t closed.
              </p>
            </div>
          )}
          <div className={kind === 'shoot' ? undefined : 'sm:col-span-2'}>
            <label htmlFor={fid('purpose')} className="label">
              Purpose {optional}
            </label>
            <input id={fid('purpose')} name="purpose" maxLength={CUSTODY_TEXT_LIMITS.purpose} placeholder="E.g. the client's ad shoot" className="input" />
          </div>
          <div>
            <label htmlFor={fid('handedOverBy')} className="label">
              Handed over by
            </label>
            <input
              id={fid('handedOverBy')}
              name="handedOverBy"
              required
              maxLength={CUSTODY_TEXT_LIMITS.handedOverBy}
              defaultValue={choices.handedOverBy}
              aria-describedby={fid('handedOverBy-hint')}
              className="input"
            />
            <p id={fid('handedOverBy-hint')} className="hint">
              Printed on the form beside their signature.
            </p>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={fid('notes')} className="label">
              Notes {optional}
            </label>
            <textarea id={fid('notes')} name="notes" rows={2} maxLength={CUSTODY_TEXT_LIMITS.notes} className="input" />
          </div>
        </div>
      </section>

      <section className="space-y-4 border-t border-line-soft pt-5">
        <div>
          <h2 className="font-semibold">Assets</h2>
          <p className="mt-0.5 text-sm text-muted">Only available assets that aren&apos;t consumables can be handed over.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={fid('pick')} className="label">
              Add an asset
            </label>
            <Select
              id={fid('pick')}
              value=""
              onChange={(e) => addAsset(e.target.value)}
              disabled={!pickable.length}
              className="input"
            >
              <option value="">{pickable.length ? 'Choose an asset to add' : 'No other asset is available'}</option>
              {pickable.map((a) => (
                <option key={a.id} value={a.id}>
                  {assetOptionText(a)}
                </option>
              ))}
            </Select>
          </div>
          {choices.kits.length > 0 && (
            <div>
              <label htmlFor={fid('kit')} className="label">
                Add a kit {optional}
              </label>
              <div className="flex gap-2">
                <Select id={fid('kit')} value={kitId} onChange={(e) => setKitId(e.target.value)} className="input min-w-0 flex-1">
                  <option value="">Choose a kit</option>
                  {choices.kits.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.code} · {k.name}
                    </option>
                  ))}
                </Select>
                <button type="button" onClick={addKit} disabled={!kitId} className="btn btn-secondary">
                  Add kit
                </button>
              </div>
              <p className="hint">Adds its available assets; the others are listed with why.</p>
            </div>
          )}
        </div>
        {kitNote && (
          <div role="status" className="rounded-lg bg-canvas px-4 py-3 text-sm">
            <p className="font-semibold">{kitNote.text}</p>
            {kitNote.skipped.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-muted">
                {kitNote.skipped.map((s) => (
                  <li key={s.code}>{skipText(s)}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {items.length ? (
          <ul aria-label="Assets to hand over" className="divide-y divide-line-soft rounded-lg border border-line">
            {items.map((a) => (
              <li key={a.id} className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_11rem_14rem_auto] sm:items-end">
                <div className="min-w-0">
                  <p className="font-semibold break-words">{a.name}</p>
                  <p className="text-xs text-muted">
                    <span className="font-mono">{a.code}</span>
                    {a.serial ? ` · S/N ${a.serial}` : ''}
                    {a.kit ? ` · ${a.kit.code}` : ''}
                    {a.parent ? ` · attached to ${a.parent.code}` : ''}
                  </p>
                  {attachedText(a).going && <p className="text-xs text-ok">{attachedText(a).going}</p>}
                  {attachedText(a).skipped && <p className="text-xs text-warn">{attachedText(a).skipped}</p>}
                </div>
                <div>
                  <label htmlFor={fid(`condition-${a.id}`)} className="label">
                    Condition out
                  </label>
                  <Select id={fid(`condition-${a.id}`)} name={`condition-${a.id}`} defaultValue={a.condition ?? ''} className="input">
                    <option value="">Not set</option>
                    {ASSET_CONDITIONS.map((c) => (
                      <option key={c} value={c}>
                        {ASSET_CONDITION_LABELS[c]}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label htmlFor={fid(`accessories-${a.id}`)} className="label">
                    {a.accessories?.length ? 'Other accessories' : 'Accessories'} {optional}
                  </label>
                  <input id={fid(`accessories-${a.id}`)} name={`accessories-${a.id}`} maxLength={CUSTODY_TEXT_LIMITS.accessories} placeholder="E.g. 2 batteries, charger" className="input" />
                </div>
                <button type="button" onClick={() => setItems((list) => list.filter((x) => x.id !== a.id))} className="btn btn-secondary">
                  Remove<span className="sr-only"> {a.code}</span>
                </button>
                {a.accessories && a.accessories.length > 0 && (
                  <fieldset className="sm:col-span-4">
                    <legend className="label">Its accessories going with it</legend>
                    <div className="flex flex-wrap gap-2 text-sm">
                      {a.accessories.map((x) => (
                        <label key={x.id} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line px-3">
                          <input type="checkbox" name={`accgo-${a.id}`} value={x.id} defaultChecked />
                          {x.quantity > 1 ? `${x.quantity} × ` : ''}
                          {x.name}
                          {x.serial && <span className="font-mono text-xs text-muted">{x.serial}</span>}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No assets chosen yet.</p>
        )}
      </section>

      <section className="space-y-2 border-t border-line-soft pt-5">
        <h2 className="font-semibold">Terms on the Form</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          {choices.terms.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ol>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={saving} className="btn btn-primary">
          {saving ? 'Saving…' : `Hand over ${items.length ? `${items.length} ${items.length === 1 ? 'asset' : 'assets'}` : 'assets'}`}
        </button>
        <Link href={cancelHref} className={`btn btn-secondary ${saving ? 'pointer-events-none opacity-60' : ''}`} aria-disabled={saving || undefined}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
