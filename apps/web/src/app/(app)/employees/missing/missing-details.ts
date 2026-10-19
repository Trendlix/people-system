import { confidentialPeople, type Standing } from '@trendlix/shared';
import type { EmploymentPlace, ProfileGap } from '../../../../lib/types';
import { profileHref } from '../tab-list';

// The Missing Details report (owner's request, 16 October 2026: "i want to generate a report with the missing personal
// profile fields and documents"): what each profile still lacks, by the same checklist as the profile's header, for
// HR and the CEO. Plain helpers for the page (no server-only, so they are unit tested): its filters as they are read
// from the address, which people it lists, the summary, and the missing items grouped as the page shows them. Relative
// imports: the tests run without the "@/" alias.

/** A row of GET /employees/missing: someone employed now or not employed yet (former employees are left out). */
export interface MissingDetailsRow {
  id: string;
  employeeCode: string;
  fullNameEn: string;
  fullNameAr: string;
  standing: Standing;
  /** The current employment's department, or its team (then `parent` is the department); null when not placed. */
  department: EmploymentPlace | null;
  jobTitle: { id: string; titleEn: string } | null;
  percent: number;
  missing: ProfileGap[];
}

/** GET /employees/missing: everyone's completeness, least complete first. */
export interface MissingDetailsReport {
  generatedAt: string;
  rows: MissingDetailsRow[];
  /**
   * How many C-level people the rows leave out for the caller (owner, 19 October 2026: "make C level Employees details
   * not visible to HR"); 0 for the CEO and the Super Admin, left out by an older API.
   */
  confidentialExcluded?: number;
}

/**
 * What the report says when C-level people are left out for the caller (owner, 19 October 2026): their details, not
 * amounts, as the payroll reports say: "C-level (2 people) are left out: only the CEO and the Super Admin see their
 * details."; null for none.
 */
export function confidentialExcludedText(count: number | null | undefined): string | null {
  if (typeof count !== 'number' || !(count > 0)) return null;
  return `${confidentialPeople(count)} ${count === 1 ? 'is' : 'are'} left out: only the CEO and the Super Admin see their details.`;
}

/** Where the browser downloads the report as an Excel workbook (a plain link, never prefetched). */
export const EXCEL_HREF = '/employees/missing/excel';

// ---------- the filters ----------

/** What is missing: anything, personal details (Basic Data, Education, Employment), or papers of the employee file. */
export type WhatFilter = '' | 'personal' | 'documents';

export const WHAT_FILTERS: readonly { value: WhatFilter; label: string }[] = [
  { value: '', label: 'Anything' },
  { value: 'personal', label: 'Personal details' },
  { value: 'documents', label: 'Documents' },
];

export interface MissingFilters {
  q: string;
  departmentId: string;
  what: WhatFilter;
  /** People not employed yet are listed too; by default only current employees are. */
  notEmployed: boolean;
}

export const NO_FILTERS: MissingFilters = { q: '', departmentId: '', what: '', notEmployed: false };

type Query = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f-]{36}$/i;
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

/** The filters in the page's address; anything it doesn't know is left out, as if not chosen. */
export function readFilters(query: Query): MissingFilters {
  const departmentId = one(query.departmentId);
  const what = one(query.what);
  return {
    q: one(query.q).trim().slice(0, 100),
    departmentId: UUID.test(departmentId) ? departmentId : '',
    what: WHAT_FILTERS.some((w) => w.value === what) ? (what as WhatFilter) : '',
    notEmployed: one(query.notEmployed) === '1',
  };
}

/** Whether any filter is chosen. */
export function isFiltered(f: MissingFilters): boolean {
  return Boolean(f.q || f.departmentId || f.what || f.notEmployed);
}

