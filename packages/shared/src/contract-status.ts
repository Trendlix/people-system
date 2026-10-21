// A person's contract status, as the Employees list shows it in place of the employee code (owner, 21 October 2026:
// "instead of the Emp code, add contract status"). Asked, the owner chose the Employees list only, and "State + end
// date": "Signed · ends 31/12/2026", "On probation until 15/01/2027", "Draft, not signed", "Ended 30/09/2026", "No
// contract", an end within 30 days in amber ("Signed · ends 05/11/2026 (in 15 days)"). Of the current employment: its
// approved ending's notice, else the contract in force (its latest signed version), else its latest draft. A trainee's
// training agreement and an intern's unpaid internship say so; freelance has no labour contract (Labour Law Art. 1(1)).
// Pure: the API sends the facts, the web words them with today in Cairo. Dates: YYYY-MM-DD; shown DD/MM/YYYY.

/** The days before an end that the status turns amber: an end within 30 days ("in 15 days"), or one already past. */
export const CONTRACT_SOON_DAYS = 30;

/** A contract version as the status reads it: the contract in force, else the latest draft. */
export interface ContractFacts {
  /** CONTRACT_STATUSES: active (signed) or draft; ended or superseded read as ended. */
  status: string;
  /** CONTRACT_FORMS: fixed, open_ended or specific_job. */
  form: string;
  startDate: string;
  /** None when open-ended, or a specific job's end not set. */
  endDate: string | null;
}

/** What the status is worked out from: the current employment, or the day the last one ended. */
export interface ContractStatusInput {
  /** The current employment; null when there is none. */
  employment: {
    employmentType: string;
    /** EMPLOYEE_STATUSES: probation while the employment's probation runs (until HR confirms it). */
    status: string;
    joinDate: string;
    probationEnd: string | null;
    /** Its contract in force, else its latest draft; null when it has none. */
    contract: ContractFacts | null;
    /** Its approved ending's last working day (the notice runs to it); null when none. */
    endingOn: string | null;
  } | null;
  /** The day the last employment ended, when there is no current one; null when never employed. */
  leftOn: string | null;
}

export const CONTRACT_STATES = [
  'signed', // signed and in force (open-ended, or ending on its end date)
  'starts', // signed, the employment starting later
  'probation', // signed, the probation running
  'draft', // a draft, not signed yet
  'ending', // an approved ending: in its notice
  'ended', // the end date passed, the employment going on
  'no_contract', // a current employment without a contract
  'freelance', // outside the labour law: no labour contract
  'left', // no current employment: the last one ended
  'no_employment', // never employed
] as const;
export type ContractState = (typeof CONTRACT_STATES)[number];

/** ok: in force; warn (amber): an end within 30 days or past; muted: nothing in force. */
export type ContractTone = 'ok' | 'warn' | 'muted';

export interface ContractStatusView {
  state: ContractState;
  /** In sentence case, e.g. "Signed · ends 05/11/2026 (in 15 days)". */
  text: string;
  /** The end the text names (the contract's, the probation's, the last working day, the day they left); null for none. */
  endsOn: string | null;
  tone: ContractTone;
}

/**
 * A person's contract status, today (YYYY-MM-DD, in Cairo unless given). In order: no current employment ("Left on
 * 30/09/2026", "No employment"); an approved ending ("Ending 30/11/2026 (notice)"); freelance ("Freelance: no labour
 * contract"); no contract ("No contract"); a draft ("Draft, not signed"); a signed one starting later ("Signed · starts
 * 01/11/2026"), on probation ("On probation until 15/01/2027"), past its end ("Ended 30/09/2026"), ending ("Signed · ends
 * 31/12/2026") or without an end ("Signed · open-ended", "Signed · for a specific job"). A trainee's reads "Training
 * agreement · …" and an intern's "Unpaid internship · …", neither with probation. An end within 30 days adds when, "(in 15
 * days)", "(tomorrow)", "(today)", and is amber, as is one already past.
 */
