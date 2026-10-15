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
  PayBasis,
  PdfField,
  PdfPageSize,
  Role,
  Standing,
  TemplateFolder,
  TemplateLanguage,
  TemplateSigners,
  TemplateTrigger,
  TemplateVersionStatus,
  WorkArrangement,
} from '@trendlix/shared';

// Shapes returned by the API.

export interface SessionUser {
  id: string;
  email: string;
  roles: Role[];
  /**
   * The signed-in user's own employee profile (the one whose work email is their sign-in email), or null when they have
   * none. Left out by an API from before 15 October 2026, hence optional: the layout then finds the profile itself.
   */
  employeeId?: string | null;
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
  repNameEn: string | null;
  repTitleEn: string | null;
  repNationalIdMasked: string | null;
  hasLogo: boolean;
  logoUpdatedAt: string | null;
  /** The square brand mark beside the logo (owner's request, 15 October 2026); its upload time is its version. */
  hasThumbnail: boolean;
  thumbnailUpdatedAt: string | null;
  updatedAt: string;
}

/** GET /company/brand (public): a version is null when there is no such image. */
export interface CompanyBrand {
  nameEn: string;
  nameAr: string | null;
  logoVersion: number | null;
  thumbnailVersion: number | null;
}

// ---------- the org chart: Organization → Departments & Job Titles → Org chart (owner's request, 15 October 2026) ----------

/** Someone who holds a job title now, as the org chart names them. */
export interface OrgChartPerson {
  id: string;
  employeeCode: string;
  fullNameEn: string;
  fullNameAr: string;
}

export interface OrgChartJobTitle {
  id: string;
  titleEn: string;
  titleAr: string | null;
  /** The current employments with this job title; 0 when it is vacant. */
  headcount: number;
  /** Who they are, by English name: only for HR, the CEO and Finance (`OrgChart.showsPeople`). */
  people?: OrgChartPerson[];
}

/** A team, or the department part of a department: its own job titles, the most senior first. */
export interface OrgChartTeam extends DepartmentRef {
  jobTitles: OrgChartJobTitle[];
}

export interface OrgChartDepartment extends OrgChartTeam {
  /** In the order an Admin set. */
  teams: OrgChartTeam[];
}

