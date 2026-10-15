'use client';

import { startTransition, useActionState, useEffect, useId, useRef, useState } from 'react';
import type { TemplateLanguage } from '@trendlix/shared';
import { FormErrors, useFieldIds } from '@/components/form';
import { titleCase } from '@/lib/format';
import type { FormState, MapFieldsRequest, TemplateLine } from '@/lib/types';
import { FieldPicker } from './field-picker';
import {
  addAt,
  addEdit,
  afterLabel,
  allSuggestions,
  braces,
  buildRequest,
  changeTag,
  clashWith,
  countEdits,
  describeEdit,
  fillBlank,
  fromSuggestion,
  hasFields,
  knownTag,
  lineDirection,
  lineName,
  lineSegments,
  lineWords,
  MAX_EDITS,
  NOTE_MAX,
  offsetAfter,
  openSuggestionCount,
  openSuggestions,
  removeTag,
  saveProblem,
  summaryText,
  undoEdit,
  type Built,
  type PendingEdit,
  type Segment,
} from './mapping';
import { closestTag, count } from './tag-check';

// Map Fields (owner's request, 15 October 2026: "I want a manual mapping fix"): a version's lines in order, each with
// its tags (click: change or remove), its blanks (click: put a field there) and the fields the API suggests (Add or
// Dismiss), and "Add a field" (at the end of the line, in a blank, or after a word). Changes are shown in place and
// listed beside the lines, each with Undo; nothing is saved until "Save as a new draft", which sends them all (the API
// makes a new draft from them; the uploaded file never changes) and goes back to the template's page, at the new draft's
// check. A refusal shows the API's messages beside the list, and the changes stay.

type Panel = { line: string; kind: 'add' } | { line: string; kind: 'tag'; index: number } | { line: string; kind: 'blank'; index: number };
type Action = (prev: FormState, request: MapFieldsRequest) => Promise<FormState>;
/** Makes a change with the key it is given; the mapper adds it to the pending ones, or says why it can't. */
type Apply = (make: (key: string) => Built) => string | null;

/**
 * Element ids of the page's controls, to give focus back to what opened a panel. Lines are known by their position on
 * the page here: their ids ("word/document.xml#12") aren't fit for an element's id or an address's #anchor.
 */
interface Ids {
  line: (line: string) => string;
  add: (line: string) => string;
  tag: (line: string, index: number) => string;
  blank: (line: string, index: number) => string;
  panel: (line: string) => string;
}

const CHIP = 'rounded-md border px-1 py-px font-mono text-[0.8em]';

// each pending change's key (for React's lists and Undo): unique on the page, and never needed to render anything
let made = 0;
const newKey = () => `e${++made}`;

