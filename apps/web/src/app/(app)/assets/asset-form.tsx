'use client';

import {
  ASSET_CLASS_LABELS,
  ASSET_CLASSES,
  ASSET_CONDITION_LABELS,
  ASSET_CONDITIONS,
  ASSET_GROUP_LABELS,
  ASSET_GROUP_RULES,
  ASSET_GROUPS,
  ASSET_STATUS_LABELS,
  ASSET_STATUSES_BY_HAND,
  ASSET_TEXT_LIMITS,
  ASSET_TYPE_CODES,
  ASSET_TYPE_LABELS,
  assetFieldsOf,
  assetTypesFor,
  isAssetGroup,
  type AssetGroup,
  type AssetKitView,
  type AssetRoomView,
  type AssetStatus,
} from '@trendlix/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, useFieldIds } from '@/components/form';
import { Select } from '@/components/select';
import { APP_ASSET_PATHS, ASSET_PATHS } from '@/lib/asset-paths';
import { saveAsset } from './actions';
import { PhotoPicker, sendPhotos, type ChosenPhoto } from './asset-photos';
import { readAssetForm, readValuesForm, usefulLifeHint } from './assets';

// The Add asset and Edit asset form (owner, 21 October 2026: "i want to add this module with a special permission to the
// system"; the brief: "a form whose fields follow the group"): what it is (the group first, then the type, the usual
// types of the group first, its name, brand, model, serial, condition and class), where it is (its room, its kit for a
// production kit asset, its status by hand on Edit), a consumable's stock (quantity, unit, reorder level, and no
// serial, condition, useful life or status: it is always available), its purchase (date, useful life, warranty) and,
// for those who see them (the CEO, Finance, a Super Admin: "CEO and Finance"), its values; then its notes and photos
// ("Take photo", "Choose photos"). The shared checks run before it is sent; the API checks everything again. Once saved,
// the photos chosen are sent one by one and the asset's page opens (the phone pages' on the phone pages).

type Surface = 'site' | 'app';

const optional = <span className="font-normal text-muted">(optional)</span>;

function Section({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="space-y-4 border-t border-line-soft pt-5 first:border-0 first:pt-0">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {note && <p className="mt-0.5 text-sm text-muted">{note}</p>}
      </div>
      <div className="grid gap-5 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({ id, label, hint, children, wide = false, opt = false }: { id: string; label: string; hint?: string; children: React.ReactNode; wide?: boolean; opt?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <label htmlFor={id} className="label">
        {label} {opt && optional}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
    </div>
  );
}

/** "In custody: it changes when it is received back", for a status the form can't change. */
function fixedStatusText(status: AssetStatus, group: AssetGroup): string {
  if (group === 'consumable') return 'Available: consumables always are, as they are kept by quantity.';
  if (status === 'custody') return 'In custody: it changes when it is received back.';
  if (status === 'disposed') return 'Disposed: it stays so.';
  return ASSET_STATUS_LABELS[status];
}

