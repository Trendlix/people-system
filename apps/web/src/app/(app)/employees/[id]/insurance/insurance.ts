import { LABELS, paperworkType, requiredPaperwork } from '@trendlix/shared';
import { formatDate } from '../../../../../lib/format';
import type { Contract, DocumentItem, DocumentsTab, EmployeeProfile, Employment, PaperworkItem } from '../../../../../lib/types';
import { profileHref } from '../../tab-list';
import { formatEgp } from '../contracts/salary';
import { templateStateText, type CheckResult, type MissingLink } from '../documents/wording';
import { occupationLabel } from './occupation';

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

// ---------- what Form 1 prints from this tab ----------
// The occupation, the subscription start and the basic and comprehensive wages are the employee's own, set by HR here
// (owner's decisions, 16 October 2026: the occupation no longer the job title's); while one isn't set, Form 1 prints
// what stands in for it. The insured wage is the comprehensive wage within this year's insurable limits, worked out by
// the API (owner's decision, 16 October 2026: no longer edited).

/** The occupation as written: "194200 · اخصائي موارد بشريه"; null when none is set. */
export function occupationText(p: Pick<EmployeeProfile, 'occupationCode' | 'occupationName'>): string | null {
  return occupationLabel(p.occupationCode, p.occupationName) || null;
}

/**
 * Whether the profile came with the social insurance wages: only for those who see salaries (HR, Finance, the CEO);
 * the API leaves them out for anyone else, so the tab doesn't show them.
 */
export const showsWages = (p: Pick<EmployeeProfile, 'insuranceBasicDefault'>): boolean => typeof p.insuranceBasicDefault === 'number';

/** What Form 1 prints for an item: the employee's own (`from` null), or what stands in for it ("the join date" …); null for nothing. */
export type Printed = { text: string; from: string | null } | null;

/** The subscription start: the employee's own, else the join date of the employment the forms are about. */
export function startPrinted(p: Pick<EmployeeProfile, 'insuranceStartDate'>, e: Pick<Employment, 'joinDate'> | null): Printed {
  if (p.insuranceStartDate) return { text: formatDate(p.insuranceStartDate), from: null };
  return e ? { text: formatDate(e.joinDate), from: 'the join date' } : null;
}

/** The basic wage: the employee's own, else the contract settings' default ("EGP 410.00 · default"). */
export function basicPrinted(p: Pick<EmployeeProfile, 'insuranceBasicWage' | 'insuranceBasicDefault'>): Printed {
  if (typeof p.insuranceBasicWage === 'number') return { text: formatEgp(p.insuranceBasicWage), from: null };
  return typeof p.insuranceBasicDefault === 'number' ? { text: formatEgp(p.insuranceBasicDefault), from: 'default' } : null;
}

type ContractWages = Pick<Contract, 'totalSalary' | 'salaryHidden'> | null | undefined;

/**
 * The insured wage as the API worked it out, and how: "EGP 15,200.00 · the comprehensive wage", or "EGP 16,700.00 · the
 * comprehensive wage (EGP 20,000.00) capped at 2026's maximum" (raised to its minimum when below it); null without a
 * comprehensive wage.
 */
export function insuredPrinted(p: Pick<EmployeeProfile, 'insuredWage'>): Printed {
  const w = p.insuredWage;
  if (!w) return null;
  const how = w.adjusted === 'max' ? `capped at ${w.limits.year}'s maximum` : w.adjusted === 'min' ? `raised to ${w.limits.year}'s minimum` : null;
  return { text: formatEgp(w.amount), from: how ? `the comprehensive wage (${formatEgp(w.comprehensive)}) ${how}` : 'the comprehensive wage' };
}

/** Under the insured wage, which isn't edited: "Set by the comprehensive wage, within EGP 2,700.00 to 16,700.00 in 2026." */
export const insuredNote = (limits: InsurableLimits): string => `Set by the comprehensive wage, within ${insurableLimitsText(limits)}.`;

/** Under "Registered with social insurance", in one plain sentence. */
export const REGISTERED_NOTE = 'Payroll deducts social insurance only for registered employees.';

/** The comprehensive wage: the employee's own, else the contract's gross and allowances; null with neither. */
export function comprehensivePrinted(p: Pick<EmployeeProfile, 'insuranceComprehensiveWage'>, c: ContractWages): Printed {
  if (typeof p.insuranceComprehensiveWage === 'number') return { text: formatEgp(p.insuranceComprehensiveWage), from: null };
  return c && !c.salaryHidden && typeof c.totalSalary === 'number' ? { text: formatEgp(c.totalSalary), from: 'from the contract' } : null;
}

type InsurableLimits = NonNullable<EmployeeProfile['insurableLimits']>;

/** A year's insurable wage limits as the API sends them, in words: "EGP 2,700.00 to 16,700.00 in 2026". */
export function insurableLimitsText(limits: InsurableLimits): string {
  return `${formatEgp(limits.min)} to ${formatEgp(limits.max).replace('EGP ', '')} in ${limits.year}`;
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
