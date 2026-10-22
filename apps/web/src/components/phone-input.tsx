'use client';

import { useState } from 'react';
import { DIAL } from '@trendlix/shared';
import { Select } from '@/components/select';
import { countryChosen, keptNumber, numberLeft, numberTyped, startParts } from '@/lib/phone-typing';

// A phone number as Prime ERP's forms take one: the country code, chosen from the list (Egypt first), beside the number
// without the 0 in front. The form sends the number as it is kept (+201012345678) in a hidden field named after the
// field, so the server actions read it as before. The typing rules are in lib/phone-typing.ts. The careers page's forms
// use it too (owner, 22 October 2026: "the mobile number format to be like the one applied in the system, country code
// and no extra zero"), as `variant="careers"`: the two fields further apart, each with its own line under it there.

/** Whether the text came in whole (pasted, dropped, picked from a suggestion or filled in by the browser), not a key at a time. */
function atOnce(e: React.ChangeEvent<HTMLInputElement>): boolean {
  const type = (e.nativeEvent as InputEvent).inputType;
  return !type || type.startsWith('insertFrom') || type === 'insertReplacementText';
}

/** The two fields' row: the system's forms', and the careers page's (further apart, its lines under each). */
const ROW = {
  system: 'grid grid-cols-[minmax(7.5rem,42%)_minmax(0,1fr)] gap-2',
  careers: 'grid grid-cols-[minmax(8.5rem,45%)_minmax(0,1fr)] gap-x-5',
} as const;

/**
 * The country code and the number, on one row. It starts with `defaultValue`, a number as it is kept: the saved one, or
 * the one sent before a refused save. `id` goes on the number box, for the field's label, and so do `required`,
 * `aria-invalid` and `aria-describedby`.
 */
export function PhoneInput({
  id,
  name,
  label,
  defaultValue,
  required,
  autoComplete = 'off',
  variant = 'system',
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
}: {
  id: string;
  /** What the number is, e.g. Second mobile: names the country code for screen readers. */
  label: string;
  /** The hidden field the form sends, e.g. mobile. */
  name: string;
  defaultValue?: string | null;
  required?: boolean;
  /** The number box's: off in the system; tel on the careers page, where the browser may fill in the person's own. */
  autoComplete?: string;
  variant?: keyof typeof ROW;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}) {
  const [parts, setParts] = useState(() => startParts(defaultValue));

  return (
    <div className={ROW[variant]}>
      <Select aria-label={`${label}: country code`} value={parts.country} onChange={(e) => setParts(countryChosen(parts, e.target.value))} className="input">
        {DIAL.map(([country, code]) => (
          <option key={country} value={country}>
            {`${country} (+${code})`}
          </option>
        ))}
      </Select>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete={autoComplete}
        required={required}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        value={parts.n}
        onChange={(e) => setParts(numberTyped(parts, e.target.value, atOnce(e)))}
        onBlur={() => setParts(numberLeft(parts))}
        className="input tabular-nums"
      />
      <input type="hidden" name={name} value={keptNumber(parts)} />
    </div>
  );
}
