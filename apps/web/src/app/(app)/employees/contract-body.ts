import { CONTRACT_FORMS, RAISE_REASONS, type ContractForm, type PayBasis, type RaiseReason } from '@trendlix/shared';
import { allowancesFrom } from '../../../lib/allowances';
import { dateFrom } from '../../../lib/form-data';
import { MAX_HOURS_PER_WEEK, parseAmount, parseHours } from './[id]/contracts/salary';

// The contract form's fields as the API takes them (pure code, tested; relative imports for the tests), for the
// drafting actions in contract-actions.ts; its pay fields (payBody) also for the raise form (contracts/raise.ts). Dates
// are typed as DD/MM/YYYY and sent as YYYY-MM-DD; amounts are typed as "15,000" and sent as numbers.

const text = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();

/** A whole number of months, within limits; "" → undefined (the API's default). */
export function monthsFrom(fd: FormData, key: string, label: string, max: number, errors: string[]): number | undefined {
  const raw = text(fd, key);
  if (raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > max) {
    errors.push(`Enter the ${label} as a whole number of months, from 0 to ${max}.`);
    return undefined;
  }
  return n;
}

/** An amount in EGP; "" → null (a mistake when `required`). */
function amountFrom(fd: FormData, key: string, label: string, errors: string[], required = false, example = '15,000'): number | null {
  const n = parseAmount(text(fd, key));
  if (n === null) {
    if (required) errors.push(`Enter the ${label}, e.g. ${example}.`);
    return null;
  }
  if (Number.isNaN(n) || (required && n <= 0)) {
    errors.push(`Enter the ${label} as an amount in EGP${required ? ' above 0' : ''}, e.g. ${example}.`);
    return null;
  }
  return n;
}

/** By the hour: the contracted hours a week, required, above 0 and up to 48 (half hours as 22.5). */
function hoursFrom(fd: FormData, errors: string[]): number | null {
  const n = parseHours(text(fd, 'hoursPerWeek'));
  if (n === null || Number.isNaN(n) || n <= 0 || n > MAX_HOURS_PER_WEEK) {
    errors.push(`Enter the hours a week as a number above 0, up to ${MAX_HOURS_PER_WEEK}, e.g. 20 or 22.5.`);
    return null;
  }
  return n;
}

/** The working days a week, 1 to 6; "" → null (the shift's week). */
function daysFrom(fd: FormData, errors: string[]): number | null {
  const raw = text(fd, 'daysPerWeek');
  if (raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 6) {
    errors.push("Enter the working days a week as a whole number from 1 to 6, or leave it empty for the shift's week.");
    return null;
  }
  return n;
}

/**
 * The pay fields (contracts/pay-fields.tsx), of a contract or a raise. The pay (owner's requests of 15 October 2026) is
 * a monthly salary, its gross, or by the hour, the rate and the hours a week, from which the API works out the gross
 * (the monthly estimate); then the working days a week, and the allowances, which replace the version's set. Starting
 * from the net per hour (rateBasis 'net'), the rate is the gross rate the form worked out from it, so a missing one
 * asks for the net per hour. `draft`: changing a draft, where an emptied net or number of working days is cleared
 * (null); a new one just leaves them out.
 *
 * An intern's internship agreement pays no wage (owner, 19 October 2026: "we are not paying them salary, its just
 * transportation allowance"): the form says so (`unpaid`), and no gross is sent, not even 0, nor a net or a basic part:
 * the API keeps the gross at 0. A monthly salary, with the working days and the allowances, paid on top.
 */
export function payBody(fd: FormData, errors: string[], draft: boolean) {
  if (text(fd, 'unpaid') === '1') {
    const daysPerWeek = daysFrom(fd, errors);
    return {
      payBasis: 'monthly' as PayBasis,
      ...(daysPerWeek !== null ? { daysPerWeek } : draft ? { daysPerWeek: null } : {}),
      ...(draft && { netSalary: null }),
      allowances: allowancesFrom(fd, errors),
    };
  }
  const payBasis: PayBasis = text(fd, 'payBasis') === 'hourly' ? 'hourly' : 'monthly';
  const netRate = text(fd, 'rateBasis') === 'net';
  const pay =
    payBasis === 'hourly'
      ? {
          hourlyRate: amountFrom(fd, 'hourlyRate', netRate ? 'net per hour' : 'hourly rate', errors, true, netRate ? '120' : '150'),
          hoursPerWeek: hoursFrom(fd, errors),
        }
      : { grossSalary: amountFrom(fd, 'grossSalary', 'gross salary', errors, true) };
  const daysPerWeek = daysFrom(fd, errors);
  const basicRaw = text(fd, 'basicPercent');
  const basicPercent = basicRaw === '' ? undefined : Number(basicRaw);
  if (basicPercent !== undefined && !(Number.isInteger(basicPercent) && basicPercent >= 1 && basicPercent <= 100)) {
    errors.push('Enter the basic part as a whole percent of the gross, from 1 to 100, e.g. 80.');
  }
  const netSalary = amountFrom(fd, 'netSalary', 'net salary', errors);
  return {
    payBasis,
    ...pay,
    ...(daysPerWeek !== null ? { daysPerWeek } : draft ? { daysPerWeek: null } : {}),
    ...(basicPercent !== undefined && { basicPercent }),
    ...(netSalary !== null ? { netSalary } : draft ? { netSalary: null } : {}),
    allowances: allowancesFrom(fd, errors),
  };
}