/** The page's address for these filters, leaving out the empty ones, so a view can be shared. */
export function missingHref(f: MissingFilters): string {
  const params = new URLSearchParams();
  if (f.q) params.set('q', f.q);
  if (f.departmentId) params.set('departmentId', f.departmentId);
  if (f.what) params.set('what', f.what);
  if (f.notEmployed) params.set('notEmployed', '1');
  const qs = params.toString();
  return qs ? `/employees/missing?${qs}` : '/employees/missing';
}

type Person = Pick<MissingDetailsRow, 'fullNameEn' | 'fullNameAr' | 'employeeCode' | 'standing' | 'department'>;

/**
 * The people the summary counts: those the search (name in English or Arabic, or employee code), the department (its
 * teams too: `inDepartment`, from withTeams) and the standing filter keep. Current employees only, unless people not
 * employed yet are asked for.
 */
export function inView<R extends Person>(rows: readonly R[], f: MissingFilters, inDepartment: ReadonlySet<string> | null): R[] {
  const needle = f.q.toLowerCase();
  return rows.filter(
    (r) =>
      (f.notEmployed || r.standing !== 'not_employed') &&
      (!needle || [r.fullNameEn, r.fullNameAr, r.employeeCode].some((v) => v.toLowerCase().includes(needle))) &&
      (!inDepartment || (r.department != null && inDepartment.has(r.department.id))),
  );
}

/** The people the table lists: of those in view, the ones with something missing of the kind chosen. */
export function listed<R extends Pick<MissingDetailsRow, 'missing'>>(rows: readonly R[], what: WhatFilter): R[] {
  return rows.filter((r) => (what === 'personal' ? personalGaps(r.missing).length > 0 : what === 'documents' ? documentGaps(r.missing).length > 0 : r.missing.length > 0));
}

// ---------- what the page says ----------

/** "18 of 25 people have something missing · 7 complete"; empty when no one is in view. */
export function summaryText(rows: readonly Pick<MissingDetailsRow, 'missing'>[]): string {
  const total = rows.length;
  if (total === 0) return '';
  const incomplete = rows.filter((r) => r.missing.length > 0).length;
  const verb = total === 1 || incomplete === 1 ? 'has' : 'have';
  return `${incomplete} of ${total} ${total === 1 ? 'person' : 'people'} ${verb} something missing · ${total - incomplete} complete`;
}

/** The parts of the profile personal details are filled in on, in the order of its tabs, as the report names them. */
export const PERSONAL_SECTIONS: readonly { tab: Exclude<ProfileGap['tab'], 'documents'>; label: string }[] = [
  { tab: 'basic', label: 'Basic data' },
  { tab: 'education', label: 'Education' },
  { tab: 'employment', label: 'Employment' },
];

/** The missing personal details (everything but papers). */
export const personalGaps = <G extends Pick<ProfileGap, 'tab'>>(missing: readonly G[]): G[] => missing.filter((m) => m.tab !== 'documents');

/** The missing papers of the employee file. */
export const documentGaps = <G extends Pick<ProfileGap, 'tab'>>(missing: readonly G[]): G[] => missing.filter((m) => m.tab === 'documents');

/** The missing personal details by section (Basic data, Education, Employment), leaving out a section with none. */
export function bySection<G extends Pick<ProfileGap, 'tab'>>(missing: readonly G[]): { tab: ProfileGap['tab']; label: string; gaps: G[] }[] {
  return PERSONAL_SECTIONS.map((s) => ({ ...s, gaps: missing.filter((m) => m.tab === s.tab) })).filter((s) => s.gaps.length > 0);
}

/**
 * Where a missing item is filled in, as the profile's header links it: the field's cell on Basic Data, Education or
 * Employment, or the paper's row on Documents. HR and the CEO, who see this report, can open every one of them.
 */
export function gapHref(employeeId: string, gap: Pick<ProfileGap, 'key' | 'tab'>): string {
  return `${profileHref(employeeId, gap.tab)}#${gap.tab === 'documents' ? 'paper' : 'field'}-${gap.key}`;
}
