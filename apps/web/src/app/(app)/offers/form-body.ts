import { OFFER_VALID_DAYS, PROBATION_MONTHS, type PayBasis } from '@trendlix/shared';
import { dateFrom } from '../../../lib/form-data';
import type { ContractSettings, FormState, OfferView } from '../../../lib/types';
import { addDays } from '../employees/[id]/contracts/dates';
import { MAX_HOURS_PER_WEEK, parseAmount } from '../employees/[id]/contracts/salary';
import { HOURS_INVALID, parseHours, payBasisFrom } from './terms';

// The offer forms as the API takes them, and what they start with (pure code, tested; relative imports for the
// tests). Dates are typed as DD/MM/YYYY and sent as YYYY-MM-DD; amounts are typed as "15,000" and sent as numbers.

const text = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();

/** The submitted values, so the form can be refilled after an error. */
export function submitted(fd: FormData): NonNullable<FormState['values']> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(fd.keys())) {
    if (key.startsWith('$ACTION')) continue;
    const all = fd.getAll(key).filter((v) => typeof v === 'string');
    if (all.length > 0) out[key] = all.length > 1 ? all : all[0];
  }
  return out;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** An email address as typed: trimmed and in small letters; a mistake when it isn't one. */
function emailFrom(fd: FormData, key: string, missing: string, errors: string[]): string {
  const email = text(fd, key).toLowerCase();
  if (!email) errors.push(missing);
  else if (!EMAIL.test(email)) errors.push('Enter a valid email address, e.g. name@example.com.');
  return email;
}

/** A required DD/MM/YYYY date as YYYY-MM-DD. */
function requiredDate(fd: FormData, key: string, label: string, errors: string[]): string {
  if (text(fd, key) === '') {
    errors.push(`Enter the ${label}, e.g. 14/10/2026.`);
    return '';
  }
  return dateFrom(fd, key, label, errors);
}

/** An amount in EGP; "" → null (a mistake with `missing`). */
function amountFrom(fd: FormData, key: string, label: string, errors: string[], missing?: string): number | null {
  const n = parseAmount(text(fd, key));
  if (n === null) {
    if (missing) errors.push(missing);
    return null;
  }
  if (Number.isNaN(n) || n <= 0) {
    errors.push(`Enter the ${label} as an amount in EGP, e.g. 15,000.`);
    return null;
  }
  return n;
}

/** A whole number within limits; "" → undefined (the API's default). */
function wholeFrom(fd: FormData, key: string, min: number, max: number, mistake: string, errors: string[]): number | undefined {
  const raw = text(fd, key);
  if (raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    errors.push(mistake);
    return undefined;
  }
  return n;
}

/** An allowance as the API takes it (lib/allowances.ts reads the rows). */
export interface OfferAllowanceInput {
  allowanceTypeId: string;
  amount: number;
}

/**
 * The offer form's fields (offer-form.tsx) as POST /offers takes them, or a draft's PATCH. `draft`: changing a draft,
 * where an emptied optional field is cleared (null) and the other pay basis's fields too; a new offer leaves them out.
 * `allowances`: the rows, already read (allowancesFrom). By the hour, `grossSalary` is the monthly estimate the form
 * worked out, and typing the net per hour (rateBasis 'net'), `hourlyRate` is the gross rate worked out from it; typing
 * the net, `grossSalary` is the gross worked out from it; `netSalary` is the net worked out, either way.
 */
