import type {
  ChangeRequestStatus,
  ContractForm,
  ContractStatus,
  Degree,
  EducationGrade,
  EmployeeStatus,
  EmploymentType,
  EndingRuleKey,
  EndingStatus,
  EndReason,
  Gender,
  Governorate,
  Initiator,
  MaritalStatus,
  MilitaryStatus,
  NoticeUnit,
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

/**
 * A grade as job titles and employments name it: G1 Entry Level … G9 Executive; rank 1 is the lowest. A job title may
 * allow a range of grades (Account Manager: G3 to G6); each employment has the person's own grade.
 */
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
  /**
   * Where it is used, which keeps it from being deleted: `jobTitles`, the job titles whose grade range starts or ends at
   * it; `employments`, the employments with it (ended ones included).
   */
  _count: { jobTitles: number; employments: number };
}

export interface JobTitleSummary {
  id: string;
  /** Its department or team: a department itself (e.g. Head of Marketing) or one of its teams (owner's decision, 15 October 2026). */
  departmentId: string;
  titleEn: string;
  titleAr: string | null;
  /**
   * The grades people with this title can have (owner's decision: Junior and Senior Account Manager are both Account
   * Managers, with different grades): the lowest and the highest. Either may be open (only a lowest, only a highest);
   * both null = any grade.
   */
  minGradeId: string | null;
  maxGradeId: string | null;
  minGrade: GradeRef | null;
  maxGrade: GradeRef | null;
  jdVersion: number;
  department: DepartmentRef & { parent: DepartmentRef | null };
  _count: { duties: number };
}

export interface JobTitle extends Omit<JobTitleSummary, '_count'> {
  /**
   * The job description's purpose, duties and requirements: simple rich text (owner's request, 15 October 2026), as
   * HTML cleaned by the API (p, with a data-indent of 1 to 4, br, strong, em, u, ul, ol, li), or null when not set.
   * Shown with components/rich-text.tsx, written with components/rich-text-editor.tsx.
   */
  jdPurpose: string | null;
  jdDuties: string | null;
  jdRequirements: string | null;
  /** The duties as plain text rows, read by the API from `jdDuties`: what KPIs will be linked to later. */
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
  /** The domain every employee's work email must end in, after the @ (e.g. trendlix.com); null when any is allowed. */
  emailDomain: string | null;
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

/** A department or a team as an employment names it: `parent` is a team's department, null for a department. */
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
  jobTitle: { id: string; titleEn: string; titleAr: string | null; jdVersion: number } | null;
  /** The person's own grade in this employment; within the job title's range when the title has one. */
  gradeId: string | null;
  grade: GradeRef | null;
  manager: { id: string; employeeCode: string; fullNameEn: string } | null;
  shift: { id: string; code: string; startTime: string; endTime: string } | null;
  /**
   * The newest signed contract (salary restricted), or null. Left out by an API from before contracts (October 2026),
   * hence optional: the screens then say contracts are not available yet.
   */
  contract?: Contract | null;
  /** The newest ending that was not rejected or withdrawn, or null. Optional for the same reason as `contract`. */
  ending?: Ending | null;
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
    jobTitle: { id: string; titleEn: string } | null;
    /** The person's own grade in this employment. */
    gradeId: string | null;
    grade: GradeRef | null;
    manager: { id: string; fullNameEn: string } | null;
  } | null;
  /** How the last employment ended, when there is no current one. */
  lastEnded: { endDate: string; endReason: EndReason } | null;
}

/**
 * One thing a profile still lacks, and the profile tab where it is filled in: `key` is the field's cell there
 * (#field-<key>), or on Documents the paper's row (#paper-<key>).
 */
export interface ProfileGap {
  key: string;
  label: string;
  tab: 'basic' | 'education' | 'employment' | 'documents';
}

/**
 * GET /employees/:id: the profile (personal, contact, education), the current employment and the history of
 * employments, newest first (the current one first). `identity` and `bank` are only present when the caller may see
 * them (masked).
 */
