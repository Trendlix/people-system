import {
  INTERNSHIP_AGREEMENT,
  isTrainingType,
  RENEWED_ONCE_MESSAGE,
  trainingEndsText,
  trainingTooSoon,
  trainingTooSoonMessage,
  type EmploymentType,
  type TrainingNext,
} from '@trendlix/shared';
import type { Contract, ContractSettings, ContractTraining } from '../../../../../lib/types';
import type { ContractDefaults } from './contract-form';
import { addDays, daysBetween } from './dates';

// An intern's internship agreement on the Employment tab and the contract pages (owner, 19 October 2026: "interns to be
// labeled trainees instead of probation and their contracts are never renewed", then "or can be only renewed 1 time,
// after that it should be converted to a full time contract. a new trainee contract can be issued after 6 months of the
// expiration of the last trainee contract"): no probation; Renew while the first agreement is in force, never a second
// time; Convert to full-time, a full-time contract as the employment's next version (signing it makes the employment
// full-time); the reminder of the agreement's end with the way forward, never "renew in writing", the non-renewal notice
// or Art. 88; and a new agreement not before 6 months after the last one ended. The unpaid internship is the one
// internship since 25 October 2026 (owner: "unpaid internship and training are the same thing .. keep the unpaid
// internship with its document and delete the trainee with its documents"). The rules are @trendlix/shared's
// (employment-types.ts), which the API decides with. Pure code, tested; relative imports, as vitest doesn't know the @/
// paths.

/** The address of the conversion: the New contract page as a full-time contract. */
export const convertHref = (employeeId: string) => `/employees/${employeeId}/contracts/new?convert=full_time`;

/** What the Contract section offers HR. */
export interface ContractActions {
  /** Renew the newest signed version: not an open-ended one in force, nor an agreement already renewed once. */
  renew: boolean;
  /** Convert an intern's agreement to a full-time contract. */
  convert: boolean;
  /** Raise the pay of the signed version in force: not an intern's (unpaid). */
  raise: boolean;
}

/**
 * The Contract section's actions: HR's (`canEdit`), one draft at a time, none while an ending is in progress. `previous`:
 * the newest signed version (what a new one renews or converts); `active`: one is in force.
 */
export function contractActions(x: {
  canEdit: boolean;
  hasDraft: boolean;
  endingInProgress: boolean;
  previous: Pick<Contract, 'form' | 'status' | 'training'> | undefined;
  active: boolean;
  employmentType: EmploymentType | string;
}): ContractActions {
  const free = x.canEdit && !x.hasDraft && !x.endingInProgress;
  const p = x.previous;
  const training = p?.training ?? null;
  return {
    renew: free && !!p && !(p.form === 'open_ended' && p.status === 'active') && (!training || training.next === 'renew_or_convert'),
    convert: free && !!training,
    raise: free && x.active && !isTrainingType(x.employmentType),
  };
}

/** The way forward once an agreement ends, in plain words, with where each is done. */
export function trainingWayText(next: TrainingNext): string {
  return next === 'renew_or_convert'
    ? 'Renew it once with Renew, or convert it with Convert to full-time. To end the internship, use End employment and choose Training completed.'
    : 'It was renewed once already, so it isn’t renewed again: convert it with Convert to full-time, or end the internship with End employment, choosing Training completed.';
}

/** An agreement's reminder this many days before it ends, as a fixed term's renewal warning. */
export const TRAINING_REMINDER_DAYS = 60;

/**
 * The reminder of an agreement's end on the Employment tab: "Internship ends on 31/03/2027: renew it once, or convert to
 * full-time." with the way forward, from 60 days before its end (ended once past: `passed`); null before then, or for a
 * contract that isn't an intern's agreement.
 */
export function trainingReminder(
  c: { endDate: string | null; training?: ContractTraining | null },
  today: string,
): { text: string; way: string; passed: boolean } | null {
  if (!c.training || !c.endDate) return null;
  const toEnd = daysBetween(today, c.endDate);
  if (toEnd > TRAINING_REMINDER_DAYS) return null;
  return { text: trainingEndsText(c.endDate, c.training.next, today), way: trainingWayText(c.training.next), passed: toEnd < 0 };
}

