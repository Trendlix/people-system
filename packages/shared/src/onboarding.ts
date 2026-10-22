// Onboarding (owner, 22 October 2026: "where will we include the ATS?", Phase 2; the original plan's spec §12: "Hire →
// generate offer & joining documents → create employee record → onboarding checklist (incl. ID & documents, JD sign-off,
// KPI template assignment)"), offboarding's mirror (offboarding.ts):
// - A checklist per employment: opened when an applicant is hired through an accepted job offer, or by HR from a new
//   employee's profile (someone hired without the ATS).
// - Its items: three the system ticks while it is open ("Contract signed": the employment's contract is signed; "KPI
//   template in place": the job title has a published KPI template; "Equipment handed over": they hold something in
//   custody), then HR's default items (an HR-editable list copied into each checklist when it opens), each with the role
//   that clears it, as offboarding's: HR, the direct manager, an Admin, Finance, the Assets custodians.
// - Completed by HR (the CEO, a Super Admin) once every item is done or not applicable.
// - A C-level person's (owner, 19 October 2026: "make C level Employees details not visible to HR") is the CEO's and a
//   Super Admin's only.
// Pure code: the API enforces these rules, the web shows them. Tested in apps/api/src/common/recruitment-hiring.spec.ts.

import type { ClearanceItemStatus, ClearanceOwner } from './offboarding.js';

export const ONBOARDING_STATUSES = ['open', 'completed'] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

export const ONBOARDING_STATUS_LABELS: Record<OnboardingStatus, string> = { open: 'In progress', completed: 'Completed' };

/** An item's kind: cleared by a person (manual), or ticked by the system: the contract, the KPI template, equipment. */
export const ONBOARDING_KINDS = ['manual', 'contract', 'kpi_template', 'assets'] as const;
export type OnboardingKind = (typeof ONBOARDING_KINDS)[number];

/** The three items the system ticks, on every checklist, first. */
export const ONBOARDING_AUTO_ITEMS: readonly { kind: Exclude<OnboardingKind, 'manual'>; label: string; owner: ClearanceOwner }[] = [
  { kind: 'contract', label: 'Contract signed', owner: 'hr' },
  { kind: 'kpi_template', label: 'KPI template in place for the job title', owner: 'hr' },
  { kind: 'assets', label: 'Equipment handed over', owner: 'assets' },
];

/** The default items a new list starts with (the owner's brief, 22 October 2026); HR changes them in Onboarding Checklist. */
export const DEFAULT_ONBOARDING_ITEMS: readonly { label: string; owner: ClearanceOwner }[] = [
  { label: 'National ID and documents collected', owner: 'hr' },
  { label: 'JD sign-off', owner: 'manager' },
  { label: 'Accounts created', owner: 'admin' },
  { label: 'Social insurance Form 1', owner: 'hr' },
];

/** An onboarding checklist's item, as its page shows it. */
export interface OnboardingItemView {
  id: string;
  kind: OnboardingKind;
  label: string;
  owner: ClearanceOwner;
  status: ClearanceItemStatus;
  /** Who cleared it (a name, or "The system") and when (ISO); null while pending. */
  doneBy: string | null;
  doneAt: string | null;
  note: string | null;
  canMark: boolean;
}

/** An onboarding checklist on the list and the profile. */
export interface OnboardingSummary {
  id: string;
  status: OnboardingStatus;
  employee: { id: string; employeeCode: string; fullNameEn: string };
  employmentId: string;
  jobTitle: string | null;
  department: string | null;
  /** YYYY-MM-DD. */
  joinDate: string;
  openedAt: string;
  /** The application they were hired from, if any. */
  application: { id: string; number: string } | null;
  progress: { cleared: number; total: number };
}

/** GET /onboarding/:id. */
export interface OnboardingView extends OnboardingSummary {
  items: OnboardingItemView[];
  completedAt: string | null;
  completedBy: string | null;
  can: { manage: boolean; complete: boolean; addItem: boolean };
}
