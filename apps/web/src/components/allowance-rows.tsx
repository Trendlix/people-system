'use client';

import { useState } from 'react';
import { useFieldIds } from '@/components/form';
import { Select } from '@/components/select';
import { treatmentText, type AllowanceRow } from '@/lib/allowances';
import type { AllowanceType } from '@/lib/types';

// Allowance rows for a contract or a job offer (owner's request, 15 October 2026): a kind and its amount a month, one
// row per kind. Each row sends allowanceTypeId and allowanceAmount (read by allowancesFrom in lib/allowances.ts).
// `onChange` gets the rows whenever they change, for working out the net while HR types; a form that tracks its fields
// by name should skip these two names.

const small = 'btn min-h-9 px-3';

// in lib/allowances.ts, where server components can use it too; still exported from here
export { treatmentText };

export function AllowanceRows({
  types,
  defaultRows,
  onChange,
  legend = 'Allowances',
  hint = 'A month each, paid on top of the gross salary.',
}: {
  /** The kinds: the active ones are offered, and any kind already on a row stays shown. */
  types: readonly AllowanceType[];
  defaultRows: readonly AllowanceRow[];
  onChange?: (rows: AllowanceRow[]) => void;
  legend?: string;
  hint?: string;
}) {
  const [rows, setRows] = useState<AllowanceRow[]>(() => [...defaultRows]);
  const fid = useFieldIds();
  const update = (next: AllowanceRow[]) => {
    setRows(next);
    onChange?.(next);
  };
  const offered = (row: AllowanceRow) =>
    types.filter((t) => (t.active || t.id === row.allowanceTypeId) && (t.id === row.allowanceTypeId || !rows.some((r) => r.allowanceTypeId === t.id)));
  const canAdd = types.some((t) => t.active && !rows.some((r) => r.allowanceTypeId === t.id));

  return (
    <fieldset className="space-y-3" aria-describedby={fid('hint')}>
      <legend className="label">{legend}</legend>
      <p id={fid('hint')} className="hint">
        {hint}
      </p>
      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((row, i) => {
            const kind = types.find((t) => t.id === row.allowanceTypeId);
            return (
              <li key={i} className="flex flex-wrap items-start gap-2">
                <div className="min-w-48 flex-1">
                  <label htmlFor={fid(`kind-${i}`)} className="sr-only">
                    Allowance {i + 1}: kind
                  </label>
                  <Select
                    id={fid(`kind-${i}`)}
                    name="allowanceTypeId"
                    value={row.allowanceTypeId}
                    onChange={(e) => update(rows.map((r, j) => (j === i ? { ...r, allowanceTypeId: e.target.value } : r)))}
                    className="input"
                  >
                    <option value="">Choose…</option>
                    {offered(row).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nameEn}
                        {!t.active ? ' (inactive)' : ''}
                      </option>
                    ))}
                  </Select>
                  {kind && <p className="hint">{treatmentText(kind)}</p>}
                </div>
                <div className="w-40">
                  <label htmlFor={fid(`amount-${i}`)} className="sr-only">
                    Allowance {i + 1}: amount in EGP a month
                  </label>
                  <input
                    id={fid(`amount-${i}`)}
                    name="allowanceAmount"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="EGP a month"
                    value={row.amount}
                    onChange={(e) => update(rows.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)))}
                    className="input tabular-nums"
                  />
                </div>
                <button type="button" onClick={() => update(rows.filter((_, j) => j !== i))} className={`${small} btn-secondary`}>
                  Remove<span className="sr-only"> allowance {i + 1}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {canAdd ? (
        <button type="button" onClick={() => update([...rows, { allowanceTypeId: '', amount: '' }])} className={`${small} btn-secondary`}>
          Add allowance
        </button>
      ) : (
        types.length === 0 && <p className="text-sm text-muted">No kinds of allowance yet: HR adds them in Organization → Allowances.</p>
      )}
    </fieldset>
  );
}
