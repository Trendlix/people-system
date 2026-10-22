import {
  APPLICATION_CHANNELS,
  GENERAL_CV_SOURCES,
  GENERAL_CV_STATUSES,
  generalCvProblems,
  HR_CV_SOURCES,
  type ApplicationListItem,
  type ApplicationSource,
  type CvBatchTarget,
  type CvSaveRow,
  type CvUploadView,
  type GeneralCvInput,
  type GeneralCvSource,
  type GeneralCvStatus,
  type VacancyApplicantsGroup,
  type VacancyListItem,
} from '@trendlix/shared';
import { generalApiForm, generalInputOf, generalTypedValues, OTHER_AREA } from '../../careers/careers';
import { APPLICANTS_PATH, applicantsHref, vacancyHref, type ApplicantsQuery } from './recruitment';

// General CVs and the applicants by posted job on the site (owner, 22 October 2026: "i want a proper viweing, what came
// out of the posted jobs and what cam on randomly", "Both"; "is there a way to easy apply from linkedin?" … "why not";
// packages/shared general-cvs.ts): the addresses, the Applicants page's two tabs, the posted jobs grouped by vacancy
// with their sources, the general CVs' filters, and the bulk upload's rows. Pure code (relative imports), tested in
// general.test.ts; the API checks everything again.

export const GENERAL_CVS_PATH = '/recruitment/general-cvs';
export const NEW_GENERAL_CV_PATH = '/recruitment/general-cvs/new';
export const GENERAL_BULK_PATH = '/recruitment/general-cvs/bulk';

export const generalCvHref = (id: string) => `${GENERAL_CVS_PATH}/${encodeURIComponent(id)}`;
export const generalCvFileHref = (id: string, download = false) => `${generalCvHref(id)}/cv${download ? '?download=1' : ''}`;
export const vacancyBulkHref = (vacancyId: string) => `${vacancyHref(vacancyId)}/bulk`;

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? '')).trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- the Applicants page's tabs ----------

/** The Applicants page's tabs: the posted jobs' applicants, and the general CVs. */
export type ApplicantsTab = 'posted' | 'general';

export const readTab = (query: Record<string, string | string[] | undefined>): ApplicantsTab => (one(query.tab) === 'general' ? 'general' : 'posted');

/** A tab's address (the posted jobs' is the page's own). */
export const tabHref = (tab: ApplicantsTab) => (tab === 'general' ? `${APPLICANTS_PATH}?tab=general` : APPLICANTS_PATH);

/** Whether a filter narrows the posted jobs' list (then a vacancy without a match is left out). */
export const filtering = (q: ApplicantsQuery): boolean =>
  !!(q.vacancyId || q.stage || q.source || q.q || q.minMatch !== null || q.minYears !== null || q.filtered !== 'hide');

/**
 * The posted jobs' applicants grouped by vacancy, in the summary's order (open first, then on hold, closed, filled):
 * each with its counts and the rows the filters keep. A vacancy with no row kept is left out while filtering; without
 * filters, every vacancy anyone applied to stays (its applicants may all be filtered out).
 */
export function groupApplicants(groups: readonly VacancyApplicantsGroup[], rows: readonly ApplicationListItem[], isFiltering: boolean): { group: VacancyApplicantsGroup; rows: ApplicationListItem[] }[] {
  const byVacancy = new Map<string, ApplicationListItem[]>();
  for (const r of rows) byVacancy.set(r.vacancy.id, [...(byVacancy.get(r.vacancy.id) ?? []), r]);
  return groups
    .map((group) => ({ group, rows: byVacancy.get(group.vacancy.id) ?? [] }))
    .filter((g) => g.rows.length > 0 || (!isFiltering && g.group.total > 0));
}

/** A source's count on a vacancy's line as a link: its applicants from that source on the Applicants page. */
export const sourceFilterHref = (vacancyId: string, source: ApplicationSource) => applicantsHref(APPLICANTS_PATH, { vacancyId, source, filtered: 'all' });

