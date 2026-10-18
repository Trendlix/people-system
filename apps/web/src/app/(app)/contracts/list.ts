import {
  CONTRACT_FORM_LABELS,
  CONTRACT_FORMS,
  CONTRACT_STATUS_LABELS,
  EMPLOYMENT_TYPES,
  ENDING_STATUS_LABELS,
  type ContractForm,
  type ContractStatus,
  type EmploymentType,
  type EndingStatus,
  type Role,
} from '@trendlix/shared';
import { hasRole } from '../../../lib/roles';
import type { ContractListItem, EndingSummary } from '../../../lib/types';

// Plain helpers for the Contracts page (no server-only, so they are unit tested): who sees it, its filters as they are
// read from the address and sent on to GET /api/contracts, and the order of what it lists. Relative imports: the tests
// run without the "@/" alias.

type WithRoles = { roles: readonly Role[] };

/** HR, the CEO and Finance see every contract (GET /contracts); the sidebar shows them the link. The API checks this again. */
export const CONTRACTS_ROLES: readonly Role[] = ['hr', 'ceo', 'finance'];

export function canSeeContracts(user: WithRoles): boolean {
  return hasRole(user, ...CONTRACTS_ROLES);
}

/** The salary on a contract: HR, Finance and the CEO, as the API sends it (null with `salaryHidden` for anyone else). */
export function seesSalary(user: WithRoles): boolean {
  return hasRole(user, 'hr', 'finance', 'ceo');
}

// ---------- the filters ----------

/** '' = drafts and signed, as the API lists without a status; 'all' = every status. */
export type StatusFilter = '' | ContractStatus | 'all';

/** The status choices, in the order the filter offers them. */
export const STATUS_FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: '', label: 'Drafts and signed' },
  { value: 'active', label: CONTRACT_STATUS_LABELS.active },
  { value: 'draft', label: 'Drafts' },
  { value: 'ended', label: CONTRACT_STATUS_LABELS.ended },
  { value: 'superseded', label: CONTRACT_STATUS_LABELS.superseded },
  { value: 'all', label: 'All' },
];

/** "Ending within" choices, in days. */
export const ENDING_WITHIN_DAYS = [30, 60, 90] as const;

/** "Contract length" choices: fixed-term, open-ended or for a specific job (owner, 18 October 2026: by the labour law). */
export const FORM_FILTERS: readonly { value: ContractForm | ''; label: string }[] = [
  { value: '', label: 'Any length' },
  ...CONTRACT_FORMS.map((f) => ({ value: f, label: CONTRACT_FORM_LABELS[f] })),
];

// The filter by length came back on 18 October 2026, with open-ended and specific-job contracts (from 15 October every
// contract had been fixed-term, and ?form= was left out).
export interface ContractFilters {
  q: string;
  status: StatusFilter;
  type: EmploymentType | '';
  form: ContractForm | '';
  /** Signed contracts ending within this many days, those past their end included; null = any. */
  endingWithin: number | null;
}

export const NO_FILTERS: ContractFilters = { q: '', status: '', type: '', form: '', endingWithin: null };

type Query = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');
const oneOf = <T extends string>(value: string, allowed: readonly T[]): T | '' => ((allowed as readonly string[]).includes(value) ? (value as T) : '');

/** The filters in the page's address; anything it doesn't know is left out, as if not chosen. */
export function readFilters(query: Query): ContractFilters {
  const days = Number(one(query.endingWithin));
  return {
    q: one(query.q).trim().slice(0, 100),
    status: oneOf(one(query.status), STATUS_FILTERS.map((s) => s.value)),
    type: oneOf(one(query.type), EMPLOYMENT_TYPES),
    form: oneOf(one(query.form), CONTRACT_FORMS),
    endingWithin: (ENDING_WITHIN_DAYS as readonly number[]).includes(days) ? days : null,
  };
}

