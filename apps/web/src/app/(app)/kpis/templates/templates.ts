import {
  KPI_LIBRARY_KIND_LABELS,
  KPI_SETTING_DEFAULTS,
  KPI_SETTING_LABELS,
  kpiMonthAdd,
  kpiMonthName,
  kpiMonthOnly,
  kpiTemplateOpensFrom,
  type KpiDraftAllResult,
  type KpiDraftSource,
  type KpiLibraryKind,
  type KpiLibraryMatch,
  type KpiLibraryRole,
  type KpiPublishDraftsResult,
  type KpiSampleView,
  type KpiSettings,
  type KpiSettingsView,
  type KpiTemplateRow,
  type KpiUserRef,
  type Role,
} from '@trendlix/shared';
import { formatDate, formatDateTime } from '../../../../lib/format';
import { hasRole, isSuperAdmin } from '../../../../lib/roles';
import { dayOfMonth } from '../../organization/payroll/settings';

// KPI Templates (owner, 21 October 2026: "Templates: HR"): every job title with its KPI template's versions, and the KPI
// settings, the deadlines of each month's steps. HR (and the Super Admin) build the templates, "with a draft and
// published versions", a version published applying from the next month and a scorecard keeping the version it opened
// with; "Offer 'Start from a sample' … and 'Copy from another job title'". The deadlines, "self-rating by the 3rd,
// manager by the 6th, HR by the 8th of the next month" and the sign-off by the 10th, in "a small KPI settings section".
// The KPI role library (owner, 21 October 2026: "can you add templetes for all departments and job roles"): "Draft
// templates for every job title", "From the role library" when starting one job title's draft, and "Publish selected
// drafts". Pure code, tested; relative imports, as vitest doesn't know the @/ paths. The API checks every request again.
// The pillars (owner, 21 October 2026: "Fully flexible"; framework.ts): a template on older pillars than the KPI
// framework's newest is counted and marked; a version published while new pillars are coming applies from their first
// month's scorecards, not before.

type WithRoles = { roles: readonly Role[] };

/** Who reads the KPI Templates list, as the API answers it: HR, the CEO and Admin (a Super Admin counts as an Admin). */
export const readsKpiTemplates = (user: WithRoles): boolean => hasRole(user, 'hr', 'ceo', 'admin');

/** Who builds the templates and changes the KPI settings: HR and the Super Admin (owner, 21 October 2026: "Templates: HR"). */
export const buildsKpiTemplates = (user: WithRoles): boolean => hasRole(user, 'hr') || isSuperAdmin(user);

/** "1 metric", "7 metrics". */
export const metricsLabel = (n: number): string => `${n} ${n === 1 ? 'metric' : 'metrics'}`;

/** "1 person", "4 people". */
export const peopleLabel = (n: number): string => `${n} ${n === 1 ? 'person' : 'people'}`;

/** "1 job title", "12 job titles". */
export const jobTitlesLabel = (n: number): string => `${n} ${n === 1 ? 'job title' : 'job titles'}`;

/** "1 draft", "12 drafts". */
export const draftsLabel = (n: number): string => `${n} ${n === 1 ? 'draft' : 'drafts'}`;

/** Who did something, as the pages name them: their name, else their email. */
export const userName = (who: KpiUserRef | null | undefined): string | null => (who ? who.name || who.email : null);

// ---------- the list of job titles ----------

/** A department's job titles on the list: its own first, then each team's. */
export interface TemplateGroup {
  department: string;
  teams: { team: string | null; rows: KpiTemplateRow[] }[];
  count: number;
}

/**
 * The job titles by department, then team, in the order the API sent them (by department, then job title): a team's
 * department is its `parentName`; a department's own job titles come before its teams'.
 */
export function groupTemplateRows(rows: readonly KpiTemplateRow[]): TemplateGroup[] {
  const groups = new Map<string, Map<string | null, KpiTemplateRow[]>>();
  for (const row of rows) {
    const d = row.jobTitle.department;
    const department = d.parentName ?? d.nameEn;
    const team = d.parentName ? d.nameEn : null;
    const teams = groups.get(department) ?? new Map<string | null, KpiTemplateRow[]>([[null, []]]);
    groups.set(department, teams);
    const list = teams.get(team) ?? [];
    teams.set(team, list);
    list.push(row);
  }
  return [...groups].map(([department, teams]) => {
    const parts = [...teams].map(([team, list]) => ({ team, rows: list })).filter((t) => t.rows.length > 0);
    return { department, teams: parts, count: parts.reduce((n, t) => n + t.rows.length, 0) };
  });
}