export function offerBody(fd: FormData, errors: string[], { draft, allowances }: { draft: boolean; allowances: OfferAllowanceInput[] }) {
  const cleared = draft ? null : undefined;
  const optional = (key: string) => text(fd, key) || cleared;

  const fullNameEn = text(fd, 'fullNameEn');
  if (!fullNameEn) errors.push("Enter the candidate's full name in English.");
  const fullNameAr = text(fd, 'fullNameAr');
  if (!fullNameAr) errors.push("Enter the candidate's full name in Arabic, as on their national ID.");
  const email = emailFrom(fd, 'email', "Enter the candidate's personal email: the offer is sent there.", errors);

  const employmentType = text(fd, 'employmentType');
  if (!employmentType) errors.push('Choose the employment type.');
  const workArrangement = text(fd, 'workArrangement') || 'office';
  const officeDays =
    workArrangement === 'hybrid'
      ? fd
          .getAll('officeDays')
          .map(Number)
          .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      : [];
  if (workArrangement === 'hybrid' && officeDays.length === 0) errors.push('Pick at least one office day for a hybrid arrangement.');
  const joinDate = requiredDate(fd, 'joinDate', 'join date', errors);

  const payBasis: PayBasis = payBasisFrom(text(fd, 'payBasis'));
  const hourly = payBasis === 'hourly';
  const net = text(fd, 'salaryBasis') === 'net';
  const netRate = text(fd, 'rateBasis') === 'net';
  let hourlyRate: number | null | undefined = cleared;
  let hoursPerWeek: number | null | undefined = cleared;
  let grossSalary: number | null;
  if (hourly) {
    hourlyRate = netRate
      ? amountFrom(fd, 'hourlyRate', 'hourly rate', errors, 'Enter the net per hour as an amount in EGP, e.g. 120.')
      : amountFrom(fd, 'hourlyRate', 'hourly rate', errors, 'Enter the hourly rate, e.g. 150.');
    const hours = parseHours(text(fd, 'hoursPerWeek'));
    if (hours === null) errors.push('Enter the hours a week, e.g. 20.');
    const hoursOk = hours !== null && !Number.isNaN(hours) && hours > 0 && hours <= MAX_HOURS_PER_WEEK;
    if (hours !== null && !hoursOk) errors.push(HOURS_INVALID);
    hoursPerWeek = hoursOk ? hours : null;
    // the monthly estimate, worked out by the form; left out when the rate or the hours are wrong
    grossSalary = hourlyRate !== null && hoursPerWeek !== null ? amountFrom(fd, 'grossSalary', 'monthly estimate', errors) : null;
  } else {
    grossSalary = net
      ? amountFrom(fd, 'grossSalary', 'gross salary', errors, 'Enter the net salary wanted as an amount in EGP, e.g. 13,000.')
      : amountFrom(fd, 'grossSalary', 'gross salary', errors, 'Enter the gross salary, e.g. 15,000.');
  }
  const daysPerWeek = wholeFrom(fd, 'daysPerWeek', 1, 6, 'Enter the working days a week as a whole number from 1 to 6, e.g. 3.', errors);
  const basicPercent = wholeFrom(fd, 'basicPercent', 1, 100, 'Enter the basic part as a whole percent of the gross, from 1 to 100, e.g. 80.', errors);
  const netSalary = amountFrom(fd, 'netSalary', 'net salary', errors);
  const probationMonths = wholeFrom(fd, 'probationMonths', 0, 3, 'Enter the probation as a whole number of months, from 0 to 3.', errors);
  const durationMonths = wholeFrom(fd, 'durationMonths', 1, 60, "Enter the contract's length as a whole number of months, from 1 to 60.", errors);
  const expiresOn = dateFrom(fd, 'expiresOn', 'last day to accept', errors);

  return {
    fullNameEn,
    fullNameAr,
    email,
    mobile: optional('mobile'),
    employeeId: optional('employeeId'),
    employmentType,
    departmentId: optional('departmentId'),
    // a job title picker left disabled sends nothing, which clears the job title
    jobTitleId: optional('jobTitleId'),
    gradeId: optional('gradeId'),
    managerId: optional('managerId'),
    shiftId: optional('shiftId'),
    workArrangement,
    officeDays,
    joinDate,
    payBasis,
    ...(grossSalary !== null && { grossSalary }),
    hourlyRate,
    hoursPerWeek,
    daysPerWeek: daysPerWeek ?? cleared,
    ...(basicPercent !== undefined && { basicPercent }),
    netSalary: netSalary ?? cleared,
    ...(probationMonths !== undefined && { probationMonths }),
    ...(durationMonths !== undefined && { durationMonths }),
    allowances,
    ...(expiresOn && { expiresOn }),
    message: text(fd, 'message'),
    note: text(fd, 'note'),
  };
}

/** A sent (or expired) offer changes only in its last day to accept and its note. */
export function sentOfferBody(fd: FormData, errors: string[]) {
  return { expiresOn: requiredDate(fd, 'expiresOn', 'last day to accept', errors), note: text(fd, 'note') };
}

/** Extend: a new last day to accept. */
export function extendBody(fd: FormData, errors: string[]) {
  return { expiresOn: requiredDate(fd, 'expiresOn', 'new last day to accept', errors) };
}

/** Withdraw: why, if HR says. */
export function withdrawBody(fd: FormData) {
  const reason = text(fd, 'reason');
  return reason ? { reason } : {};
}