/** Whether any filter is chosen (the default status, drafts and signed, is not one). */
export function isFiltered(f: ContractFilters): boolean {
  return Boolean(f.q || f.status || f.type || f.form || f.endingWithin !== null);
}

/** The filters as a query string, without the empty ones and in a fixed order: "status=active&endingWithin=30". */
function queryOf(f: ContractFilters, status: string): string {
  const params = new URLSearchParams();
  if (f.q) params.set('q', f.q);
  if (status) params.set('status', status);
  if (f.type) params.set('type', f.type);
  if (f.form) params.set('form', f.form);
  if (f.endingWithin !== null) params.set('endingWithin', String(f.endingWithin));
  return params.toString();
}

const withQuery = (path: string, qs: string) => (qs ? `${path}?${qs}` : path);

/** The page's address for these filters, to share or to change one filter from. */
export function contractsHref(f: ContractFilters): string {
  return withQuery('/contracts', queryOf(f, f.status));
}

/**
 * What to ask GET /api/contracts for these filters (paths under /api): one request, except for All. The API takes one
 * status at a time and lists drafts and signed ones without it, so All asks for those, then the ended and the replaced
 * ones (`mergeAll` puts them together). With "Ending within", the API keeps signed contracts only, so one request does.
 */
export function listPaths(f: ContractFilters): string[] {
  if (f.status === 'all' && f.endingWithin === null) {
    return [withQuery('/contracts', queryOf(f, '')), withQuery('/contracts', queryOf(f, 'ended')), withQuery('/contracts', queryOf(f, 'superseded'))];
  }
  return [withQuery('/contracts', queryOf(f, f.status === 'all' ? '' : f.status))];
}

/** Newest start first, then the higher number: how the API orders ended and replaced contracts. */
function newestFirst(a: ContractListItem, b: ContractListItem): number {
  return b.startDate.localeCompare(a.startDate) || b.number.localeCompare(a.number);
}

/**
 * The answers to `listPaths` as one list, in the API's own order: signed by end date, then drafts (both as the first
 * answer has them), then ended and replaced together, newest first.
 */
export function mergeAll(answers: ContractListItem[][]): ContractListItem[] {
  const [first = [], ...rest] = answers;
  return [...first, ...rest.flat().sort(newestFirst)];
}

/** "1 contract", "12 contracts". */
export function countLabel(n: number): string {
  return `${n} ${n === 1 ? 'contract' : 'contracts'}`;
}

// ---------- needs attention ----------

/** How far ahead the panels look, in days: as on the home page (the non-renewal notice is due about 9 weeks before the end). */
export const CONTRACTS_WITHIN = 90;
export const PROBATION_WITHIN = 30;

/** The endings HR approved and the CEO approved too: the employment is in its notice period until the last working day. */
export const APPROVED_ENDINGS = '/endings?status=approved';

/** Rows by a date (YYYY-MM-DD), soonest first; null stays null (it couldn't load). */
export function byDate<T>(rows: T[], date: (row: T) => string): T[];
export function byDate<T>(rows: T[] | null, date: (row: T) => string): T[] | null;
export function byDate<T>(rows: T[] | null, date: (row: T) => string): T[] | null {
  return rows && [...rows].sort((a, b) => date(a).localeCompare(date(b)));
}

/** The endings still going, by last working day: waiting for the CEO, and approved (in notice). Null when either couldn't load. */
export function endingsInProgress(pending: EndingSummary[] | null, approved: EndingSummary[] | null): EndingSummary[] | null {
  if (pending === null || approved === null) return null;
  return byDate([...pending, ...approved], (e) => e.lastWorkingDay);
}

/** Where an ending in progress stands: "Waiting for the CEO", or "Approved, in notice" until the last working day. */
export function endingStage(status: EndingStatus): string {
  if (status === 'approved') return `${ENDING_STATUS_LABELS.approved}, in notice`;
  return ENDING_STATUS_LABELS[status] ?? status;
}