export function FieldMapper({ lines, language, version, action }: { lines: TemplateLine[]; language: TemplateLanguage; version: number; action: Action }) {
  const base = useId();
  const [edits, setEdits] = useState<PendingEdit[]>([]);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const [panel, setPanel] = useState<Panel | null>(null);
  const [onlyFields, setOnlyFields] = useState(false);
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState('');
  const [state, dispatch, saving] = useActionState(action, {});
  const opener = useRef('');

  // each line's position on the page, from 1
  const positions = new Map(lines.map((l, i) => [l.id, i + 1]));
  const at = (line: string) => positions.get(line) ?? 0;
  const ids: Ids = {
    line: (line) => `line-${at(line)}`,
    add: (line) => `${base}add-${at(line)}`,
    tag: (line, index) => `${base}tag-${at(line)}-${index}`,
    blank: (line, index) => `${base}blank-${at(line)}-${index}`,
    panel: (line) => `${base}panel-${at(line)}`,
  };

  // leaving the page (closing the tab, reloading) asks first while there are changes not saved
  const unsaved = edits.length > 0;
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  const counts = countEdits(edits);
  const suggested = openSuggestionCount(lines, edits, dismissed);
  const touched = new Set(edits.map((e) => e.line));
  const shown = onlyFields ? lines.filter((l) => hasFields(l) || touched.has(l.id) || panel?.line === l.id) : lines;
  // the shown lines in runs of one part (body, header, footer), each run under the part's name when there are several
  const runs: { part: string; label: string; lines: TemplateLine[] }[] = [];
  for (const line of shown) {
    const last = runs[runs.length - 1];
    if (last && last.part === line.part) last.lines.push(line);
    else runs.push({ part: line.part, label: line.partLabel, lines: [line] });
  }
  // the parts' names in the lines' names only when there are several, as with the headings
  const parts = new Set(lines.map((l) => l.part)).size > 1;
  const tagTotal = lines.reduce((n, l) => n + l.tags.length, 0);
  const blankTotal = lines.reduce((n, l) => n + l.blanks.length, 0);
  const inOrder = [...edits].sort((a, b) => at(a.line) - at(b.line) || a.from - b.from || a.to - b.to);
  const blocked = edits.length ? saveProblem(edits, note) : null;

  function openPanel(next: Panel, from: string) {
    const same = panel && panel.line === next.line && panel.kind === next.kind && ('index' in panel ? panel.index : -1) === ('index' in next ? next.index : -1);
    if (same) return closePanel();
    opener.current = from;
    setPanel(next);
  }

  function closePanel() {
    const line = panel?.line;
    const back = opener.current;
    setPanel(null);
    // back to what opened it, or to the line's "Add a field" when that is gone (a tag changed or removed)
    requestAnimationFrame(() => (document.getElementById(back) ?? (line ? document.getElementById(ids.add(line)) : null))?.focus());
  }

  const apply: Apply = (make) => {
    const built = make(newKey());
    if ('error' in built) return built.error;
    const next = addEdit(edits, built.edit);
    if ('error' in next) return next.error;
    setEdits(next.edits);
    setNotice('');
    return null;
  };

  function addSuggestion(line: TemplateLine, index: number) {
    const error = apply((key) => fromSuggestion(line, index, key));
    if (error) setNotice(error);
  }

  function addAllSuggestions() {
    const r = allSuggestions(lines, edits, dismissed, newKey);
    setEdits(r.edits);
    const left = r.skipped ? `; ${r.skipped} left out, as another field goes in the same place` : '';
    setNotice(`${count(r.added, 'suggested field')} added${left}. Each one can be undone in the list of changes.`);
  }

  function undo(key: string) {
    setEdits(undoEdit(edits, key));
  }

  function undoAll() {
    if (window.confirm(`Undo all ${count(edits.length, 'change')}?`)) setEdits([]);
  }

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!edits.length || blocked) return;
    const request = buildRequest(edits, lines, note);
    startTransition(() => dispatch(request));
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-4">
        <div className="card flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3">
          <div className="space-y-2">
            <p className="text-sm text-muted">
              {count(lines.length, 'line')} · {count(tagTotal, 'tag')} · {count(blankTotal, 'blank')}
            </p>
            <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={onlyFields} onChange={(e) => setOnlyFields(e.target.checked)} className="size-4 accent-accent" />
              Show only lines with tags, blanks or suggestions
            </label>
          </div>
          {suggested > 0 && (
            <button type="button" onClick={addAllSuggestions} className="btn btn-secondary">
              Add all suggestions ({suggested})
            </button>
          )}
          {notice && (
            <p role="status" className="w-full text-sm text-ok">
              {notice}
            </p>
          )}
        </div>

        {runs.length === 0 ? (
          <div className="card px-6 py-10 text-center text-sm text-muted">
            {lines.length ? 'No line has a tag, a blank or a suggestion. Untick the box above to see every line, then use Add a field.' : 'No text was found in this file.'}
          </div>
        ) : (
          runs.map((run, i) => (
            <div key={`${run.part}-${i}`} className="card overflow-hidden">
              {parts && <h2 className="border-b border-line bg-canvas px-4 py-2 text-xs font-semibold tracking-wide text-muted uppercase">{titleCase(run.label)}</h2>}
              <ol className="divide-y divide-line-soft">
                {run.lines.map((line) => (
                  <LineRow
                    key={line.id}
                    line={line}
                    name={lineName(line, parts)}
                    dir={lineDirection(line.text, language)}
                    edits={edits}
                    dismissed={dismissed}
                    panel={panel?.line === line.id ? panel : null}
                    ids={ids}
                    onOpen={openPanel}
                    onClose={closePanel}
                    onApply={apply}
                    onUndo={undo}
                    onSuggestion={(index) => addSuggestion(line, index)}
                    onDismiss={(key) => setDismissed(new Set(dismissed).add(key))}
                  />
                ))}
              </ol>
            </div>
          ))
        )}
      </div>

      <aside aria-labelledby={`${base}changes`} className="card space-y-4 p-5 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
        <div>
          <h2 id={`${base}changes`} className="font-semibold">
            Changes
          </h2>
          <p role="status" className="mt-0.5 text-sm text-muted">
            {summaryText(counts)}
          </p>
        </div>
        {inOrder.length > 0 && (
          <ol className="divide-y divide-line-soft border-y border-line-soft">
            {inOrder.map((e) => {
              const line = lines[at(e.line) - 1];
              const name = line ? lineName(line, parts) : 'A line';
              return (
                <li key={e.key} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <a href={`#${ids.line(e.line)}`} className="text-xs text-muted">
                      {name}
                    </a>
                    <p className="font-mono text-xs wrap-anywhere">{describeEdit(e)}</p>
                    {e.kind === 'add' && (
                      <p dir="auto" className="text-xs text-muted wrap-anywhere">
                        {afterLabel(line?.text ?? '', e.from)}
                      </p>
                    )}
                  </div>
                  <button type="button" onClick={() => undo(e.key)} className="inline-flex min-h-8 shrink-0 items-center text-sm font-semibold text-accent hover:underline">
                    Undo<span className="sr-only">: {name}, {describeEdit(e)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        <form onSubmit={save} className="space-y-3">
          <FormErrors errors={blocked ? [blocked] : state.errors} />
          <div>
            <label htmlFor={`${base}note`} className="label">
              What changed <span className="font-normal text-muted">(optional)</span>
            </label>
            <textarea
              id={`${base}note`}
              rows={2}
              maxLength={NOTE_MAX}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-describedby={`${base}note-hint`}
              className="input"
            />
            <p id={`${base}note-hint`} className="hint">
              Shown in the list of versions. Left empty, it says the fields were mapped from v{version}.
            </p>
          </div>
          <button type="submit" disabled={!edits.length || !!blocked || saving} aria-describedby={`${base}save-hint`} className="btn btn-primary w-full">
            {saving ? 'Saving…' : 'Save as a new draft'}
          </button>
          <p id={`${base}save-hint`} className="hint">
            Makes a new draft with these changes; v{version} stays as it is. Check the new draft on the template&apos;s page, then publish it. Up to {MAX_EDITS}{' '}
            changes at once.
          </p>
          {edits.length > 1 && (
            <button type="button" onClick={undoAll} disabled={saving} className="inline-flex min-h-9 items-center text-sm font-semibold text-danger hover:underline">
              Undo all changes
            </button>
          )}
        </form>
      </aside>
    </div>
  );
}

// ---------- one line ----------

function LineRow({
  line,
  name,
  dir,
  edits,
  dismissed,
  panel,
  ids,
  onOpen,
  onClose,
  onApply,
  onUndo,
  onSuggestion,
  onDismiss,
}: {
  line: TemplateLine;
  /** "Line 13", or "Line 13 of the body" when the file has several parts. */
  name: string;
  dir: 'rtl' | 'ltr';
  edits: PendingEdit[];
  dismissed: ReadonlySet<string>;
  /** This line's open panel, if any. */
  panel: Panel | null;
  ids: Ids;
  onOpen: (panel: Panel, from: string) => void;
  onClose: () => void;
  onApply: Apply;
  onUndo: (key: string) => void;
  onSuggestion: (index: number) => void;
  onDismiss: (key: string) => void;
}) {
  const segments = lineSegments(line, edits);
  const suggestions = openSuggestions(line, edits, dismissed);
  const panelId = ids.panel(line.id);
  const isOpen = (kind: Panel['kind'], index = -1) => panel?.kind === kind && ('index' in panel ? panel.index : -1) === index;

  return (
    <li id={ids.line(line.id)} className="scroll-mt-4">
      <div className="flex items-start gap-3 px-4 py-2">
        <span aria-hidden="true" className="w-7 shrink-0 pt-1 text-right text-xs text-muted tabular-nums">
          {line.index + 1}
        </span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <p dir={dir} lang={dir === 'rtl' ? 'ar' : undefined} className="text-sm leading-7 whitespace-pre-wrap wrap-anywhere">
            <span className="sr-only">{name}: </span>
            {segments.length === 0 && <span className="text-xs text-muted italic">Empty line</span>}
            {segments.map((s) => (
              <SegmentView key={`${s.kind}-${s.from}-${s.to}`} segment={s} line={line} ids={ids} panelId={panelId} isOpen={isOpen} onOpen={onOpen} onUndo={onUndo} />
            ))}
          </p>
          {suggestions.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label={`Suggested fields for ${name.toLowerCase()}`}>
              {suggestions.map((s) => {
                const where = s.from === s.to ? afterLabel(line.text, s.from) : 'in the blank';
                return (
                  <li key={s.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-dashed border-accent/40 bg-accent-soft/50 px-2.5 py-1 text-xs">
                    <span className="wrap-anywhere">
                      Suggested: <code className="font-mono text-accent">{braces(s.tag)}</code> · {s.label || knownTag(s.tag)?.labelEn}{' '}
                      <span className="text-muted">({where})</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <button type="button" onClick={() => onSuggestion(s.index)} className="inline-flex min-h-7 items-center font-semibold text-accent hover:underline">
                        Add<span className="sr-only"> {braces(s.tag)} to {name.toLowerCase()}</span>
                      </button>
                      <button type="button" onClick={() => onDismiss(s.key)} className="inline-flex min-h-7 items-center font-semibold text-muted hover:underline">
                        Dismiss<span className="sr-only"> the suggestion {braces(s.tag)} for {name.toLowerCase()}</span>
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <button
          id={ids.add(line.id)}
          type="button"
          onClick={() => onOpen({ line: line.id, kind: 'add' }, ids.add(line.id))}
          aria-expanded={isOpen('add')}
          aria-controls={isOpen('add') ? panelId : undefined}
          className="inline-flex min-h-8 shrink-0 items-center rounded-md px-2 text-sm font-semibold whitespace-nowrap text-accent hover:bg-accent-soft"
        >
          Add a field<span className="sr-only"> to {name.toLowerCase()}</span>
        </button>
      </div>
      {panel && (
        <div
          id={panelId}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              onClose();
            }
          }}
          className="border-t border-line-soft bg-canvas/70 px-4 py-4 sm:pl-14"
        >
          {panel.kind === 'add' && <AddPanel line={line} name={name} edits={edits} onApply={onApply} onClose={onClose} />}
          {panel.kind === 'tag' && <TagPanel line={line} index={panel.index} onApply={onApply} onClose={onClose} />}
          {panel.kind === 'blank' && <BlankPanel line={line} index={panel.index} onApply={onApply} onClose={onClose} />}
        </div>
      )}
    </li>
  );
}

/** A piece of a line: text; a tag or blank (a button opening its panel); or a pending change, with Undo. */
function SegmentView({
  segment: s,
  line,
  ids,
  panelId,
  isOpen,
  onOpen,
  onUndo,
}: {
  segment: Segment;
  line: TemplateLine;
  ids: Ids;
  panelId: string;
  isOpen: (kind: Panel['kind'], index?: number) => boolean;
  onOpen: (panel: Panel, from: string) => void;
  onUndo: (key: string) => void;
}) {
  if (s.kind === 'text') return <>{s.text}</>;

  if (s.kind === 'tag') {
    const open = isOpen('tag', s.index);
    const label = knownTag(s.tag)?.labelEn;
    return (
      <button
        id={ids.tag(line.id, s.index)}
        type="button"
        dir="ltr"
        title={label ?? 'Not in the tag list'}
        onClick={() => onOpen({ line: line.id, kind: 'tag', index: s.index }, ids.tag(line.id, s.index))}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className={`${CHIP} mx-px inline cursor-pointer break-all ${
          s.known ? 'border-line bg-canvas text-ink hover:border-accent hover:text-accent' : 'border-warn/40 bg-warn-soft text-warn hover:border-warn'
        } ${open ? 'ring-2 ring-accent/40' : ''}`}
      >
        {s.text}
        <span className="sr-only">
          {s.known ? `, ${label ?? 'a known field'}` : ', not in the tag list'}: change or remove
        </span>
      </button>
    );
  }

  if (s.kind === 'blank') {
    const open = isOpen('blank', s.index);
    return (
      <button
        id={ids.blank(line.id, s.index)}
        type="button"
        title="Put a field here"
        onClick={() => onOpen({ line: line.id, kind: 'blank', index: s.index }, ids.blank(line.id, s.index))}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className={`inline cursor-pointer rounded-sm break-all text-muted underline decoration-muted/70 decoration-dotted decoration-2 underline-offset-4 hover:bg-accent-soft hover:text-accent ${
          open ? 'bg-accent-soft text-accent' : ''
        }`}
      >
        {s.text}
        <span className="sr-only"> (a blank): put a field here</span>
      </button>
    );
  }

  // a pending change
  const e = s.edit;
  const lead = e.text.startsWith(' ') ? ' ' : '';
  const trail = e.text.length > 1 && e.text.endsWith(' ') ? ' ' : '';
  const undoButton = (
    <button
      type="button"
      onClick={() => onUndo(e.key)}
      title="Undo"
      className="mx-0.5 inline-flex size-5 items-center justify-center rounded align-middle text-xs text-muted hover:bg-line hover:text-ink"
    >
      <span aria-hidden="true">×</span>
      <span className="sr-only">Undo: {describeEdit(e)}</span>
    </button>
  );
  return (
    <>
      {(e.kind === 'change' || e.kind === 'remove') && (
        <del dir="ltr" className={`${CHIP} mx-px border-danger/30 bg-danger-soft/60 text-danger line-through`}>
          <span className="sr-only">Removed: </span>
          {e.replaced}
        </del>
      )}
      {e.kind === 'fill' && (
        <del className="text-muted line-through">
          <span className="sr-only">Blank replaced: </span>
          {e.replaced}
        </del>
      )}
      {e.tag && (
        <>
          {lead}
          <ins dir="ltr" className={`${CHIP} mx-px border-ok/40 bg-ok-soft text-ok no-underline`}>
            <span className="sr-only">Added: </span>
            {braces(e.tag)}
          </ins>
          {trail}
        </>
      )}
      {undoButton}
    </>
  );
}

// ---------- the panels ----------

function PanelButtons({ submit, onClose, children }: { submit: string; onClose: () => void; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="submit" className="btn btn-primary">
        {submit}
      </button>
      {children}
      <button type="button" onClick={onClose} className="btn btn-secondary">
        Cancel
      </button>
    </div>
  );
}

function PanelError({ error }: { error: string }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {error}
    </p>
  );
}

type Where = 'end' | 'blank' | 'after';

/** "Add a field": the field, and where it goes: at the end of the line, in place of a blank, or after a word or a typed text. */
function AddPanel({ line, name, edits, onApply, onClose }: { line: TemplateLine; name: string; edits: PendingEdit[]; onApply: Apply; onClose: () => void }) {
  const fid = useFieldIds();
  // blanks with a change already (filled, or a suggestion put in) aren't offered
  const blanks = line.blanks.map((b, index) => ({ ...b, index })).filter((b) => !clashWith({ line: line.id, from: b.from, to: b.to }, edits));
  const words = lineWords(line);
  const [tag, setTag] = useState<string | null>(null);
  const [where, setWhere] = useState<Where>(blanks.length ? 'blank' : 'end');
  const [blank, setBlank] = useState(blanks[0]?.index ?? 0);
  const [word, setWord] = useState('');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!tag) return setError('Choose a field.');
    let make: (key: string) => Built;
    if (where === 'blank') {
      make = (key) => fillBlank(line, blank, tag, key);
    } else if (where === 'after') {
      let offset: number;
      if (typed.trim()) {
        const found = offsetAfter(line, typed);
        if ('error' in found) return setError(found.error);
        offset = found.offset;
      } else if (word) {
        offset = Number(word);
      } else {
        return setError('Choose the word the field goes after, or type it.');
      }
      make = (key) => addAt(line, offset, tag, key);
    } else {
      make = (key) => addAt(line, line.text.length, tag, key);
    }
    const refused = onApply(make);
    if (refused) setError(refused);
    else onClose();
  }

  const options: { value: Where; label: string }[] = [
    { value: 'end', label: line.text.trim() ? 'At the end of the line' : 'In this empty line' },
    ...(blanks.length ? [{ value: 'blank' as const, label: blanks.length === 1 ? 'In place of the blank' : 'In place of a blank' }] : []),
    ...(words.length ? [{ value: 'after' as const, label: 'After a word or text' }] : []),
  ];

  return (
    <form onSubmit={submit} className="space-y-4" aria-labelledby={fid('title')}>
      <h3 id={fid('title')} className="text-sm font-semibold">
        Add a Field to {titleCase(name)}
      </h3>
      <FieldPicker value={tag} onChange={setTag} autoFocus />
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <fieldset className="sm:col-span-2">
          <legend className="label">Where it goes</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            {options.map((o) => (
              <label key={o.value} className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
                <input type="radio" name={fid('where')} value={o.value} checked={where === o.value} onChange={() => setWhere(o.value)} className="size-4 accent-accent" />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>
        {where === 'blank' && blanks.length > 1 && (
          <div>
            <label htmlFor={fid('blank')} className="label">
              Blank
            </label>
            <select id={fid('blank')} value={blank} onChange={(e) => setBlank(Number(e.target.value))} className="input">
              {blanks.map((b, i) => (
                <option key={b.index} value={b.index}>
                  Blank {i + 1} ({afterLabel(line.text, b.from)})
                </option>
              ))}
            </select>
          </div>
        )}
        {where === 'after' && (
          <>
            <div>
              <label htmlFor={fid('word')} className="label">
                After the word
              </label>
              <select id={fid('word')} value={word} onChange={(e) => setWord(e.target.value)} className="input" dir="auto">
                <option value="">Choose a word…</option>
                {words.map((w) => (
                  <option key={w.offset} value={w.offset}>
                    {w.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={fid('typed')} className="label">
                Or after this text <span className="font-normal text-muted">(optional)</span>
              </label>
              <input
                id={fid('typed')}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                dir="auto"
                autoComplete="off"
                aria-describedby={fid('typed-hint')}
                className="input"
              />
              <p id={fid('typed-hint')} className="hint">
                A word or phrase as written in the line; the field goes after its first appearance. Used instead of the word chosen.
              </p>
            </div>
          </>
        )}
      </div>
      <PanelError error={error} />
      <PanelButtons submit="Add field" onClose={onClose} />
    </form>
  );
}

/** A tag of the line: change it to another field (an unknown one: to the closest known tag in one click), or remove it. */
function TagPanel({ line, index, onApply, onClose }: { line: TemplateLine; index: number; onApply: Apply; onClose: () => void }) {
  const fid = useFieldIds();
  const found = line.tags[index];
  const entry = found ? knownTag(found.tag) : undefined;
  const closest = found && !entry ? closestTag(found.tag) : null;
  const [tag, setTag] = useState<string | null>(null);
  const [error, setError] = useState('');
  if (!found) return null;

  function done(make: (key: string) => Built) {
    const refused = onApply(make);
    if (refused) setError(refused);
    else onClose();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!tag) return setError('Choose the field to change it to.');
        done((key) => changeTag(line, index, tag, key));
      }}
      className="space-y-4"
      aria-labelledby={fid('title')}
    >
      <div>
        <h3 id={fid('title')} className="text-sm font-semibold">
          Change or Remove <code className="font-mono">{braces(found.tag)}</code>
        </h3>
        {entry ? (
          <p className="mt-0.5 text-sm text-muted">
            {entry.labelEn} ·{' '}
            <span lang="ar" dir="rtl">
              {entry.labelAr}
            </span>
          </p>
        ) : (
          <p className="mt-0.5 text-sm text-warn">Not in the tag list: it stops the version from being published until it is changed or removed.</p>
        )}
      </div>
      {closest && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <span>
            Did you mean <code className="font-mono">{braces(closest)}</code> ({knownTag(closest)?.labelEn})?
          </span>
          <button type="button" onClick={() => done((key) => changeTag(line, index, closest, key))} className="btn btn-secondary">
            Change to {braces(closest)}
          </button>
        </div>
      )}
      <FieldPicker value={tag} onChange={setTag} legend="Change it to" autoFocus />
      <PanelError error={error} />
      <PanelButtons submit="Change" onClose={onClose}>
        <button type="button" onClick={() => done((key) => removeTag(line, index, key))} className="btn btn-danger">
          Remove<span className="sr-only"> {braces(found.tag)}</span>
        </button>
      </PanelButtons>
    </form>
  );
}

/** A blank of the line: put a field in its place. */
function BlankPanel({ line, index, onApply, onClose }: { line: TemplateLine; index: number; onApply: Apply; onClose: () => void }) {
  const fid = useFieldIds();
  const blank = line.blanks[index];
  const [tag, setTag] = useState<string | null>(null);
  const [error, setError] = useState('');
  if (!blank) return null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!tag) return setError('Choose a field.');
        const refused = onApply((key) => fillBlank(line, index, tag, key));
        if (refused) setError(refused);
        else onClose();
      }}
      className="space-y-4"
      aria-labelledby={fid('title')}
    >
      <div>
        <h3 id={fid('title')} className="text-sm font-semibold">
          Put a Field Here
        </h3>
        <p className="mt-0.5 text-sm text-muted wrap-anywhere">
          In place of the blank “{line.text.slice(blank.from, blank.to)}”, {afterLabel(line.text, blank.from)}.
        </p>
      </div>
      <FieldPicker value={tag} onChange={setTag} autoFocus />
      <PanelError error={error} />
      <PanelButtons submit="Put the field here" onClose={onClose} />
    </form>
  );
}