/** What a job title's template stands at, in words for its row: each part, or null when there is none. */
export interface TemplateRowText {
  inForce: string | null;
  upcoming: string | null;
  draft: string | null;
}

export function templateRowText(row: KpiTemplateRow): TemplateRowText {
  return {
    inForce: row.inForce ? `Version ${row.inForce.version} · ${metricsLabel(row.inForce.metrics)} · since ${formatDate(row.inForce.opensFrom)}` : null,
    upcoming: row.upcoming ? `Version ${row.upcoming.version} · opens from ${formatDate(row.upcoming.opensFrom)}` : null,
    draft: row.draft ? `Version ${row.draft.version} · saved ${formatDate(row.draft.updatedAt)}` : null,
  };
}

/** The list's figures: the job titles, how many have a version in force, one upcoming, a draft, the old pillars. */
export function templateCounts(rows: readonly KpiTemplateRow[]): { jobTitles: number; inForce: number; upcoming: number; drafts: number; none: number; oldPillars: number } {
  return {
    jobTitles: rows.length,
    inForce: rows.filter((r) => r.inForce).length,
    upcoming: rows.filter((r) => r.upcoming).length,
    drafts: rows.filter((r) => r.draft).length,
    none: rows.filter((r) => !r.inForce && !r.upcoming && !r.draft).length,
    oldPillars: rows.filter((r) => r.oldPillars).length,
  };
}

// ---------- starting a draft ----------

/** "Start from a sample": the three samples of the framework (Senior Frontend Developer, Video Producer, HR Specialist). */
export const sampleLabel = (s: Pick<KpiSampleView, 'role' | 'department' | 'metrics'>): string => `${s.role} · ${s.department} (${metricsLabel(s.metrics.length)})`;

/** A choice of "Copy from another job title", by its department. */
export interface CopyGroup {
  label: string;
  options: { value: string; label: string }[];
}

/**
 * "Copy from another job title": every other job title's versions it has now (the one in force, the upcoming one, its
 * draft), by department, in the list's order; a department with none is left out.
 */
export function copyChoices(rows: readonly KpiTemplateRow[], jobTitleId: string): CopyGroup[] {
  const groups = new Map<string, CopyGroup['options']>();
  for (const row of rows) {
    if (row.jobTitle.id === jobTitleId) continue;
    const options: CopyGroup['options'] = [];
    const title = row.jobTitle.titleEn;
    if (row.inForce) options.push({ value: row.inForce.id, label: `${title} · version ${row.inForce.version}, in force` });
    if (row.upcoming) options.push({ value: row.upcoming.id, label: `${title} · version ${row.upcoming.version}, from ${formatDate(row.upcoming.opensFrom)}` });
    if (row.draft) options.push({ value: row.draft.id, label: `${title} · draft` });
    if (!options.length) continue;
    const d = row.jobTitle.department;
    const label = d.parentName ? `${d.parentName} › ${d.nameEn}` : d.nameEn;
    groups.set(label, [...(groups.get(label) ?? []), ...options]);
  }
  return [...groups].map(([label, options]) => ({ label, options }));
}

/** Ids in URLs and forms are UUIDs. */
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Where a new draft comes from, as the form sent it (`from`, and `sampleCode`, `templateId` or `libraryKey`), or what is
 * wrong with it.
 */
export function draftSourceOf(fd: Pick<FormData, 'get'>): { source: KpiDraftSource } | { error: string } {
  const from = fd.get('from');
  if (from === 'blank') return { source: { from: 'blank' } };
  if (from === 'published') return { source: { from: 'published' } };
  if (from === 'library') {
    const key = String(fd.get('libraryKey') ?? '').trim();
    return key ? { source: { from: 'library', libraryKey: key } } : { error: 'Choose the role to start from.' };
  }
  if (from === 'sample') {
    const code = String(fd.get('sampleCode') ?? '').trim();
    return code ? { source: { from: 'sample', sampleCode: code } } : { error: 'Choose the sample to start from.' };
  }
  if (from === 'template') {
    const id = String(fd.get('templateId') ?? '').trim();
    return UUID.test(id) ? { source: { from: 'template', templateId: id } } : { error: 'Choose the job title’s template to copy.' };
  }
  return { error: 'Choose how to start the draft.' };
}

// ---------- the role library ----------