/** Why the pay changes, chosen from the list (`key`: the field's name); a mistake when none is chosen. */
export function raiseReasonFrom(fd: FormData, key: string, errors: string[]): RaiseReason | undefined {
  const reason = text(fd, key);
  if ((RAISE_REASONS as readonly string[]).includes(reason)) return reason as RaiseReason;
  errors.push('Choose why the pay changes: annual raise, performance raise, counter-offer raise, promotion, market adjustment, cost of living or other.');
  return undefined;
}

/**
 * The contract's length (owner, 18 October 2026: "can we update the employment types based on the labour law?"), as the
 * API takes it: fixed-term (the default) for its months, 1 to 60; open-ended with no length or end date (Labour Law Art.
 * 87); for a specific job with the job, required, and its expected end date, if known (Art. 155).
 * `draft`: changing a draft, where an emptied expected end date is cleared (null).
 */
export function lengthBody(fd: FormData, errors: string[], draft: boolean) {
  const raw = text(fd, 'form');
  const form: ContractForm = (CONTRACT_FORMS as readonly string[]).includes(raw) ? (raw as ContractForm) : 'fixed';
  if (form === 'open_ended') return { form };
  if (form === 'specific_job') {
    const jobToDo = text(fd, 'jobToDo');
    if (!jobToDo) errors.push('Enter the job the contract is for: a contract for a specific job ends when it is done (Labour Law Art. 155).');
    const endDate = dateFrom(fd, 'endDate', 'expected end date', errors);
    return { form, jobToDo, ...(endDate ? { endDate } : draft ? { endDate: null } : {}) };
  }
  const durationMonths = monthsFrom(fd, 'durationMonths', 'length', 60, errors);
  if (durationMonths === 0) errors.push('A fixed term runs for 1 to 60 months.');
  return { form, ...(durationMonths !== undefined && { durationMonths }) };
}

/**
 * The contract form's fields (contracts/contract-form.tsx). A renewal has no start date or probation to send: it
 * starts the day after the previous version ends, without probation. Then its length (lengthBody), the pay (payBody)
 * and the note.
 *
 * A renewal whose pay changes counts as a raise (owner's decisions, 16 October 2026): the form asks whether the pay
 * changes (payChange), and when it does, why (raiseReason, required), which the API needs to send it to the CEO, who
 * approves it before it is signed. With the same pay (or no question: a first contract) no reason is sent.
 */
export function contractBody(fd: FormData, errors: string[], renewal: boolean, draft: boolean) {
  const startDate = renewal ? '' : dateFrom(fd, 'startDate', 'start date', errors);
  const length = lengthBody(fd, errors, draft);
  // an intern's agreement has no probation (19 October 2026): its form sends 0
  const probationMonths = renewal ? undefined : monthsFrom(fd, 'probationMonths', 'probation', 3, errors);
  const pay = payBody(fd, errors, draft);
  const raiseReason = text(fd, 'payChange') === 'changes' ? raiseReasonFrom(fd, 'raiseReason', errors) : undefined;
  return {
    ...(startDate && { startDate }),
    ...length,
    ...(probationMonths !== undefined && { probationMonths }),
    ...pay,
    ...(raiseReason && { raiseReason }),
    note: text(fd, 'note'),
  };
}

/**
 * Converting an intern's agreement to a full-time contract (owner, 19 October 2026: "or can be only
 * renewed 1 time, after that it should be converted to a full time contract"), as POST …/contracts takes it: the
 * full-time contract form's fields (contractBody, not a renewal: its start date and probation are sent, the agreement
 * having had none), with convertsTo. Signing it makes the employment full-time. No reason for a change of pay: it isn't a
 * raise.
 */
export function conversionBody(fd: FormData, errors: string[]) {
  return { ...contractBody(fd, errors, false, false), convertsTo: 'full_time' as const };
}
