'use client';

import { memo } from 'react';
import { pdfFieldBoxes, type PdfField, type PdfFieldKind, type TemplateLanguage } from '@trendlix/shared';
import { GRIPS, type Grip } from './place';
import { boxSamples, fieldLabel, isOptional, sampleText } from './samples';

// One field drawn over its page on Place Fields: an outlined, lightly filled rectangle (each box of a boxes field as the
// filled PDF prints into it, pdfFieldBoxes), with sample content inside so its place can be judged by eye, and, once
// selected, the handles it is resized by. An optional field (left blank when its tag has no value) is outlined with
// dashes: a text field's outline, a boxes field's boxes. The pointer and the keys are the editor's (field-editor.tsx): this only says
// which field (data-field), handle (data-grip) or box was pressed.

const KIND_STYLE: Record<PdfFieldKind, string> = {
  text: 'border-accent bg-accent/10',
  boxes: 'border-dashed border-ok/60 bg-transparent',
  check: 'border-warn bg-warn/10',
  fixed: 'border-muted bg-muted/10',
};

const GRIP_STYLE: Record<Grip, string> = {
  nw: 'left-0 top-0 cursor-nwse-resize',
  n: 'left-1/2 top-0 cursor-ns-resize',
  ne: 'left-full top-0 cursor-nesw-resize',
  e: 'left-full top-1/2 cursor-ew-resize',
  se: 'left-full top-full cursor-nwse-resize',
  s: 'left-1/2 top-full cursor-ns-resize',
  sw: 'left-0 top-full cursor-nesw-resize',
  w: 'left-0 top-1/2 cursor-ew-resize',
};

const JUSTIFY = { right: 'justify-end', center: 'justify-center', left: 'justify-start' } as const;

/** Whether a text or boxes field still needs its tag (drawn in red until it has one). */
export const needsTag = (field: Pick<PdfField, 'kind' | 'tag'>) => (field.kind === 'text' || field.kind === 'boxes') && !field.tag;

/**
 * `scale`: screen pixels a point; `box`: the box of a selected boxes field that the arrow keys move alone; `samples`:
 * show what would print; `editable`: the handles are shown once selected.
 */
export const FieldBox = memo(function FieldBox({
  field,
  scale,
  selected,
  box,
  samples,
  language,
  editable,
}: {
  field: PdfField;
  scale: number;
  selected: boolean;
  box: number | null;
  samples: boolean;
  language: TemplateLanguage;
  editable: boolean;
}) {
  const optional = isOptional(field);
  const width = field.width * scale;
  const height = field.height * scale;
  const font = { fontSize: field.fontSize * scale, fontWeight: field.bold ? 700 : 400, lineHeight: 1 };
  const text = samples && field.kind !== 'boxes' ? sampleText(field, language) : '';
  const arabic = field.kind === 'text' && language !== 'en';
  const align = field.kind === 'check' ? 'center' : (field.align ?? 'right');
  // the edge handles would cover a small field (a check box, a line of text): its corners are enough, small and centred
  // on the corner, so a thin field stays easy to grab in the middle
  const grips = editable && selected ? GRIPS.filter((g) => g.length === 2 || (width > 32 && height > 24)) : [];
  return (
    <div
      data-field={field.id}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${fieldLabel(field)}${optional ? ', optional' : ''}, page ${field.page}`}
      className={`absolute box-border border outline-accent ${needsTag(field) ? 'border-danger bg-danger/10' : KIND_STYLE[field.kind]} ${
        optional && field.kind === 'text' ? 'border-dashed' : ''
      } ${
        selected ? 'z-10 outline-2 outline-offset-2' : 'hover:outline hover:outline-offset-1'
      } ${editable ? 'cursor-move' : 'cursor-pointer'} focus-visible:outline-2 focus-visible:outline-offset-2`}
      style={{ left: field.x * scale, top: field.y * scale, width, height }}
    >
      {field.kind === 'boxes' ? (
        <BoxesInside field={field} scale={scale} samples={samples} box={box} font={font} dashed={optional} />
      ) : (
        text && (
          <span className={`pointer-events-none absolute inset-0 flex items-center overflow-hidden px-[1px] whitespace-nowrap text-ink ${JUSTIFY[align]}`} style={font}>
            <span lang={arabic ? 'ar' : undefined} dir={arabic ? 'rtl' : 'auto'}>
              {text}
            </span>
          </span>
        )
      )}
      {grips.map((g) => (
        <i
          key={g}
          data-grip={g}
          aria-hidden="true"
          className={`absolute -m-1 size-2 border border-accent bg-white ${GRIP_STYLE[g]}`}
        />
      ))}
    </div>
  );
});

/** The boxes of a boxes field, where the filled PDF prints into them, each with its sample character; `dashed` when optional. */
function BoxesInside({
  field,
  scale,
  samples,
  box,
  font,
  dashed,
}: {
  field: PdfField;
  scale: number;
  samples: boolean;
  box: number | null;
  font: React.CSSProperties;
  dashed: boolean;
}) {
  const rects = pdfFieldBoxes(field);
  const chars = samples ? boxSamples(field) : [];
  return rects.map((r, i) => (
    <span
      key={i}
      data-box={i}
      className={`pointer-events-none absolute box-border flex items-center justify-center border text-ink tabular-nums ${
        box === i ? 'z-10 border-2 border-warn bg-warn/20' : 'border-ok bg-ok/10'
      } ${dashed ? 'border-dashed' : ''}`}
      style={{ left: (r.x - field.x) * scale, top: (r.y - field.y) * scale, width: r.width * scale, height: r.height * scale, ...font }}
    >
      {chars[i]}
    </span>
  ));
}