export interface EmployeeProfile {
  id: string;
  employeeCode: string;
  /** الرقم التأميني: the social insurance number, digits only. */
  insuranceNo: string | null;
  fullNameEn: string;
  fullNameAr: string;
  /** The short name the person goes by (e.g. Hazem Magdy), for the email signature. */
  displayName: string | null;
  dateOfBirth: string | null;
  gender: Gender | null;
  nationality: string | null;
  maritalStatus: MaritalStatus | null;
  militaryStatus: MilitaryStatus | null;
  workEmail: string | null;
  personalEmail: string | null;
  /** Mobile numbers (this, mobile2 and emergencyMobile) are kept as the country code and the number in one run, e.g. +201012345678. */
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
  } | null;
  /** HR, Finance and CEO only; null = nothing recorded. */
  bank?: {
    bankName: string | null;
    branch: string | null;
    holderName: string | null;
    accountNoMasked: string | null;
    ibanMasked: string | null;
  } | null;
  /**
   * How complete the profile is: all its data and the papers the employee file needs, except the emergency contact and
   * the second mobile (owner's decision, 15 October 2026).
   */
  completeness: { percent: number; missing: ProfileGap[] };
  /** What the caller may do: edit (HR), delete (HR and Admin), see the national ID, see the bank details. */
  access: { edit: boolean; delete: boolean; identity: boolean; bank: boolean };
  /**
   * Whether the employee confirmed their details, and what changed since (owner's decision, 15 October 2026). Left out
   * by an API from before confirmations (October 2026), hence optional: the screens then show nothing about it.
   */
  confirmation?: ProfileConfirmation;
  /**
   * The employee's requests to change their details: pending first, then up to 10 recent ones. The employee themself,
   * HR, Admin and the CEO get them; anyone else gets []. Optional for the same reason as `confirmation`.
   */
  changeRequests?: ChangeRequest[];
  /** Whether the signed-in user is this employee (their sign-in email is the work email). Optional like `confirmation`. */
  isSelf?: boolean;
}

// ---------- the employee's own check of their details, and their change requests ----------
// Owner's decision of 15 October 2026 (packages/shared/src/profile-confirmation.ts). Moments are ISO.

/** On the profile: when the employee last confirmed their details, and whether they changed since. */
export interface ProfileConfirmation {
  /** Null = never confirmed. */
  confirmedAt: string | null;
  confirmedBy: { email: string } | null;
  /** Confirmed, and nothing confirmed changed since (nor the statement accepted). */
  upToDate: boolean;
  /** The fields (CONFIRM_FIELDS keys) changed since the last confirmation; [] when never confirmed. */
  changedFields: string[];
  /** The version of the statement accepted (PROFILE_DISCLAIMER.version). */
  disclaimerVersion: number | null;
}

/** One field of a change request: what it was when asked, and what the employee asked for. Values as the API keeps them. */
export interface ChangeRequestChange {
  field: string;
  label: string;
  from: string | number | null;
  to: string | number | null;
}

/**
 * An employee's request to change their details (GET /change-requests, and on their profile). HR or an Admin approves
 * it, which makes the change, or rejects it with a note; the employee may cancel it while it waits.
 */
export interface ChangeRequest {
  id: string;
  employee: { id: string; employeeCode: string; fullNameEn: string };
  changes: ChangeRequestChange[];
  /** What should change and why, in the employee's words. */
  note: string | null;
  status: ChangeRequestStatus;
  requestedBy: { email: string } | null;
  requestedAt: string;
  decidedBy: { email: string } | null;
  decidedAt: string | null;
  /** HR's note: optional on approval, required on rejection. */
  decisionNote: string | null;
}

