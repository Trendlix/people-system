import type {
  Degree,
  EducationGrade,
  EmployeeStatus,
  EmploymentType,
  Gender,
  MaritalStatus,
  MilitaryStatus,
  PaperworkKind,
  Role,
  WorkArrangement,
} from '@trendlix/shared';

// Shapes returned by the API.

export interface SessionUser {
  id: string;
  email: string;
  roles: Role[];
}

export interface Department {
  id: string;
  nameEn: string;
  nameAr: string | null;
  _count: { jobTitles: number };
}

export interface JobTitleSummary {
  id: string;
  departmentId: string;
  titleEn: string;
  titleAr: string | null;
  grade: string | null;
  jdVersion: number;
  department: { id: string; nameEn: string; nameAr: string | null };
  _count: { duties: number };
}

export interface JobTitle extends Omit<JobTitleSummary, '_count'> {
  jdPurpose: string | null;
  jdRequirements: string | null;
  duties: { id: string; position: number; duty: string }[];
}

export interface Shift {
  id: string;
  code: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  workingDays: number[];
}

export interface Company {
  nameEn: string;
  nameAr: string | null;
  activity: string | null;
  commercialRegNo: string | null;
  taxRegNo: string | null;
  insuranceEmployerNo: string | null;
  addressAr: string | null;
  addressEn: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  repName: string | null;
  repTitle: string | null;
  repNationalIdMasked: string | null;
  hasLogo: boolean;
  logoUpdatedAt: string | null;
  updatedAt: string;
}

export interface CompanyBrand {
  nameEn: string;
  nameAr: string | null;
  logoVersion: number | null;
}

/** Returned by every form action. */
export interface FormState {
  errors?: string[];
  values?: Record<string, string | string[]>;
  message?: string;
}

// ---------- employees ----------
// Dates are "YYYY-MM-DD" (or null), times "HH:mm"; createdAt / updatedAt are ISO moments.

/** One row of GET /employees, already limited to the people the caller may see. */
export interface EmployeeSummary {
  id: string;
  employeeCode: string;
  fullNameEn: string;
  fullNameAr: string;
  workEmail: string | null;
  status: EmployeeStatus;
  employmentType: EmploymentType;
  joinDate: string;
  department: { id: string; nameEn: string } | null;
  jobTitle: { id: string; titleEn: string } | null;
  manager: { id: string; fullNameEn: string } | null;
}

/** GET /employees/:id. `identity` and `bank` are only present when the caller may see them (masked). */
export interface EmployeeProfile {
  id: string;
  employeeCode: string;
  fullNameEn: string;
  fullNameAr: string;
  dateOfBirth: string | null;
  gender: Gender | null;
  nationality: string | null;
  maritalStatus: MaritalStatus | null;
  militaryStatus: MilitaryStatus | null;
  workEmail: string | null;
  personalEmail: string | null;
  mobile: string | null;
  addressAr: string | null;
  governorate: string | null;
  emergencyName: string | null;
  emergencyRelation: string | null;
  emergencyMobile: string | null;
  university: string | null;
  faculty: string | null;
  degree: Degree | null;
  major: string | null;
  graduationYear: number | null;
  educationGrade: EducationGrade | null;
  qualificationAr: string | null;
  employmentType: EmploymentType;
  status: EmployeeStatus;
  departmentId: string | null;
  jobTitleId: string | null;
  managerId: string | null;
  joinDate: string;
  probationEnd: string | null;
  workArrangement: WorkArrangement;
  /** Hybrid only; 0 = Sunday … 6 = Saturday. */
  officeDays: number[];
  shiftId: string | null;
  jdAcknowledgedAt: string | null;
  createdAt: string;
  updatedAt: string;
  department: { id: string; nameEn: string; nameAr: string | null } | null;
  jobTitle: { id: string; titleEn: string; titleAr: string | null; grade: string | null; jdVersion: number } | null;
  manager: { id: string; employeeCode: string; fullNameEn: string } | null;
  shift: { id: string; code: string; startTime: string; endTime: string } | null;
  reports: { id: string; employeeCode: string; fullNameEn: string; status: EmployeeStatus; jobTitle: { titleEn: string } | null }[];
  /** HR and CEO only; null = nothing recorded. */
  identity?: {
    nationalIdMasked: string | null;
    printedNoMasked: string | null;
    issueDate: string | null;
    expiryDate: string | null;
    issuingOffice: string | null;
  } | null;
  /** HR, Finance and CEO only; null = nothing recorded. */
  bank?: {
    bankName: string | null;
    branch: string | null;
    holderName: string | null;
    accountNoMasked: string | null;
    ibanMasked: string | null;
  } | null;
  /** What the caller may do: edit (HR), see the national ID, see the bank details. */
  access: { edit: boolean; identity: boolean; bank: boolean };
}

/** GET /employees/:id/identity: the full national ID details (each call is audited). */
export interface EmployeeIdentity {
  nationalId: string | null;
  printedNo: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  issuingOffice: string | null;
}

/** GET /employees/:id/bank: the full bank details (each call is audited). */
export interface EmployeeBank {
  bankName: string | null;
  branch: string | null;
  accountNo: string | null;
  iban: string | null;
  holderName: string | null;
}

// ---------- users ----------

/** A sign-in account, from GET /users (admins only). */
export interface UserAccount {
  id: string;
  email: string;
  isActive: boolean;
  roles: Role[];
  createdAt: string;
  /** The latest successful sign-in; null = never signed in. */
  lastSignInAt: string | null;
  /** The employee whose work email is this user's email (linked by work email, nothing else). */
  employee: { id: string; employeeCode: string; fullNameEn: string } | null;
}

// ---------- employee file: scanned paperwork ----------

/** Whether the OCR service has read the file's text (which makes it searchable). */
export type OcrStatus = 'pending' | 'done' | 'failed' | 'unavailable';

/** One scanned file, from GET /employees/:id/paperwork (HR and CEO), newest first. The file itself is never included. */
export interface PaperworkItem {
  id: string;
  kind: PaperworkKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  ocrStatus: OcrStatus;
  /** ISO moment. */
  uploadedAt: string;
  uploadedBy: { email: string } | null;
}

/** One result of GET /paperwork/search?q= (HR and CEO; at most 50): the file, whose it is, and the matching text. */
export interface PaperworkSearchHit {
  item: PaperworkItem;
  employee: { id: string; employeeCode: string; fullNameEn: string };
  snippet: string;
}

/**
 * POST /employees/:id/identity/scan: what was read from the ID card photos, for HR to check. Only the photos are
 * stored (in the employee file); nothing else changes until HR saves. Dates are YYYY-MM-DD.
 */
export interface IdCardScan {
  suggestions: {
    nationalId?: string;
    fullNameAr?: string;
    addressAr?: string;
    dateOfBirth?: string;
    gender?: Gender;
    issueDate?: string;
    expiryDate?: string;
    printedNo?: string;
    issuingOffice?: string;
  };
  /** The stored photos and their text (null when that side could not be read). */
  front: { itemId: string; text: string | null };
  back?: { itemId: string; text: string | null };
}
