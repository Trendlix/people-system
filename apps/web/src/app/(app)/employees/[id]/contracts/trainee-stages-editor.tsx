'use client';

import { useState } from 'react';
import { traineeNotes, traineeProblems, traineeStagePeriods } from '@trendlix/shared';
import { formatDate } from '@/lib/format';
import type { FormState } from '@/lib/types';
import { formatEgp } from './salary';
import { EMPTY_STAGE, stageRows, stagesOf, totalMonthsText, type SavedStage, type StageRow } from './trainee-stages';

// The training stages of a trainee's contract, the training agreement (owner, 18 October 2026: Internship became
// Trainee, the law's المتدرج): rows of a stage's name, its months and its pay a month, added and removed, sent as
// traineeStageName, traineeStageMonths and traineeStagePay in order (read by traineeStagesFrom in trainee-stages.ts).
// While HR types it shows the training's whole length, each stage's dates from the start, and what the law asks
// (traineeProblems, the API's own check): each stage's pay more than the one before ("بصورة تصاعدية", Labour Law Art.
// 29), the last at least the minimum wage of the rates set by law, and the trainee at least 14 on the start date (Art.
// 28). `onChange` gets the rows whenever they change: the contract's gross is the first stage's pay.

const small = 'btn min-h-9 px-3';

export function TraineeStagesEditor({
  state,
  fid,
  saved,
  minimumWage,
  dateOfBirth,
  startDate,
  onChange,
}: {
  state: FormState;
  fid: (name: string) => string;
  /** The draft's stages, or the version renewed; none for a new agreement. */
  saved: readonly SavedStage[] | null;
  /** The minimum wage a month of the year the contract starts (Payroll Setup's rates set by law); null when not set. */
  minimumWage: number | null;
  /** The trainee's, from the profile; null when not recorded. */
  dateOfBirth: string | null;
  /** YYYY-MM-DD, or null while not known (typed). */
  startDate: string | null;
  onChange?: (rows: StageRow[]) => void;
}) {
  const [rows, setRows] = useState<StageRow[]>(() => stageRows(state, saved));
  const update = (next: StageRow[]) => {
    setRows(next);
    onChange?.(next);
  };
  const change = (i: number, field: keyof StageRow, value: string) => update(rows.map((r, j) => (j === i ? { ...r, [field]: value } : r)));

  const stages = stagesOf(rows);
  const typed = stages.length > 0;
  const problems = typed ? traineeProblems({ stages, minimumWage, dateOfBirth, startDate: startDate ?? '' }) : [];
  const notes = traineeNotes({ minimumWage, dateOfBirth });
  const total = totalMonthsText(stages);
  // each stage's dates, once the start and every stage's months are known
  const periods = startDate && total ? traineeStagePeriods(stages, startDate) : [];

  return (
    <fieldset className="space-y-3" aria-describedby={fid('stages-hint')}>
      <legend className="font-semibold">Training Stages</legend>
      <p id={fid('stages-hint')} className="hint">
        The training agreement sets the training&apos;s stages, one after the other, and the pay of each, rising from stage to stage, the last at
        least the minimum wage (Labour Law Art. 29:{' '}
        <span lang="ar">ومراحلها المتتابعة والمكافأة التى يحصل عليها المتدرج فى كل مرحلة بصورة تصاعدية</span>).
        {minimumWage !== null && minimumWage > 0 && ` The minimum wage: ${formatEgp(minimumWage)} a month.`} The contract&apos;s gross is the first
        stage&apos;s pay; payroll pays each stage&apos;s in its months.
      </p>
      <ol className="space-y-3">
        {rows.map((row, i) => (
          <li
            key={i}
            className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[minmax(0,1fr)_7rem_10rem_auto] sm:items-end sm:border-0 sm:p-0"
          >
            <div>
              <label htmlFor={fid(`stage-name-${i}`)} className="label">
                Stage {i + 1}
                <span className="sr-only">: its name</span>
              </label>
              <input
                id={fid(`stage-name-${i}`)}
                name="traineeStageName"
                maxLength={100}
                autoComplete="off"
                placeholder="e.g. Basics"
                value={row.name}
                onChange={(e) => change(i, 'name', e.target.value)}
                className="input"
              />
            </div>
            <div>
              <label htmlFor={fid(`stage-months-${i}`)} className="label">
                Months<span className="sr-only"> of stage {i + 1}</span>
              </label>
              <input
                id={fid(`stage-months-${i}`)}
                name="traineeStageMonths"
                inputMode="numeric"
                autoComplete="off"
                maxLength={3}
                value={row.months}
                onChange={(e) => change(i, 'months', e.target.value)}
                className="input tabular-nums"
              />
            </div>
            <div>
              <label htmlFor={fid(`stage-pay-${i}`)} className="label">
                Pay a month (EGP)<span className="sr-only"> in stage {i + 1}</span>
              </label>
              <input
                id={fid(`stage-pay-${i}`)}
                name="traineeStagePay"
                inputMode="decimal"
                autoComplete="off"
                value={row.pay}
                onChange={(e) => change(i, 'pay', e.target.value)}
                className="input tabular-nums"
              />
            </div>
            {rows.length > 1 ? (
              <button type="button" onClick={() => update(rows.filter((_, j) => j !== i))} className={`${small} btn-secondary justify-self-start`}>
                Remove<span className="sr-only"> stage {i + 1}</span>
              </button>
            ) : (
              <span aria-hidden className="hidden sm:block" />
            )}
            {periods[i] && (
              <p className="hint sm:col-span-4">
                {formatDate(periods[i].from)} – {formatDate(periods[i].to)}
              </p>
            )}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => update([...rows, { ...EMPTY_STAGE }])} className={`${small} btn-secondary`}>
          Add a stage
        </button>
        {total && <span className="text-sm tabular-nums">{total}</span>}
      </div>
      <div role="status" className="space-y-2">
        {problems.length > 0 && (
          <ul className="list-disc space-y-1 rounded-lg bg-warn-soft py-3 pr-4 pl-8 text-sm text-warn">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        {notes.map((n) => (
          <p key={n} className="hint">
            {n}
          </p>
        ))}
      </div>
    </fieldset>
  );
}
