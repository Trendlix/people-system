'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useTransition } from 'react';
import { PDF_FIELDS_MAX, TEMPLATE_VERSION_STATUS_LABELS, type PdfField, type PdfPageSize, type PdfRect, type TemplateLanguage, type TemplateVersionStatus } from '@trendlix/shared';
import { FormErrors } from '@/components/form';
import { Select } from '@/components/select';
import { applyStandardLayout, saveTemplateFields } from '../../../../actions';
import { PreviewWithData } from '../../../../preview-with-data';
import { count } from '../../../../tag-check';
import { fieldsJsonHref, fieldsSampleHref, STANDARD_LAYOUT_APPLIED, standardLayoutConfirm, versionPreviewHref } from '../../../../wording';
import { FieldBox } from './field-box';
import { FieldProperties } from './field-properties';
import { PdfPages } from './pdf-pages';
import {
  arrowDelta,
  boxAt,
  clampRect,
  cleanField,
  drawnRect,
  duplicateField,
  fieldInMessage,
  fieldsDirty,
  fitScale,
  moveRect,
  newFieldId,
  nudgeBox,
  pointOnPage,
  resizeRect,
  withRect,
  type Grip,
  type Point,
} from './place';
import { defaultSize, newField, type PaletteItem } from './samples';
import { FieldList, TagPalette } from './tag-palette';

// Place Fields (owner's decision, 15 October 2026): an official form uploaded as a PDF is never converted; HR places
// each field on it once, and every document is the original PDF with the values printed where the fields were placed.
// The pages are drawn with pdf.js (pdf-pages.tsx); over them, each field as an outlined box with what it would print.
// A tag (or a check mark, or fixed text) is picked on the left and placed with a click or a drag; the selected field is
// dragged, resized by its handles, moved with the arrow keys (half a point; Shift: five), duplicated (Ctrl/⌘+D) or
// removed (Delete), and set on the right. Save sends them all (the API checks them and names a field it refuses); Test
// print opens the form filled with sample values from the fields as they are, saved or not; Preview with data uses the
// saved ones. Use the standard layout (owner, 16 October 2026), for a form the system has a layout for, replaces the
// fields with it and saves them at once, once confirmed: a layout improved after the form was uploaded reaches it
// without uploading it again. Read-only for the CEO and for a replaced version: the fields are shown, Test print and
// Preview stay.

type Zoom = 'fit' | 1 | 1.5;

const ZOOMS: readonly (readonly [Zoom, string])[] = [
  ['fit', 'Fit width'],
  [1, '100%'],
  [1.5, '150%'],
];

/** The room around the pages in the scrolling area (pdf-pages.tsx's p-4), taken off the width Fit width fills. */
const PAGES_PADDING = 32;

const LEAVE = 'Leave without saving? The changes to the fields will be lost.';

/** What a drag on a page is doing: drawing a new field, or moving, resizing or nudging one box of the field pressed. */
type Drag =
  | { mode: 'draw'; page: number; size: PdfPageSize; start: Point; item: PaletteItem }
  | { mode: 'move' | 'box' | Grip; size: PdfPageSize; start: Point; origin: PdfField; index: number };

/** A field being drawn: where it would go so far. */
type Ghost = PdfRect & { page: number };

export interface EditorVersion {
  id: string;
  version: number;
  fileName: string;
  status: TemplateVersionStatus;
  language: TemplateLanguage;
}

/** An earlier PDF version of the same form with fields placed, and as many pages, to copy its fields from. */
export interface CopySource {
  id: string;
  version: number;
  fieldCount: number;
}

const sizeOf = (item: PaletteItem) => defaultSize(item.kind === 'tag' ? 'text' : item.kind);

/** Asks before the page is left with changes not saved: closing or reloading the tab, or a link to another page of the app. */
function useLeaveWarning(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const unload = (e: BeforeUnloadEvent) => e.preventDefault();
    // a link inside the app is followed by the router, without the browser's own warning: asked here first
    const click = (e: MouseEvent) => {
      const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if ((a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search)) return;
      if (!window.confirm(LEAVE)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('click', click, true);
    };
  }, [on]);
}

