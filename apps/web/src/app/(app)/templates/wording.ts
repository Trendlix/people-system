import {
  EMPLOYMENT_TYPES,
  LABELS,
  TEMPLATE_FOLDER_LABELS,
  TEMPLATE_FOLDERS,
  TEMPLATE_SLOTS,
  TEMPLATE_TRIGGER_LABELS,
  type EmploymentType,
  type TemplateFolder,
  type TemplateLanguage,
  type TemplateSigners,
  type TemplateTrigger,
} from '@trendlix/shared';
import { formatDate } from '../../../lib/format';
import { hasRole } from '../../../lib/roles';
import type { SessionUser, TemplateSlotView } from '../../../lib/types';
import { count } from './tag-check';

// How the template library words a slot (its language, who it applies to, when it's offered, who signs it, where it
// stands), the progress line, and who may do what. Pure code (no server-only), tested; relative imports, as vitest
// doesn't know the @/ paths.

type WithRoles = Pick<SessionUser, 'roles'>;

/** HR, Admin (a Super Admin too) and the CEO see the library and download its files; the API checks this again. */
export function seesTemplates(user: WithRoles): boolean {
  return hasRole(user, 'hr', 'admin', 'ceo');
}

/** HR and Admin (a Super Admin too) upload and publish versions; the CEO only views. Deleting a draft: canDelete. */
export function managesTemplates(user: WithRoles): boolean {
  return hasRole(user, 'hr', 'admin');
}

export const WHO_SEES = 'Only HR, Admin and the CEO can see the templates.';

/** Said where the server doesn't have templates yet (it answers 404). */
export const NOT_AVAILABLE = 'Not available yet.';
export const NOT_AVAILABLE_ACTION = 'Not available yet: the server does not have templates yet. Please try again after its next update.';

export const LANGUAGE_LABELS: Record<TemplateLanguage, string> = { ar: 'Arabic', en: 'English' };

/** A slot's language, or that each version's is chosen when it is uploaded. */
export function languageLabel(language: TemplateLanguage | null): string {
  return language ? LANGUAGE_LABELS[language] : 'Arabic or English, chosen on upload';
}

export const SIGNER_LABELS: Record<TemplateSigners, string> = {
  both: 'The employee and the company',
  employee: 'The employee',
  company: 'The company',
  none: 'Not signed',
};

/** "All employment types", or the ones named: "Full-time", "Part-time, Internship". */
export function appliesToLabel(types: readonly EmploymentType[]): string {
  if (EMPLOYMENT_TYPES.every((t) => types.includes(t))) return 'All employment types';
  return types.map((t) => LABELS.employmentType[t] ?? t).join(', ');
}

/** "On hiring · On renewal" */
export function triggersLabel(triggers: readonly TemplateTrigger[]): string {
  return triggers.map((t) => TEMPLATE_TRIGGER_LABELS[t] ?? t).join(' · ');
}

export function folderLabel(folder: TemplateFolder): string {
  return TEMPLATE_FOLDER_LABELS[folder] ?? folder;
}

/** Where the template page is. */
export const templateHref = (key: string) => `/templates/${encodeURIComponent(key)}`;

/** Where the browser downloads a version's Word file: the web server fetches it from the API with the session. */
export const versionFileHref = (id: string) => `/templates/versions/${encodeURIComponent(id)}/file`;

/** The name of the slot a copy is printed from, by its key (from the API's list, else the shared list). */
export function sourceName(key: string, slots: readonly Pick<TemplateSlotView, 'key' | 'name'>[] = []): string {
  return slots.find((s) => s.key === key)?.name ?? TEMPLATE_SLOTS.find((s) => s.key === key)?.name ?? key;
}

/** Said on a copy slot (the full-time contract's social insurance copy), in place of its own files. */
export const COPY_NOTE = "Printed from the official copy's file. On this copy, the salary reads the insured salary.";

type Draft = NonNullable<TemplateSlotView['latestDraft']>;
type Published = NonNullable<TemplateSlotView['published']>;

/** What is wrong with a draft's tags, for the library: "has unknown tags", "has broken tags", both, or null. */
export function draftIssues(draft: Pick<Draft, 'unknownTags' | 'broken'>): string | null {
  const unknown = (draft.unknownTags ?? []).length > 0;
  const broken = (draft.broken ?? []).length > 0;
  if (unknown && broken) return 'has unknown and broken tags';
  if (unknown) return 'has unknown tags';
  if (broken) return 'has broken tags';
  return null;
}

