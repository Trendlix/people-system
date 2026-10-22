'use client';

import { useId, useState } from 'react';
import {
  PDF_FIELD_KINDS,
  PDF_FONT_SIZE_MAX,
  PDF_FONT_SIZE_MIN,
  type PdfField,
  type PdfFieldAlign,
  type PdfPageSize,
  type TemplateLanguage,
} from '@trendlix/shared';
import { useFieldIds } from '@/components/form';
import { Select } from '@/components/select';
import { BOXES_MAX, boxCount, clampRect, groupsText, LINES_MAX, parseGroups, round2, rowCount, setBoxCount, withRect } from './place';
import { canBeOptional, changeKind, changeTag, dateKind, digitsSetting, fieldLabel, isAmountTag, KIND_LABELS, TAGS_BY_GROUP, withLines, withOptional } from './samples';

// The right of Place Fields: the selected field's settings, each applied as it is changed (Save sends them all). Its
// tag and kind; for text and boxes, whether it is left blank when the tag has no value; its font; for text and fixed
// text, how it lines up, how many lines a long value may wrap onto and whether it shrinks; for boxes, how many, their
// groups ("4+2+2"), the gaps between them, which side a short value keeps to, a date's order, an amount's part and the
// boxes moved on their own; Arabic digits, ticked and locked where the template's slot decides them (a social insurance
// form); for a check mark, when it is ticked and its mark; for fixed text, the text; and its exact place, in points.
// Read-only, the same settings, greyed.

type Update = (change: (field: PdfField) => PdfField) => void;

const SMALL_INPUT = 'input min-h-9 py-1';
const SECTION = 'space-y-3 border-t border-line-soft pt-3';

/**
 * A number typed in points (or boxes): applied as soon as it is a number within `min`–`max`; on leaving the box, what
 * was typed is brought within them, or put back.
 */
function NumberInput({
  id,
  value,
  onValue,
  min,
  max,
  step,
  className = SMALL_INPUT,
  label,
}: {
  id?: string;
  value: number;
  onValue: (value: number) => void;
  min: number;
  max: number;
  step: number;
  className?: string;
  /** For a box without a visible label of its own. */
  label?: string;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <input
      id={id}
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      aria-label={label}
      value={typed ?? String(round2(value))}
      onChange={(e) => {
        setTyped(e.target.value);
        const n = parseFloat(e.target.value);
        if (Number.isFinite(n) && n >= min && n <= max) onValue(n);
      }}
      onBlur={() => {
        const n = parseFloat(typed ?? '');
        if (typed !== null && Number.isFinite(n)) onValue(Math.min(max, Math.max(min, n)));
        setTyped(null);
      }}
      className={`${className} tabular-nums`}
    />
  );
}

