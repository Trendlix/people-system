'use client';

import { useState } from 'react';
import { DIAL } from '@trendlix/shared';
import { countryChosen, keptNumber, numberLeft, numberTyped, startParts } from '@/lib/phone-typing';

// A phone number as Prime ERP's forms take one: the country code, chosen from the list (Egypt first), beside the number
// without the 0 in front. The form sends the number as it is kept (+201012345678) in a hidden field named after the
// field, so the server actions read it as before. The typing rules are in lib/phone-typing.ts.

/** Whether the text came in whole (pasted, dropped, picked from a suggestion or filled in by the browser), not a key at a time. */
function atOnce(e: React.ChangeEvent<HTMLInputElement>): boolean {
  const type = (e.nativeEvent as InputEvent).inputType;
  return !type || type.startsWith('insertFrom') || type === 'insertReplacementText';
}

/**
 * The country code and the number, on one row. It starts with `defaultValue`, a number as it is kept: the saved one, or
 * the one sent before a refused save. `id` goes on the number box, for the field's label.
 */
export function PhoneInput({
  id,
  name,
  label,
  defaultValue,
  'aria-describedby': describedBy,
}: {
  id: string;
  /** What the number is, e.g. Second mobile: names the country code for screen readers. */
  label: string;
  /** The hidden field the form sends, e.g. mobile. */
  name: string;
  defaultValue?: string | null;
  'aria-describedby'?: string;
}) {
  const [parts, setParts] = useState(() => startParts(defaultValue));

  return (
    <div className="grid grid-cols-[minmax(7.5rem,42%)_minmax(0,1fr)] gap-2">
      <select aria-label={`${label}: country code`} value={parts.country} onChange={(e) => setParts(countryChosen(parts, e.target.value))} className="input">
        {DIAL.map(([country, code]) => (
          <option key={country} value={country}>
            {`${country} (+${code})`}
          </option>
        ))}
      </select>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="off"
        aria-describedby={describedBy}
        value={parts.n}
        onChange={(e) => setParts(numberTyped(parts, e.target.value, atOnce(e)))}
        onBlur={() => setParts(numberLeft(parts))}
        className="input tabular-nums"
      />
      <input type="hidden" name={name} value={keptNumber(parts)} />
    </div>
  );
}