/** Copy fields from an earlier version of the form: they replace the fields here, unsaved, once confirmed. */
function CopyFields({ sources, current, onCopy }: { sources: readonly CopySource[]; current: number; onCopy: (fields: PdfField[]) => void }) {
  const [from, setFrom] = useState(sources[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectId = useId();
  const source = sources.find((s) => s.id === from) ?? sources[0];

  async function copy() {
    if (!source) return;
    const replace = current ? `Replace the ${count(current, 'field')} here with the ${count(source.fieldCount, 'field')} of v${source.version}?` : `Copy the ${count(source.fieldCount, 'field')} of v${source.version}?`;
    if (!window.confirm(`${replace} Nothing is saved until you save.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(fieldsJsonHref(source.id), { cache: 'no-store' });
      const body = (await res.json().catch(() => null)) as { fields?: unknown; message?: string } | null;
      if (!res.ok || !Array.isArray(body?.fields)) setError(body?.message ?? 'The fields could not be loaded. Please try again.');
      else onCopy(body.fields as PdfField[]);
    } catch {
      setError('The fields could not be loaded. Please try again.');
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      {sources.length > 1 ? (
        <>
          <label htmlFor={selectId} className="text-muted">
            Copy fields from
          </label>
          <Select id={selectId} value={source?.id} onChange={(e) => setFrom(e.target.value)} className="input min-h-9 w-auto py-1">
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                v{s.version} ({count(s.fieldCount, 'field')})
              </option>
            ))}
          </Select>
          <button type="button" onClick={copy} disabled={busy} className="font-semibold text-accent hover:underline disabled:opacity-60">
            {busy ? 'Copying…' : 'Copy'}
          </button>
        </>
      ) : (
        source && (
          <button type="button" onClick={copy} disabled={busy} className="font-semibold text-accent hover:underline disabled:opacity-60">
            {busy ? 'Copying…' : `Copy fields from v${source.version}`}
          </button>
        )
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** What the right panel says while no field is selected: how to place and move fields. */
function Help({ editable, fields, pages }: { editable: boolean; fields: number; pages: number }) {
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">
        {count(fields, 'field')} on {count(pages, 'page')}. {editable ? 'Select a field to change it.' : 'Select a field to see its settings.'}
      </p>
      {editable && (
        <ul className="list-disc space-y-1.5 pl-4 text-xs text-muted">
          <li>Drag a field to move it, or its corners to resize it.</li>
          <li>Arrow keys move it half a point; with Shift, 5 points.</li>
          <li>Delete removes it; Ctrl+D (⌘D on a Mac) duplicates it; Esc lets it go.</li>
          <li>Alt-click (Option-click on a Mac) a box of a Boxes field to move that box alone.</li>
          <li>Dashed lines mark an optional field: it is left blank when there’s no value.</li>
          <li>Test print shows the form filled with sample values, exactly as it will print.</li>
        </ul>
      )}
    </div>
  );
}

export function FieldEditor({
  slotKey,
  slotName,
  version,
  pages: given,
  fields: initial,
  canEdit,
  readOnly,
  notice,
  copyFrom,
  standardLayout,
  offers,
}: {
  /** The template's slot, e.g. insurance_form_1: a social insurance form prints its numbers in ٠-٩ (samples.ts). */
  slotKey: string;
  slotName: string;
  version: EditorVersion;
  pages: PdfPageSize[];
  fields: PdfField[];
  /** HR and Admin, on a version that isn't replaced. */
  canEdit: boolean;
  /** Why the fields can't be changed here, when they can't. */
  readOnly: string | null;
  /** Said once at the top, e.g. that the draft was just uploaded. */
  notice: string | null;
  copyFrom: CopySource[];
  /** The system has a standard layout for this form: Use the standard layout is offered to those who can edit. */
  standardLayout: boolean;
  /** A job offer template: Preview with data takes an offer's data. */
  offers: boolean;
}) {
  const [fields, setFields] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [box, setBox] = useState<number | null>(null);
  const [tool, setTool] = useState<PaletteItem | null>(null);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [samples, setSamples] = useState(true);
  const [opened, setOpened] = useState<PdfPageSize[]>([]);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [areaWidth, setAreaWidth] = useState(0);
  const [errors, setErrors] = useState<string[]>();
  const [said, setSaid] = useState<string | null>(null);
  /** Said once the fields are saved ("Saved.", or that the standard layout was applied), until they change again. */
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [applying, startApplying] = useTransition();
  const drag = useRef<Drag | null>(null);
  const focusNext = useRef<{ id: string; reveal: boolean } | null>(null);
  const anchor = useRef<number | null>(null);

  const pages = given.length ? given : opened;
  const dirty = useMemo(() => fieldsDirty(saved, fields), [saved, fields]);
  const current = fields.find((f) => f.id === selected) ?? null;
  const scale = zoom === 'fit' ? fitScale(areaWidth - PAGES_PADDING, pages) : zoom;
  const placed = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of fields) if (f.tag && f.kind !== 'check') counts.set(f.tag, (counts.get(f.tag) ?? 0) + 1);
    return counts;
  }, [fields]);
  const byPage = useMemo(() => {
    const map = new Map<number, PdfField[]>();
    for (const f of fields) map.set(f.page, [...(map.get(f.page) ?? []), f]);
    return map;
  }, [fields]);

  useLeaveWarning(canEdit && dirty);

  // Fit width follows the scrolling area's width
  useEffect(() => {
    if (!scroller) return;
    const ro = new ResizeObserver(([entry]) => setAreaWidth(entry.contentRect.width));
    ro.observe(scroller);
    return () => ro.disconnect();
  }, [scroller]);

  // after a zoom, the middle of what was in view stays in view
  useLayoutEffect(() => {
    if (anchor.current === null || !scroller) return;
    scroller.scrollTop = anchor.current * scroller.scrollHeight - scroller.clientHeight / 2;
    anchor.current = null;
  }, [scale, scroller]);

  // a field just placed, duplicated or named by a refusal gets the keyboard (and is brought into view)
  useEffect(() => {
    const next = focusNext.current;
    if (!next || !scroller) return;
    focusNext.current = null;
    const el = scroller.querySelector<HTMLElement>(`[data-field="${CSS.escape(next.id)}"]`);
    el?.focus({ preventScroll: true });
    if (next.reveal) el?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  });

  const select = useCallback((id: string | null, reveal = false) => {
    setSelected(id);
    setBox(null);
    if (id) focusNext.current = { id, reveal };
  }, []);

  /** Puts a field in place of the one with its id. */
  const replace = useCallback((next: PdfField) => setFields((fs) => fs.map((f) => (f.id === next.id ? next : f))), []);

  const update = useCallback((change: (field: PdfField) => PdfField) => {
    setFields((fs) => fs.map((f) => (f.id === selected ? change(f) : f)));
  }, [selected]);

  function zoomTo(z: Zoom) {
    if (scroller && scroller.scrollHeight > 0) anchor.current = (scroller.scrollTop + scroller.clientHeight / 2) / scroller.scrollHeight;
    setZoom(z);
  }

  /** A new field of what was picked, if the form has room for one more. */
  function place(item: PaletteItem, page: number, rect: PdfRect) {
    if (fields.length >= PDF_FIELDS_MAX) return setSaid(`A form can have at most ${PDF_FIELDS_MAX} fields.`);
    const id = newFieldId(new Set(fields.map((f) => f.id)));
    setFields((fs) => [...fs, newField(item, id, page, rect, version.language)]);
    setTool(null);
    setSaid(null);
    select(id);
  }

  function duplicate(field: PdfField) {
    const size = pages[field.page - 1];
    if (!size) return;
    if (fields.length >= PDF_FIELDS_MAX) return setSaid(`A form can have at most ${PDF_FIELDS_MAX} fields.`);
    const copy = duplicateField(field, newFieldId(new Set(fields.map((f) => f.id))), size);
    setFields((fs) => [...fs, copy]);
    select(copy.id);
  }

  function remove(id: string) {
    setFields((fs) => fs.filter((f) => f.id !== id));
    select(null);
    scroller?.focus({ preventScroll: true });
  }

  function copyIn(copied: PdfField[]) {
    const ids = new Set<string>();
    const fit = copied
      .filter((f) => f && Number.isInteger(f.page) && f.page >= 1 && f.page <= pages.length)
      .map((f) => {
        const id = ids.has(f.id) || !f.id ? newFieldId(ids) : f.id;
        ids.add(id);
        return withRect({ ...f, id }, clampRect(f, pages[f.page - 1]));
      });
    setFields(fit.slice(0, PDF_FIELDS_MAX));
    select(null);
  }

  // ---------- the pointer on a page ----------

  function down(e: React.PointerEvent<HTMLDivElement>, page: number, size: PdfPageSize) {
    if (e.button !== 0) return;
    const at = pointOnPage(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect(), scale);
    const target = e.target as HTMLElement;
    const el = target.closest<HTMLElement>('[data-field]');
    const field = el ? fields.find((f) => f.id === el.dataset.field) : undefined;
    if (field && el) {
      e.preventDefault();
      el.focus({ preventScroll: true });
      setSelected(field.id);
      // Alt-click (Option-click) picks one box of a boxes field, which the arrow keys then move alone
      const index = e.altKey && field.kind === 'boxes' ? boxAt(field, at) : null;
      setBox(index);
      if (!canEdit) return;
      const grip = target.dataset.grip as Grip | undefined;
      drag.current = { mode: index !== null ? 'box' : (grip ?? 'move'), size, start: at, origin: field, index: index ?? 0 };
    } else if (tool && canEdit) {
      e.preventDefault();
      drag.current = { mode: 'draw', page, size, start: at, item: tool };
      setGhost({ page, ...drawnRect(at, at, size, sizeOf(tool)) });
    } else {
      select(null);
      scroller?.focus({ preventScroll: true });
      return;
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // the pointer is already gone
    }
  }

  function move(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const at = pointOnPage(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect(), scale);
    if (d.mode === 'draw') return setGhost({ page: d.page, ...drawnRect(d.start, at, d.size, sizeOf(d.item)) });
    const [dx, dy] = [at.x - d.start.x, at.y - d.start.y];
    if (!dx && !dy) return;
    if (d.mode === 'move') replace(withRect(d.origin, moveRect(d.origin, dx, dy, d.size)));
    else if (d.mode === 'box') replace(nudgeBox(d.origin, d.index, dx, dy, d.size));
    else replace(withRect(d.origin, resizeRect(d.origin, d.mode, dx, dy, d.size)));
  }

  function up(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    drag.current = null;
    if (d?.mode !== 'draw') return;
    const at = pointOnPage(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect(), scale);
    setGhost(null);
    place(d.item, d.page, drawnRect(d.start, at, d.size, sizeOf(d.item)));
  }

  function cancel() {
    drag.current = null;
    setGhost(null);
  }

  // ---------- the keys ----------

  /** On the pages: the selected field (or its picked box) moved, removed or duplicated. */
  function onPagesKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!current || !canEdit || e.altKey) return;
    const size = pages[current.page - 1];
    if (!size) return;
    const d = arrowDelta(e.key, e.shiftKey);
    if (d) {
      e.preventDefault();
      replace(box !== null && current.kind === 'boxes' ? nudgeBox(current, box, d.x, d.y, size) : withRect(current, moveRect(current, d.x, d.y, size)));
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove(current.id);
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      duplicate(current);
    }
  }

  /** Anywhere in the editor: Esc lets go of the picked box, then what was picked to place, then the field; Ctrl/⌘+S saves. */
  function onKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      if (box !== null) setBox(null);
      else if (tool) setTool(null);
      else if (selected) select(null);
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && canEdit) {
      e.preventDefault();
      if (dirty && !saving && !applying) save();
    }
  }

  // ---------- saving ----------

  function save() {
    const from = fields;
    const sent = fields.map(cleanField);
    setErrors(undefined);
    setSavedNote(null);
    startSaving(async () => {
      const result = await saveTemplateFields(version.id, sent);
      if (result.errors?.length) {
        setErrors(result.errors);
        const named = fieldInMessage(result.errors.join(' '), sent);
        if (named) select(named, true);
        return;
      }
      const next = result.fields ?? sent;
      setSaved(next);
      // what the API saved, unless the fields were changed again meanwhile
      setFields((fs) => (fs === from ? next : fs));
      setSavedNote('Saved.');
    });
  }

  /** The standard layout in place of the fields, saved by the API; changes not saved are dropped, once confirmed. */
  function applyStandard() {
    if (!window.confirm(standardLayoutConfirm(dirty))) return;
    setErrors(undefined);
    setSavedNote(null);
    startApplying(async () => {
      const result = await applyStandardLayout(version.id);
      if (result.errors?.length || !result.fields) return setErrors(result.errors);
      setSaved(result.fields);
      setFields(result.fields);
      setTool(null);
      select(null);
      setSavedNote(STANDARD_LAYOUT_APPLIED);
    });
  }

  const hint = tool
    ? 'Click on the form where it goes, or drag to draw its box. Esc cancels.'
    : canEdit
      ? fields.length
        ? null
        : 'Pick a tag on the left, then click on the form where it goes.'
      : null;

  return (
    <div className="space-y-4" onKeyDown={onKey}>
      <header className="card space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wide text-muted uppercase">{slotName}</p>
            <h1 className="page-title mt-1">Place Fields</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              <span className="font-semibold text-ink tabular-nums">v{version.version}</span>
              <span className="break-all">{version.fileName}</span>
              <span className="badge">{TEMPLATE_VERSION_STATUS_LABELS[version.status] ?? version.status}</span>
              <span>
                {count(pages.length, 'page')} · {count(fields.length, 'field')}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {canEdit && dirty && <span className="text-sm font-medium text-warn">Unsaved changes</span>}
            {canEdit && savedNote && !dirty && (
              <span role="status" className="text-sm text-ok">
                {savedNote}
              </span>
            )}
            {/* the fields as they are, saved or not, posted to the route that answers the test print: opened in a new tab */}
            <form
              method="post"
              action={fieldsSampleHref(version.id)}
              target="_blank"
              onSubmit={(e) => {
                const input = e.currentTarget.elements.namedItem('fields');
                if (input instanceof HTMLInputElement) input.value = JSON.stringify(fields.map(cleanField));
              }}
            >
              <input type="hidden" name="fields" defaultValue="[]" />
              <button type="submit" disabled={!fields.length} className="btn btn-secondary">
                Test print<span className="sr-only"> (opens a PDF in a new tab)</span>
              </button>
            </form>
            {canEdit && standardLayout && (
              <button type="button" onClick={applyStandard} disabled={saving || applying} className="btn btn-secondary">
                {applying ? 'Applying…' : 'Use the standard layout'}
              </button>
            )}
            {canEdit && (
              <button type="button" onClick={save} disabled={!dirty || saving || applying} className="btn btn-primary">
                {saving ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {/* a plain link: never prefetched */}
            <a href={versionPreviewHref(version.id)} target="_blank" rel="noopener" className="inline-flex min-h-9 items-center text-sm font-semibold">
              Open the form<span className="sr-only"> as uploaded, in a new tab</span>
            </a>
            <PreviewWithData versionId={version.id} label={`v${version.version} (${version.fileName})`} align="start" offers={offers} />
            {canEdit && dirty && <span className="text-xs text-muted">Preview with data uses the saved fields.</span>}
          </div>
          {canEdit && copyFrom.length > 0 && <CopyFields sources={copyFrom} current={fields.length} onCopy={copyIn} />}
        </div>
        {notice && (
          <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
            {notice}
          </p>
        )}
        {readOnly && <p className="rounded-lg bg-accent-soft px-4 py-3 text-sm">{readOnly}</p>}
        <FormErrors errors={errors} />
      </header>

      <div className="grid gap-3 lg:h-[calc(100dvh-6rem)] lg:min-h-[32rem] lg:grid-cols-[15rem_minmax(0,1fr)_17rem]">
        <aside aria-label={canEdit ? 'Add a field' : 'Fields on this form'} className="card max-h-[50vh] overflow-y-auto p-3 lg:max-h-none">
          {canEdit ? (
            <TagPalette picked={tool} onPick={setTool} placed={placed} />
          ) : (
            <FieldList fields={fields} selected={selected} onSelect={(id) => select(id, true)} pageCount={pages.length} />
          )}
        </aside>

        <section aria-label="The form" className="card flex h-[75vh] min-h-0 flex-col overflow-hidden lg:h-auto">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-3 py-2">
            <div role="group" aria-label="Zoom" className="flex rounded-lg border border-line bg-card p-0.5">
              {ZOOMS.map(([z, label]) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={zoom === z}
                  onClick={() => zoomTo(z)}
                  className={`min-h-8 rounded-md px-2.5 text-sm ${zoom === z ? 'bg-accent-soft font-semibold text-accent' : 'text-ink hover:bg-canvas'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={samples} onChange={(e) => setSamples(e.target.checked)} className="size-4 accent-accent" />
              Show samples
            </label>
            {(said || hint) && (
              <p role="status" className={`text-xs ${said ? 'text-danger' : 'text-muted'}`}>
                {said ?? hint}
              </p>
            )}
          </div>
          <div
            ref={setScroller}
            tabIndex={-1}
            onKeyDown={onPagesKey}
            onFocus={(e) => {
              // a field reached with Tab is selected, as a click selects it
              const id = e.target instanceof HTMLElement && e.target.dataset.field;
              if (id && id !== selected) {
                setSelected(id);
                setBox(null);
              }
            }}
            className="min-h-0 flex-1 overflow-auto bg-canvas outline-none"
          >
            {(zoom !== 'fit' || areaWidth > 0) && (
              <PdfPages src={versionPreviewHref(version.id)} pages={pages} scale={scale} root={scroller} onOpened={setOpened}>
                {(n, size) => (
                  <div
                    className={`absolute inset-0 select-none ${canEdit ? 'touch-none' : ''} ${tool && canEdit ? 'cursor-crosshair' : ''}`}
                    onPointerDown={(e) => down(e, n, size)}
                    onPointerMove={move}
                    onPointerUp={up}
                    onPointerCancel={cancel}
                  >
                    {byPage.get(n)?.map((f) => (
                      <FieldBox
                        key={f.id}
                        field={f}
                        scale={scale}
                        selected={f.id === selected}
                        box={f.id === selected ? box : null}
                        samples={samples}
                        language={version.language}
                        slotKey={slotKey}
                        editable={canEdit}
                      />
                    ))}
                    {ghost?.page === n && (
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute border-2 border-dashed border-accent bg-accent/10"
                        style={{ left: ghost.x * scale, top: ghost.y * scale, width: ghost.width * scale, height: ghost.height * scale }}
                      />
                    )}
                  </div>
                )}
              </PdfPages>
            )}
          </div>
        </section>

        <aside aria-labelledby="field-properties" className="card max-h-[70vh] overflow-y-auto p-4 lg:max-h-none">
          <h2 id="field-properties" className="mb-3 font-semibold">
            Field Properties
          </h2>
          {current ? (
            <FieldProperties
              key={current.id}
              field={current}
              language={version.language}
              slotKey={slotKey}
              editable={canEdit}
              pages={pages}
              box={box}
              onChange={update}
              onDuplicate={() => duplicate(current)}
              onDelete={() => remove(current.id)}
            />
          ) : (
            <Help editable={canEdit} fields={fields.length} pages={pages.length} />
          )}
        </aside>
      </div>
    </div>
  );
}
