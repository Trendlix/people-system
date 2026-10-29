import {
  APPLICATION_CHANNELS,
  GENERAL_CV_SOURCES,
  GENERAL_CV_STATUSES,
  generalCvProblems,
  HR_CV_SOURCES,
  OTHER_POSITION,
  CV_POSITION_LIMITS,
  type ApplicationListItem,
  type ApplicationSource,
  type CvBatchTarget,
  type CvPosition,
  type CvSaveRow,
  type CvUploadView,
  type GeneralCvInput,
  type GeneralCvSource,
  type GeneralCvStatus,
  type VacancyApplicantsGroup,
  type VacancyListItem,
  type VerdictFilter,
  VACANCY_STATUS_LABELS,
} from '@trendlix/shared';
import { generalApiForm, generalInputOf, generalTypedValues } from '../../careers/careers';
import { APPLICANTS_PATH, applicantsHref, minYearsOf, skillOf, vacancyHref, verdictOf, type ApplicantsQuery } from './recruitment';
import { shownCode } from '../../../lib/hidden';

// General CVs and the applicants by posted job on the site (owner, 22 October 2026: "i want a proper viweing, what came
// out of the posted jobs and what cam on randomly", "Both"; "is there a way to easy apply from linkedin?" … "why not";
// packages/shared general-cvs.ts): the addresses, the Applicants page's two tabs, the posted jobs grouped by vacancy
// with their sources, the general CVs' filters, and the bulk upload's rows. Since 25 October 2026 a general CV is for a
// position (owner: "should it be the positions?"; asked, "Position, grouped by team"; packages/shared cv-positions.ts),
// its team known from it: HR's lists show the position with its team, and filter by either. Pure code (relative
// imports), tested in general.test.ts; the API checks everything again.

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
  !!(q.vacancyId || q.stage || q.source || q.q || q.skill || q.verdict || q.minMatch !== null || q.minYears !== null || q.minCvMatch !== null || q.filtered !== 'hide');

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
  /** The team (25 October 2026: "Team", once "Area"): a team's or a department's id; the position's, or an older CV's area. */
  departmentId: string;
  /** The position (25 October 2026): its key, or OTHER_POSITION for those written for Other; '' for any. */
  positionKey: string;
  q: string;
  /** The years at least: those typed, else the CV's estimate (24 October 2026: "CV years in list + more rules"). */
  minYears: number | null;
  /** A skill of the dictionary their CV names; '' for any. */
  skill: string;
  /** The latest screening verdict (24 October 2026), `none` for none yet; '' for any. */
  verdict: VerdictFilter | '';
  /**
   * `fit`: the best open position's CV fit first (owner, 25 October 2026: "and if it recomended to another position based
   * on the CV"); '': the newest first.
   */
  sort: 'fit' | '';
}

export function readGeneralQuery(query: Record<string, string | string[] | undefined>): GeneralQuery {
  const status = one(query.status);
  const source = one(query.source);
  const departmentId = one(query.departmentId);
  const positionKey = one(query.positionKey);
  return {
    status: status === 'all' || (GENERAL_CV_STATUSES as readonly string[]).includes(status) ? (status as GeneralQuery['status']) : '',
    source: (GENERAL_CV_SOURCES as readonly string[]).includes(source) ? (source as GeneralCvSource) : '',
    departmentId: UUID.test(departmentId) ? departmentId : '',
    positionKey: isPositionFilter(positionKey) ? positionKey : '',
    q: one(query.q).slice(0, 100),
    minYears: minYearsOf(query.minYears),
    skill: skillOf(query.skill),
    verdict: verdictOf(query.verdict),
    sort: one(query.sort) === 'fit' ? 'fit' : '',
  };
}

/** Whether a filter narrows the general CVs (besides the status chips): then "Nobody here." and Clear. */
export const generalFiltering = (g: GeneralQuery): boolean => !!(g.status || g.source || g.departmentId || g.positionKey || g.q || g.skill || g.verdict || g.minYears !== null);

/** A position's key as the filter takes it, "<team id>:video editor", or OTHER_POSITION for the written ones. */
export function isPositionFilter(value: string): boolean {
  if (value === OTHER_POSITION) return true;
  const at = value.indexOf(':');
  return at === 36 && UUID.test(value.slice(0, at)) && value.length > at + 1 && value.length <= CV_POSITION_LIMITS.key;
}

