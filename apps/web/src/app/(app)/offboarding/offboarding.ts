import {
  CLEARANCE_ITEM_STATUSES,
  CLEARANCE_OWNERS,
  END_REASONS,
  EXIT_RATINGS,
  exitInterviewProblems,
  OFFBOARDING_STATUSES,
  REHIRE_ELIGIBILITIES,
  REHIRE_LABELS,
  rehireProblems,
  type ClearanceItemStatus,
  type ClearanceOwner,
  type EndReason,
  type ExitRating,
  type OffboardingStatus,
  type RehireEligibility,
  type RehireMatch,
  type Role,
} from '@trendlix/shared';
import { formatDate } from '../../../lib/format';
import { SETUP_PATHS } from '../organization/setup-pages';

// Offboarding on the site (owner, 21 October 2026: "when an employee resigns or contract ends with no renewal, where will
// the data be stored? will it be another tab?"; 22 October 2026, the full module: "Former Employees tab, clearance
// checklist (assets returned, laptop, access), exit interview, rehire eligibility, turnover numbers"): the addresses,
// who sees what, reading the pages' filters and the forms. Pure code (relative imports), tested in offboarding.test.ts;
// the API checks everything again.

export const OFFBOARDING_PATH = '/offboarding';
/** The default clearance checklist, under Organization since 23 October 2026 (owner: "Recruitment and checklists"). */
export const OFFBOARDING_CHECKLIST_PATH = SETUP_PATHS.clearanceChecklist;
export const TURNOVER_PATH = '/offboarding/turnover';
export const FORMER_EMPLOYEES_PATH = '/employees/former';
export const MY_EXIT_INTERVIEW_PATH = '/my-requests/exit-interview';

export const caseHref = (id: string) => `${OFFBOARDING_PATH}/${encodeURIComponent(id)}`;
export const casePrintHref = (id: string) => `${caseHref(id)}/print`;
export const turnoverExcelHref = (year: number) => `${TURNOVER_PATH}/excel?year=${year}`;

type WithRoles = { roles: readonly Role[] };

/** Those who handle the cases (open, complete, the exit interview, rehire eligibility, the reports): HR, the CEO, a Super Admin. */
export const managesOffboarding = (user: WithRoles): boolean => user.roles.some((r) => r === 'hr' || r === 'ceo' || r === 'super_admin');

/**
 * Who has Offboarding in the sidebar: those who handle cases, and those who clear items on most of them (an Admin, a
 * Super Admin, Finance). A direct manager opens a case from its notification; the API lists what each may see.
 */
export const seesOffboardingList = (user: WithRoles): boolean => managesOffboarding(user) || user.roles.some((r) => r === 'admin' || r === 'finance');

// ---------- the list ----------

export type CasesFilter = OffboardingStatus | 'all';

export const CASE_FILTERS: readonly { value: CasesFilter; label: string }[] = [
  { value: 'open', label: 'In clearance' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All' },
];

/** ?status=: open (in clearance) unless another is chosen. */
export function readCasesFilter(query: Record<string, string | string[] | undefined>): CasesFilter {
  const v = typeof query.status === 'string' ? query.status : '';
  return (OFFBOARDING_STATUSES as readonly string[]).includes(v) || v === 'all' ? (v as CasesFilter) : 'open';
}

export const casesHref = (filter: CasesFilter) => (filter === 'open' ? OFFBOARDING_PATH : `${OFFBOARDING_PATH}?status=${filter}`);

/** "3 of 8 cleared". */
export const progressText = (p: { cleared: number; total: number }) => `${p.cleared} of ${p.total} cleared`;

export const STATUS_STYLE: Record<OffboardingStatus, string> = {
  open: 'bg-warn-soft text-warn',
  completed: 'bg-ok-soft text-ok',
  cancelled: 'bg-line-soft text-muted',
};

export const ITEM_STYLE: Record<ClearanceItemStatus, string> = {
  pending: 'bg-warn-soft text-warn',
  done: 'bg-ok-soft text-ok',
  not_applicable: 'bg-line-soft text-muted',
};

export const REHIRE_STYLE: Record<RehireEligibility, string> = {
  eligible: 'bg-ok-soft text-ok',
  conditional: 'bg-warn-soft text-warn',
  not_eligible: 'bg-danger-soft text-danger',
};

// ---------- the forms ----------

const text = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === 'string' ? v.trim() : '';
};

/** Clearing an item: done, not applicable or back to pending, and the note. */
export function markItemForm(fd: FormData): { body: { status: ClearanceItemStatus; note: string | null } | null; errors: string[] } {
  const status = text(fd, 'status');
  if (!(CLEARANCE_ITEM_STATUSES as readonly string[]).includes(status)) return { body: null, errors: ['Choose done, not applicable or pending.'] };
  const note = text(fd, 'note');
  if (note.length > 500) return { body: null, errors: ['Keep the note to 500 characters or fewer.'] };
  return { body: { status: status as ClearanceItemStatus, note: note || null }, errors: [] };
}

/** A one-off item: its name and who clears it. */
export function addItemForm(fd: FormData): { body: { label: string; owner: ClearanceOwner } | null; errors: string[] } {
  const label = text(fd, 'label').replace(/\s+/g, ' ');
  const owner = text(fd, 'owner');
  const errors: string[] = [];
  if (!label) errors.push('Give the item a name.');
  else if (label.length > 120) errors.push('Keep the name to 120 characters or fewer.');
  if (!(CLEARANCE_OWNERS as readonly string[]).includes(owner)) errors.push('Choose who clears it.');
  return errors.length ? { body: null, errors } : { body: { label, owner: owner as ClearanceOwner }, errors };
}