/** "In use: v3, published 14/10/2026 by hr@trendlix.com" */
export function inUseText(published: Published): string {
  const by = published.publishedBy?.email;
  return `In use: v${published.version}, published ${formatDate(published.publishedAt)}${by ? ` by ${by}` : ''}`;
}

/** "Draft v4, not published", with what is wrong with its tags: "Draft v4, not published: has unknown tags" */
export function draftText(draft: Pick<Draft, 'version' | 'unknownTags' | 'broken'>): string {
  const issues = draftIssues(draft);
  return `Draft v${draft.version}, not published${issues ? `: ${issues}` : ''}`;
}

export type StatusTone = 'ok' | 'warn' | 'danger' | 'muted';
export interface StatusLine {
  text: string;
  tone: StatusTone;
}

/**
 * Where a slot stands, as lines: the version in use, then a newer draft waiting to be published; or "No file yet". A draft
 * older than the version in use is left out.
 */
export function statusLines(slot: Pick<TemplateSlotView, 'published' | 'latestDraft'>): StatusLine[] {
  const lines: StatusLine[] = [];
  const { published, latestDraft: draft } = slot;
  if (published) lines.push({ text: inUseText(published), tone: 'ok' });
  if (draft && (!published || draft.version > published.version)) lines.push({ text: draftText(draft), tone: draftIssues(draft) ? 'danger' : 'warn' });
  if (!lines.length) lines.push({ text: 'No file yet', tone: 'muted' });
  return lines;
}

/** The library's upload button: "Upload" for a slot without any file yet, else "Upload a new version". */
export function uploadLabel(slot: Pick<TemplateSlotView, 'published' | 'latestDraft' | 'versionCount'>): string {
  return slot.versionCount > 0 || slot.published || slot.latestDraft ? 'Upload a new version' : 'Upload';
}

/** How many templates are in use, of those that need a file of their own (copy slots aren't counted). */
export function progress(slots: readonly Pick<TemplateSlotView, 'copyOf' | 'published'>[]): { inUse: number; total: number; text: string } {
  const own = slots.filter((s) => !s.copyOf);
  const inUse = own.filter((s) => s.published).length;
  return { inUse, total: own.length, text: `${inUse} of ${count(own.length, 'template')} in use` };
}

/** The slots by folder, in the library's folder order (TEMPLATE_FOLDERS), each folder keeping the slots' order; empty folders left out. */
export function byFolder<S extends Pick<TemplateSlotView, 'folder'>>(slots: readonly S[]): { folder: TemplateFolder; slots: S[] }[] {
  const known = TEMPLATE_FOLDERS.map((folder) => ({ folder, slots: slots.filter((s) => s.folder === folder) }));
  const others = slots.filter((s) => !(TEMPLATE_FOLDERS as readonly string[]).includes(s.folder));
  if (others.length) known.push(...[...new Set(others.map((s) => s.folder))].map((folder) => ({ folder, slots: others.filter((s) => s.folder === folder) })));
  return known.filter((g) => g.slots.length > 0);
}

/** The confirmation before publishing: "Publish v4? It replaces v3 for new documents." */
export function publishConfirm(version: number, inUse: number | null | undefined): string {
  return inUse ? `Publish v${version}? It replaces v${inUse} for new documents.` : `Publish v${version}? New documents will be made from it.`;
}

/**
 * The Word file of a version: a .docx (a .doc must be saved as .docx in Word first). Uploads pass through the web app on
 * Vercel, which takes at most 4.5 MB per request, so a file must stay under 4 MB (the API has its own limit too).
 */
export const DOCX_ACCEPT = '.docx';
export const TEMPLATE_MAX_BYTES = 4 * 1024 * 1024;
export const TEMPLATE_TOO_LARGE = 'The Word file must be 4 MB or smaller. Large pictures in it can be compressed in Word (Picture Format → Compress Pictures).';
export const NOT_DOCX = 'Choose a Word file (.docx). A .doc file must be saved as .docx in Word first.';

/** Whether a file name is a Word document's (.docx). */
export const isDocx = (name: string) => name.trim().toLowerCase().endsWith('.docx');

/** What the upload form says of the chosen file before sending it: too large, or not a .docx; '' when it can go. */
export function fileProblem(file: Pick<File, 'name' | 'size'>): string {
  if (!isDocx(file.name)) return NOT_DOCX;
  if (file.size > TEMPLATE_MAX_BYTES) return TEMPLATE_TOO_LARGE;
  return '';
}