// ---------- the general CVs' list ----------

/** The general CVs' filters, as the address carries them. */
export interface GeneralQuery {
  status: GeneralCvStatus | 'all' | '';
  source: GeneralCvSource | '';
  departmentId: string;
  q: string;
}

export function readGeneralQuery(query: Record<string, string | string[] | undefined>): GeneralQuery {
  const status = one(query.status);
  const source = one(query.source);
  const departmentId = one(query.departmentId);
  return {
    status: status === 'all' || (GENERAL_CV_STATUSES as readonly string[]).includes(status) ? (status as GeneralQuery['status']) : '',
    source: (GENERAL_CV_SOURCES as readonly string[]).includes(source) ? (source as GeneralCvSource) : '',
    departmentId: UUID.test(departmentId) ? departmentId : '',
    q: one(query.q).slice(0, 100),
  };
}

function generalParams(q: Partial<GeneralQuery>): URLSearchParams {
  const params = new URLSearchParams();
  if (q.status) params.set('status', q.status);
  if (q.source) params.set('source', q.source);
  if (q.departmentId) params.set('departmentId', q.departmentId);
  if (q.q) params.set('q', q.q);
  return params;
}

export const generalApiPath = (q: Partial<GeneralQuery>) => {
  const s = generalParams(q).toString();
  return s ? `/recruitment/general-cvs?${s}` : '/recruitment/general-cvs';
};

/** The General CVs tab's address with these filters. */
export const generalHref = (q: Partial<GeneralQuery>) => {
  const params = generalParams(q);
  params.set('tab', 'general');
  return `${APPLICANTS_PATH}?${params.toString()}`;
};

// ---------- the bulk upload ----------

/** A batch's address in the API: a vacancy's, or the general CVs'. */
export const uploadsApiPath = (target: CvBatchTarget) => (target.kind === 'vacancy' ? `/recruitment/cv-uploads?vacancyId=${encodeURIComponent(target.vacancyId)}` : '/recruitment/cv-uploads');

/** The sources a batch's rows may have: a vacancy's channels (LinkedIn unless changed), or how a general CV came. */
export const batchSources = (target: CvBatchTarget): readonly string[] => (target.kind === 'vacancy' ? APPLICATION_CHANNELS : HR_CV_SOURCES);

/** The source a batch's rows start with: LinkedIn (its Easy Apply CVs, the owner's reason for the bulk upload). */
export const DEFAULT_BATCH_SOURCE = 'linkedin';

/** A row of the batch as HR edits it (a general CV's area: a department's id, or OTHER_AREA with `areaOther`). */
export interface BatchRow {
  id: string;
  fileName: string;
  textFound: boolean;
  fullName: string;
  email: string;
  mobile: string;
  source: string;
  departmentId: string;
  areaOther: string;
  referrer: string;
  keep: boolean;
  skip: boolean;
  duplicate: CvUploadView['duplicate'];
}

/** An uploaded CV as a row to check: its guesses, LinkedIn, no area yet. */
export const rowOf = (u: CvUploadView): BatchRow => ({
  id: u.id,
  fileName: u.fileName,
  textFound: u.textFound,
  fullName: u.guess.fullName ?? '',
  email: u.guess.email ?? '',
  mobile: u.guess.mobile ?? '',
  source: DEFAULT_BATCH_SOURCE,
  departmentId: '',
  areaOther: '',
  referrer: '',
  keep: false,
  skip: false,
  duplicate: u.duplicate,
});

/** The rows as the save takes them: a vacancy's without the general CVs' area, referrer and keep. */
export function saveRows(rows: readonly BatchRow[], target: CvBatchTarget): CvSaveRow[] {
  return rows.map((r) => ({
    id: r.id,
    fullName: r.fullName.trim(),
    email: r.email.trim(),
    mobile: r.mobile.trim(),
    source: r.source,
    ...(target.kind === 'general' && {
      departmentId: r.departmentId && r.departmentId !== OTHER_AREA ? r.departmentId : null,
      areaOther: r.departmentId === OTHER_AREA ? r.areaOther.trim() || null : null,
      referrer: r.source === 'referral' ? r.referrer.trim() || null : null,
      keep: r.keep,
    }),
    ...(r.skip && { skip: true }),
  }));
}