/** An answer the candidate gave another way (by phone, in person), recorded by HR. */
export function answerBody(fd: FormData, errors: string[]) {
  const answer = text(fd, 'answer');
  if (answer !== 'accepted' && answer !== 'declined') errors.push('Choose whether the candidate accepted or declined.');
  const reason = text(fd, 'reason');
  return { answer, ...(reason && { reason }) };
}

/** Sending by email: to the address typed (the offer's email to start with). */
export function emailSendBody(fd: FormData, origin: string, errors: string[]) {
  const to = emailFrom(fd, 'to', 'Enter the email address to send the offer to.', errors);
  return { via: 'email' as const, origin, to };
}

// ---------- what the form starts with ----------

/** The offer form's starting values. Dates are YYYY-MM-DD ('' for none). */
export interface OfferDefaults {
  fullNameEn: string;
  fullNameAr: string;
  email: string;
  mobile: string;
  employeeId: string;
  employmentType: string;
  departmentId: string;
  jobTitleId: string;
  gradeId: string;
  managerId: string;
  shiftId: string;
  workArrangement: string;
  officeDays: number[];
  joinDate: string;
  payBasis: PayBasis;
  grossSalary: number | null;
  hourlyRate: number | null;
  hoursPerWeek: number | null;
  daysPerWeek: number | null;
  basicPercent: number;
  netSalary: number | null;
  allowances: OfferAllowanceInput[];
  probationMonths: number;
  durationMonths: number;
  expiresOn: string;
  message: string;
  note: string;
}

/** The basic part of the gross unless HR sets another, as on contracts; the contract settings' when they have it. */
export const DEFAULT_BASIC_PERCENT = 80;

/**
 * A new offer: the contract settings' probation and length (3 and 12 months unless HR or Admin changed them) and basic
 * share of the gross (80%, changed on Payroll Setup), open until today + OFFER_VALID_DAYS (7).
 */
export function newOfferDefaults(settings: ContractSettings | null, today: string): OfferDefaults {
  return {
    fullNameEn: '',
    fullNameAr: '',
    email: '',
    mobile: '',
    employeeId: '',
    employmentType: '',
    departmentId: '',
    jobTitleId: '',
    gradeId: '',
    managerId: '',
    shiftId: '',
    workArrangement: 'office',
    officeDays: [],
    joinDate: '',
    payBasis: 'monthly',
    grossSalary: null,
    hourlyRate: null,
    hoursPerWeek: null,
    daysPerWeek: null,
    // the company's default share (Payroll Setup, 16 October 2026)
    basicPercent: settings?.basicPercentDefault ?? DEFAULT_BASIC_PERCENT,
    netSalary: null,
    allowances: [],
    probationMonths: settings?.probationMonths ?? PROBATION_MONTHS,
    durationMonths: settings?.durationMonths ?? 12,
    expiresOn: addDays(today, OFFER_VALID_DAYS),
    message: '',
    note: '',
  };
}

/** A draft as it is, to change. */
export function offerDefaults(o: OfferView): OfferDefaults {
  return {
    fullNameEn: o.fullNameEn,
    fullNameAr: o.fullNameAr,
    email: o.email,
    mobile: o.mobile ?? '',
    employeeId: o.employeeId ?? '',
    employmentType: o.employmentType,
    departmentId: o.department?.id ?? '',
    jobTitleId: o.jobTitle?.id ?? '',
    gradeId: o.grade?.id ?? '',
    managerId: o.manager?.id ?? '',
    shiftId: o.shift?.id ?? '',
    workArrangement: o.workArrangement,
    officeDays: o.officeDays ?? [],
    joinDate: o.joinDate,
    payBasis: payBasisFrom(o.payBasis),
    grossSalary: o.grossSalary,
    hourlyRate: o.hourlyRate,
    hoursPerWeek: o.hoursPerWeek,
    daysPerWeek: o.daysPerWeek,
    basicPercent: o.basicPercent ?? DEFAULT_BASIC_PERCENT,
    netSalary: o.netSalary,
    allowances: (o.allowances ?? []).map((a) => ({ allowanceTypeId: a.allowanceTypeId, amount: a.amount })),
    probationMonths: o.probationMonths,
    durationMonths: o.durationMonths,
    expiresOn: o.expiresOn,
    message: o.message ?? '',
    note: o.note ?? '',
  };
}
