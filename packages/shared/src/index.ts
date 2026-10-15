// Values shared by the web app and the API.
// Source of truth: the enums in trendlix-hrms-handoff/db/schema.sql.

export const ROLES = ['employee', 'manager', 'hr', 'finance', 'ceo', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'internship', 'freelance', 'sales'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const EMPLOYEE_STATUSES = ['active', 'probation', 'on_leave', 'notice_period', 'resigned', 'terminated'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const WORK_ARRANGEMENTS = ['office', 'wfh', 'hybrid'] as const;
export type WorkArrangement = (typeof WORK_ARRANGEMENTS)[number];

// ---------- employee profile lists (trendlix-hrms-handoff/docs/profile-fields.md) ----------

export const GENDERS = ['male', 'female'] as const;
export type Gender = (typeof GENDERS)[number];

export const MARITAL_STATUSES = ['single', 'married', 'divorced', 'widowed'] as const;
export type MaritalStatus = (typeof MARITAL_STATUSES)[number];

export const MILITARY_STATUSES = ['completed', 'exempt', 'postponed', 'not_applicable'] as const;
export type MilitaryStatus = (typeof MILITARY_STATUSES)[number];

export const DEGREES = ['high_school', 'diploma', 'bachelor', 'master', 'doctorate'] as const;
export type Degree = (typeof DEGREES)[number];

export const EDUCATION_GRADES = ['excellent', 'very_good', 'good', 'pass'] as const;
export type EducationGrade = (typeof EDUCATION_GRADES)[number];

export const GOVERNORATES = [
  'Alexandria', 'Aswan', 'Asyut', 'Beheira', 'Beni Suef', 'Cairo', 'Dakahlia', 'Damietta', 'Faiyum',
  'Gharbia', 'Giza', 'Ismailia', 'Kafr El Sheikh', 'Luxor', 'Matrouh', 'Minya', 'Monufia', 'New Valley',
  'North Sinai', 'Port Said', 'Qalyubia', 'Qena', 'Red Sea', 'Sharqia', 'Sohag', 'South Sinai', 'Suez',
] as const;
export type Governorate = (typeof GOVERNORATES)[number];

// What the screens show for each stored value.
export const LABELS = {
  employmentType: { full_time: 'Full-time', part_time: 'Part-time', internship: 'Internship', freelance: 'Freelance', sales: 'Sales' },
  status: {
    active: 'Active',
    probation: 'Probation',
    on_leave: 'On leave',
    notice_period: 'Notice period',
    resigned: 'Resigned',
    terminated: 'Terminated',
  },
  workArrangement: { office: 'Office', wfh: 'Work from home', hybrid: 'Hybrid' },
  gender: { male: 'Male', female: 'Female' },
  maritalStatus: { single: 'Single', married: 'Married', divorced: 'Divorced', widowed: 'Widowed' },
  militaryStatus: { completed: 'Completed', exempt: 'Exempt', postponed: 'Postponed', not_applicable: 'Not applicable' },
  degree: { high_school: 'High school', diploma: 'Diploma', bachelor: "Bachelor's", master: "Master's", doctorate: 'Doctorate' },
  educationGrade: { excellent: 'Excellent', very_good: 'Very good', good: 'Good', pass: 'Pass' },
} as const satisfies {
  employmentType: Record<EmploymentType, string>;
  status: Record<EmployeeStatus, string>;
  workArrangement: Record<WorkArrangement, string>;
  gender: Record<Gender, string>;
  maritalStatus: Record<MaritalStatus, string>;
  militaryStatus: Record<MilitaryStatus, string>;
  degree: Record<Degree, string>;
  educationGrade: Record<EducationGrade, string>;
};

/** Months of probation after the join date, unless HR sets another end date. */
export const PROBATION_MONTHS = 3;

// ---------- employee file: scanned paperwork (spec §8.5) ----------

export const PAPERWORK_KINDS = [
  'national_id_front',
  'national_id_back',
  'qualification_certificate',
  'birth_certificate',
  'military_certificate',
  'criminal_record',
  'personal_photo',
  'syndicate_card', // كارنيه النقابة, for members of a professional syndicate: optional, never on the checklist
  'other',
] as const;
export type PaperworkKind = (typeof PAPERWORK_KINDS)[number];

export const PAPERWORK_LABELS: Record<PaperworkKind, string> = {
  national_id_front: 'National ID (front)',
  national_id_back: 'National ID (back)',
  qualification_certificate: 'Qualification certificate',
  birth_certificate: 'Birth certificate',
  military_certificate: 'Military status certificate',
  criminal_record: 'Criminal record certificate',
  personal_photo: 'Personal photo',
  syndicate_card: 'Syndicate card',
  other: 'Other document',
};

/** Restricted like the national ID itself: HR and CEO only. */
export const RESTRICTED_PAPERWORK: readonly PaperworkKind[] = ['national_id_front', 'national_id_back'];

/**
 * The scans an employee's file needs (spec §8.5), by employment type (see paperworkType). Full-time: the full list;
 * military papers for men only (a woman's military status is always Not applicable). Other employment types: the
 * national ID (their signed job offer and NDA come from document generation). While the gender is not recorded,
 * military papers are listed as needed. Someone not employed yet (null) needs the full-time list: HR collects the
 * papers before the start date, and full time is the usual hire (owner, 15 October 2026).
 * The bank account letter and the social insurance forms (Form 1 …) are not scans HR collects: the system generates
 * them from templates HR adds (owner, 15 October 2026).
 */
export function requiredPaperwork(employmentType: EmploymentType | null, gender: Gender | null): PaperworkKind[] {
  if (employmentType !== null && employmentType !== 'full_time') return ['national_id_front', 'national_id_back'];
  return [
    'national_id_front',
    'national_id_back',
    'qualification_certificate',
    'birth_certificate',
    ...(gender === 'female' ? [] : (['military_certificate'] as const)),
    'criminal_record',
    'personal_photo',
  ];
}

/**
 * The employment type a file's papers are checked against: the current employment's, else the latest past one's (a
 * former employee's file stays as it was), else null for someone never employed (the full-time list).
 */
export function paperworkType(current: EmploymentType | null | undefined, latest: EmploymentType | null | undefined): EmploymentType | null {
  return current ?? latest ?? null;
}

// ---------- employment history ----------

/** Why an employment ended. Resigned gives the status Resigned; the others give Terminated. */
export const END_REASONS = ['resigned', 'terminated', 'contract_ended', 'mutual_agreement', 'retired', 'deceased', 'disability', 'other'] as const;
export type EndReason = (typeof END_REASONS)[number];

export const END_REASON_LABELS: Record<EndReason, string> = {
  resigned: 'Resigned',
  terminated: 'Terminated',
  contract_ended: 'Contract ended',
  mutual_agreement: 'Mutual agreement',
  retired: 'Retired',
  deceased: 'Deceased',
  disability: 'Disability',
  other: 'Other',
};

/** Where someone stands, for the directory: their current employment's status, or no current employment. */
export const STANDINGS = ['active', 'probation', 'on_leave', 'notice_period', 'former', 'not_employed'] as const;
export type Standing = (typeof STANDINGS)[number];

export const STANDING_LABELS: Record<Standing, string> = {
  active: 'Active',
  probation: 'Probation',
  on_leave: 'On leave',
  notice_period: 'Notice period',
  former: 'Former employee',
  not_employed: 'Not employed yet',
};

// ---------- phone numbers (as Prime ERP keeps them) ----------

export * from './phone.js';

// ---------- education: Egyptian universities and faculties ----------

export * from './education.js';

// ---------- banks (EG-ACH list) ----------

export * from './banks.js';

// ---------- contracts and how employment ends (Labour Law 14/2025) ----------

export * from './contracts.js';

// ---------- the employee's own check of their data ----------

export * from './profile-confirmation.js';