export function contractStatusOf(input: ContractStatusInput, today: string = todayInCairo()): ContractStatusView {
  const e = input.employment;
  if (!e) {
    return input.leftOn
      ? { state: 'left', text: `Left on ${shown(input.leftOn)}`, endsOn: input.leftOn, tone: 'muted' }
      : { state: 'no_employment', text: 'No employment', endsOn: null, tone: 'muted' };
  }
  // the notice of an ending the CEO approved runs to the last working day, whatever the contract
  if (e.endingOn) {
    const days = daysFrom(today, e.endingOn);
    const when = days < 0 ? ', passed' : days <= CONTRACT_SOON_DAYS ? `, ${inDays(days)}` : '';
    return { state: 'ending', text: `Ending ${shown(e.endingOn)} (notice${when})`, endsOn: e.endingOn, tone: toneOf(days) };
  }
  if (e.employmentType === 'freelance') return { state: 'freelance', text: 'Freelance: no labour contract', endsOn: null, tone: 'muted' };

  // a trainee's training agreement (Arts. 28–30) and an intern's unpaid internship: agreements, not employment contracts
  const agreement = e.employmentType === 'trainee' ? 'Training agreement' : e.employmentType === 'intern' ? 'Unpaid internship' : null;
  const c = e.contract;
  if (!c) {
    const text = e.employmentType === 'trainee' ? 'No training agreement' : e.employmentType === 'intern' ? 'Unpaid internship · no agreement' : 'No contract';
    return { state: 'no_contract', text, endsOn: null, tone: 'muted' };
  }
  if (c.status === 'draft') return { state: 'draft', text: agreement ? `${agreement} · draft, not signed` : 'Draft, not signed', endsOn: null, tone: 'muted' };
  // ended or replaced, nothing in force (a current employment's signed contract ends only with it: not sent so)
  if (c.status !== 'active') return { state: 'ended', text: endedText(agreement, c.endDate), endsOn: c.endDate, tone: 'muted' };

  // signed: a new joiner's first day still ahead
  if (e.joinDate > today && c.startDate > today) {
    return { state: 'starts', text: `${agreement ?? 'Signed'} · starts ${shown(c.startDate)}`, endsOn: c.endDate, tone: 'ok' };
  }
  // the probation of an employment contract (Art. 90), while it runs
  if (!agreement && e.status === 'probation' && e.probationEnd && e.probationEnd >= today) {
    const days = daysFrom(today, e.probationEnd);
    return { state: 'probation', text: `On probation until ${shown(e.probationEnd)}${soon(days)}`, endsOn: e.probationEnd, tone: toneOf(days) };
  }
  if (!c.endDate) {
    const text = c.form === 'specific_job' ? `${agreement ?? 'Signed'} · for a specific job` : `${agreement ?? 'Signed'} · open-ended`;
    return { state: 'signed', text, endsOn: null, tone: 'ok' };
  }
  const days = daysFrom(today, c.endDate);
  // past its end with the employment going on, not renewed (a fixed term then open-ended by Art. 88(3))
  if (days < 0) return { state: 'ended', text: endedText(agreement, c.endDate), endsOn: c.endDate, tone: 'warn' };
  return { state: 'signed', text: `${agreement ?? 'Signed'} · ends ${shown(c.endDate)}${soon(days)}`, endsOn: c.endDate, tone: toneOf(days) };
}

/** "Ended 30/09/2026", or an agreement's "Training agreement · ended 30/09/2026"; without the date when it has none. */
function endedText(agreement: string | null, end: string | null): string {
  const on = end ? ` ${shown(end)}` : '';
  return agreement ? `${agreement} · ended${on}` : `Ended${on}`;
}

// ---------- dates ----------

const CAIRO_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' });
/** Today in Cairo, YYYY-MM-DD. */
const todayInCairo = () => CAIRO_DAY.format(new Date());
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A date as the screens show it: DD/MM/YYYY. */
const shown = (date: string) => (DATE.test(date) ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : date);
/** Whole days from one day to another: negative when it is before. */
const daysFrom = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const inDays = (days: number) => (days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`);
/** " (in 15 days)" for an end within 30 days, else nothing. */
const soon = (days: number) => (days >= 0 && days <= CONTRACT_SOON_DAYS ? ` (${inDays(days)})` : '');
const toneOf = (days: number): ContractTone => (days <= CONTRACT_SOON_DAYS ? 'warn' : 'ok');
