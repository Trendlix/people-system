import { TEMPLATE_SLOTS } from '@trendlix/shared';
import type {
  DocumentDetailPlace,
  DocumentItem,
  DocumentSectionKey,
  GeneratedDocument,
  GeneratedDocumentStatus,
  MissingDocumentDetail,
} from '../../../../../lib/types';
import { SIGNER_LABELS, templateHref } from '../../../templates/wording';
import { isProfileTab, profileHref } from '../../tab-list';

// How the profile's Contracts tab words the documents generated from templates (its sections, a document's progress,
// where a template stands) and where each missing detail is filled in. Pure code (no server-only), tested; relative
// imports, as vitest doesn't know the @/ paths.
//
// These are the documents the company issues (Generated → Printed → Signed copy uploaded → Verified); the papers the
// employee brings are the employee file, on the Documents tab.

/** The sections, in the order the tab shows them, with their titles. */
export const SECTION_ORDER: readonly DocumentSectionKey[] = ['contract', 'hiring', 'insurance', 'letters', 'leaving'];

export const SECTION_TITLES: Record<DocumentSectionKey, string> = {
  contract: 'Contract Documents',
  hiring: 'Hiring',
  insurance: 'Social Insurance',
  letters: 'Letters & Certificates',
  leaving: 'Leaving',
};

/** The sections in the tab's order; any the screens don't know yet come last, as sent. */
export function orderedSections<S extends { key: string }>(sections: readonly S[]): S[] {
  const at = (key: string) => {
    const i = SECTION_ORDER.indexOf(key as DocumentSectionKey);
    return i < 0 ? SECTION_ORDER.length : i;
  };
  return [...sections].sort((a, b) => at(a.key) - at(b.key));
}

export function sectionTitle(key: string): string {
  return SECTION_TITLES[key as DocumentSectionKey] ?? key;
}

// ---------- a generated document's progress ----------

export const DOCUMENT_STATUS_LABELS: Record<GeneratedDocumentStatus, string> = {
  generated: 'Generated',
  printed: 'Printed',
  signed: 'Signed copy uploaded',
  verified: 'Verified',
};

export type Tone = 'ok' | 'warn' | 'accent' | 'muted';

/** The status pill's colour: waiting on HR (generated, printed), waiting to be checked (signed), done (verified). */
export const DOCUMENT_STATUS_TONE: Record<GeneratedDocumentStatus, Tone> = {
  generated: 'muted',
  printed: 'warn',
  signed: 'accent',
  verified: 'ok',
};

/** One step of a document's progress: whether it is done, when, and by whom when the API says. */
export interface ProgressStep {
  key: GeneratedDocumentStatus;
  label: string;
  at: string | null;
  by: string | null;
}

const emailOf = (who: { email: string } | string | null | undefined): string | null =>
  !who ? null : typeof who === 'string' ? who : (who.email ?? null);

/** Generated → Printed → Signed copy uploaded → Verified, each with when (null: not yet) and who. */
export function progressSteps(d: GeneratedDocument): ProgressStep[] {
  return [
    { key: 'generated', label: DOCUMENT_STATUS_LABELS.generated, at: d.generatedAt, by: emailOf(d.generatedBy) },
    { key: 'printed', label: DOCUMENT_STATUS_LABELS.printed, at: d.printedAt, by: emailOf(d.printedBy) },
    { key: 'signed', label: DOCUMENT_STATUS_LABELS.signed, at: d.signedUploadedAt, by: emailOf(d.signedUploadedBy) },
    { key: 'verified', label: DOCUMENT_STATUS_LABELS.verified, at: d.verifiedAt, by: emailOf(d.verifiedBy) },
  ];
}

/** Newest first, by when each was generated. */
export function newestFirst(documents: readonly GeneratedDocument[]): GeneratedDocument[] {
  return [...documents].sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt));
}

