import type {
  Degree,
  EducationGrade,
  EmployeeStatus,
  EmploymentType,
  EndReason,
  Gender,
  Governorate,
  MaritalStatus,
  MilitaryStatus,
  PaperworkKind,
  Role,
  Standing,
  WorkArrangement,
} from '@trendlix/shared';

// Shapes returned by the API.

export interface SessionUser {
  id: string;
  email: string;
  roles: Role[];
}

/** A department as other records name it. `parent` is set when it is a team: the department the team belongs to. */
export interface DepartmentRef {
  id: string;
  nameEn: string;
  nameAr: string | null;
}

/**
 * A department or a team (owner's words: Department → Team → Job title, e.g. Marketing → Content Team → Senior Content
 * Creator). One level only: a team belongs to a department (`parentId`), and a team has no teams of its own. The API
 * calls teams sub-departments (`parent`, `children`); GET /departments returns departments and teams in one list, in the
 * order an Admin set (then by name).
 */
export interface Department extends DepartmentRef {
  /** The department this team belongs to; null for a department. */
  parentId: string | null;
  parent: DepartmentRef | null;
  /** Its place among the departments, or among its department's teams, as an Admin ordered them (PUT /departments/order). */
  sortOrder: number;
  /** `children`: how many teams it has. */
  _count: { jobTitles: number; children: number };
  /** GET /departments/:id only: its teams, in their saved order. */
  children?: (DepartmentRef & { sortOrder: number; _count: { jobTitles: number } })[];
}

/** A grade as job titles and employees name it: G1 Entry Level … G9 Executive; rank 1 is the lowest. */
export interface GradeRef {
  id: string;
  code: string;
  rank: number;
  levelEn: string;
  levelAr: string | null;
}

/** GET /grades, lowest rank first. */
export interface Grade extends GradeRef {
  description: string | null;
  _count: { jobTitles: number };
}

export interface JobTitleSummary {
  id: string;
  /** Its team (a few older job titles may still sit directly in a department until HR moves them). */
  departmentId: string;
  titleEn: string;
  titleAr: string | null;
  gradeId: string | null;
  grade: GradeRef | null;
  jdVersion: number;
  department: DepartmentRef & { parent: DepartmentRef | null };
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

/** A team (or, from before teams, a department) as an employment names it: `parent` is the team's department. */
export type EmploymentPlace = DepartmentRef & { parent: DepartmentRef | null };

/**
 * One period of employment (owner's decision: the profile and the employment are separate, so the profiles of people
 * who leave are kept). One at a time is current: the one without an end date. Ended ones are the person's history.
 */
export interface Employment {
  id: string;
  employeeId: string;
  employmentType: EmploymentType;
  /** Active, Probation, On leave or Notice period while current; Resigned or Terminated once ended (by the end reason). */
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
  /** The last working day; null while current. */
  endDate: string | null;
  endReason: EndReason | null;
  endNote: string | null;
  createdAt: string;
  updatedAt: string;
  /** May be a team: then `parent` is its department. */
  department: EmploymentPlace | null;
  /** `grade` is the employee's grade: their job title's. */
  jobTitle: { id: string; titleEn: string; titleAr: string | null; jdVersion: number; grade: GradeRef | null } | null;
  manager: { id: string; employeeCode: string; fullNameEn: string } | null;
  shift: { id: string; code: string; startTime: string; endTime: string } | null;
}

/** One row of GET /employees, already limited to the people the caller may see. */
export interface EmployeeSummary {
  id: string;
  employeeCode: string;
  fullNameEn: string;
  fullNameAr: string;
  workEmail: string | null;
  /** The current employment's status, else Former employee (an employment ended) or Not employed yet. */
  standing: Standing;
  /** The current employment; null for a former employee or someone not employed yet. */
  employment: {
    id: string;
    status: EmployeeStatus;
    employmentType: EmploymentType;
    joinDate: string;
    /** May be a team: then `parent` is its department. */
    department: EmploymentPlace | null;
    /** `grade` is the employee's grade: their job title's. */
    jobTitle: { id: string; titleEn: string; grade: Omit<GradeRef, 'levelAr'> | null } | null;
    manager: { id: string; fullNameEn: string } | null;
  } | null;
  /** How the last employment ended, when there is no current one. */
  lastEnded: { endDate: string; endReason: EndReason } | null;
}

/** One thing a profile still lacks, and the profile tab where it is filled in. */
export interface ProfileGap {
  key: string;
  label: string;
  tab: 'basic' | 'education' | 'documents';
}

/**
 * GET /employees/:id: the profile (personal, contact, education), the current employment and the history of
 * employments, newest first (the current one first). `identity` and `bank` are only present when the caller may see
 * them (masked).
 */
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
  /** A second mobile number. */
  mobile2: string | null;
  addressAr: string | null;
  /** The city or district, in Arabic as on the ID card (e.g. مدينة نصر). */
  city: string | null;
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
  createdAt: string;
  updatedAt: string;
  /** The current employment; null when there is none (not employed yet, or a former employee). */
  employment: Employment | null;
  /** Every employment, newest first, the current one first. */
  employments: Employment[];
  /** The people whose current employment reports to this person; `status` is their employment's. */
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
  /** How complete the profile is: the fields HR fills in and the papers the employee file needs. */
  completeness: { percent: number; missing: ProfileGap[] };
  /** What the caller may do: edit (HR), delete (HR and Admin), see the national ID, see the bank details. */
  access: { edit: boolean; delete: boolean; identity: boolean; bank: boolean };
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
  /** The number printed on the paper, if any. */
  documentNo: string | null;
  /** When the paper stops being valid (YYYY-MM-DD), if it does. */
  expiresOn: string | null;
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
    /** Printed on the back. */
    maritalStatus?: MaritalStatus;
    /** The governorate the address ends in. */
    governorate?: Governorate;
    /** The city or district the address names before its governorate, in Arabic as printed (e.g. مدينة نصر). */
    city?: string;
    /** 'Egyptian': the card is an Egyptian national ID. */
    nationality?: string;
  };
  /** The suggestions changed by fixes learned from HR's earlier corrections (GET /id-card/corrections). */
  corrected: LearnedField[];
  /** What was left out and why, in plain English, for HR (e.g. a number the edge of the picture cuts through). */
  notes: string[];
  /** The stored photos and their text (null when that side could not be read). */
  front: { itemId: string; text: string | null };
  back?: { itemId: string; text: string | null };
}

