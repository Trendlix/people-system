'use client';

import { useMemo, useState, useTransition } from 'react';
import { DateInput } from '@/components/date-time-inputs';
import { useFieldIds } from '@/components/form';
import { Select } from '@/components/select';
import { formatDate, parseDate } from '@/lib/format';
import { shownCode } from '@/lib/hidden';
import type { PayrollBankBatchView, PayrollBankFile, PayrollLineView } from '@/lib/types';
import { formatEgp } from '../../employees/[id]/contracts/salary';
import { makeBankBatch } from '../actions';
import {
  BANK_FILE_LABELS,
  BANK_FILES,
  bankLabel,
  byName,
  batchFileHref,
  batchMarks,
  batchNote,
  owedNote,
  owedOf,
  overpaidNote,
  type Payee,
  departmentsOf,
  isWallet,
  payees,
  peopleText,
  startTicks,
  tickedTotal,
  type BatchMark,
} from '../files';

// Picking who a bank file pays (owner, 5 November 2026: "allow me to select a group of people for the transfer"; asked,
// "Tick names"; "on ticking calculate the transferred amount of ticked people"; then "batches sent to the back employees
// are not to be selected again instead there is an edit and they have remaining payment", asked, "No, reserved"): for
// each file, everyone it still owes something, ticked to start with, each with what is left to transfer (the rest after a
// correction of their line, with what the batches hold already), with quick picks and the ticked people's total as it
// changes. Those the batches pay in full (a batch not confirmed sent yet too) are listed apart, never ticked: a
// correction of their line (the results' Correct) leaves them owed the rest. Downloading makes a numbered batch of the
// ticked people (the API records it, to be confirmed once sent to the bank) and saves its file. The CIB file asks for its
// value date, the day the bank is to pay (today, to start with).

type Line = Pick<PayrollLineView, 'id' | 'employeeCode' | 'name' | 'department' | 'onHold' | 'bank' | 'result'>;

export function BankBatchPicker({
  runId,
  lines,
  batches,
  today,
  makes,
}: {
  runId: string;
  lines: Line[];
  batches: PayrollBankBatchView[];
  /** YYYY-MM-DD, Cairo. */
  today: string;
  /** The caller makes batches (not a developer, who only looks). */
  makes: boolean;
}) {
  const marks = useMemo(() => batchMarks(batches), [batches]);
  // each file's people by name, A to Z (9 November 2026), those owed and those paid in full alike
  const files = BANK_FILES.map((file) => ({ file, ...owedOf(byName(payees(lines, file)), batches) })).filter((f) => f.owed.length + f.paid.length > 0);
  if (!files.length) return <p className="text-sm text-muted">Nobody on this run is paid through the bank files.</p>;
  return (
    <div className="space-y-6">
      {files.map(({ file, owed, paid }) => (
        <FilePicker key={file} runId={runId} file={file} owed={owed} paid={paid} marks={marks} today={today} makes={makes} />
      ))}
    </div>
  );
}