/** What HR may do next with a document. Printing may be skipped: a signed copy can be uploaded straight away. */
export function nextSteps(status: GeneratedDocumentStatus): { print: boolean; upload: boolean; reupload: boolean; verify: boolean } {
  return {
    print: status === 'generated',
    upload: status === 'generated' || status === 'printed',
    // a wrong scan is replaced before it is verified
    reupload: status === 'signed',
    verify: status === 'signed',
  };
}

// ---------- an item: what it is, where its template stands ----------

/** "Contract CON-2026-0001, v2", for a contract's documents; null for the others. */
export function itemContext(item: Pick<DocumentItem, 'contractNumber' | 'contractVersion'>): string | null {
  if (!item.contractNumber) return null;
  return `Contract ${item.contractNumber}${item.contractVersion ? `, v${item.contractVersion}` : ''}`;
}

/** Where the item's template stands, in words: none, only a draft, or the version in use. */
export function templateStateText(item: Pick<DocumentItem, 'templateStatus' | 'templateVersion'>): { text: string; tone: Tone } {
  if (item.templateStatus === 'missing') return { text: 'No template yet', tone: 'warn' };
  if (item.templateStatus === 'draft') return { text: 'Draft template only, publish it first', tone: 'warn' };
  return { text: item.templateVersion ? `Template v${item.templateVersion}` : 'Template published', tone: 'muted' };
}

/** The template's page in the library (HR uploads and publishes it there). */
export const itemTemplateHref = (item: Pick<DocumentItem, 'slotKey'>) => templateHref(item.slotKey);

/** What is typed when generating (`needsInputs`), with its label; tags the screens don't know are labelled by name. */
export const INPUT_LABELS: Record<string, { label: string; hint: string }> = {
  letter_to: { label: 'Addressed to', hint: 'Who the letter is for, e.g. the embassy or the bank, as it should read on the letter.' },
  letter_purpose: { label: 'Purpose', hint: 'What the letter is for, e.g. a visa application.' },
};

export function inputLabel(tag: string): string {
  return INPUT_LABELS[tag]?.label ?? tag.replace(/_/g, ' ');
}

/** A contract's documents grouped by contract version, newest version first; each group keeps the items' order. */
export interface ContractGroup {
  contractId: string;
  contractNumber: string | null;
  contractVersion: number | null;
  items: DocumentItem[];
}

