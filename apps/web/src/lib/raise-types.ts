import type {
  PayBasis,
  PayChange,
  PayEvent,
  PayStage,
  RaiseApproval,
  RaiseDecision,
  RaiseFigureKind,
  RaiseReason,
  RaiseReasonChoice,
  RaiseRequester,
  RaiseRequestStatus,
  RaiseRequestStepKind,
  RaiseWay,
  SalarySummary,
} from '@trendlix/shared';
import type { Contract } from './types';

// Shapes the API returns for pay raises, renewals with new pay, the salary history and raise requests (owner's
// decisions, 16 October 2026; packages/shared raises.ts and salary-history.ts). Dates YYYY-MM-DD, times ISO.

/**
 * A version that changes the pay (a raise, or a renewal with new pay), on `Contract.raise`: why, the CEO's step, the
 * promotion with it, Form 2, and from when the insured wage follows it. The CEO's reason for returning it only for those
 * who see salaries.
 */
export interface ContractRaise {
  reason: RaiseReason;
  approval: RaiseApproval;
  /** Sent to the CEO, last. */
  sentAt: string | null;
  approvedBy: { email: string } | null;
  approvedAt: string | null;
  /** Why the CEO returned it, until it is sent again (HR, Finance and the CEO; else null). */
  returnedReason: string | null;
  newJobTitle: { id: string; titleEn: string; titleAr: string | null } | null;
  newGrade: { id: string; code: string } | null;
  /** Form 2 filed: the insured wage follows the new pay from this 1st of a month. */
  form2From: string | null;
  /** The next 1 January from the effective date, or the Form 2 date. */
  insuredWageFrom: string;
  /** The raise request it was prepared from, if any. */
  requestId: string | null;
}

/** GET /raises/pending (HR and the CEO): a change of pay waiting for the CEO, with its person and the pay it replaces. */
export interface PendingRaise extends Contract {
  change: PayChange;
  employee: { id: string; employeeCode: string; fullNameEn: string };
  employmentId: string;
  jobTitleEn: string | null;
  previous: {
    id: string;
    number: string;
    version: number;
    startDate: string;
    endDate: string | null;
    payBasis: PayBasis;
    grossSalary: number | null;
    hourlyRate: number | null;
    allowancesTotal: number | null;
    totalSalary: number | null;
  } | null;
}

/** A document generated for a version, on a pay event (HR and the CEO; null for Finance). */
export interface PayEventDocument {
  id: string;
  slotKey: string;
  name: string;
  status: string;
  fileName: string;
  generatedAt: string;
}

/** A pay event as the salary history sends it. */
export interface SalaryEvent extends PayEvent {
  documents: PayEventDocument[] | null;
}

/** A paid payroll month of the employment: what was actually received. */
export interface PaidMonth {
  /** "YYYY-MM". */
  month: string;
  lineId: string;
  runId: string;
  paidOn: string | null;
  net: number;
  transfer: number;
  onHold: boolean;
  /** Whether each language's payslip is drawn yet (it is drawn when first opened). */
  payslips: { en: boolean; ar: boolean };
}

/** One employment's salary history. */
export interface EmploymentSalaryHistory {
  employmentId: string;
  employmentType: string;
  joinDate: string;
  endDate: string | null;
  current: boolean;
  jobTitle: string | null;
  /** Null until a version is signed. */
  summary: SalarySummary | null;
  /** Oldest first, every version, signed or not (its `stage` says). */
  events: SalaryEvent[];
  /** Oldest first. Not shown from here: the profile's Pay Received reads every employment's months with the payslips. */
  paid: PaidMonth[];
}

/** GET /employees/:id/salary-history (HR, Finance and the CEO): the current employment first, then the past ones, newest first. */
export interface SalaryHistory {
  employments: EmploymentSalaryHistory[];
}