/** The default checklist as typed: its rows, by their index (label-N, owner-N, id-N), in order; empty rows left out. */
export function checklistForm(fd: FormData): { items: { id?: string; label: string; owner: string }[] } {
  const items: { id?: string; label: string; owner: string }[] = [];
  for (let i = 0; i < 40; i++) {
    if (!fd.has(`label-${i}`)) continue;
    const label = text(fd, `label-${i}`).replace(/\s+/g, ' ');
    const owner = text(fd, `owner-${i}`);
    const id = text(fd, `id-${i}`);
    if (!label && !id) continue;
    items.push({ ...(id && { id }), label, owner });
  }
  return { items };
}

/** Rehire eligibility as chosen, with its reason; the shared rule's words when it isn't complete. */
export function rehireForm(fd: FormData): { body: { eligibility: RehireEligibility; reason: string | null } | null; errors: string[] } {
  const eligibility = text(fd, 'eligibility');
  const reason = text(fd, 'reason');
  const errors = rehireProblems({ eligibility, reason });
  if (errors.length) return { body: null, errors };
  return { body: { eligibility: eligibility as RehireEligibility, reason: reason || null }, errors };
}

/** The exit interview's answers as typed (rating-role … from 1 to 5), with the shared rule's words. */
export function exitInterviewForm(fd: FormData): {
  body: { reason: string; ratings: Record<ExitRating, number>; recommend: string; comments: string | null } | null;
  errors: string[];
} {
  const ratings = Object.fromEntries(EXIT_RATINGS.map((k) => [k, Number(text(fd, `rating-${k}`)) || 0])) as Record<ExitRating, number>;
  const body = { reason: text(fd, 'reason'), ratings, recommend: text(fd, 'recommend'), comments: text(fd, 'comments') || null };
  const errors = exitInterviewProblems(body);
  return errors.length ? { body: null, errors } : { body, errors };
}

/** What a form had typed, to show again after a refusal. */
export function typedValues(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === 'string' && !k.startsWith('$')) out[k] = v;
  return out;
}

// ---------- Former Employees ----------

export interface FormerQuery {
  year: string | null;
  reason: EndReason | null;
  departmentId: string | null;
}

const UUID = /^[0-9a-f-]{36}$/i;

export function readFormerQuery(query: Record<string, string | string[] | undefined>): FormerQuery {
  const one = (k: string) => (typeof query[k] === 'string' ? (query[k] as string) : '');
  const year = one('year');
  const reason = one('reason');
  const departmentId = one('departmentId');
  return {
    year: /^\d{4}$/.test(year) ? year : null,
    reason: (END_REASONS as readonly string[]).includes(reason) ? (reason as EndReason) : null,
    departmentId: UUID.test(departmentId) ? departmentId : null,
  };
}

/** GET /offboarding/former with the filters chosen. */
export function formerApiPath(q: FormerQuery): string {
  const params = new URLSearchParams();
  if (q.year) params.set('year', q.year);
  if (q.reason) params.set('reason', q.reason);
  if (q.departmentId) params.set('departmentId', q.departmentId);
  const qs = params.toString();
  return qs ? `/offboarding/former?${qs}` : '/offboarding/former';
}

// ---------- the turnover ----------

/** ?year=: this year (of `today`) unless a year from 2000 is chosen. */
export function readTurnoverYear(query: Record<string, string | string[] | undefined>, today: string): number {
  const v = typeof query.year === 'string' ? query.year : '';
  const n = /^\d{4}$/.test(v) ? Number(v) : NaN;
  return n >= 2000 && n <= 2100 ? n : Number(today.slice(0, 4));
}

/** "12.5%", or a dash with nobody employed. */
export const percentText = (rate: number | null): string => (rate === null ? '—' : `${rate.toFixed(1)}%`);

/** "March 2026" for "2026-03". */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// ---------- the rehire warning ----------

/**
 * The warning on a job offer or a new employment for someone who worked here (the brief: "a warning when a job offer or
 * a new hire matches a former employee, especially Not eligible"): who, when they left, and their eligibility.
 */
export function rehireWarningText(m: RehireMatch): string {
  const left = m.leftOn ? `left on ${formatDate(m.leftOn)}` : 'worked here before';
  const how = m.matchedBy === 'email' ? ' (the same email)' : m.matchedBy === 'national_id' ? ' (the same national ID)' : '';
  const eligibility = m.eligibility ? `Rehire: ${REHIRE_LABELS[m.eligibility]}${m.reason ? `: ${m.reason}` : '.'}` : 'No rehire decision was recorded.';
  return `${m.fullNameEn}${how} ${left}. ${eligibility}`;
}

/** Whether a warning is a strong one: someone not eligible to be hired again. */
export const strongWarning = (matches: readonly RehireMatch[]): boolean => matches.some((m) => m.eligibility === 'not_eligible');

/** The choices of rehire eligibility, in order. */
export const REHIRE_CHOICES = REHIRE_ELIGIBILITIES.map((value) => ({ value, label: REHIRE_LABELS[value] }));