export function contractGroups(items: readonly DocumentItem[]): ContractGroup[] {
  const groups = new Map<string, ContractGroup>();
  for (const item of items) {
    const key = item.contractId ?? '';
    const group = groups.get(key) ?? { contractId: key, contractNumber: item.contractNumber ?? null, contractVersion: item.contractVersion ?? null, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => (b.contractVersion ?? 0) - (a.contractVersion ?? 0));
}

/** "Contract CON-2026-0001 · Version 2", a group's heading. */
export function contractGroupTitle(group: Pick<ContractGroup, 'contractNumber' | 'contractVersion'>): string {
  const number = group.contractNumber ? `Contract ${group.contractNumber}` : 'Contract';
  return group.contractVersion ? `${number} · Version ${group.contractVersion}` : number;
}

// ---------- where a missing detail is filled in ----------

/**
 * The link to where a missing detail is filled in: the field's cell on a profile tab (`#field-<key>`, a paper's row
 * `#paper-<key>` on Documents), the company profile, or the contract on the Contracts tab. Null for a place the screens
 * don't know.
 */
export function missingHref(employeeId: string, where: Pick<DocumentDetailPlace, 'key'> & { tab: string }): string | null {
  const key = encodeURIComponent(where.key ?? '');
  if (where.tab === 'company') return '/organization/company';
  if (where.tab === 'contracts') return `${profileHref(employeeId, 'contracts')}#contract`;
  if (!isProfileTab(where.tab)) return null;
  const anchor = where.tab === 'documents' ? 'paper' : 'field';
  return key ? `${profileHref(employeeId, where.tab)}#${anchor}-${key}` : profileHref(employeeId, where.tab);
}

/** Where it is filled in, in words: "Basic Data", "Company profile", "Contract". */
export function placeLabel(tab: string): string {
  const named: Record<string, string> = {
    basic: 'Basic Data',
    education: 'Education',
    employment: 'Employment',
    contracts: 'Contract',
    documents: 'Employee file',
    company: 'Company profile',
  };
  return named[tab] ?? tab;
}

/** A missing detail as the screen lists it: its label, where it is filled in, and the link there (null: no link). */
export interface MissingLink {
  tag: string;
  label: string;
  place: string;
  href: string | null;
}

export function missingLinks(employeeId: string, missing: readonly MissingDocumentDetail[]): MissingLink[] {
  return missing.map((m) => ({
    tag: m.tag,
    label: m.label || m.tag,
    place: placeLabel(m.where?.tab ?? ''),
    href: m.where ? missingHref(employeeId, m.where) : null,
  }));
}

// ---------- files ----------

/** Where the browser downloads the Word file: the web server fetches it from the API with the session. */
export const documentFileHref = (employeeId: string, documentId: string) =>
  `/employees/${encodeURIComponent(employeeId)}/documents/${encodeURIComponent(documentId)}/file`;

/** The same as a PDF, shown in a new tab (Preview). */
export const documentPreviewHref = (employeeId: string, documentId: string) => `${documentFileHref(employeeId, documentId)}?format=pdf`;

/** Where the browser opens the signed copy, the same way. */
export const signedFileHref = (employeeId: string, documentId: string) =>
  `/employees/${encodeURIComponent(employeeId)}/documents/${encodeURIComponent(documentId)}/signed-file`;

/** The signed copy's type: as the API says, else from its name (a PDF, else a photo). */
export function signedMimeType(d: Pick<GeneratedDocument, 'signedFileName' | 'signedMime'>): string {
  if (d.signedMime) return d.signedMime;
  const name = (d.signedFileName ?? '').toLowerCase();
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

// ---------- what the actions answer ----------

/** Checking before generating: what is missing (each with its link), or why it can't be checked. */
export interface CheckResult {
  errors?: string[];
  missing?: MissingLink[];
  usesRestricted?: boolean;
}

/** Generating: done (`message`), refused for missing details (`missing`), or refused for another reason (`errors`). */
export interface GenerateResult {
  errors?: string[];
  missing?: MissingLink[];
  message?: string;
}

/** Said where the server doesn't have document generation yet (it answers 404 for its addresses). */
export const NOT_AVAILABLE = 'Not available yet.';
export const NOT_AVAILABLE_ACTION = 'Not available yet: the server does not have document generation yet. Please try again after its next update.';
export const NO_TEMPLATE = 'There is no published template for this document yet. Upload and publish one in Templates first.';

/** Whether a 404's messages are the server's own "Cannot GET /api/…" for an address it doesn't have. */
export const isMissingRoute = (messages: readonly string[]) => messages.some((m) => /^Cannot (GET|POST|PUT|PATCH|DELETE) /.test(m));

/** Who signs a slot's printed document, in a sentence: "the employee and the company" (from the template library). */
export function signersText(slotKey: string): string | null {
  const signers = TEMPLATE_SLOTS.find((s) => s.key === slotKey)?.signers;
  return signers && signers !== 'none' ? (SIGNER_LABELS[signers] ?? '').toLowerCase() || null : null;
}

/** What was typed when a document was generated, as "Addressed to: … · Purpose: …"; null when nothing was. */
export function inputsText(inputs: Record<string, string> | null | undefined): string | null {
  const said = Object.entries(inputs ?? {})
    .filter(([, value]) => typeof value === 'string' && value.trim() !== '')
    .map(([tag, value]) => `${inputLabel(tag)}: ${value.trim()}`);
  return said.length > 0 ? said.join(' · ') : null;
}