/** The rows whose email is an earlier row's (not left out), as HR has typed them: the save would skip them. */
export function inBatchRepeats(rows: readonly BatchRow[]): Set<string> {
  const seen = new Set<string>();
  const repeats = new Set<string>();
  for (const r of rows) {
    const email = r.email.trim().toLowerCase();
    if (r.skip || !email) continue;
    if (seen.has(email)) repeats.add(r.id);
    else seen.add(email);
  }
  return repeats;
}

/** What a row's duplicate says: there already (its reference and day), or earlier in the batch. */
export function duplicateText(d: CvUploadView['duplicate'], target: CvBatchTarget): string | null {
  if (!d) return null;
  if (d.inBatch) return 'The same email is earlier in this batch.';
  const ref = d.reference ? ` (${d.reference})` : '';
  return target.kind === 'vacancy' ? `Applied for this job already${ref}: it will be skipped.` : `Sent a CV in the last 30 days${ref}: tick Keep to save it anyway.`;
}

// ---------- a general CV's page and HR's Add a CV ----------

export const GENERAL_STATUS_STYLE: Record<GeneralCvStatus, string> = {
  new: 'bg-accent-soft text-accent',
  reviewed: 'bg-canvas text-ink',
  moved: 'bg-ok-soft text-ok',
  archived: 'bg-canvas text-muted',
};

/** The vacancies a general CV can be added to: open or on hold, newest first as the list gives them. */
export const movableVacancies = (rows: readonly VacancyListItem[]) => rows.filter((v) => v.status === 'open' || v.status === 'on_hold');

const field = (fd: FormData, name: string): string => {
  const v = fd.get(name);
  return typeof v === 'string' ? v.trim() : '';
};

/** HR's Add a CV as the rules check it: the general form's fields, how it came, who referred them and the notes. */
export function hrCvInputOf(fd: FormData): GeneralCvInput {
  const source = field(fd, 'source');
  return { ...generalInputOf(fd), source: source || null, referrer: source === 'referral' ? field(fd, 'referrer') || null : null, notes: field(fd, 'notes') || null };
}

/** What is wrong with HR's Add a CV before it is sent (the CV's own checks are the API's). */
export function addCvProblems(fd: FormData): string[] {
  const problems = generalCvProblems(hrCvInputOf(fd), { byHr: true });
  const cv = fd.get('cv');
  if (!(cv instanceof Blob) || cv.size === 0) problems.push('Attach the CV, as a PDF or a Word file.');
  return problems;
}

/** What was typed on Add a CV, kept to show again after a refusal (never the CV). */
export function addCvTypedValues(fd: FormData): Record<string, string> {
  return { ...generalTypedValues(fd), source: field(fd, 'source'), referrer: field(fd, 'referrer'), notes: field(fd, 'notes') };
}

/** Add a CV as the API takes it (POST /recruitment/general-cvs): the general form's fields with the source, referrer and notes. */
export function addCvApiForm(fd: FormData): FormData {
  const input = hrCvInputOf(fd);
  const out = generalApiForm(fd, {});
  if (input.source) out.set('source', input.source);
  if (input.referrer) out.set('referrer', input.referrer);
  if (input.notes) out.set('notes', input.notes);
  return out;
}

/** A vacancy's applicants by stage in words, those with none left out: "Applied 4 · Shortlisted 2". */
export function stageCountsText(group: VacancyApplicantsGroup, labels: Readonly<Record<string, string>>): string {
  const parts = Object.entries(group.byStage)
    .filter(([, n]) => n > 0)
    .map(([stage, n]) => `${labels[stage] ?? stage} ${n}`);
  if (group.filteredOut) parts.push(`Filtered out ${group.filteredOut}`);
  return parts.join(' · ');
}
