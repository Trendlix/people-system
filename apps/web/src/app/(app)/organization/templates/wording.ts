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
import { formatDate } from '../../../../lib/format';
import { hasRole } from '../../../../lib/roles';
import type { SessionUser, TemplateSlotView, TemplateVersion } from '../../../../lib/types';
import { count } from './tag-check';

// How the template library words a slot (its language, who it applies to, when it's offered, who signs it, where it
// stands), the progress line, and who may do what. Pure code (no server-only), tested; relative imports, as vitest
// doesn't know the @/ paths.

type WithRoles = Pick<SessionUser, 'roles'>;

/**
 * Only a Super Admin sees the library, uploads and publishes versions (owner, 19 October 2026: "enable templates sidebar
 * to super admin only"; before, HR, Admin and the CEO saw it). Deleting a draft: canDelete, a Super Admin too.
 */
export function seesTemplates(user: WithRoles): boolean {
  return hasRole(user, 'super_admin');
}

/** Uploading and publishing versions: a Super Admin, as seeing them. */
export function managesTemplates(user: WithRoles): boolean {
  return hasRole(user, 'super_admin');
}

export const WHO_SEES = 'Only a Super Admin can see the templates.';

/** Said instead of a link to a template, to those who can't open the templates. */
export const ASK_SUPER_ADMIN = 'A Super Admin manages the templates.';

/** Said where the server doesn't have templates yet (it answers 404). */
export const NOT_AVAILABLE = 'Not available yet.';
export const NOT_AVAILABLE_ACTION = 'Not available yet: the server does not have templates yet. Please try again after its next update.';

export const LANGUAGE_LABELS: Record<TemplateLanguage, string> = { ar: 'Arabic', en: 'English', bilingual: 'Arabic and English' };

/** A slot's language, or that each version's is chosen when it is uploaded. */
export function languageLabel(language: TemplateLanguage | null): string {
  return language ? LANGUAGE_LABELS[language] : 'Arabic, English or both, chosen on upload';
}

/**
 * How a bilingual template (both languages side by side, like the owner's NDA, 15 October 2026) takes its tags: those
 * that depend on the language print in Arabic, and their _ar and _en forms print the language they name.
 */
export const BILINGUAL_HINT =
  'Arabic and English side by side, e.g. the NDA. Tags that depend on the language print in Arabic; for each side use their _ar and _en forms, e.g. {{job_title_ar}} and {{job_title_en}}.';

export const SIGNER_LABELS: Record<TemplateSigners, string> = {
  both: 'The employee and the company',
  employee: 'The employee',
  company: 'The company',
  none: 'Not signed',
};

/**
 * "All employment types", or the ones named: "Full-time", "Part-time, Unpaid internship". A Sales slot (`paidByCommission`;
 * owner, 18 October 2026: Sales became Full-time paid by commission): "Full-time, paid by commission (the full-time one
 * until this is published)".
 */
export function appliesToLabel(types: readonly EmploymentType[], paidByCommission = false): string {
  if (EMPLOYMENT_TYPES.every((t) => types.includes(t))) return 'All employment types';
  const names = types.map((t) => LABELS.employmentType[t] ?? t).join(', ');
  return paidByCommission ? `${names}, paid by commission (the ${names.toLowerCase()} one until this is published)` : names;
}

/** "On hiring · On renewal" */
export function triggersLabel(triggers: readonly TemplateTrigger[]): string {
  return triggers.map((t) => TEMPLATE_TRIGGER_LABELS[t] ?? t).join(' · ');
}

export function folderLabel(folder: TemplateFolder): string {
  return TEMPLATE_FOLDER_LABELS[folder] ?? folder;
}

/**
 * The template library, under Organization since 23 October 2026 (owner: "Check-in Setup, KPI Pillars and deadlines,
 * Recruitment and checklists, Templates"); /templates and every page under it redirect there (lib/moved-pages.ts).
 */
export const TEMPLATES_PATH = '/organization/templates';

/** Where the template page is. */
export const templateHref = (key: string) => `${TEMPLATES_PATH}/${encodeURIComponent(key)}`;

/** Where the browser downloads a version's file (Word or PDF): the web server fetches it from the API with the session. */
export const versionFileHref = (id: string) => `${TEMPLATES_PATH}/versions/${encodeURIComponent(id)}/file`;

/** The same file as a PDF, shown in a new tab (Preview); a PDF version's own file. */
export const versionPreviewHref = (id: string) => `${versionFileHref(id)}?format=pdf`;

/** The Fields Guide page: every tag a template can use, with search and Copy, and the guide to download. */
export const FIELDS_GUIDE_PAGE = `${TEMPLATES_PATH}/tags`;

/** The Fields Guide as a Word file to download: the web server fetches it from the API with the session. */
export const FIELDS_GUIDE_DOCX_HREF = `${TEMPLATES_PATH}/fields-guide`;

/** The same guide as a PDF, shown in a new tab. */
export const FIELDS_GUIDE_PDF_HREF = `${FIELDS_GUIDE_DOCX_HREF}?format=pdf`;