/** "From the role library": the library's roles by kind, in its order (each kind's general template after its roles). */
export function libraryChoices(roles: readonly KpiLibraryRole[]): CopyGroup[] {
  const groups = new Map<KpiLibraryKind, CopyGroup['options']>();
  for (const r of roles) groups.set(r.kind, [...(groups.get(r.kind) ?? []), { value: r.key, label: r.name }]);
  return [...groups].map(([kind, options]) => ({ label: KPI_LIBRARY_KIND_LABELS[kind] ?? kind, options }));
}

/** Under the role picker: the role suggested for the job title, and why ("Suggested: Frontend Developer. The job title says …"). */
export const librarySuggestion = (match: Pick<KpiLibraryMatch, 'name' | 'reason'>): string => `Suggested: ${match.name}. ${match.reason}`;

/**
 * What "Draft templates for every job title" asks first: how many job titles have no template yet, that nothing is
 * published, and that the others stay as they are.
 */
export function draftAllConfirmText(withoutTemplate: number): string {
  return `Make a draft for each job title with no KPI template yet (${jobTitlesLabel(withoutTemplate)})? Each starts from the closest role in the library, its metrics linked to the job title’s duties. Nothing is published, and the job titles with a draft or a published version stay as they are.`;
}

/** The result's headline: "12 drafts made; 3 job titles skipped. Review each draft, then publish it." */
export function draftAllSummary(result: KpiDraftAllResult): string {
  const made = result.made.length;
  const skipped = result.skipped.length;
  if (!made) return skipped ? `No drafts made: each of the ${jobTitlesLabel(skipped)} has a draft or a published version already.` : 'No drafts made: there are no job titles yet.';
  return `${draftsLabel(made)} made${skipped ? `; ${jobTitlesLabel(skipped)} skipped` : ''}. Review each draft, then publish it.`;
}

/**
 * A made draft whose metrics the KPI framework's pillars leave in Unplaced (owner's brief, 21 October 2026: "anything
 * unmatched goes to Unplaced with a note"); null when none.
 */
export const madeDraftUnplaced = (made: Pick<KpiDraftAllResult['made'][number], 'unplaced'>): string | null =>
  made.unplaced > 0
    ? `${made.unplaced === 1 ? '1 metric is' : `${made.unplaced} metrics are`} in Unplaced: written for pillars the KPI framework no longer has. Place ${made.unplaced === 1 ? 'it' : 'them'} before publishing.`
    : null;

/** The role a made draft used: "Frontend Developer", "General HR + team leadership". */
export const madeDraftRole = (made: Pick<KpiDraftAllResult['made'][number], 'libraryName' | 'leadership'>): string => `${made.libraryName}${made.leadership ? ' + team leadership' : ''}`;

// ---------- publishing ----------

/**
 * The 1st (YYYY-MM-DD) from which a version published today applies: the 1st of next month, or, while new pillars are
 * coming (`pillarsFrom`: the month the KPI framework's newest applies from), their first month's opening if later.
 */
export const opensFromIfPublished = (today: string, pillarsFrom?: string | null): string =>
  pillarsFrom ? kpiTemplateOpensFrom(today, pillarsFrom) : `${kpiMonthAdd(today.slice(0, 7), 1)}-01`;

/**
 * What Publish asks first (owner's brief, 21 October 2026: "Publishing applies from the next month; a scorecard keeps the
 * version it opened with"): published on 21 October, it applies to the scorecards opened from 1 November, October's.
 */
export function publishConfirmText(version: number, today: string, pillarsFrom?: string | null): string {
  const from = opensFromIfPublished(today, pillarsFrom);
  return `Publish version ${version}? It applies to the scorecards opened from ${formatDate(from)}: ${kpiMonthName(kpiMonthAdd(from, -1))}'s KPIs on. The scorecards opened already keep the version they opened with.`;
}

/**
 * When a version published today applies (owner's brief, 21 October 2026: "publishing now applies from November's
 * scorecards for October"): "Publishing now applies from November’s scorecards, those for October: 1 November opens
 * October’s scorecards."
 */
export function publishTimingNote(today: string, pillarsFrom?: string | null): string {
  const from = opensFromIfPublished(today, pillarsFrom);
  const opening = kpiMonthOnly(from);
  const month = kpiMonthOnly(kpiMonthAdd(from, -1));
  return `Publishing now applies from ${opening}’s scorecards, those for ${month}: 1 ${opening} opens ${month}’s scorecards.`;
}

