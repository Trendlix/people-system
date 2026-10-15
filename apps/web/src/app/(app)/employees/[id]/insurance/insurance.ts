import { LABELS, paperworkType, requiredPaperwork } from '@trendlix/shared';
import type { DocumentItem, DocumentsTab, EmployeeProfile, Employment, PaperworkItem } from '../../../../../lib/types';
import { occupationLabel } from '../../../organization/departments/occupation';
import { profileHref } from '../../tab-list';
import { templateStateText, type CheckResult, type MissingLink } from '../documents/wording';

// The profile's Social Insurance tab (owner's request, 16 October 2026: "creating a tab here for all social insurance
// work"): which employment and forms it is about, whether each form can be generated, where the social insurance print
// stands, and where it links. Pure code, tested; relative imports, as vitest doesn't know the @/ paths.

/** Social insurance Form 1 (joining) and Form 6 (leaving): the API's insurance section (documents/offer.ts). */
export const FORM_1 = 'insurance_form_1';
export const FORM_6 = 'insurance_form_6';

/** The contract's social insurance copy: a copy of the contract, so it is listed with the contract on the Contracts tab. */
export const CONTRACT_INSURANCE_COPY = 'contract_full_time_insurance';

/**
 * The employment the tab is about: the current one, else the latest, as the documents are (Form 6 is generated after
 * the last day too); null for someone never employed.
 */
export function insuredEmployment(p: Pick<EmployeeProfile, 'employment' | 'employments'>): Employment | null {
  return p.employment ?? p.employments[0] ?? null;
}

/** The forms the API offers the employee, in order: Form 1 once hired full time, Form 6 once the employment is ending or has ended. */
export function insuranceForms(tab: Pick<DocumentsTab, 'sections'>): DocumentItem[] {
  return tab.sections.find((s) => s.key === 'insurance')?.items ?? [];
}

/** Whether the Contracts tab lists the contract's social insurance copy (a full-time contract version has one). */
export function hasInsuranceCopy(tab: Pick<DocumentsTab, 'sections'>): boolean {
  return tab.sections.some((s) => s.key === 'contract' && s.items.some((i) => i.slotKey === CONTRACT_INSURANCE_COPY));
}

/** Where the contract's social insurance copy is: with the contract's documents on the Contracts tab. */
export const insuranceCopyHref = (employeeId: string) => `${profileHref(employeeId, 'contracts')}#contract-documents`;

/** Why a form isn't listed: none without an employment or for one that isn't full time, Form 6 only once there is an ending. */
export type FormsGap = { kind: 'not_employed' | 'not_full_time' | 'no_ending'; text: string };

export function formsGap(employment: Pick<Employment, 'employmentType'> | null, forms: readonly Pick<DocumentItem, 'slotKey'>[]): FormsGap | null {
  if (!employment) return { kind: 'not_employed', text: 'Not employed yet: Form 1 comes once they are hired full time.' };
  if (employment.employmentType !== 'full_time') {
    return { kind: 'not_full_time', text: `Forms 1 and 6 are for full-time employments. This one is ${LABELS.employmentType[employment.employmentType].toLowerCase()}.` };
  }
  if (!forms.some((f) => f.slotKey === FORM_6)) return { kind: 'no_ending', text: 'Form 6 (leaving) comes once an ending is recorded on the Employment tab.' };
  return null;
}

// ---------- the job title's insurance occupation ----------

/** The occupation Form 1 prints, from the employment's job title: "212300 · مدير مبيعات"; null when the title has none. */
export function occupationText(jobTitle: Employment['jobTitle']): string | null {
  return occupationLabel(jobTitle?.occupationCode, jobTitle?.occupationName) || null;
}

/**
 * Where the job title's insurance occupation is set: the job title's page under Organization, at Edit job title; the
 * job titles' list when the API doesn't say the department the title is under.
 */
export function jobTitleHref(jobTitle: { id: string; departmentId?: string | null }): string {
  if (!jobTitle.departmentId) return '/organization/departments';
  return `/organization/departments/${encodeURIComponent(jobTitle.departmentId)}/job-titles/${encodeURIComponent(jobTitle.id)}#edit`;
}

/**
 * Missing details as the check lists them, with what is set on the job title (its insurance occupation) linked to this
 * employee's job title itself rather than to the list of job titles; the others as they are.
 */
export function withJobTitleLinks(missing: readonly MissingLink[], jobTitle: { id: string; departmentId?: string | null } | null): MissingLink[] {
  if (!jobTitle?.departmentId) return [...missing];
  return missing.map((m) => (m.href === '/organization/departments' ? { ...m, href: jobTitleHref(jobTitle) } : m));
}

// ---------- whether a form can be generated now ----------

/** A form's template isn't published, it is ready to generate, details are missing, or it couldn't be checked. */
export type Readiness =
  | { state: 'template'; text: string }
  | { state: 'ready' }
  | { state: 'missing'; missing: MissingLink[] }
  | { state: 'unchecked'; errors: string[] };

/** The forms checked before generating: those with a published template (there is nothing to check for the others). */
export const formsToCheck = <I extends Pick<DocumentItem, 'templateStatus'>>(forms: readonly I[]): I[] => forms.filter((f) => f.templateStatus === 'published');

/** A form's readiness, from what checking it answered (null: not checked, as its template isn't published). */
export function readiness(form: Pick<DocumentItem, 'templateStatus' | 'templateVersion'>, check: CheckResult | null): Readiness {
  if (form.templateStatus !== 'published' || !check) return { state: 'template', text: templateStateText(form).text };
  if (check.errors?.length) return { state: 'unchecked', errors: check.errors };
  if (check.missing?.length) return { state: 'missing', missing: check.missing };
  return { state: 'ready' };
}

// ---------- the social insurance print (برنت التأمينات) in the employee file ----------

export const PRINT = 'insurance_print';

/** Whether the employee file's checklist needs the print: a full-time employment's does (current, else latest, else a full-time hire's). */
export function printRequired(p: Pick<EmployeeProfile, 'employment' | 'employments' | 'gender'>): boolean {
  return requiredPaperwork(paperworkType(p.employment?.employmentType, p.employments[0]?.employmentType), p.gender).includes(PRINT);
}

/** Uploaded (its newest file, and how many there are) or missing, needed or not; the employee file has no other state. */
export type PrintStatus =
  | { state: 'uploaded'; uploadedAt: string; files: number; documentNo: string | null }
  | { state: 'missing'; required: boolean };

export function printStatus(items: readonly Pick<PaperworkItem, 'kind' | 'uploadedAt' | 'documentNo'>[], required: boolean): PrintStatus {
  const prints = items.filter((i) => i.kind === PRINT).sort((a, b) => Date.parse(b.uploadedAt) - Date.parse(a.uploadedAt));
  if (prints.length === 0) return { state: 'missing', required };
  return { state: 'uploaded', uploadedAt: prints[0].uploadedAt, files: prints.length, documentNo: prints[0].documentNo };
}

/** Where the print is viewed or uploaded: its row on the Documents tab, which only a paper the checklist needs has. */
export function printHref(employeeId: string, required: boolean): string {
  return required ? `${profileHref(employeeId, 'documents')}#paper-${PRINT}` : profileHref(employeeId, 'documents');
}