function generalParams(q: Partial<GeneralQuery>): URLSearchParams {
  const params = new URLSearchParams();
  if (q.status) params.set('status', q.status);
  if (q.source) params.set('source', q.source);
  if (q.departmentId) params.set('departmentId', q.departmentId);
  if (q.positionKey) params.set('positionKey', q.positionKey);
  if (q.q) params.set('q', q.q);
  if (q.minYears !== null && q.minYears !== undefined) params.set('minYears', String(q.minYears));
  if (q.skill) params.set('skill', q.skill);
  if (q.verdict) params.set('verdict', q.verdict);
  if (q.sort) params.set('sort', q.sort);
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

/** A row of the batch as HR edits it (a general CV's position: a position's key, or OTHER_POSITION with `positionOther`). */
export interface BatchRow {
  id: string;
  fileName: string;
  textFound: boolean;
  /** A scan the OCR service is still reading (22 October 2026: "make the OCR egine reads the CV and analyse it"). */
  reading: boolean;
  /** What the CV said at first, to tell HR's typing from it when the reading fills the row in. */
  guessed: { fullName: string; email: string; mobile: string };
  fullName: string;
  email: string;
  mobile: string;
  source: string;
  position: string;
  positionOther: string;
  referrer: string;
  keep: boolean;
  skip: boolean;
  duplicate: CvUploadView['duplicate'];
}

/** An uploaded CV as a row to check: its guesses, LinkedIn, no position yet. */
export const rowOf = (u: CvUploadView): BatchRow => ({
  id: u.id,
  fileName: u.fileName,
  textFound: u.textFound,
  // an API from before the reading has no `reading`
  reading: u.reading === true,
  guessed: { fullName: u.guess.fullName ?? '', email: u.guess.email ?? '', mobile: u.guess.mobile ?? '' },
  fullName: u.guess.fullName ?? '',
  email: u.guess.email ?? '',
  mobile: u.guess.mobile ?? '',
  source: DEFAULT_BATCH_SOURCE,
  position: '',
  positionOther: '',
  referrer: '',
  keep: false,
  skip: false,
  duplicate: u.duplicate,
});

/**
 * The rows whose scan was being read, filled in once the OCR service has read it (22 October 2026: "make the OCR egine
 * reads the CV and analyse it"): the name, email and mobile it found, where HR left them as they were. A row still being
 * read, or gone from the batch, stays as it is.
 */
export function mergeReadings(rows: readonly BatchRow[], uploads: readonly CvUploadView[]): BatchRow[] {
  const byId = new Map(uploads.map((u) => [u.id, u]));
  return rows.map((r) => {
    const u = byId.get(r.id);
    if (!r.reading || !u || u.reading) return r;
    const now = rowOf(u);
    const take = (k: 'fullName' | 'email' | 'mobile') => (r[k].trim() === '' || r[k] === r.guessed[k] ? now[k] : r[k]);
    return { ...r, reading: false, textFound: u.textFound, guessed: now.guessed, fullName: take('fullName'), email: take('email'), mobile: take('mobile'), duplicate: u.duplicate };
  });
}

/** The rows as the save takes them: a vacancy's without the general CVs' position, referrer and keep. */
export function saveRows(rows: readonly BatchRow[], target: CvBatchTarget): CvSaveRow[] {
  return rows.map((r) => ({
    id: r.id,
    fullName: r.fullName.trim(),
    email: r.email.trim(),
    mobile: r.mobile.trim(),
    source: r.source,
    ...(target.kind === 'general' && {
      positionKey: r.position && r.position !== OTHER_POSITION ? r.position : null,
      positionOther: r.position === OTHER_POSITION ? r.positionOther.trim() || null : null,
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

// The batch's place chosen on the page (owner, 29 October 2026: "when uploading bulk CVs, allow me to add them to an open
// vacancy directly as a bulk"): the bulk upload from the Applicants page saves to the general CVs, or to an open vacancy
// (or one on hold) picked in Save to; the whole batch goes there (the API's move), HR's typing on each row kept. The
// page's address names the vacancy, so a refresh finds the batch where it went.

/** A batch's place from a vacancy's id (none: the general CVs). */
export const batchTargetOf = (vacancyId: string | null | undefined): CvBatchTarget => (vacancyId ? { kind: 'vacancy', vacancyId } : { kind: 'general' });

/** Where a saved batch is seen: the vacancy's page, or the general CVs' tab. */
export const batchDoneHref = (target: CvBatchTarget) => (target.kind === 'vacancy' ? vacancyHref(target.vacancyId) : tabHref('general'));

/** The bulk upload's address with its place: `?vacancy=` for a vacancy. */
export const generalBulkHref = (target: CvBatchTarget) => (target.kind === 'vacancy' ? `${GENERAL_BULK_PATH}?vacancy=${encodeURIComponent(target.vacancyId)}` : GENERAL_BULK_PATH);

/** The place the address names: a vacancy among the choices (open, or on hold), else the general CVs. */
export function readBulkTarget(query: Record<string, string | string[] | undefined>, choices: readonly { id: string }[]): CvBatchTarget {
  const id = one(query.vacancy);
  return batchTargetOf(UUID.test(id) && choices.some((c) => c.id === id) ? id : null);
}

/** The vacancies a CV may go to, as a list shows them: "Video Editor (VAC-2026-0004)", "· On hold" for one on hold. */
export const vacancyChoices = (rows: readonly VacancyListItem[]): { id: string; label: string }[] =>
  movableVacancies(rows).map((v) => ({ id: v.id, label: `${v.title} (${v.number})${v.status === 'on_hold' ? ` · ${VACANCY_STATUS_LABELS.on_hold}` : ''}` }));

/**
 * The rows after the batch went to `target` (`uploads`: the batch there, as the API's move gives it): HR's typing on each
 * row kept, its duplicate as the new place's; its source kept when the place takes it (LinkedIn, Referral, Other), else
 * LinkedIn; CVs that were waiting there joined as new rows, in the batch's order.
 */
export function retargetRows(rows: readonly BatchRow[], uploads: readonly CvUploadView[], target: CvBatchTarget): BatchRow[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const sources = batchSources(target);
  return uploads.map((u) => {
    const r = byId.get(u.id);
    if (!r) return rowOf(u);
    return { ...r, duplicate: u.duplicate, source: sources.includes(r.source) ? r.source : DEFAULT_BATCH_SOURCE };
  });
}

/** What a row's duplicate says: there already (its reference and day), or earlier in the batch. */
export function duplicateText(d: CvUploadView['duplicate'], target: CvBatchTarget): string | null {
  if (!d) return null;
  if (d.inBatch) return 'The same email is earlier in this batch.';
  const ref = shownCode(d.reference) ? ` (${d.reference})` : '';
  return target.kind === 'vacancy' ? `Applied for this job already${ref}: it will be skipped.` : `Sent a CV in the last 30 days${ref}: tick Keep to save it anyway.`;
}

// ---------- the position on HR's lists and pages (25 October 2026) ----------

/** What a general CV says of its position: the one chosen, or written for Other; its team; an older one's area. */
type PositionOf = { positionName?: string | null; positionOther?: string | null; team?: string | null; area: string };

/**
 * A general CV's Position cell (owner, 25 October 2026: "Position, grouped by team"): the position chosen with its team
 * under it (`sub`, muted); "Other: Photographer" for one written; the area for an older CV, sent for an area.
 */
export function positionCell(c: PositionOf): { main: string; sub: string | null } {
  if (c.positionName) return { main: c.positionName, sub: c.team ?? null };
  if (c.positionOther) return { main: `Other: ${c.positionOther}`, sub: null };
  return { main: c.area, sub: null };
}

/**
 * A general CV's Position and Team on its page and the candidate's: the position chosen, "Other: …" for one written, "—"
 * for an older CV; the team known (its position's, or an older CV's area: its team, or the words written), else "—".
 */
export function positionFacts(c: PositionOf): { position: string; team: string } {
  const position = c.positionName || (c.positionOther ? `Other: ${c.positionOther}` : '—');
  if (c.positionName || c.positionOther) return { position, team: c.team || '—' };
  return { position, team: c.team || c.area || '—' };
}

/** The positions by team, in their order, for Recruitment Settings: each team named as HR's lists name it. */
export function positionsByTeam(positions: readonly CvPosition[]): { teamId: string; team: string; positions: CvPosition[] }[] {
  const out: { teamId: string; team: string; positions: CvPosition[] }[] = [];
  for (const p of positions) {
    const last = out[out.length - 1];
    if (last && last.teamId === p.teamId) last.positions.push(p);
    else out.push({ teamId: p.teamId, team: p.teamHrName, positions: [p] });
  }
  return out;
}

/** The form fields of a position's row on Recruitment Settings: its key, its own name, its switch and its public name. */
export const positionField = {
  key: 'key',
  merged: (key: string) => `merged-${key}`,
  shown: (key: string) => `shown-${key}`,
  publicName: (key: string) => `name-${key}`,
} as const;

/**
 * HR's choices of positions as the API takes them (PUT /recruitment/settings/positions): every row on the form (its key
 * in `key`), hidden when its switch is off, its public name as typed (empty, or its own name typed: none).
 */
export function positionChoicesOf(fd: FormData): { key: string; hidden: boolean; publicName: string | null }[] {
  const keys = [...new Set(fd.getAll(positionField.key).filter((k): k is string => typeof k === 'string' && k.length > 0))];
  return keys.map((key) => {
    const typed = fd.get(positionField.publicName(key));
    const merged = fd.get(positionField.merged(key));
    const name = typeof typed === 'string' ? typed.trim().replace(/\s+/g, ' ') : '';
    return { key, hidden: fd.get(positionField.shown(key)) === null, publicName: name && name !== merged ? name : null };
  });
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
