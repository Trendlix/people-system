import { traineeMonths, traineeProblems, type TraineeStage } from '@trendlix/shared';
import type { FormState } from '../../../../../lib/types';
import { formatEgp, parseAmount, plainAmount } from './salary';

// A trainee's training stages as the contract form has them (owner, 18 October 2026: "can we update the employment
// types based on the labour law?"; Internship became Trainee, the law's المتدرج): a trainee's contract is the training
// agreement, which "يجب أن يكون … مكتوبا، وتحدد فيه على الأخص مدة تعلم المهنة … ومراحلها المتتابعة والمكافأة التى يحصل
// عليها المتدرج فى كل مرحلة بصورة تصاعدية" (Labour Law 14/2025, Art. 29). The stages editor (trainee-stages-editor.tsx)
// sends one traineeStageName, traineeStageMonths and traineeStagePay per row, in order; they are read here for the API
// and refilled from them after a refused save. Pure code, tested; relative imports, as vitest doesn't know the @/ paths.

/** A stage as typed: its name, its months and its pay a month, as text. */
export interface StageRow {
  name: string;
  months: string;
  pay: string;
}

const list = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** A stage as a contract has it: its pay null when hidden with the salary (TraineeStageView). */
export type SavedStage = { name: string; months: number; pay: number | null };

/** A new training agreement starts with one stage to fill in. */
export const EMPTY_STAGE: StageRow = { name: '', months: '', pay: '' };

/** The rows to show: as typed before a refused save, else as saved (one empty row for none). */
export function stageRows(state: FormState, saved: readonly SavedStage[] | null | undefined): StageRow[] {
  if (state.values && 'traineeStageName' in state.values) {
    const names = list(state.values.traineeStageName);
    const months = list(state.values.traineeStageMonths);
    const pay = list(state.values.traineeStagePay);
    return names.map((name, i) => ({ name, months: months[i] ?? '', pay: pay[i] ?? '' }));
  }
  if (!saved?.length) return [{ ...EMPTY_STAGE }];
  return saved.map((s) => ({ name: s.name, months: String(s.months), pay: s.pay === null ? '' : plainAmount(s.pay) }));
}

/** Whole months as typed, in Arabic digits too; NaN when it isn't a whole number. */
function monthsOf(input: string): number {
  const s = input.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).trim();
  return /^\d{1,3}$/.test(s) ? Number(s) : NaN;
}

/**
 * The stages the rows give, as traineeProblems checks them: a row left wholly empty is left out; months or pay that
 * can't be read (or left empty) are NaN, which traineeProblems names.
 */
export function stagesOf(rows: readonly StageRow[]): TraineeStage[] {
  return rows
    .filter((r) => r.name.trim() || r.months.trim() || r.pay.trim())
    .map((r) => ({ name: r.name.trim(), months: monthsOf(r.months), pay: parseAmount(r.pay) ?? NaN }));
}

/** The rows submitted (`fd`), for the API. */
export function stageRowsFrom(fd: FormData): StageRow[] {
  const names = fd.getAll('traineeStageName').map(String);
  const months = fd.getAll('traineeStageMonths').map(String);
  const pay = fd.getAll('traineeStagePay').map(String);
  return names.map((name, i) => ({ name, months: months[i] ?? '', pay: pay[i] ?? '' }));
}

/**
 * The training stages submitted, for the API (traineeStages), with what is wrong with them in `errors`: the checks the
 * form makes itself (traineeProblems without the minimum wage or the date of birth, which the API checks again with
 * both).
 */
export function traineeStagesFrom(fd: FormData, errors: string[]): TraineeStage[] {
  const stages = stagesOf(stageRowsFrom(fd));
  errors.push(...traineeProblems({ stages, minimumWage: null, dateOfBirth: null, startDate: '' }));
  return stages;
}

/** "12 months in all", "1 month in all"; null while a stage's months can't be read. */
export function totalMonthsText(stages: readonly TraineeStage[]): string | null {
  if (!stages.length || stages.some((s) => !Number.isInteger(s.months) || s.months < 1)) return null;
  const total = traineeMonths(stages);
  return `${total} ${total === 1 ? 'month' : 'months'} in all`;
}

const monthsText = (n: number) => `${n} ${n === 1 ? 'month' : 'months'}`;

/** A stage in a few words: "Basics · 3 months · EGP 4,000.00 a month" (the pay left out when hidden). */
export function stageLabel(s: SavedStage): string {
  return [s.name, monthsText(s.months), s.pay !== null && Number.isFinite(s.pay) && `${formatEgp(s.pay)} a month`].filter(Boolean).join(' · ');
}

/** The training in a few words: "3 stages, 12 months", "1 stage, 6 months". */
export function trainingSummary(stages: readonly Pick<SavedStage, 'months'>[]): string {
  const total = stages.reduce((sum, s) => sum + (Number.isFinite(s.months) ? s.months : 0), 0);
  return `${stages.length} ${stages.length === 1 ? 'stage' : 'stages'}, ${monthsText(total)}`;
}

/** A training agreement in the lists, from its whole length: "Training agreement · 12 months". */
export const trainingLengthText = (months: number) => `Training agreement · ${monthsText(months)}`;