export function AssetForm({
  mode,
  code = null,
  from = null,
  defaults,
  values,
  rooms,
  kits,
  today,
  photosHad = 0,
  ai,
  surface,
  cancelHref,
}: {
  mode: 'add' | 'edit';
  code?: string | null;
  /** The asset's status now (Edit). */
  from?: AssetStatus | null;
  /** The fields as they start (editDefaults on Edit; the group and anything asked for on Add). */
  defaults: Record<string, string>;
  /** The values as they start, for those who see them; null: the Values section isn't shown (nor sent). */
  values: Record<string, string> | null;
  rooms: AssetRoomView[];
  kits: AssetKitView[];
  today: string;
  photosHad?: number;
  /** Whether the Assets AI is set up (GET /auth/me's assets.ai): always false in step 1. */
  ai: boolean;
  surface: Surface;
  cancelHref: string;
}) {
  const router = useRouter();
  const fid = useFieldIds();
  const startGroup: AssetGroup = isAssetGroup(defaults.group) ? defaults.group : 'kit';
  const [group, setGroup] = useState<AssetGroup>(startGroup);
  const [errors, setErrors] = useState<string[]>([]);
  const [photos, setPhotos] = useState<ChosenPhoto[]>([]);
  const [shrinking, setShrinking] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const fields = assetFieldsOf(group);
  const rule = ASSET_GROUP_RULES[group];
  const sameGroup = group === startGroup;
  // the class and the useful life follow the group chosen, unless it is the asset's own (Edit) or the one it started with
  const classDefault = sameGroup && defaults.assetClass ? defaults.assetClass : rule.defaultClass;
  const lifeDefault = sameGroup && mode === 'edit' ? (defaults.usefulLifeYears ?? '') : rule.usefulLifeYears === null ? '' : String(rule.usefulLifeYears);
  const usual = assetTypesFor(group);
  const others = ASSET_TYPE_CODES.filter((t) => !usual.includes(t));
  const pickableRooms = rooms.filter((r) => !r.archived || r.id === defaults.roomId);
  const statusByHand = mode === 'edit' && from !== null && fields.status && (ASSET_STATUSES_BY_HAND as readonly string[]).includes(from);
  const busy = saving || shrinking;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const fd = new FormData(e.currentTarget);
    // the shared checks first, as the API will make them
    const problems = [...readAssetForm(fd, today, mode === 'edit' ? from : null).problems, ...(values ? readValuesForm(fd).problems : [])];
    if (problems.length) {
      setErrors(problems);
      return;
    }
    setErrors([]);
    start(async () => {
      setProgress('Saving…');
      const result = await saveAsset(mode === 'edit' ? code : null, mode === 'edit' ? from : null, fd);
      if (result.errors?.length || !result.code) {
        setErrors(result.errors?.length ? result.errors : ['The asset could not be saved. Please try again.']);
        setProgress(null);
        return;
      }
      const saved = result.code;
      let failed = 0;
      if (photos.length) {
        setProgress(`Sending photo 1 of ${photos.length}…`);
        const sent = await sendPhotos(saved, photos, (done) => done < photos.length && setProgress(`Sending photo ${done + 1} of ${photos.length}…`));
        failed = sent.failed.length;
      }
      const page = surface === 'app' ? APP_ASSET_PATHS.asset(saved) : ASSET_PATHS.asset(saved);
      const done = mode === 'add' ? 'added' : 'saved';
      router.push(`${page}?done=${done}${failed ? `&photosFailed=${failed}` : ''}`);
    });
  }

  return (
    <form onSubmit={submit} noValidate aria-label={mode === 'add' ? 'Add asset' : `Edit ${code}`} className="card space-y-6 p-5">
      <FormErrors errors={errors} />

      {/* Step 2 (owner, 21 October 2026: "i might link a claude account for the assets section only to fetch data and
          help in the data entry"; then "the connection method", a connector on their own Claude account): "Fill from
          photos" (identify the asset from photos) and "Scan label" (read a serial label). Shown only once the AI is set
          up (GET /auth/me's assets.ai, always false in step 1): the form works by hand without it. */}
      {ai && (
        <section aria-label="Fill in with AI" className="flex flex-wrap gap-2 rounded-lg border border-dashed border-line p-3">
          <button type="button" disabled className="btn btn-secondary" data-assets-ai="fill-from-photos">
            Fill from photos
          </button>
          <button type="button" disabled className="btn btn-secondary" data-assets-ai="scan-label">
            Scan label
          </button>
        </section>
      )}

      <Section title="What It Is">
        <Field id={fid('group')} label="Group" hint={`${rule.examples}. Its code starts ${rule.prefix}-.`}>
          <Select
            id={fid('group')}
            name="group"
            required
            value={group}
            onChange={(e) => isAssetGroup(e.target.value) && setGroup(e.target.value)}
            aria-describedby={`${fid('group')}-hint`}
            className="input"
          >
            {ASSET_GROUPS.map((g) => (
              <option key={g} value={g}>
                {ASSET_GROUP_LABELS[g]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={fid('type')} label="Type" hint={mode === 'edit' ? `The code stays ${code}, whatever the group and type become.` : 'The code is given when it is saved, e.g. PK-CAM-0001.'}>
          <Select id={fid('type')} name="type" required defaultValue={defaults.type ?? ''} aria-describedby={`${fid('type')}-hint`} className="input">
            <option value="">Choose a type</option>
            <optgroup label={`Usual for ${ASSET_GROUP_LABELS[group].toLowerCase()}`}>
              {usual.map((t) => (
                <option key={t} value={t}>
                  {ASSET_TYPE_LABELS[t]} ({t})
                </option>
              ))}
            </optgroup>
            <optgroup label="Other types">
              {others.map((t) => (
                <option key={t} value={t}>
                  {ASSET_TYPE_LABELS[t]} ({t})
                </option>
              ))}
            </optgroup>
          </Select>
        </Field>
        <Field id={fid('name')} label="Name" hint="What people call it, e.g. Sony FX3 camera body." wide>
          <input id={fid('name')} name="name" required maxLength={ASSET_TEXT_LIMITS.name} defaultValue={defaults.name ?? ''} aria-describedby={`${fid('name')}-hint`} className="input" />
        </Field>
        <Field id={fid('brand')} label="Brand" opt>
          <input id={fid('brand')} name="brand" maxLength={ASSET_TEXT_LIMITS.brand} defaultValue={defaults.brand ?? ''} className="input" />
        </Field>
        <Field id={fid('model')} label="Model" opt>
          <input id={fid('model')} name="model" maxLength={ASSET_TEXT_LIMITS.model} defaultValue={defaults.model ?? ''} className="input" />
        </Field>
        {fields.serial && (
          <Field id={fid('serial')} label="Serial number" hint="Copied exactly from its label." opt>
            <input
              id={fid('serial')}
              name="serial"
              maxLength={ASSET_TEXT_LIMITS.serial}
              autoComplete="off"
              spellCheck={false}
              defaultValue={defaults.serial ?? ''}
              aria-describedby={`${fid('serial')}-hint`}
              className="input font-mono"
            />
          </Field>
        )}
        {fields.condition && (
          <Field id={fid('condition')} label="Condition" opt>
            <Select id={fid('condition')} name="condition" defaultValue={defaults.condition ?? ''} className="input">
              <option value="">Not set</option>
              {ASSET_CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {ASSET_CONDITION_LABELS[c]}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field id={fid('assetClass')} label="Accounting class" hint="Fixed: kept for years (cameras, laptops, furniture). Current: used up within a year, or bought to resell.">
          <Select key={`class-${group}`} id={fid('assetClass')} name="assetClass" defaultValue={classDefault} aria-describedby={`${fid('assetClass')}-hint`} className="input">
            {ASSET_CLASSES.map((c) => (
              <option key={c} value={c}>
                {ASSET_CLASS_LABELS[c]}
              </option>
            ))}
          </Select>
        </Field>
      </Section>

      <Section title="Where It Is">
        <Field id={fid('roomId')} label="Room" hint={rooms.length ? 'Where it is kept when nobody holds it.' : 'No rooms yet: an Assets manager adds them on Rooms.'} opt>
          <Select id={fid('roomId')} name="roomId" defaultValue={defaults.roomId ?? ''} aria-describedby={`${fid('roomId')}-hint`} className="input">
            <option value="">No room</option>
            {pickableRooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.archived ? ' (archived)' : ''}
              </option>
            ))}
          </Select>
        </Field>
        {fields.kit && (
          <Field id={fid('kitId')} label="Kit" hint={kits.length ? 'Only production kit assets go in a kit.' : 'No kits yet: add them on Kits.'} opt>
            <Select id={fid('kitId')} name="kitId" defaultValue={defaults.kitId ?? ''} aria-describedby={`${fid('kitId')}-hint`} className="input">
              <option value="">No kit</option>
              {kits.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.code} · {k.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {mode === 'edit' && from !== null && (
          <Field id={fid('status')} label="Status" hint={statusByHand ? 'In custody is set by a handover only, and Disposed by disposal.' : undefined}>
            {statusByHand ? (
              <Select id={fid('status')} name="status" defaultValue={from} aria-describedby={`${fid('status')}-hint`} className="input">
                {ASSET_STATUSES_BY_HAND.map((s) => (
                  <option key={s} value={s}>
                    {ASSET_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            ) : (
              <p id={fid('status')} className="input flex items-center bg-canvas text-muted">
                {fixedStatusText(from, group)}
              </p>
            )}
          </Field>
        )}
      </Section>

      {fields.stock && (
        <Section title="Stock" note="Consumables are kept by quantity, and are always available.">
          <Field id={fid('quantity')} label="Quantity" hint="How many there are now, e.g. 12 or 3.5.">
            <input id={fid('quantity')} name="quantity" inputMode="decimal" autoComplete="off" defaultValue={defaults.quantity ?? ''} aria-describedby={`${fid('quantity')}-hint`} className="input tabular-nums" />
          </Field>
          <Field id={fid('unit')} label="Unit" hint="E.g. rolls, packs, sheets, m." opt>
            <input id={fid('unit')} name="unit" maxLength={ASSET_TEXT_LIMITS.unit} defaultValue={defaults.unit ?? ''} aria-describedby={`${fid('unit')}-hint`} className="input" />
          </Field>
          <Field id={fid('reorderLevel')} label="Reorder level" hint="Flagged to reorder at or under it." opt>
            <input id={fid('reorderLevel')} name="reorderLevel" inputMode="decimal" autoComplete="off" defaultValue={defaults.reorderLevel ?? ''} aria-describedby={`${fid('reorderLevel')}-hint`} className="input tabular-nums" />
          </Field>
        </Section>
      )}

      <Section title="Purchase">
        <Field id={fid('purchaseDate')} label="Purchase date" hint="As on the invoice; not after today." opt>
          <DateInput id={fid('purchaseDate')} name="purchaseDate" defaultValue={defaults.purchaseDate ?? ''} aria-describedby={`${fid('purchaseDate')}-hint`} />
        </Field>
        {fields.usefulLife && (
          <Field id={fid('usefulLifeYears')} label="Useful life (years)" hint={usefulLifeHint(group)} opt>
            <input
              key={`life-${group}`}
              id={fid('usefulLifeYears')}
              name="usefulLifeYears"
              inputMode="numeric"
              autoComplete="off"
              defaultValue={lifeDefault}
              aria-describedby={`${fid('usefulLifeYears')}-hint`}
              className="input tabular-nums"
            />
          </Field>
        )}
        <Field id={fid('warrantyEnd')} label="Warranty ends" opt>
          <DateInput id={fid('warrantyEnd')} name="warrantyEnd" defaultValue={defaults.warrantyEnd ?? ''} />
        </Field>
      </Section>

      {values && (
        <Section title="Values" note="Only the CEO, Finance and a Super Admin see and set these. All in EGP.">
          <Field id={fid('purchasePrice')} label="Purchase cost (EGP)" hint="From the invoice, e.g. 45000 or 45000.50." opt>
            <input id={fid('purchasePrice')} name="purchasePrice" inputMode="decimal" autoComplete="off" defaultValue={values.purchasePrice} aria-describedby={`${fid('purchasePrice')}-hint`} className="input tabular-nums" />
          </Field>
          <Field id={fid('supplier')} label="Supplier" opt>
            <input id={fid('supplier')} name="supplier" maxLength={ASSET_TEXT_LIMITS.supplier} defaultValue={values.supplier} className="input" />
          </Field>
          <Field id={fid('invoiceNo')} label="Invoice number" opt>
            <input id={fid('invoiceNo')} name="invoiceNo" maxLength={ASSET_TEXT_LIMITS.invoiceNo} defaultValue={values.invoiceNo} className="input" />
          </Field>
          <Field id={fid('marketValue')} label="Market value (EGP)" hint="What it would fetch now in Egypt, in its condition." opt>
            <input id={fid('marketValue')} name="marketValue" inputMode="decimal" autoComplete="off" defaultValue={values.marketValue} aria-describedby={`${fid('marketValue')}-hint`} className="input tabular-nums" />
          </Field>
          <Field id={fid('priceLow')} label="Market value, low (EGP)" opt>
            <input id={fid('priceLow')} name="priceLow" inputMode="decimal" autoComplete="off" defaultValue={values.priceLow} className="input tabular-nums" />
          </Field>
          <Field id={fid('priceHigh')} label="Market value, high (EGP)" opt>
            <input id={fid('priceHigh')} name="priceHigh" inputMode="decimal" autoComplete="off" defaultValue={values.priceHigh} className="input tabular-nums" />
          </Field>
          <Field id={fid('priceNote')} label="How the market value was reached" hint="One or two sentences, e.g. three listings for the same model in good condition." wide opt>
            <textarea id={fid('priceNote')} name="priceNote" rows={2} maxLength={ASSET_TEXT_LIMITS.priceNote} defaultValue={values.priceNote} aria-describedby={`${fid('priceNote')}-hint`} className="input" />
          </Field>
        </Section>
      )}

      <Section title="Notes">
        <Field id={fid('notes')} label="Notes" hint="Visible specs, colour, accessories, defects." wide opt>
          <textarea id={fid('notes')} name="notes" rows={3} maxLength={ASSET_TEXT_LIMITS.notes} defaultValue={defaults.notes ?? ''} aria-describedby={`${fid('notes')}-hint`} className="input" />
        </Field>
      </Section>

      <section className="border-t border-line-soft pt-5">
        <PhotoPicker had={photosHad} photos={photos} onChange={setPhotos} onBusy={setShrinking} disabled={saving} />
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className="btn btn-primary">
          {progress ?? (shrinking ? 'Preparing the photos…' : mode === 'add' ? 'Add asset' : 'Save changes')}
        </button>
        <Link href={cancelHref} className={`btn btn-secondary ${saving ? 'pointer-events-none opacity-60' : ''}`} aria-disabled={saving || undefined}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