/**
 * POST /employees/read-id-card: what was read from photos of a new employee's ID card, for the Add employee form.
 * Nothing is stored; the photos go to the employee file once the employee is added. Dates are YYYY-MM-DD.
 */
export interface IdCardReading {
  suggestions: IdCardScan['suggestions'];
  corrected: LearnedField[];
  notes: string[];
  /** The text read from each side (null when that side could not be read). */
  front: { text: string | null };
  back?: { text: string | null };
}

// ---------- ID card scans (POST /id-card/prepare) and what is learned from HR's corrections ----------

/**
 * A card's rotated rectangle on a page, in the pixels of that page's image: centre (cx, cy), size w × h (w ≥ h), and
 * `angle` in degrees, positive clockwise as seen on screen. To cut the card out: rotate the page by -angle around the
 * centre, then cut the w × h box centred there.
 */
export interface IdCardBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
  angle: number;
}

/** A card found on a scan. `image`: the card cut out, straightened and upright (base64 JPEG, about 1000 px wide). */
export interface IdCardFound {
  image: string;
  /** Index in `pages`. */
  page: number;
  box: IdCardBox;
  /** Which side the OCR service took it for, when it could tell. */
  recognised: 'front' | 'back' | null;
  confidence: number;
}

/**
 * POST /id-card/prepare: the cards found on one or two scans or photos (often one page holding both sides), and the
 * pages as analysed (base64 JPEG, long side at most 2000 px), to frame a card by hand. Nothing is stored.
 */
export interface IdCardPrepared {
  pages: { width: number; height: number; image: string }[];
  front: IdCardFound | null;
  back: IdCardFound | null;
  /** How many cards were found on all the pages. */
  found: number;
}

/** The fields whose corrections are learned: never national ID numbers or dates. */
export type LearnedField = 'fullNameAr' | 'addressAr' | 'issuingOffice';

/** GET /id-card/corrections (HR and Admin): a word or phrase the card reader got wrong, and how HR corrected it. */
export interface CardCorrection {
  id: string;
  field: LearnedField;
  wrong: string;
  right: string;
  /** How often HR made this same correction. */
  timesSeen: number;
  createdAt: string;
  updatedAt: string;
}