/** GET /org-chart: the company, and its departments in the order an Admin set. Everyone signed in may read it. */
export interface OrgChart {
  company: { nameEn: string; nameAr: string | null; hasLogo: boolean; logoVersion: number | null };
  /** Whether the job titles list their people (HR, the CEO and Finance see every employee). */
  showsPeople: boolean;
  departments: OrgChartDepartment[];
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
  /**
   * What the caller may do: edit (HR), delete (a Super Admin only, owner's decision of 15 October 2026), see the national
   * ID, see the bank details.
   */
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

/** A sign-in account, from GET /users (Admins and Super Admins only). */
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

/**
 * One row of GET /contracts?status=&q=&type=&endingWithin= (HR, CEO and Finance): a contract version in the
 * company-wide list of the Contracts page, with its person and employment. Without a status, drafts and signed ones
 * only; `endingWithin` keeps signed ones ending within that many days, overdue included. Signed by end date first, then
 * drafts, then the rest. The salary fields are null, with `salaryHidden`, for anyone but HR, Finance and the CEO.
 */
export interface ContractListItem extends ContractPay {
  id: string;
  number: string;
  version: number;
  form: ContractForm;
  status: ContractStatus;
  startDate: string;
  /** Null only for a contract from before every contract was fixed-term (owner, 15 October 2026). */
  endDate: string | null;
  probationMonths: number;
  probationEnd: string | null;
  signedOn: string | null;
  insuranceFiledOn: string | null;
  labourOfficeFiledOn: string | null;
  /** A signed fixed contract's last day to tell the employee it won't be renewed: 45 working days before it ends. */
  nonRenewalNoticeBy: string | null;
  /** In EGP: the gross (for pay by the hour, the monthly estimate), and the insured salary with the insured allowances. */
  grossSalary: number | null;
  insuredSalary: number | null;
  salaryHidden: boolean;
  employee: ContractEmployeeRef & { fullNameAr: string };
  employmentId: string;
  employmentType: EmploymentType;
  /** The employment hasn't ended. */
  employmentCurrent: boolean;
  /** As signed; a draft's are the employment's current ones. */
  jobTitleEn: string | null;
  departmentName: string | null;
}

/**
 * How a contract's pay is set (owner's requests, 15 October 2026): a monthly salary, or by the hour for part-time work
 * (the gross is then the monthly estimate, rate × hours a week × 52 ÷ 12, worked out by the API); the working days a
 * week; and the allowances paid every month on top of the gross. The amounts are null, like the salary, for anyone but
 * HR, Finance and the CEO.
 */
export interface ContractPay {
  payBasis: PayBasis;
  /** By the hour: EGP an hour. Null for a monthly salary. */
  hourlyRate: number | null;
  /** By the hour: the contracted hours a week. Null for a monthly salary. */
  hoursPerWeek: number | null;
  /** Working days a week, e.g. 2 or 3 part-time (1 to 6); null: the shift's week. */
  daysPerWeek: number | null;
  /** Each allowance a month, with its kind's name and treatment as drafted. */
  allowances: AllowanceLine[] | null;
  allowancesTotal: number | null;
  /** The gross and the allowances, a month. */
  totalSalary: number | null;
}

// ---------- contracts and endings on the employee profile (the Employment tab) ----------

/**
 * One version of an employment's contract, from GET /employees/:id/employments/:employmentId/contracts (newest first),
 * or the newest signed one as `Employment.contract`. Version 1 is the first contract; later versions are renewals,
 * starting the day after the previous one ends. Signed versions are never edited, except their filing dates and note.
 * The salary fields are null, with `salaryHidden`, for anyone but HR, Finance and the CEO.
 */
export interface Contract extends ContractPay {
  id: string;
  number: string;
  version: number;
  /** Always 'fixed': every contract runs for a fixed term (owner, 15 October 2026). */
  form: ContractForm;
  startDate: string;
  /** Null only for a contract from before every contract was fixed-term. */
  endDate: string | null;
  durationMonths: number | null;
  /** 0 = no probation (a renewal, or someone who already had one with the company: once per employer, Art. 90). */
  probationMonths: number;
  probationEnd: string | null;
  /** The actual gross, in EGP; for pay by the hour, the monthly estimate. Allowances are on top of it. */
  grossSalary: number | null;
  /** The basic part of the gross, in percent (80 by default); the rest is variable. */
  basicPercent: number | null;
  basicSalary: number | null;
  variableSalary: number | null;
  /** As worked out on the contract form, allowances included; optional. */
  netSalary: number | null;
  /** The salary on the social insurance copy: the gross and the insured allowances, capped at the year's maximum insurable wage. */
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

// ---------- document templates: the library (spec §8; packages/shared/src/templates.ts) ----------
// HR uploads each Word file as used today, with merge tags such as {{full_name_ar}}; a version is uploaded as a draft,
// checked (unknown or broken tags block it) and published. Moments are ISO.

/** Where a slot stands: no file yet, only drafts, or a version in use. */
export type TemplateSlotStatus = 'missing' | 'draft' | 'published';

/**
 * One row of GET /templates (HR, Admin and the CEO): a slot of the library, as TEMPLATE_SLOTS describes it, with its
 * version in use and its newest draft. A `copyOf` slot (the full-time contract's social insurance copy) is printed from
 * its source's file and has no versions of its own; `overrides`: tag → the value it reads instead on that copy.
 */
export interface TemplateSlotView {
  key: string;
  name: string;
  folder: TemplateFolder;
  /** Null: each version's language is set when it is uploaded. */
  language: TemplateLanguage | null;
  appliesTo: EmploymentType[];
  triggers: TemplateTrigger[];
  signers: TemplateSigners;
  copyOf?: string | null;
  overrides?: Record<string, string> | null;
  status: TemplateSlotStatus;
  /** The version new documents are made from; null when none is published. */
  published: {
    id: string;
    version: number;
    fileName: string;
    /** Left out by an API from before PDF templates: a Word file. */
    format?: 'docx' | 'pdf';
    uploadedAt: string;
    publishedAt: string;
    publishedBy: { email: string } | null;
  } | null;
  /** The newest draft, if any (it may be older than the version in use). */
  latestDraft: {
    id: string;
    version: number;
    fileName: string;
    format?: 'docx' | 'pdf';
    /** A PDF draft's fields placed so far (it can't be published with none); null for a Word file. */
    fieldCount?: number | null;
    uploadedAt: string;
    /** {{tags}} not in the tag list (TEMPLATE_TAGS): they block publishing. */
    unknownTags: string[];
    /** Fragments that look like a tag but are not one (e.g. "{{full_name_ar}"): they block publishing too. */
    broken: string[];
  } | null;
  versionCount: number;
}

/**
 * One uploaded version of a template's file (GET /templates/:slot, newest first): a Word file with {{tags}}, or an
 * official form as a PDF with its fields placed on it (owner's decision, 15 October 2026). The file itself is never
 * included.
 */
export interface TemplateVersion {
  id: string;
  version: number;
  fileName: string;
  sizeBytes: number;
  /** Left out by an API from before PDF templates: a Word file. */
  format?: 'docx' | 'pdf';
  /** A PDF's pages and the fields placed on it; null for a Word file. */
  pageCount?: number | null;
  fieldCount?: number | null;
  language: TemplateLanguage;
  /** The tags found in the file. */
  tags: string[];
  unknownTags: string[];
  broken: string[];
  /** draft → published (in use) → retired (replaced by a newer published version). */
  status: TemplateVersionStatus;
  /** What changed, in the uploader's words. */
  note: string | null;
  uploadedBy: { email: string } | null;
  uploadedAt: string;
  publishedBy: { email: string } | null;
  publishedAt: string | null;
  /** Documents and job offers made from it: only a version nothing was made from can be deleted (a Super Admin). */
  usedBy: number;
}

/** GET /templates/:slot: the slot and every version of its file, newest first ([] for a copy slot). */
export interface TemplateDetail extends TemplateSlotView {
  versions: TemplateVersion[];
}

/**
 * GET (and PUT) /templates/versions/:id/fields: a PDF version, the size of each of its pages in points, and the fields
 * placed on it; `editable`: false for a version that was replaced (the API then refuses a save).
 */
export interface TemplateFields {
  version: TemplateVersion;
  pages: PdfPageSize[];
  fields: PdfField[];
  editable: boolean;
}

// ---------- documents generated from the templates: the profile's Contracts tab ----------
// The company issues them from its published templates; each one goes Generated → Printed → Signed copy uploaded →
// Verified. HR generates and moves them along, the CEO views and downloads them, only a Super Admin deletes one. Dates
// are "YYYY-MM-DD"; moments are ISO.

/** The parts of the Contracts tab, in this order. */
export type DocumentSectionKey = 'contract' | 'hiring' | 'insurance' | 'letters' | 'leaving';

/** Where a generated document stands. */
export type GeneratedDocumentStatus = 'generated' | 'printed' | 'signed' | 'verified';

/**
 * One document generated for an employee: kept by the API as the filled Word file (.docx), given out only as a protected
 * PDF (owner's request, 15 October 2026); and the signed copy once it is uploaded.
 */
export interface GeneratedDocument {
  id: string;
  status: GeneratedDocumentStatus;
  /** The kept Word file's name; the PDF is named like it (pdfFileName). */
  fileName: string;
  sizeBytes: number;
  /** The template version it was filled in from. */
  templateVersion: number;
  /** The date written on it. */
  documentDate: string;
  generatedBy: { email: string } | null;
  generatedAt: string;
  printedAt: string | null;
  /** Null for a step not done, or an account since deleted. */
  printedBy?: { email: string } | null;
  signedUploadedAt: string | null;
  signedUploadedBy?: { email: string } | null;
  verifiedAt: string | null;
  verifiedBy: { email: string } | null;
  /** The signed copy's file name (a photo or a PDF); null until it is uploaded. */
  signedFileName: string | null;
  /** The signed copy's type (image/jpeg, image/png, image/webp or application/pdf); else told from its name. */
  signedMime?: string | null;
  signedSize?: number | null;
  /** What was typed when generating it (an HR letter: `letter_to`, `letter_purpose`). */
  inputs?: Record<string, string> | null;
  /** It holds restricted data (national ID, salary, bank). */
  hasRestricted?: boolean;
  note: string | null;
}

/**
 * One document an employee may be given (a template slot), with what has been generated from it, newest first. A
 * contract's documents name the contract version (full time: the official and the social insurance copies; other
 * types: one contract). `needsInputs`: what is typed when generating it (an HR letter: `letter_to`, `letter_purpose`).
 */
export interface DocumentItem {
  slotKey: string;
  name: string;
  contractId?: string | null;
  contractNumber?: string | null;
  contractVersion?: number | null;
  /** No template yet, only drafts, or a published version to generate from. */
  templateStatus: TemplateSlotStatus;
  /** The published version's number; null when none is published. */
  templateVersion: number | null;
  needsInputs: string[];
  documents: GeneratedDocument[];
}

/** GET /employees/:id/documents (HR and the CEO): the Contracts tab's documents, part by part. */
export interface DocumentsTab {
  sections: { key: DocumentSectionKey; items: DocumentItem[] }[];
}

/**
 * Where a missing detail is filled in: a profile tab and the field's cell there (#field-<key>, on Documents the paper's
 * row #paper-<key>), the company profile (`company`), or the contract on the Contracts tab (`contracts`).
 */
export interface DocumentDetailPlace {
  tab: ProfileGap['tab'] | 'contracts' | 'company';
  key: string;
}

/** One detail a template needs that this employee's records lack. */
export interface MissingDocumentDetail {
  /** The template's {{tag}}. */
  tag: string;
  label: string;
  where: DocumentDetailPlace;
}

/**
 * GET /employees/:id/documents/check?slotKey=&contractId= (HR): what generating would lack, before it is tried.
 * `usesRestricted`: the template uses restricted data (national ID, salary, bank). 404 when nothing is published.
 */
export interface DocumentCheck {
  missing: MissingDocumentDetail[];
  usesRestricted: boolean;
}

/**
 * A kind of allowance (Organization → Allowances; owner's request, 15 October 2026): paid every month on top of the
 * gross salary, taxed or not, and counted in the insured wage or not. An inactive kind isn't offered for new contracts
 * and offers. `inUse`: on a contract or offer, so it can't be deleted (only made inactive).
 */
export interface AllowanceType {
  id: string;
  nameEn: string;
  nameAr: string;
  taxable: boolean;
  insured: boolean;
  active: boolean;
  sortOrder: number;
  inUse: boolean;
}

/** An allowance on a contract or offer, a month: its kind's name and treatment as when drafted. */
export interface AllowanceLine {
  allowanceTypeId: string;
  nameEn: string;
  nameAr: string;
  taxable: boolean;
  insured: boolean;
  amount: number;
}

// ---------- job offers (owner's request, 15 October 2026; packages/shared/src/offers.ts) ----------
// A candidate is not an employee: HR drafts an offer, the system fills in the job offer template, HR sends it (by the
// system's email, or as a link HR sends), and the candidate accepts or declines it on a public page. Once accepted, the
// API makes the profile, the employment and a draft contract. HR writes, HR and the CEO read; the salary fields are null,
// with `salaryHidden`, for anyone else. Dates are "YYYY-MM-DD"; moments are ISO.

type OfferStatusShown = import('@trendlix/shared').OfferShownStatus;
type OfferWay = import('@trendlix/shared').OfferSendWay;
type OfferPayBasis = import('@trendlix/shared').PayBasis;

/** One row of GET /offers?status=&q= (status: a shown status, or 'open' = drafts and sent ones not expired). */
export interface OfferListItem {
  id: string;
  /** OFF-<year>-<4 digits>. */
  number: string;
  /** As shown: a sent offer past its last day is 'expired'. */
  status: OfferStatusShown;
  fullNameEn: string;
  fullNameAr: string;
  email: string;
  employmentType: EmploymentType;
  jobTitle: { titleEn: string; titleAr: string | null } | null;
  departmentName: string | null;
  joinDate: string;
  grossSalary: number | null;
  /** The gross and the allowances, a month. */
  totalSalary: number | null;
  salaryHidden: boolean;
  /** The last day to accept. */
  expiresOn: string;
  sentAt: string | null;
  respondedAt: string | null;
  /** Once accepted and the profile is made (or a former employee offered again): their profile. */
  employeeId: string | null;
}

/** Something the job offer template needs that the offer (or the company profile) lacks, and where it is filled in. */
export interface OfferMissingValue {
  tag: string;
  label: string;
  /** `tab`: 'offer' (a field of the offer: `key`), 'company' (the company profile), or another place the API names. */
  where: { tab: string; key: string };
}

/** GET /offers/:id (also what POST, PATCH and the actions answer). */
export interface OfferView {
  id: string;
  number: string;
  status: OfferStatusShown;
  fullNameEn: string;
  fullNameAr: string;
  email: string;
  mobile: string | null;
  /** A former employee offered again (or, once accepted, the profile made). */
  employeeId: string | null;
  employee: { id: string; employeeCode: string; fullNameEn: string } | null;
  employmentType: EmploymentType;
  department: (DepartmentRef & { parent: DepartmentRef | null }) | null;
  jobTitle: { id: string; titleEn: string; titleAr: string | null } | null;
  grade: { id: string; code: string; levelEn: string } | null;
  manager: { id: string; employeeCode: string; fullNameEn: string } | null;
  shift: { id: string; code: string; workingDays: number[] } | null;
  workArrangement: WorkArrangement;
  /** Hybrid only; 0 = Sunday … 6 = Saturday. */
  officeDays: number[];
  joinDate: string;
  payBasis: OfferPayBasis;
  /** A month; by the hour, the monthly estimate (hourly rate × hours a week × 52 ÷ 12). */
  grossSalary: number | null;
  hourlyRate: number | null;
  hoursPerWeek: number | null;
  daysPerWeek: number | null;
  basicPercent: number | null;
  netSalary: number | null;
  insuredSalary: number | null;
  allowances: AllowanceLine[] | null;
  allowancesTotal: number | null;
  totalSalary: number | null;
  salaryHidden: boolean;
  probationMonths: number;
  durationMonths: number;
  expiresOn: string;
  /** A few words to the candidate, in the email and on their page. */
  message: string | null;
  /** For HR only. */
  note: string | null;
  /**
   * The job offer template of the employment type (offerSlotKey) and where it stands. `previewVersion`: while none is
   * published, the newest draft's, which a draft offer is previewed with (sending needs a published one).
   */
  template: { slotKey: string; name: string; status: TemplateSlotStatus; version: number | null; previewVersion: number | null };
  /** A draft's: what filling in the template would lack. */
  missing: OfferMissingValue[];
  /**
   * The document as sent; null for a draft (filled in afresh at each preview). Given out only as a protected PDF;
   * `hasPdf`: a PDF was kept when it was sent (else the API makes one when it is opened, with the converter).
   */
  document: { fileName: string; hasPdf: boolean; documentDate: string } | null;
  sentVia: OfferWay | null;
  sentTo: string | null;
  sentAt: string | null;
  sentBy: { email: string } | null;
  sentCount: number;
  /** The candidate first opened the link. */
  viewedAt: string | null;
  respondedAt: string | null;
  /** HR recorded the answer; null when the candidate answered online. */
  answeredBy: { email: string } | null;
  /** The name the candidate typed to accept. */
  acceptedName: string | null;
  declineReason: string | null;
  withdrawnAt: string | null;
  withdrawReason: string | null;
  /** The profile, the employment and the draft contract were made from it. */
  hiredAt: string | null;
  /** Whether the server can send email (SMTP is set up); without it, HR copies the link. */
  emailConfigured: boolean;
  /** Whether the server can make PDFs (the converter is set up): without it, the offer's document can't be made or sent. */
  pdfAvailable: boolean;
  createdAt: string;
  createdBy: { email: string } | null;
}

/** POST /offers/:id/send: the offer as sent, and the candidate's link (sending again makes a new link). */
export interface OfferSendResult {
  offer: OfferView;
  link: string;
}

/** GET /public/offers/:token: what the candidate's page shows (no sign-in). */
export interface PublicOffer {
  number: string;
  status: OfferStatusShown;
  fullNameEn: string;
  fullNameAr: string;
  jobTitleEn: string | null;
  jobTitleAr: string | null;
  employmentType: EmploymentType;
  joinDate: string;
  expiresOn: string;
  /** Null when the company profile isn't filled in yet. */
  companyNameEn: string | null;
  companyNameAr: string | null;
  message: string | null;
  document: { hasPdf: boolean } | null;
  respondedAt: string | null;
  acceptedName: string | null;
}