/** The name of the slot a copy is printed from, by its key (from the API's list, else the shared list). */
export function sourceName(key: string, slots: readonly Pick<TemplateSlotView, 'key' | 'name'>[] = []): string {
  return slots.find((s) => s.key === key)?.name ?? TEMPLATE_SLOTS.find((s) => s.key === key)?.name ?? key;
}

/** Said on a template whose salary tags read the insured salary (the full-time contract's social insurance copy). */
export const OVERRIDES_NOTE =
  'On this template, {{gross_salary}} and {{gross_salary_words}} print the insured salary: the gross, capped at the maximum insurable wage.';

/** Said on a copy slot (printed from another slot's file), in place of its own files. */
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

/**
 * "Draft v4, not published", with what is wrong with its tags: "Draft v4, not published: has unknown tags"; or, for a PDF
 * draft with no field placed yet, "Draft v4, not published: no fields placed yet".
 */
export function draftText(draft: Pick<Draft, 'version' | 'unknownTags' | 'broken' | 'format' | 'fieldCount'>): string {
  const issues = draftIssues(draft) ?? (draft.format === 'pdf' && draft.fieldCount === 0 ? 'no fields placed yet' : null);
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
 * The file of a version: a Word file (.docx; a .doc must be saved as .docx in Word first), or an official form as a PDF
 * whose fields are placed after it is uploaded (owner's decision, 15 October 2026). Uploads pass through the web app on
 * Vercel, which takes at most 4.5 MB per request, so a file must stay under 4 MB (the API has its own limit too, and
 * tells a PDF from a Word file by what is in it).
 */
export const TEMPLATE_ACCEPT = '.docx,.pdf';
export const TEMPLATE_MAX_BYTES = 4 * 1024 * 1024;
export const TEMPLATE_TOO_LARGE = 'The Word file must be 4 MB or smaller. Large pictures in it can be compressed in Word (Picture Format → Compress Pictures).';
export const PDF_TEMPLATE_TOO_LARGE = 'The PDF must be 4 MB or smaller. Save a smaller copy of it and upload that.';
export const NOT_TEMPLATE_FILE = 'Choose a Word file (.docx) or a PDF. A .doc file must be saved as .docx in Word first.';

/** Whether a file name is a Word document's (.docx). */
export const isDocx = (name: string) => name.trim().toLowerCase().endsWith('.docx');

/** Whether a file name is a PDF's. */
export const isPdfName = (name: string) => name.trim().toLowerCase().endsWith('.pdf');

/** What the upload form says of the chosen file before sending it: too large, or neither a .docx nor a PDF; '' when it can go. */
export function fileProblem(file: Pick<File, 'name' | 'size'>): string {
  const pdf = isPdfName(file.name);
  if (!pdf && !isDocx(file.name)) return NOT_TEMPLATE_FILE;
  if (file.size > TEMPLATE_MAX_BYTES) return pdf ? PDF_TEMPLATE_TOO_LARGE : TEMPLATE_TOO_LARGE;
  return '';
}

// ---------- PDF templates ----------

/** Whether a version is an official form uploaded as a PDF, with its fields placed on it (else a Word file). */
export const isPdfVersion = (version: Pick<TemplateVersion, 'format'>) => version.format === 'pdf';

/** Where a PDF version's fields are placed (Place Fields). */
export const fieldsHref = (slotKey: string, versionId: string) => `${templateHref(slotKey)}/versions/${encodeURIComponent(versionId)}/fields`;

/** A version's fields as JSON (Copy fields from), read by the web server from the API with the session. */
export const fieldsJsonHref = (versionId: string) => `${TEMPLATES_PATH}/versions/${encodeURIComponent(versionId)}/fields`;

/** Where Test print posts the fields being placed: the form filled with sample values comes back as a PDF. */
export const fieldsSampleHref = (versionId: string) => `${fieldsJsonHref(versionId)}/sample`;

/** "2 pages · 14 fields placed", or "2 pages · No fields placed yet"; the pages left out when the API doesn't say. */
export function fieldsSummary(version: Pick<TemplateVersion, 'pageCount' | 'fieldCount'>): string {
  const pages = version.pageCount ? `${count(version.pageCount, 'page')} · ` : '';
  return `${pages}${version.fieldCount ? `${count(version.fieldCount, 'field')} placed` : 'No fields placed yet'}`;
}

/**
 * What Use the standard layout asks first on Place Fields (owner, 16 October 2026); with changes not saved, that they
 * are lost too.
 */
export function standardLayoutConfirm(dirty: boolean): string {
  const ask = 'Replace the fields on this form with the standard layout? Fields you placed or moved are replaced.';
  return dirty ? `${ask} Your unsaved changes will be lost.` : ask;
}

/** Said once the standard layout is on the form. */
export const STANDARD_LAYOUT_APPLIED = 'Standard layout applied.';

/** Why a PDF draft can't be published yet: no field is placed on it (the API refuses it too); null when it can. */
export function pdfPublishBlock(version: Pick<TemplateVersion, 'format' | 'fieldCount'>): string | null {
  return isPdfVersion(version) && version.fieldCount === 0 ? "Can't be published yet: no fields are placed on the form. Place them first." : null;
}