function FilePicker({
  runId,
  file,
  owed,
  paid,
  marks,
  today,
  makes,
}: {
  runId: string;
  file: PayrollBankFile;
  owed: Payee<Line>[];
  paid: Payee<Line>[];
  marks: Map<string, BatchMark[]>;
  today: string;
  makes: boolean;
}) {
  const fid = useFieldIds();
  const label = BANK_FILE_LABELS[file];
  const people = owed;
  const [ticked, setTicked] = useState<Set<string>>(() => startTicks(owed));
  // a batch made or discarded, or a line corrected, since: start again from everyone owed something
  const owedKey = owed.map((p) => `${p.id}:${p.left}`).join(',');
  const [seen, setSeen] = useState(owedKey);
  if (seen !== owedKey) {
    setSeen(owedKey);
    setTicked(startTicks(owed));
  }
  const [valueDate, setValueDate] = useState(() => formatDate(today));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const departments = departmentsOf(people);
  const wallets = file === 'ach' ? people.filter(isWallet) : [];
  const count = people.filter((p) => ticked.has(p.id)).length;
  const total = tickedTotal(people, ticked);

  const tick = (ids: Iterable<string>, on: boolean) =>
    setTicked((was) => {
      const next = new Set(was);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const make = () => {
    if (file === 'cib' && !parseDate(valueDate)) {
      setError('Enter the value date as DD/MM/YYYY, e.g. 16/10/2026.');
      return;
    }
    setError(null);
    const lineIds = people.filter((p) => ticked.has(p.id)).map((p) => p.id);
    startTransition(async () => {
      const res = await makeBankBatch(runId, file, lineIds, file === 'cib' ? valueDate : null);
      if (res.errors?.length) setError(res.errors.join(' '));
      else if (res.batchId) window.location.assign(batchFileHref(runId, res.batchId));
    });
  };

  const quick = 'btn btn-secondary min-h-8 px-3 text-sm';
  return (
    <section aria-labelledby={fid('title')} className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id={fid('title')} className="font-semibold">
          {label.name} <span className="font-normal text-muted">· {label.note}</span>
        </h3>
        <p aria-live="polite" className="text-sm tabular-nums">
          <span className="font-semibold">
            {count} of {people.length}
          </span>{' '}
          ticked · <span className="font-semibold">{formatEgp(total)}</span>
        </p>
      </div>

      {makes && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Quick picks for the ${label.name}`}>
          <button type="button" className={quick} onClick={() => tick(people.map((p) => p.id), true)}>
            All
          </button>
          <button type="button" className={quick} onClick={() => setTicked(new Set())}>
            None
          </button>
          {people.some((p) => p.held > 0) && people.some((p) => p.held === 0) && (
            <button type="button" className={quick} onClick={() => setTicked(new Set(people.filter((p) => p.held === 0).map((p) => p.id)))}>
              Not in a batch yet
            </button>
          )}
          {wallets.length > 0 && (
            <button type="button" className={quick} onClick={() => tick(wallets.map((p) => p.id), true)}>
              Wallets
            </button>
          )}
          {departments.length > 1 && (
            <div className="w-56">
              <Select
                aria-label="Tick a department"
                value=""
                onChange={(e) => {
                  const d = e.target.value;
                  if (d) tick(people.filter((p) => p.department?.trim() === d).map((p) => p.id), true);
                }}
                className="input min-h-8 py-1 text-sm"
              >
                <option value="">Tick a department…</option>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
      )}

      {people.length === 0 && <p className="text-sm text-muted">Everyone this file pays is in a batch already.</p>}
      {people.length > 0 && (
      <ul className="divide-y divide-line-soft rounded-lg border border-line">
        {people.map((p) => {
          const note = owedNote(p, marks);
          const code = shownCode(p.employeeCode);
          const bank = file === 'ach' ? bankLabel(p) : null;
          return (
            <li key={p.id}>
              <label className="flex items-start gap-3 px-4 py-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={ticked.has(p.id)}
                  disabled={!makes}
                  onChange={(e) => tick([p.id], e.target.checked)}
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{p.name}</span>
                  {code && <span className="text-muted"> · {code}</span>}
                  {(p.department || bank) && <span className="block text-xs text-muted">{[p.department, bank].filter(Boolean).join(' · ')}</span>}
                  {note && <span className="block text-xs text-warn">{note}</span>}
                </span>
                <span className="tabular-nums">{formatEgp(p.left)}</span>
              </label>
            </li>
          );
        })}
      </ul>
      )}

      {paid.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">
            Paid in full by the batches: {peopleText(paid.length)}
          </summary>
          <ul className="mt-2 divide-y divide-line-soft rounded-lg border border-line text-muted">
            {paid.map((p) => {
              const code = shownCode(p.employeeCode);
              const over = overpaidNote(p);
              return (
                <li key={p.id} className="flex items-start gap-3 px-4 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{p.name}</span>
                    {code && <span> · {code}</span>}
                    {batchNote(marks.get(p.id)) && <span className="block text-xs">{batchNote(marks.get(p.id))}</span>}
                    {over && <span className="block text-xs text-warn">{over}</span>}
                  </span>
                  <span className="tabular-nums">{formatEgp(p.held)}</span>
                </li>
              );
            })}
          </ul>
        </details>
      )}

      {makes && (
        <div className="flex flex-wrap items-end gap-3">
          {file === 'cib' && (
            <div className="w-44">
              <label htmlFor={fid('valueDate')} className="label">
                Value date
              </label>
              <DateInput id={fid('valueDate')} name="valueDate" required defaultValue={valueDate} onChange={(e) => setValueDate(e.target.value)} />
            </div>
          )}
          <button type="button" className="btn btn-primary" disabled={count === 0 || pending} onClick={make}>
            {pending ? 'Making the file…' : `Download ${label.name} · ${peopleText(count)}`}
          </button>
          {error && (
            <p role="alert" className="w-full text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