/** What a draft is, beside its version on the draft card: a conversion to full-time, a renewal, or the first contract. */
export function draftKind(d: Pick<Contract, 'version' | 'convertsTo'>): string {
  if (d.convertsTo) return ' (Conversion to full-time)';
  return d.version > 1 ? ' (Renewal)' : '';
}

/** Why the probation of an intern's agreement is none, under the field (shown as 0, not editable). */
export const noProbationHint = (): string =>
  'None: an intern has no probation, as an internship agreement isn’t an employment contract (probation, Labour Law Art. 90, is an employment contract’s).';

/**
 * Renew after an agreement was renewed once: why not, and the way instead (null while it may be renewed, or for any other
 * contract): "An internship agreement is renewed once. Convert it to a full-time contract instead."
 */
export function renewalRefusal(previous: Pick<Contract, 'training'> | undefined): string | null {
  return previous?.training?.next === 'convert_or_end' ? RENEWED_ONCE_MESSAGE : null;
}

/** On renewing a first agreement: that it is its one renewal. */
export const onlyRenewalNote = (): string => `This is the ${INTERNSHIP_AGREEMENT}’s one renewal: when it ends, it is converted to a full-time contract or the internship ends.`;

// ---------- converting an agreement to a full-time contract ----------

/** The full-time contract's first day, to start with: the day after the agreement ends ('' when it has no end). */
export const conversionStart = (agreement: Pick<Contract, 'endDate'>): string => (agreement.endDate ? addDays(agreement.endDate, 1) : '');

/**
 * What the full-time contract an intern's agreement converts to starts with: fixed-term for the settings' months, from
 * the day after the agreement ends; the settings' probation (it may be 0 to 3), none for someone who had an employment
 * here before (probation comes once with an employer, Labour Law Art. 90; the agreement had none); a gross still to
 * type, and the agreement's working days and allowances (the transportation allowance goes on unless HR removes it).
 */
export function conversionDefaults(settings: ContractSettings, agreement: Contract, employedBefore: boolean): ContractDefaults {
  return {
    startDate: conversionStart(agreement),
    form: 'fixed',
    durationMonths: settings.durationMonths,
    jobToDo: '',
    endDate: '',
    probationMonths: employedBefore ? 0 : settings.probationMonths,
    payBasis: 'monthly',
    grossSalary: null,
    hourlyRate: null,
    hoursPerWeek: null,
    daysPerWeek: agreement.daysPerWeek ?? null,
    basicPercent: settings.basicPercentDefault ?? agreement.basicPercent ?? 80,
    netSalary: null,
    allowances: (agreement.allowances ?? []).map((a) => ({ allowanceTypeId: a.allowanceTypeId, amount: a.amount })),
    note: '',
  };
}

/** Under Signed on, for the full-time contract an agreement converts to: what signing it does. */
export const CONVERSION_SIGN_HINT =
  "The day the employee and the company signed it. Signing makes the employment full-time, on probation while the contract's probation runs, and it replaces the agreement. A signed contract can't be changed, except its filing dates and note.";

/** Under the full-time contract's start date: from when it runs. */
export const CONVERSION_START_HINT = 'The day after the agreement ends, unless the full-time contract starts earlier. It must start after the agreement’s start.';

/** Under its probation, for someone with no earlier employment here. */
export const CONVERSION_PROBATION_HINT =
  'At most 3 months, 0 for none: the agreement had no probation, so the full-time contract may have it, once with the company (Labour Law Art. 90).';

// ---------- a new agreement, 6 months after the last ----------

/**
 * Hiring someone as an intern too soon after their last agreement ended: the plain warning (the API refuses it), for the
 * join date typed or, before one is, today. Null for another type, someone who never had one, or a date from the 6
 * months on.
 */
export function hireTooSoonText(x: {
  type: EmploymentType | string;
  joinDate: string | null;
  today: string;
  name: string;
  nextTraining: { lastEnded: string; from: string } | null | undefined;
}): string | null {
  if (!isTrainingType(x.type) || !x.nextTraining) return null;
  const date = x.joinDate || x.today;
  return trainingTooSoon(x.nextTraining.lastEnded, date) ? trainingTooSoonMessage(x.name, x.nextTraining.lastEnded) : null;
}
