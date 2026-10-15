import type { PayBasis } from '@trendlix/shared';
import { allowancesFrom } from '../../../lib/allowances';
import { dateFrom } from '../../../lib/form-data';
import { MAX_HOURS_PER_WEEK, parseAmount, parseHours } from './[id]/contracts/salary';

// The contract form's fields as the API takes them (pure code, tested; relative imports for the tests), for the
// drafting actions in contract-actions.ts. Dates are typed as DD/MM/YYYY and sent as YYYY-MM-DD; amounts are typed as
// "15,000" and sent as numbers.

const text = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();

/** A whole number of months, within limits; "" → undefined (the API's default). */
function monthsFrom(fd: FormData, key: string, label: string, max: number, errors: string[]): number | undefined {
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
 * The contract form's fields (contracts/contract-form.tsx). A renewal has no start date or probation to send: it
 * starts the day after the previous version ends, without probation. Every contract runs for a fixed term (owner, 15
 * October 2026), so the length is always sent and the form (always fixed) isn't. The pay (owner's requests of the same
 * day) is a monthly salary, its gross, or by the hour, the rate and the hours a week, from which the API works out the
 * gross (the monthly estimate); then the working days a week, and the allowances, which replace the contract's set.
 * Starting from the net per hour (rateBasis 'net'), the rate is the gross rate the form worked out from it, so a
 * missing one asks for the net per hour. `draft`: changing a draft, where an emptied net or number of working days is
 * cleared (null); a new contract just leaves them out.
 */
export function contractBody(fd: FormData, errors: string[], renewal: boolean, draft: boolean) {
  const startDate = renewal ? '' : dateFrom(fd, 'startDate', 'start date', errors);
  const durationMonths = monthsFrom(fd, 'durationMonths', 'length', 60, errors);
  if (durationMonths === 0) errors.push('A fixed term runs for 1 to 60 months.');
  const probationMonths = renewal ? undefined : monthsFrom(fd, 'probationMonths', 'probation', 3, errors);
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
    ...(startDate && { startDate }),
    ...(durationMonths !== undefined && { durationMonths }),
    ...(probationMonths !== undefined && { probationMonths }),
    payBasis,
    ...pay,
    ...(daysPerWeek !== null ? { daysPerWeek } : draft ? { daysPerWeek: null } : {}),
    ...(basicPercent !== undefined && { basicPercent }),
    ...(netSalary !== null ? { netSalary } : draft ? { netSalary: null } : {}),
    allowances: allowancesFrom(fd, errors),
    note: text(fd, 'note'),
  };
}