/**
 * A step of a raise request, in its log (owner, 17 October 2026: "all the request steps to be logged in the request"),
 * as the caller may see it: HR, Finance and the CEO every figure; the employee the figure they suggested and, once
 * signed, their new gross; the manager the percent they suggested themself only (`figuresHidden`). The comments HR and
 * the CEO exchange (a return, HR's note on sending) only for HR, Finance and the CEO.
 */
export interface RaiseRequestStep {
  id: string;
  kind: RaiseRequestStepKind;
  /** HR's and the CEO's decisions. */
  decision: RaiseDecision | null;
  /** Submitted: the reason from the list. */
  raiseReason: RaiseReasonChoice | null;
  comment: string | null;
  /** Which figure was typed (null: worked out from the pay, or a gross typed before 17 October 2026). */
  figure: RaiseFigureKind | null;
  /** EGP a month on the gross before. */
  increaseAmount: number | null;
  increasePercent: number | null;
  /** The gross it comes to. */
  gross: number | null;
  /** The raise prepared: how, from when (once signed for the employee and the manager), its number. */
  way: RaiseWay | null;
  effectiveDate: string | null;
  contractNumber: string | null;
  by: { email: string } | null;
  at: string;
  figuresHidden: boolean;
}

/**
 * The raise suggested on a request: an amount a month on the gross, a percent of it, or (before 17 October 2026) the
 * gross typed; with the gross it comes to for HR, Finance and the CEO. Others are sent what they typed themselves only.
 */
export interface RaiseSuggestion {
  kind: RaiseFigureKind | 'gross';
  amount: number | null;
  percent: number | null;
  gross: number | null;
}

/**
 * A raise request as the caller may see it: HR, Finance and the CEO everything; the employee their own suggestion and,
 * once done, their new gross; the manager no figure (`amountsHidden`). The fields added on 17 October 2026 (the reason
 * from the list, the comment, the suggestion, the contract in force, the log) are optional, as an API from before
 * doesn't send them.
 */
export interface RaiseRequest {
  id: string;
  employee: { id: string; employeeCode: string; fullNameEn: string };
  employmentId: string;
  requester: RaiseRequester;
  requestedBy: { email: string } | null;
  /** The requester's comment (what the request was asked with, before 17 October 2026). */
  reason: string;
  /** The reason from the list; null on a request from before 17 October 2026. */
  raiseReason?: RaiseReasonChoice | null;
  /** The requester's comment: the same as `reason`. */
  comment?: string;
  suggestion?: RaiseSuggestion | null;
  /** The contract in force now, which a raise is weighed against (HR, Finance and the CEO). */
  inForce?: { number: string; startDate: string; endDate: string | null; payBasis: PayBasis; grossSalary: number } | null;
  /** Every step, oldest first. */
  steps?: RaiseRequestStep[];
  status: RaiseRequestStatus;
  createdAt: string;
  updatedAt: string;
  suggestedGross: number | null;
  /** The raise HR prepared from it, if any. */
  raise: {
    contractId: string;
    number: string;
    way: 'amendment' | 'contract';
    stage: PayStage;
    /** HR, Finance and the CEO; for the others once done. */
    effectiveDate: string | null;
    previousGross: number | null;
    newGross: number | null;
    returnedReason: string | null;
    approvedAt: string | null;
  } | null;
  /** Rejected by HR or the CEO, with the comment. */
  decision: { stage: 'hr' | 'ceo'; reason: string | null; at: string | null; by: { email: string } | null } | null;
  doneAt: string | null;
  amountsHidden: boolean;
}

/** GET /employees/:id/raise-requests: the requests the caller may see, and whether they may ask for one now. */
export interface EmployeeRaiseRequests {
  requests: RaiseRequest[];
  canRequest: boolean;
  /** Why not, when they can't. */
  cannotRequestBecause: string | null;
  /** The employee and HR may suggest an amount; a manager never states one (a percent only). */
  suggestsAmount: boolean;
  /** What the caller may suggest: an amount or a percent, a manager a percent only. */
  suggestionKinds?: RaiseFigureKind[];
  /** The gross in force, for those who see salaries, to show what a suggestion comes to. */
  currentGross?: number | null;
}
