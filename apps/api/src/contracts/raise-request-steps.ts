import { BadRequestException } from '@nestjs/common';
import {
  raiseFiguresOf,
  type RaiseDecision,
  type RaiseFigure,
  type RaiseFigureKind,
  type RaiseReasonChoice,
  type RaiseRequestStepKind,
  type RaiseWay,
} from '@trendlix/shared';
import { fromDateOnly, toDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

// The log of a raise request (owner, 17 October 2026: "all the request steps to be logged in the request"): every step
// in order, each with who and when, written in the same transaction as the step itself, and shown on the request as the
// caller may see it ("Keep salaries private", owner's decision, 16 October 2026). Pure code but the writer.

/** The database, or a transaction in it. */
type Db = PrismaService | Prisma.TransactionClient;

/** What a step is loaded with: who took it. */
export const STEP_INCLUDE = { actor: { select: { email: true } } } satisfies Prisma.RaiseRequestStepInclude;

export type StepRow = Prisma.RaiseRequestStepGetPayload<{ include: typeof STEP_INCLUDE }>;

/** A step as it is written: its kind, and what goes with it. */
export interface StepInput {
  kind: RaiseRequestStepKind;
  decision?: RaiseDecision;
  raiseReason?: string | null;
  comment?: string | null;
  /** Which figure was typed, and both figures and the gross they come to (stepFigures). */
  figure?: RaiseFigureKind | null;
  increaseAmount?: number | null;
  increasePercent?: number | null;
  gross?: number | null;
  way?: RaiseWay | null;
  effectiveDate?: string | null;
  contractNumber?: string | null;
}

/** Logs a step on a request, by `actorId`, in the transaction the step is taken in. */
export async function recordStep(db: Db, requestId: string, actorId: string | null, step: StepInput): Promise<void> {
  await db.raiseRequestStep.create({
    data: {
      requestId,
      actorId,
      kind: step.kind,
      decision: step.decision ?? null,
      raiseReason: step.raiseReason ?? null,
      comment: step.comment ?? null,
      figure: step.figure ?? null,
      increaseAmount: step.increaseAmount ?? null,
      increasePercent: step.increasePercent ?? null,
      gross: step.gross ?? null,
      way: step.way ?? null,
      effectiveDate: step.effectiveDate ? toDateOnly(step.effectiveDate) : null,
      contractNumber: step.contractNumber ?? null,
    },
  });
}

/** The raise typed: an amount or a percent, not both; null for neither. */
export function typedFigure(amount: number | null | undefined, percent: number | null | undefined): RaiseFigure | null {
  const hasAmount = amount !== undefined && amount !== null;
  const hasPercent = percent !== undefined && percent !== null;
  if (hasAmount && hasPercent) throw new BadRequestException('Give the raise as an amount or a percent, not both.');
  if (hasAmount) return { kind: 'amount', value: amount };
  if (hasPercent) return { kind: 'percent', value: percent };
  return null;
}

/**
 * A raise's figures for the log: the one typed as it was typed, the other worked out from the gross before (`before`)
 * and after (`gross`), the percent to two decimals; without a figure typed, both worked out. Without the gross before
 * (no signed contract yet), only what was typed and the gross.
 */
export function stepFigures(before: number | null, gross: number | null, typed: RaiseFigure | null = null) {
  const worked = before !== null && gross !== null ? raiseFiguresOf(before, gross) : null;
  return {
    figure: typed?.kind ?? null,
    increaseAmount: typed?.kind === 'amount' ? typed.value : (worked?.amount ?? null),
    increasePercent: typed?.kind === 'percent' ? typed.value : (worked?.percent ?? null),
    gross,
  };
}

/**
 * Who is looking at a request, as far as its amounts go ("Keep salaries private", owner's decision, 16 October 2026):
 * HR, Finance and the CEO see everything; the employee their own request, with their own suggestion and, once the raise
 * is signed, their new salary; the direct manager the reason, the comments and the decisions, never a figure but the
 * percent they suggested themself.
 */
export type RequestViewer = 'full' | 'self' | 'manager';

/** Steps whose comment goes to the employee and their manager too; the others' (a return, HR's note on sending) stay between HR and the CEO. */
const SHARED_COMMENTS: readonly RaiseRequestStepKind[] = ['submitted', 'hr_decision', 'ceo_decision'];

const money = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : d.toNumber());

/**
 * A step as `viewer` may see it. `mine`: the viewer made the request (the employee always, on the requests they see);
 * `done`: its raise is signed. The employee sees the figure they typed when asking (a gross on a request from before
 * 17 October 2026) and, once signed, their new salary on the signing; the manager only the percent they suggested
 * themself; neither sees HR's or the CEO's figures, nor a gross before the signing, nor the effective date before then,
 * nor the comments HR and the CEO exchange (a return, HR's note on sending).
 */
export function stepView(s: StepRow, viewer: RequestViewer, ctx: { mine: boolean; done: boolean }) {
  const full = viewer === 'full';
  const all = { figure: s.figure as RaiseFigureKind | null, increaseAmount: money(s.increaseAmount), increasePercent: money(s.increasePercent), gross: money(s.gross) };
  const none = { figure: null, increaseAmount: null, increasePercent: null, gross: null };
  let figures: typeof all = none;
  if (full) {
    figures = all;
  } else if (s.kind === 'submitted' && ctx.mine) {
    if (viewer === 'self') {
      figures =
        all.figure === 'amount'
          ? { ...none, figure: 'amount', increaseAmount: all.increaseAmount }
          : all.figure === 'percent'
            ? { ...none, figure: 'percent', increasePercent: all.increasePercent }
            : { ...none, gross: all.gross }; // a gross typed before 17 October 2026
    } else if (all.figure === 'percent') {
      figures = { ...none, figure: 'percent', increasePercent: all.increasePercent };
    }
  } else if (viewer === 'self' && s.kind === 'signed' && ctx.done) {
    figures = { ...none, gross: all.gross }; // their new salary
  }
  return {
    id: s.id.toString(),
    kind: s.kind as RaiseRequestStepKind,
    decision: s.decision as RaiseDecision | null,
    raiseReason: s.raiseReason as RaiseReasonChoice | null,
    comment: full || SHARED_COMMENTS.includes(s.kind as RaiseRequestStepKind) ? s.comment : null,
    ...figures,
    way: s.way as RaiseWay | null,
    effectiveDate: full || ctx.done ? fromDateOnly(s.effectiveDate) : null,
    contractNumber: s.contractNumber,
    by: s.actor && { email: s.actor.email },
    at: s.at,
    figuresHidden: !full,
  };
}

export type StepView = ReturnType<typeof stepView>;

/** A contract's pay as raisedPay takes it. */
export function payOf(c: { payBasis: string; grossSalary: Prisma.Decimal; hourlyRate: Prisma.Decimal | null; hoursPerWeek: Prisma.Decimal | null }) {
  return { payBasis: c.payBasis, grossSalary: c.grossSalary.toNumber(), hourlyRate: c.hourlyRate?.toNumber() ?? null, hoursPerWeek: c.hoursPerWeek?.toNumber() ?? null };
}