/** A choice of a few, as buttons in a row (Right · Center · Left). */
function Choice<T extends string>({ legend, value, options, onValue }: { legend: string; value: T; options: readonly (readonly [T, string])[]; onValue: (value: T) => void }) {
  const name = useId();
  return (
    <fieldset>
      <legend className="label">{legend}</legend>
      <div className="flex rounded-lg border border-line bg-white p-0.5">
        {options.map(([v, label]) => (
          <label key={v} className={`flex min-h-8 flex-1 cursor-pointer items-center justify-center rounded-md px-2 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent ${v === value ? 'bg-accent-soft font-semibold text-accent' : 'text-ink hover:bg-canvas'}`}>
            <input type="radio" name={name} className="sr-only" checked={v === value} onChange={() => onValue(v)} />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Check({
  label,
  checked,
  onChange,
  hint,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-accent disabled:opacity-60" />
      <span>
        {label}
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

/**
 * Whether the field prints ٠-٩: its own setting, unless the template's slot decides it (a social insurance form prints
 * every number in ٠-٩ but an email's, owner 16 October 2026), when it shows the rule, locked, and why.
 */
function DigitsCheck({ field, slotKey, language, onChange }: { field: PdfField; slotKey: string | null | undefined; language: TemplateLanguage; onChange: Update }) {
  const { checked, locked } = digitsSetting(field, slotKey, language);
  return (
    <Check
      label="Arabic digits"
      hint={locked ?? '٠١٢٣ instead of 0123.'}
      checked={checked}
      disabled={locked !== null}
      onChange={(arabicDigits) => onChange((f) => ({ ...f, arabicDigits }))}
    />
  );
}

/** A gap between boxes, in points: a slider and the number. */
function Gap({ label, value, onValue }: { label: string; value: number; onValue: (value: number) => void }) {
  const fid = useFieldIds();
  return (
    <div>
      <label htmlFor={fid('range')} className="label">
        {label} <span className="font-normal text-muted">(pt)</span>
      </label>
      <div className="flex items-center gap-2">
        <input id={fid('range')} type="range" min={0} max={20} step={0.25} value={Math.min(20, value)} onChange={(e) => onValue(+e.target.value)} className="min-w-0 flex-1 accent-accent" />
        <NumberInput value={value} onValue={onValue} min={0} max={100} step={0.25} className={`${SMALL_INPUT} w-20`} label={`${label} in points`} />
      </div>
    </div>
  );
}

/** The groups, typed as "4+2+2": applied once they add up to the boxes; what is wrong is said under them. */
function GroupsInput({ field, onChange }: { field: PdfField; onChange: Update }) {
  const fid = useFieldIds();
  const boxes = boxCount(field);
  const [typed, setTyped] = useState<string | null>(null);
  const parsed = typed === null ? null : parseGroups(typed, boxes);
  const error = parsed && 'error' in parsed ? parsed.error : null;
  return (
    <div>
      <label htmlFor={fid('groups')} className="label">
        Groups <span className="font-normal text-muted">(optional)</span>
      </label>
      <input
        id={fid('groups')}
        value={typed ?? groupsText(field.groups)}
        onChange={(e) => {
          setTyped(e.target.value);
          const next = parseGroups(e.target.value, boxes);
          if ('groups' in next) onChange((f) => ({ ...f, groups: next.groups }));
        }}
        onBlur={() => setTyped(null)}
        placeholder="e.g. 4+2+2"
        aria-invalid={!!error}
        aria-describedby={fid('groups-hint')}
        className={`${SMALL_INPUT} font-mono`}
      />
      <p id={fid('groups-hint')} className={`hint ${error ? 'text-danger' : ''}`}>
        {error ?? 'Boxes in groups, left to right, with the group gap between them.'}
      </p>
    </div>
  );
}

function TagSelect({ field, language, onChange }: { field: PdfField; language: TemplateLanguage; onChange: Update }) {
  const fid = useFieldIds();
  const check = field.kind === 'check';
  return (
    <div>
      <label htmlFor={fid('tag')} className="label">
        {check ? 'Ticked when' : 'Tag'}
      </label>
      <Select id={fid('tag')} value={field.tag ?? ''} onChange={(e) => onChange((f) => changeTag(f, e.target.value || null, language))} className={SMALL_INPUT}>
        {(check || !field.tag) && <option value="">{check ? 'Always ticked' : 'Choose a tag'}</option>}
        {TAGS_BY_GROUP.map((g) => (
          <optgroup key={g.group} label={g.label}>
            {g.tags.map((t) => (
              <option key={t.tag} value={t.tag}>
                {t.labelEn} ({t.tag})
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
      {!check && !field.tag && <p className="hint text-danger">Choose the tag this field prints.</p>}
    </div>
  );
}

/**
 * `pages`: every page's size (a field moved to another page stays on it); `box`: the box of a boxes field picked with
 * Alt-click, which the arrow keys move alone; `slotKey`: the template's, whose rule may decide the digits.
 */
export function FieldProperties({
  field,
  language,
  slotKey,
  editable,
  pages,
  box,
  onChange,
  onDuplicate,
  onDelete,
}: {
  field: PdfField;
  language: TemplateLanguage;
  slotKey?: string | null;
  editable: boolean;
  pages: readonly PdfPageSize[];
  box: number | null;
  onChange: Update;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const fid = useFieldIds();
  const set = (patch: Partial<PdfField>) => onChange((f) => ({ ...f, ...patch }));
  const page = pages[field.page - 1] ?? { width: 612, height: 792 };
  const place = (patch: Partial<PdfField>) => onChange((f) => withRect(f, clampRect({ ...f, ...patch }, page)));
  const date = dateKind(field.tag);
  const printsText = field.kind === 'text' || field.kind === 'fixed';
  const rows = rowCount(field);
  const moved = (field.nudges ?? []).some((n) => n && (n.dx || n.dy));

  return (
    <fieldset disabled={!editable} className="min-w-0 space-y-3">
      <legend className="sr-only">{fieldLabel(field)}</legend>
      <p className="text-sm font-medium break-words">{fieldLabel(field)}</p>

      <div>
        <label htmlFor={fid('kind')} className="label">
          Kind
        </label>
        <Select id={fid('kind')} value={field.kind} onChange={(e) => onChange((f) => changeKind(f, e.target.value as PdfField['kind'], language))} className={SMALL_INPUT}>
          {PDF_FIELD_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </Select>
      </div>

      {field.kind !== 'fixed' && <TagSelect field={field} language={language} onChange={onChange} />}

      {canBeOptional(field.kind) && (
        <Check
          label="Leave blank when there’s no value"
          hint="Otherwise a missing value stops the document, as in a Word template."
          checked={!!field.optional}
          onChange={(optional) => onChange((f) => withOptional(f, optional))}
        />
      )}

      {field.kind === 'check' && (
        <>
          {field.tag && (
            <div>
              <label htmlFor={fid('equals')} className="label">
                Is
              </label>
              <input id={fid('equals')} dir="auto" value={field.equals ?? ''} onChange={(e) => set({ equals: e.target.value })} placeholder="e.g. ذكر" className={SMALL_INPUT} />
              <p className="hint">Ticked only when the tag prints exactly this.</p>
            </div>
          )}
          <div>
            <label htmlFor={fid('mark')} className="label">
              Mark
            </label>
            <input id={fid('mark')} dir="auto" value={field.text ?? ''} onChange={(e) => set({ text: e.target.value })} placeholder="✓" maxLength={3} className={`${SMALL_INPUT} w-20`} />
          </div>
        </>
      )}

      {field.kind === 'fixed' && (
        <div>
          <label htmlFor={fid('text')} className="label">
            Text
          </label>
          <textarea id={fid('text')} dir="auto" rows={2} value={field.text ?? ''} onChange={(e) => set({ text: e.target.value })} className="input py-1" />
          {!field.text?.trim() && <p className="hint text-danger">Type the text to print.</p>}
        </div>
      )}

      <div className="grid grid-cols-[1fr_auto] items-end gap-3">
        <div>
          <label htmlFor={fid('size')} className="label">
            Font size <span className="font-normal text-muted">(pt)</span>
          </label>
          <NumberInput id={fid('size')} value={field.fontSize} onValue={(fontSize) => set({ fontSize })} min={PDF_FONT_SIZE_MIN} max={PDF_FONT_SIZE_MAX} step={0.5} />
        </div>
        <div className="pb-2">
          <Check label="Bold" checked={!!field.bold} onChange={(bold) => set({ bold })} />
        </div>
      </div>

      {printsText && (
        <>
          <Choice<PdfFieldAlign>
            legend="Align"
            value={field.align ?? 'right'}
            options={[
              ['right', 'Right'],
              ['center', 'Center'],
              ['left', 'Left'],
            ]}
            onValue={(align) => set({ align })}
          />
          <div>
            <label htmlFor={fid('lines')} className="label">
              Lines
            </label>
            <NumberInput id={fid('lines')} value={rows} onValue={(n) => onChange((f) => withLines(f, n))} min={1} max={LINES_MAX} step={1} className={`${SMALL_INPUT} w-24`} />
            <p className="hint">
              {rows > 1
                ? `The box is split into ${rows} rows: a short value sits on the bottom one, a longer one wraps onto the rows above.`
                : 'More than 1 lets a long value wrap onto the rows above instead of printing small.'}
            </p>
          </div>
          <Check
            label="Shrink to fit"
            hint={rows > 1 ? 'A value too long for all its lines prints smaller.' : 'A value too long for the box prints smaller.'}
            checked={!!field.shrinkToFit}
            onChange={(shrinkToFit) => set({ shrinkToFit })}
          />
          <DigitsCheck field={field} slotKey={slotKey} language={language} onChange={onChange} />
        </>
      )}

      {field.kind === 'boxes' && (
        <section aria-labelledby={fid('boxes-title')} className={SECTION}>
          <h3 id={fid('boxes-title')} className="text-sm font-semibold">
            Boxes
          </h3>
          <div>
            <label htmlFor={fid('boxes')} className="label">
              Number of boxes
            </label>
            <NumberInput id={fid('boxes')} value={boxCount(field)} onValue={(n) => onChange((f) => setBoxCount(f, n))} min={1} max={BOXES_MAX} step={1} className={`${SMALL_INPUT} w-24`} />
          </div>
          <GroupsInput key={boxCount(field)} field={field} onChange={onChange} />
          <Gap label="Box gap" value={field.boxGap ?? 0} onValue={(boxGap) => set({ boxGap })} />
          <Gap label="Group gap" value={field.groupGap ?? 0} onValue={(groupGap) => set({ groupGap })} />
          <Choice<'left' | 'right'>
            legend="A short value starts at"
            value={field.boxAlign ?? 'left'}
            options={[
              ['left', 'Left box'],
              ['right', 'Right box'],
            ]}
            onValue={(boxAlign) => set({ boxAlign })}
          />
          {date && (
            <Choice<'DMY' | 'YMD'>
              legend="Date order, left to right"
              value={field.dateOrder ?? 'DMY'}
              options={
                date === 'date'
                  ? [
                      ['DMY', 'DD MM YYYY'],
                      ['YMD', 'YYYY MM DD'],
                    ]
                  : [
                      ['DMY', 'MM YYYY'],
                      ['YMD', 'YYYY MM'],
                    ]
              }
              onValue={(dateOrder) => set({ dateOrder })}
            />
          )}
          {isAmountTag(field.tag) && (
            <div>
              <label htmlFor={fid('part')} className="label">
                Amount part
              </label>
              <Select
                id={fid('part')}
                value={field.amountPart ?? ''}
                onChange={(e) => set({ amountPart: (e.target.value || undefined) as PdfField['amountPart'] })}
                className={SMALL_INPUT}
              >
                <option value="">The whole amount</option>
                <option value="pounds">Pounds only</option>
                <option value="piasters">Piastres only (2 digits)</option>
              </Select>
            </div>
          )}
          <DigitsCheck field={field} slotKey={slotKey} language={language} onChange={onChange} />
          <div className="space-y-2">
            <p className="text-xs text-muted">
              {box !== null
                ? `Box ${box + 1} is picked: the arrow keys move it alone. Esc lets it go.`
                : 'A box printed off line? Alt-click it (Option-click on a Mac), then move it alone with the arrow keys.'}
            </p>
            <button type="button" onClick={() => set({ nudges: undefined })} disabled={!moved} className="btn btn-secondary min-h-9 w-full px-3">
              Reset box positions
            </button>
          </div>
        </section>
      )}

      <section aria-labelledby={fid('place-title')} className={SECTION}>
        <h3 id={fid('place-title')} className="text-sm font-semibold">
          Position <span className="font-normal text-muted">(pt)</span>
        </h3>
        {pages.length > 1 && (
          <div>
            <label htmlFor={fid('page')} className="label">
              Page
            </label>
            <Select
              id={fid('page')}
              value={field.page}
              onChange={(e) => {
                const n = Number(e.target.value);
                onChange((f) => ({ ...withRect(f, clampRect(f, pages[n - 1] ?? page)), page: n }));
              }}
              className={SMALL_INPUT}
            >
              {pages.map((_, i) => (
                <option key={i} value={i + 1}>
                  Page {i + 1}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['x', 'X', 0, page.width],
              ['y', 'Y', 0, page.height],
              ['width', 'Width', 1, page.width],
              ['height', 'Height', 1, page.height],
            ] as const
          ).map(([key, label, min, max]) => (
            <div key={key}>
              <label htmlFor={fid(key)} className="label">
                {label}
              </label>
              <NumberInput id={fid(key)} value={field[key]} onValue={(v) => place({ [key]: v })} min={min} max={max} step={0.5} />
            </div>
          ))}
        </div>
      </section>

      <div className="flex gap-2 border-t border-line-soft pt-3">
        <button type="button" onClick={onDuplicate} className="btn btn-secondary min-h-9 flex-1 px-3">
          Duplicate
        </button>
        <button type="button" onClick={onDelete} className="btn btn-danger min-h-9 flex-1 px-3">
          Delete
        </button>
      </div>
    </fieldset>
  );
}