/** The job titles' drafts: what "Publish selected drafts" can choose from. */
export const draftIdsOf = (rows: readonly KpiTemplateRow[]): string[] => rows.flatMap((r) => (r.draft ? [r.draft.id] : []));

/** The drafts chosen in the form, each once (only ids). */
export function templateIdsOf(fd: Pick<FormData, 'getAll'>): string[] {
  return [...new Set(fd.getAll('templateIds').map((v) => String(v).trim()))].filter((id) => UUID.test(id));
}

/** What "Publish selected drafts" asks first. */
export function publishDraftsConfirmText(count: number, today: string, pillarsFrom?: string | null): string {
  const from = opensFromIfPublished(today, pillarsFrom);
  return `Publish ${count === 1 ? 'the selected draft' : `the ${draftsLabel(count)} selected`}? Each one that passes the checks applies to the scorecards opened from ${formatDate(from)}: ${kpiMonthName(kpiMonthAdd(from, -1))}'s KPIs on. A draft with problems stays a draft, and you’ll see why.`;
}

/** The result's headline: "3 drafts published, applying from 01/11/2026; 1 not published." */
export function publishDraftsSummary(result: KpiPublishDraftsResult): string {
  const published = result.published.length;
  const refused = result.problems.length;
  const from = result.published[0]?.opensFrom;
  const head = published ? `${draftsLabel(published)} published${from ? `, applying from ${formatDate(from)}` : ''}` : 'Nothing published';
  return `${head}${refused ? `; ${refused} not published` : ''}.`;
}

/** A draft that wasn't published, as the result names it: "Copywriter, version 1", or "A draft" when it couldn't be found. */
export const refusedDraftName = (p: Pick<KpiPublishDraftsResult['problems'][number], 'title' | 'version'>): string =>
  p.title ? `${p.title}${p.version !== null ? `, version ${p.version}` : ''}` : 'A draft';

// ---------- the forms' answers ----------

/** "Draft templates for every job title": the API's refusal, or what it made and left. */
export interface DraftAllState {
  errors?: string[];
  result?: KpiDraftAllResult;
}

/** "Publish selected drafts": the API's refusal, or what it published and what stopped the others. */
export interface PublishDraftsState {
  errors?: string[];
  result?: KpiPublishDraftsResult;
}

// ---------- the KPI settings: the deadlines ----------

export type SettingKey = keyof KpiSettings;

/** The deadlines, in the order of the steps. */
export const SETTING_KEYS = Object.keys(KPI_SETTING_DEFAULTS) as SettingKey[];

/** The deadlines as typed in the form. */
export type SettingValues = Record<SettingKey, string>;

export const settingValuesOf = (s: KpiSettings): SettingValues =>
  Object.fromEntries(SETTING_KEYS.map((k) => [k, String(s[k])])) as SettingValues;

/** A whole number as typed (Arabic-Indic digits too: an Arabic keyboard), else NaN: what the rules then refuse. */
export function wholeOf(text: string | null | undefined): number {
  const s = String(text ?? '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .trim();
  return /^\d{1,4}$/.test(s) ? Number(s) : Number.NaN;
}

/** The deadlines typed (or sent by a form), as the rules check them (kpiSettingsProblems): anything not whole is NaN. */
export function settingsOf(values: Partial<Record<SettingKey, string | null | undefined>>): KpiSettings {
  return Object.fromEntries(SETTING_KEYS.map((k) => [k, wholeOf(values[k])])) as unknown as KpiSettings;
}

/** "Self-rating by the 3rd, manager’s scoring by the 6th, HR’s calibration by the 8th and sign-off by the 10th". */
export function settingsSummary(s: KpiSettings): string {
  const parts = SETTING_KEYS.map((k, i) => {
    const label = KPI_SETTING_LABELS[k];
    // in the middle of the sentence, in lower case but for a capital's word (HR)
    const lower = i > 0 && label.charAt(1) === label.charAt(1).toLowerCase();
    return `${lower ? label.charAt(0).toLowerCase() + label.slice(1) : label} ${dayOfMonth(s[k])}`;
  });
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/** "Last changed by Mona Adel on 21/10/2026, 5:42 PM"; null when never changed (the defaults). */
export function settingsChangedText(view: Pick<KpiSettingsView, 'updatedAt' | 'updatedBy'>): string | null {
  if (!view.updatedAt) return null;
  const who = userName(view.updatedBy);
  return `Last changed${who ? ` by ${who}` : ''} on ${formatDateTime(view.updatedAt)}`;
}