/** GET /employees/:id/identity: the full national ID details (each call is audited). */
export interface EmployeeIdentity {
  nationalId: string | null;
  printedNo: string | null;
  issueDate: string | null;
  expiryDate: string | null;
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
export type LearnedField = 'fullNameAr' | 'addressAr';

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

// ---------- contracts and endings: Organization → Contracts & Endings, Approvals, the home page's alerts ----------
// The owner's decisions of 15 October 2026, checked against Labour Law 14/2025 (packages/shared/src/contracts.ts).
// Dates are "YYYY-MM-DD"; moments are ISO.

/** An employee as the contract and ending lists name them. */
export interface ContractEmployeeRef {
  id: string;
  employeeCode: string;
  fullNameEn: string;
}

/** GET /contract-settings: what a new contract starts with. Probation is at most 3 months, once per employer (Art. 90). */
export interface ContractSettings {
  probationMonths: number;
  /** How long a fixed-term contract runs, in months (12 by default). */
  durationMonths: number;
}

/**
 * One way an employment can end, from GET /ending-rules (in their order). HR or Admin tune its label, notice, pay in
 * lieu and whether it is offered; resignation and the company's notice can't go below 3 months (Art. 156). A signed
 * contract keeps the rules it was signed under.
 */
export interface EndingRule {
  key: EndingRuleKey;
  label: string;
  /** Who starts it: the employee, the company, either, or no one (death, total disability). */
  initiator: Initiator;
  /** 0 = no notice. */
  noticeAmount: number;
  noticeUnit: NoticeUnit;
  /** Whether the notice can be paid instead of worked. */
  payInLieu: boolean;
  /** How the employment is recorded as ended. */
  endReason: EndReason;
  /** The legal source, e.g. "Labour Law Arts. 156, 161, 167; Decree 187/2025". */
  source: string;
  /** Offered when HR records an ending. */
  active: boolean;
}

/** GET /contracts/expiring?within=60 (HR and CEO): signed contracts ending soon. */
export interface ExpiringContract {
  id: string;
  number: string;
  employee: ContractEmployeeRef;
  employmentId: string;
  endDate: string;
  /** The last day to tell the employee it won't be renewed: 45 working days before the end. */
  nonRenewalNoticeBy: string;
  /** A renewal (the next contract version) is already drafted. */
  renewalDraft: boolean;
}

/** GET /employments/probation-ending?within=30 (HR and CEO): current employments whose probation ends soon. */
export interface ProbationEnding {
  employee: ContractEmployeeRef;
  employmentId: string;
  probationEnd: string;
}

/** GET /endings?status=pending_ceo (HR and CEO): an ending HR recorded and approved, waiting for the CEO. */
export interface EndingSummary {
  id: string;
  ruleKey: EndingRuleKey;
  ruleLabel: string;
  /** Who started it. */
  initiator: Initiator | null;
  /** When notice was given; null when there was none. */
  noticeGivenOn: string | null;
  /** The notice is paid instead of worked. */
  payInLieu: boolean;
  lastWorkingDay: string;
  reason: string | null;
  note: string | null;
  status: EndingStatus;
  /** Who recorded and approved it for HR, and when (ISO moment). */
  hrApprovedBy: { email: string } | null;
  hrApprovedAt: string | null;
  endReason: EndReason;
  employee: ContractEmployeeRef;
  employmentId: string;
}

// ---------- contracts and endings on the employee profile (the Employment tab) ----------

/**
 * One version of an employment's contract, from GET /employees/:id/employments/:employmentId/contracts (newest first),
 * or the newest signed one as `Employment.contract`. Version 1 is the first contract; later versions are renewals,
 * starting the day after the previous one ends. Signed versions are never edited, except their filing dates and note.
 * The salary fields are null, with `salaryHidden`, for anyone but HR, Finance and the CEO.
 */
export interface Contract {
  id: string;
  number: string;
  version: number;
  form: ContractForm;
  startDate: string;
  /** Null for an open-ended contract. */
  endDate: string | null;
  durationMonths: number | null;
  /** 0 = no probation (a renewal, or someone who already had one with the company: once per employer, Art. 90). */
  probationMonths: number;
  probationEnd: string | null;
  /** The actual gross, in EGP. */
  grossSalary: number | null;
  /** The basic part of the gross, in percent (80 by default); the rest is variable. */
  basicPercent: number | null;
  basicSalary: number | null;
  variableSalary: number | null;
  /** Approximate, as agreed; optional. */
  netSalary: number | null;
  /** The salary on the social insurance copy: the gross, capped at the year's maximum insurable wage. */
  insuredSalary: number | null;
  /** The terms as signed: the job title, grade, department or team, and shift at the time. */
  jobTitleEn: string | null;
  jobTitleAr: string | null;
  gradeCode: string | null;
  departmentName: string | null;
  shiftCode: string | null;
  /** draft → active (signed) → ended, or superseded by a signed renewal. */
  status: ContractStatus;
  signedOn: string | null;
  insuranceFiledOn: string | null;
  labourOfficeFiledOn: string | null;
  note: string | null;
  /** A fixed contract's last day to tell the employee it won't be renewed: 45 working days before it ends. */
  nonRenewalNoticeBy: string | null;
  salaryHidden?: boolean;
}

/**
 * How an employment is ending (or ended): recorded by HR, which counts as HR's approval, then approved by the CEO; HR
 * completes it on or after the last working day, which ends the employment.
 */
export interface Ending {
  id: string;
  ruleKey: EndingRuleKey;
  ruleLabel: string;
  /** Who started it, for a rule either side may start; else the rule's own. */
  initiator: Initiator | null;
  /** When notice was given or received (or, without notice, the date of the event). */
  noticeGivenOn: string | null;
  /** The notice is paid instead of worked. */
  payInLieu: boolean;
  lastWorkingDay: string;
  /** A resignation's certification at the labour office (Decree 187/2025). */
  certifiedOffice: string | null;
  certifiedSerial: string | null;
  certifiedOn: string | null;
  /** A resignation: the company decides by this day, or it counts as accepted. */
  decisionDueOn: string | null;
  reason: string | null;
  note: string | null;
  status: EndingStatus;
  hrApprovedBy: { email: string } | null;
  /** ISO moments. */
  hrApprovedAt: string | null;
  ceoDecidedBy: { email: string } | null;
  ceoDecidedAt: string | null;
  ceoNote: string | null;
  completedAt: string | null;
  endReason: EndReason;
  /** Once completed: when the final dues must be paid (Art. 108) and the ending filed with the labour office (Decree 214/2025). */
  deadlines: { finalDuesBy: string; labourOfficeFilingBy: string } | null;
}
