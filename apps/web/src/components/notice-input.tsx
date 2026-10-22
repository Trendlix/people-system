'use client';

import { useState } from 'react';
import { NOTICE_PERIOD_UNIT_LABELS, NOTICE_PERIOD_UNITS } from '@trendlix/shared';
import { Select } from '@/components/select';
import { wholeTyped } from '@/lib/number-typing';

// A notice period (owner, 22 October 2026, on the careers form: "Motice period Field in Days" … "and a selectoor to make
// it months, and the field accept only numbers"): a whole number beside Days (first) or Months, on one row. The form
// sends them as `noticeNumber` and `noticeUnit`; the server action makes them the period as kept, "30 days" or
// "2 months" (noticeOf in @trendlix/shared). On the careers page (`variant="careers"`) each has its own line under it.

/** The two fields' row: the system's forms', and the careers page's (further apart). */
const ROW = {
  system: 'grid grid-cols-[minmax(0,1fr)_minmax(7rem,40%)] gap-2',
  careers: 'grid grid-cols-[minmax(0,1fr)_minmax(7rem,40%)] gap-x-5',
} as const;

/** `id` goes on the number box, for the field's label, and so do `aria-invalid` and `aria-describedby`. */
export function NoticeInput({
  id,
  defaultNumber,
  defaultUnit,
  variant = 'system',
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
}: {
  id: string;
  /** What was typed before a refused send. */
  defaultNumber?: string;
  defaultUnit?: string;
  variant?: keyof typeof ROW;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}) {
  const [n, setN] = useState(() => wholeTyped(defaultNumber ?? ''));
  return (
    <div className={ROW[variant]}>
      <input
        id={id}
        name="noticeNumber"
        inputMode="numeric"
        autoComplete="off"
        maxLength={3}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        value={n}
        onChange={(e) => setN(wholeTyped(e.target.value))}
        className="input tabular-nums"
      />
      <Select aria-label="Notice period: days or months" name="noticeUnit" defaultValue={defaultUnit === 'months' ? 'months' : 'days'} className="input">
        {NOTICE_PERIOD_UNITS.map((u) => (
          <option key={u} value={u}>
            {NOTICE_PERIOD_UNIT_LABELS[u]}
          </option>
        ))}
      </Select>
    </div>
  );
}
