'use client';

import { useId, useState } from 'react';
import type { PdfField } from '@trendlix/shared';
import { titleCase } from '@/lib/format';
import { matchesTag } from '../../../../tag-check';
import { fieldLabel, isOptional, TAGS_BY_GROUP, type PaletteItem } from './samples';

// The left of Place Fields. To place fields (HR, Admin): every tag, searched by its name or its English or Arabic label
// and listed by group, then Check mark and Fixed text; one is picked, then placed on the form with a click or a drag.
// Read-only: the fields on the form, to find one.

const ITEM = 'flex w-full flex-col items-start gap-0.5 rounded-lg border px-2.5 py-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent';
const ITEM_IDLE = 'border-transparent hover:bg-canvas';
const ITEM_PICKED = 'border-accent bg-accent-soft';

const same = (a: PaletteItem | null, b: PaletteItem) => !!a && a.kind === b.kind && (a.kind !== 'tag' || (b.kind === 'tag' && a.tag === b.tag));

/** `picked`: what is about to be placed; `placed`: how many fields print each tag. */
export function TagPalette({ picked, onPick, placed }: { picked: PaletteItem | null; onPick: (item: PaletteItem | null) => void; placed: ReadonlyMap<string, number> }) {
  const [query, setQuery] = useState('');
  const searchId = useId();
  const groups = TAGS_BY_GROUP.map((g) => ({ ...g, tags: g.tags.filter((t) => matchesTag(t, query)) })).filter((g) => g.tags.length > 0);
  const pick = (item: PaletteItem) => onPick(same(picked, item) ? null : item);

  return (
    <div className="space-y-3">
      <div>
        <h2 className="font-semibold">Add a Field</h2>
        <p className="mt-0.5 text-xs text-muted">Pick one, then click on the form where it goes, or drag to draw its box.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            [{ kind: 'check' }, 'Check mark', '✓ in a box'],
            [{ kind: 'fixed' }, 'Fixed text', 'The same on every form'],
          ] as const
        ).map(([item, label, hint]) => (
          <button key={label} type="button" aria-pressed={same(picked, item)} onClick={() => pick(item)} className={`${ITEM} border-line ${same(picked, item) ? ITEM_PICKED : 'hover:bg-canvas'}`}>
            <span className="font-medium">{label}</span>
            <span className="text-xs text-muted">{hint}</span>
          </button>
        ))}
      </div>
      <div>
        <label htmlFor={searchId} className="sr-only">
          Search tags
        </label>
        <input id={searchId} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tags" className="input min-h-9 py-1" />
      </div>
      {groups.length === 0 && <p className="text-sm text-muted">No tag matches.</p>}
      {groups.map((g) => (
        <section key={g.group} aria-label={titleCase(g.label)}>
          <h3 className="sticky top-0 z-10 bg-card py-1 text-xs font-semibold tracking-wide text-muted uppercase">{titleCase(g.label)}</h3>
          <ul className="space-y-0.5">
            {g.tags.map((t) => {
              const item: PaletteItem = { kind: 'tag', tag: t.tag };
              const count = placed.get(t.tag) ?? 0;
              return (
                <li key={t.tag}>
                  <button type="button" aria-pressed={same(picked, item)} onClick={() => pick(item)} className={`${ITEM} ${same(picked, item) ? ITEM_PICKED : ITEM_IDLE}`}>
                    <span className="flex w-full items-baseline justify-between gap-2">
                      <span className="font-medium">{t.labelEn}</span>
                      {count > 0 && <span className="shrink-0 text-xs font-semibold text-ok">{count === 1 ? 'Placed' : `Placed ×${count}`}</span>}
                    </span>
                    <span className="flex w-full items-baseline justify-between gap-2">
                      <code dir="ltr" className="min-w-0 truncate font-mono text-[11px] text-muted">
                        {t.tag}
                      </code>
                      <span lang="ar" dir="rtl" className="shrink-0 text-xs">
                        {t.labelAr}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The fields on the form, page by page, to select one (read-only). */
export function FieldList({ fields, selected, onSelect, pageCount }: { fields: readonly PdfField[]; selected: string | null; onSelect: (id: string) => void; pageCount: number }) {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="font-semibold">Fields on This Form</h2>
        <p className="mt-0.5 text-xs text-muted">{fields.length ? 'Select one to see its settings.' : 'No fields are placed yet.'}</p>
      </div>
      {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => {
        const on = fields.filter((f) => f.page === page);
        if (!on.length) return null;
        return (
          <section key={page} aria-label={`Page ${page}`}>
            {pageCount > 1 && <h3 className="py-1 text-xs font-semibold tracking-wide text-muted uppercase">Page {page}</h3>}
            <ul className="space-y-0.5">
              {on.map((f) => (
                <li key={f.id}>
                  <button type="button" aria-pressed={f.id === selected} onClick={() => onSelect(f.id)} className={`${ITEM} ${f.id === selected ? ITEM_PICKED : ITEM_IDLE}`}>
                    <span className="font-medium">{fieldLabel(f)}</span>
                    {f.tag && (
                      <code dir="ltr" className="font-mono text-[11px] text-muted">
                        {f.tag}
                      </code>
                    )}
                    {isOptional(f) && <span className="text-[11px] text-muted">Optional: left blank when there’s no value</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
