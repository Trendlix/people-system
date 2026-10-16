'use client';

import { Fragment, useRef, useState } from 'react';
import { Select } from '@/components/select';

// A choice from a standard list, with Other for what the list lacks: used where the same thing must always be written
// the same way, e.g. the university and the faculty. The form sends the value chosen, or the text typed under Other, in
// a hidden field named after the field, so the server actions read it as a plain text field.

export type ListChoice = { value: string; label: string };
/** A labelled part of the list (an <optgroup>), or, with no label, plain options. */
export type ListGroup = { label?: string; choices: readonly ListChoice[] };

const OTHER = '__other__';

/**
 * Where a saved value starts: the choice it is, also when it was written another way (`aliases`, e.g. its Arabic name,
 * or in other capitals), or Other with the text as it was saved, so saving the form never loses it.
 */
function startOf(value: string, groups: readonly ListGroup[], aliases?: ReadonlyMap<string, string>) {
  const v = value.trim();
  if (!v) return { pick: '', text: '' };
  const known = aliases?.get(v) ?? aliases?.get(v.toLowerCase()) ?? v;
  return groups.some((g) => g.choices.some((c) => c.value === known)) ? { pick: known, text: '' } : { pick: OTHER, text: v };
}

export function ListOrOther({
  id,
  name,
  label,
  groups,
  aliases,
  defaultValue,
  max,
  onValue,
  otherPlaceholder = 'As written on the certificate',
  'aria-describedby': describedBy,
}: {
  /** Goes on the list, for the field's label. */
  id: string;
  /** The hidden field the form sends, e.g. university. */
  name: string;
  /** What the field is, e.g. University: names the Other box for screen readers. */
  label: string;
  groups: readonly ListGroup[];
  /** Other ways a value on file may be written, mapped to the choice it is. */
  aliases?: ReadonlyMap<string, string>;
  defaultValue?: string | null;
  max?: number;
  /** Called with the value the form will send, each time it changes. */
  onValue?: (value: string) => void;
  /** The example in the Other box: where the name is copied from. */
  otherPlaceholder?: string;
  'aria-describedby'?: string;
}) {
  const [start] = useState(() => startOf(defaultValue ?? '', groups, aliases));
  const [pick, setPick] = useState(start.pick);
  const [text, setText] = useState(start.text);
  const otherBox = useRef<HTMLInputElement>(null);

  const options = (choices: readonly ListChoice[]) =>
    choices.map((c) => (
      <option key={c.value} value={c.value}>
        {c.label}
      </option>
    ));

  return (
    <div className="space-y-2">
      <Select
        id={id}
        value={pick}
        aria-describedby={describedBy}
        onChange={(e) => {
          setPick(e.target.value);
          onValue?.(e.target.value === OTHER ? text.trim() : e.target.value);
          if (e.target.value === OTHER) requestAnimationFrame(() => otherBox.current?.focus());
        }}
        className="input"
      >
        <option value="">Not set</option>
        {groups.map((g, i) =>
          g.label ? (
            <optgroup key={g.label} label={g.label}>
              {options(g.choices)}
            </optgroup>
          ) : (
            <Fragment key={i}>{options(g.choices)}</Fragment>
          ),
        )}
        <option value={OTHER}>Other (type it)</option>
      </Select>
      {pick === OTHER && (
        <input
          ref={otherBox}
          aria-label={`${label}, not on the list`}
          aria-describedby={describedBy}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onValue?.(e.target.value.trim());
          }}
          maxLength={max}
          placeholder={otherPlaceholder}
          className="input"
        />
      )}
      <input type="hidden" name={name} value={pick === OTHER ? text.trim() : pick} />
    </div>
  );
}
