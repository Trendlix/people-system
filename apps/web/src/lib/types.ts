import type {
  ApproverRole,
  AssetsAccess,
  AssetsAccessView,
  AttendanceImportMark,
  ChangeRequestStatus,
  ContractFacts,
  ContractForm,
  ContractKind,
  ContractStatus,
  Degree,
  DevicePlatform,
  EducationGrade,
  EmployeeStatus,
  EmploymentType,
  EndingRuleKey,
  EndingStatus,
  EndReason,
  Gender,
  Governorate,
  Initiator,
  InsuredWage,
  LawRates,
  LeaveBalanceKind,
  LeaveDecision,
  LeavePay,
  LeaveStage,
  LeaveStatus,
  LeaveStepKind,
  MaritalStatus,
  MilitaryStatus,
  NoticeUnit,
  PaperworkKind,
  PayBasis,
  PayStage,
  PayrollResult,
  PayrollRules,
  PayrollStatus,
  PayrollTerms,
  PdfField,
  PdfPageSize,
  PhotoCrop,
  ReimbursementDecision,
  ReimbursementStage,
  ReimbursementStatus,
  ReimbursementStepKind,
  Role,
  SavedPayrollInputs,
  SessionKind,
  Standing,
  TemplateFolder,
  TemplateLanguage,
  TemplateSigners,
  TemplateTrigger,
  TemplateVersionStatus,
  TrainingNext,
  WorkArrangement,
  WorkNature,
  WorkPattern,
} from '@trendlix/shared';
import type { ContractRaise } from './raise-types';

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
  /**
   * Whether they are the person in charge of a department or a team, its head or its team lead (owner, 19 October 2026:
   * "i want to add department lead person, the person in charge"): they decide the leave and the claims of its people
   * who have no direct manager, so they get My Team even without the manager role. Left out by an API from before it.
   */
  leads?: boolean;
  /**
   * Their Assets access in effect, whether they see the asset values, and whether the Assets AI is set up (owner, 21
   * October 2026: "i want to add this module with a special permission to the system"; "3 levels per user"; values for
   * the "CEO and Finance"). Left out by an API from before the Assets module: no access.
   */
  assets?: AssetsAccessView | null;
  /**
   * Whether they hire for an open vacancy or sit on an interview to come or of the last 60 days (recruitment, Phase 2, 22
   * October 2026: "Show it only to people who are a hiring manager or interviewer on something open"): the sidebar
   * shows them My Hiring. Left out by an API from before it.
   */
  hiring?: boolean;
}

/**
 * The person in charge of a department (its head of department) or of a team (its team lead), or of where someone
 * works (owner, 19 October 2026: "i want to add department lead person, the person in charge").
 */
export interface LeadPerson {
  id: string;
  fullNameEn: string;
}

/**
 * Who decides the manager stage of a leave request or a reimbursement claim (owner, 19 October 2026): the requester's
 * direct manager, else, when they have none, their team lead, else their department's head, never the requester
 * themself (approverInCharge in @trendlix/shared). `role` says which; left out (or null) by an API from before it, when
 * it was always the direct manager.
 */
export interface RequestApprover extends LeadPerson {
  role?: ApproverRole | null;
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
  /** GET /departments/:id only: its teams, in their saved order, each with its team lead (`head`, from an API that has it). */
  children?: (DepartmentRef & { sortOrder: number; _count: { jobTitles: number }; head?: (LeadPerson & { employeeCode: string }) | null })[];
  /**
   * The person in charge (owner, 19 October 2026): a department's head of department, a team's team lead; null for none.
   * Any current employee, and one may lead several. Left out by an API from before it.
   */
  head?: (LeadPerson & { employeeCode: string }) | null;
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
  /**
   * Those holding it are C-level (owner, 19 October 2026: "make C level Employees details not visible to HR"): G9 ·
   * Executive, by a migration; a Super Admin ticks it on the grades page. GET /grades sends it; left out by an API from
   * before it (none then), and where an employment names its grade.
   */
  confidential?: boolean;
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

/**
 * A shift: its window (start to end, "HH:mm") and its hours to work a day within it (owner, 16 October 2026: "my
 * company shift is to maintain 9 hours within the shift window, its like flexible shift"); null: the whole window.
 * Fewer than the window: flexible. Missing from an API from before then.
 */
export interface Shift {
  id: string;
  code: string;
  startTime: string;
  endTime: string;
  hoursPerDay?: number | null;
  /** "HH:mm": hours count until it, a long day making up short ones (owner, 20 October 2026); null or missing: none. */
  countUntil?: string | null;
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
  /**
   * For social insurance Form 1: the insurance office the company is registered with, in Arabic (e.g. مكتب تأمينات
   * الدقي), and its sector code, one or two digits as the office gave it (قطاع المنشأة). Optional: left out by an API from
   * before October 2026.
   */
  insuranceOffice?: string | null;
  insuranceSectorCode?: string | null;
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
  /**
   * The person in charge (owner, 19 October 2026): a department's head of department, a team's team lead, drawn under
   * its name for everyone, as the Departments page names them; null for none. Left out by an API from before it.
   */
  head?: OrgChartPerson | null;
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
  /**
   * Hazardous or unhealthy work, or work in a remote area: seven more days of annual leave (Labour Law 14/2025, Art. 124:
   * "تزاد مدة الإجازة السنوية بمقدار سبعة أيام للعمال الذين يعملون فى الأعمال الخطرة"). HR sets it. Optional: left out by an
   * API from before leave (18 October 2026), and for those who don't see HR data.
   */
  hazardousWork?: boolean;
  /**
   * Employment types by the labour law (owner, 18 October 2026: "can we update the employment types based on the labour
   * law?"): a full-time employment paid by commission, as Sales was (the law's wage includes "العمولة أو النسبة
   * المئوية", Art. 1(4)(أ)); the nature of the work, regular unless the law's temporary, casual or seasonal (Art. 1(6–8));
   * and HR's warnings: a fixed-term contract past its end date with the work going on and no signed renewal, which the
   * law counts as open-ended (Art. 88(3)), and casual work past its 6 months (Art. 1(7)). Each left out by an API from
   * before them.
   */
  paidByCommission?: boolean;
  workNature?: WorkNature;
  /** All but freelance (Art. 1(1)). */
  underLabourLaw?: boolean;
  /** The work arrangement in the law's words: remote work (Work from home), partly remote (Hybrid), on site (Art. 96(1)). */
  workPattern?: WorkPattern;
  becameOpenEnded?: boolean;
  casualTooLong?: boolean;
  /**
   * "Can check in from anywhere" (owner, 20 October 2026: check-ins locked to the office network, "Office staff, plus
   * exceptions"): HR lets an Office employee check in off the office network. Left out by an API from before it.
   */
  checkInAnywhere?: boolean;
  /**
   * "Can check in without a location" (owner, 20 October 2026: "Company switch + exceptions"): with Check-in Setup's
   * switch refusing presses without a location, HR lets this person press on the website without one. Left out by an
   * API from before it.
   */
  checkInWithoutLocation?: boolean;
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
  /**
   * Its hours to work a day: null for the whole window (owner, 16 October 2026: flexible shifts); its working days, 0 =
   * Sunday … 6 = Saturday (the employee's dashboard shows them). Each missing from an older API.
   */
  shift: { id: string; code: string; startTime: string; endTime: string; hoursPerDay?: number | null; workingDays?: number[] } | null;
  /**
   * The newest signed contract (salary restricted), or null. Left out by an API from before contracts (October 2026),
   * hence optional: the screens then say contracts are not available yet.
   */
  contract?: Contract | null;
  /** The newest ending that was not rejected or withdrawn, or null. Optional for the same reason as `contract`. */
  ending?: Ending | null;
  /**
   * The people in charge of where it places them (owner, 19 October 2026: "i want to add department lead person, the
   * person in charge"): their team's team lead (none in a department itself) and their department's head, each while a
   * current employee. The current employment's only (null on an ended one); left out by an API from before it.
   */
  leads?: { teamLead: LeadPerson | null; departmentHead: LeadPerson | null } | null;
}

/** The current employment as a row of GET /employees gives it. */
export interface EmployeeSummaryEmployment {
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
  /**
   * What the Employees list's contract status is worked out from (owner, 21 October 2026: "instead of the Emp code, add
   * contract status"; contractStatusOf, @trendlix/shared): the probation end, the contract in force else the latest draft
   * (null: none), and the approved ending's last working day (null: none, or the caller doesn't see endings). Left out by
   * an API from before them.
   */
  probationEnd?: string | null;
  contract?: ContractFacts | null;
  endingOn?: string | null;
}

/** What the directory card keeps of the current employment. */
type CardEmploymentField = 'id' | 'status' | 'department' | 'jobTitle';

/**
 * A C-level person's current employment as those who may not see them get it (owner, 19 October 2026: "make C level
 * Employees details not visible to HR"): the directory card's, where they work and as what; the rest is never sent, so
 * it reads as undefined (a consumer that needs it has to tell the rows apart: isRestricted in lib/confidential.ts).
 */
export type CardEmployment = Pick<EmployeeSummaryEmployment, CardEmploymentField> &
  Partial<Record<Exclude<keyof EmployeeSummaryEmployment, CardEmploymentField>, undefined>>;

/** What every row of GET /employees has, a C-level person's card too. */
interface EmployeeSummaryBase {
  id: string;
  employeeCode: string;
  fullNameEn: string;
  fullNameAr: string;
  workEmail: string | null;
  /** The picture beside the name: the personal photo's paper (/employee-photo/<id>); null for those who don't see the employee file, or without one. */
  photoId?: string | null;
  /** The square of that photo shown in the circle, as HR cropped it (fractions of the photo); null: the whole photo, centred. */
  photoCrop?: PhotoCrop | null;
  /**
   * The current employment's status (a trainee's or an intern's Active is Trainee or Intern: employmentStanding), else
   * Former employee (an employment ended) or Not employed yet.
   */
  standing: Standing;
}

/** A row the caller sees in full. `confidential`: the person is C-level (the caller is the CEO, a Super Admin or them). */
export interface FullEmployeeSummary extends EmployeeSummaryBase {
  /** Left out by an API from before C-level people (19 October 2026). */
  confidential?: boolean;
  restricted?: false;
  /** The current employment; null for a former employee or someone not employed yet. */
  employment: EmployeeSummaryEmployment | null;
  /** How the last employment ended, when there is no current one. */
  lastEnded: { endDate: string; endReason: EndReason } | null;
}

/**
 * A C-level person's row for those who may not see them (HR, Finance, Admin, managers; owner, 19 October 2026): only
 * the directory card, name, photo, job title, department or team, work email, employee code and standing. Any action
 * on them is refused by the API (404), so the pickers of HR's actions leave these rows out (actionablePeople).
 */
export interface RestrictedEmployeeSummary extends EmployeeSummaryBase {
  confidential: true;
  restricted: true;
  employment: CardEmployment | null;
  lastEnded: null;
}

/** One row of GET /employees, already limited to the people the caller may see: in full, or a C-level person's card. */
export type EmployeeSummary = FullEmployeeSummary | RestrictedEmployeeSummary;

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
  /** The picture beside the name: the personal photo's paper (/employee-photo/<id>); null for those who don't see the employee file, or without one. */
  photoId?: string | null;
  /** The square of that photo shown in the circle, as HR cropped it (fractions of the photo); null: the whole photo, centred. */
  photoCrop?: PhotoCrop | null;
  /** الرقم التأميني: the social insurance number, digits only. */
  insuranceNo: string | null;
  /**
   * The employee's occupation in the social insurance table (packages/shared occupations.ts): the six-digit code Form 1
   * prints (كود المهنة) and its Arabic name; null when not chosen. HR sets it on the Social Insurance tab (owner's
   * decision, 16 October 2026: no longer the job title's). Optional: left out by an API from before it.
   */
  occupationCode?: string | null;
  occupationName?: string | null;
  /**
   * What else Form 1 prints that is the employee's own, set by HR on the Social Insurance tab (owner, 16 October 2026),
   * null for none of their own: the subscription start (YYYY-MM-DD; none: the join date is printed) …
   */
  insuranceStartDate?: string | null;
  /**
   * … and the wages, salary data: only for those who see salaries (HR, Finance, the CEO), left out for anyone else.
   * The basic wage (none: `insuranceBasicDefault`, the contract settings' default) and the comprehensive wage (none:
   * the contract's gross and allowances).
   */
  insuranceBasicWage?: number | null;
  insuranceComprehensiveWage?: number | null;
  insuranceBasicDefault?: number;
  /**
   * The insured wage Form 1 prints, as the API works it out (owner's decision, 16 October 2026): the comprehensive wage
   * within this year's insurable limits, and how; null without a comprehensive wage. Salary data, as the wages.
   */
  insuredWage?: InsuredWage | null;
  /**
   * After a signed raise (owner's decision, 16 October 2026: "From the next January unless amended in Form 2"): the
   * insured wage is the one before it until this date (the next 1 January, or the Form 2 date), and whether Form 2 was
   * filed; null otherwise, and with the employee's own comprehensive wage. Salary data, as the wages.
   */
  insuredWageAsBefore?: { until: string; form2Filed: boolean } | null;
  /** This year's insurable wage limits (the latest year known when this one isn't in the table). Salary data, as the wages. */
  insurableLimits?: InsuredWage['limits'];
  /**
   * Registered with social insurance: payroll deducts social insurance only for those who are (owner's decision, 16
   * October 2026). HR sets it on the Social Insurance tab. Optional: left out by an API from before payroll.
   */
  socialInsured?: boolean;
  fullNameEn: string;
  fullNameAr: string;
  /** The short name the person goes by (e.g. Hazem Magdy), for the email signature. */
  displayName: string | null;
  dateOfBirth: string | null;
  /**
   * For the annual leave (owner, 18 October 2026: "can you apply the leaves according to the law?"): the months served
   * with employers before this one, which count towards the 30 days of 10 full years' service "with one or more
   * employers" (Labour Law 14/2025, Art. 124), null when none is recorded; and a disability, 45 days. HR sets them.
   * Optional: left out by an API from before leave, and for those who don't see HR data.
   */
  priorServiceMonths?: number | null;
  disability?: boolean;
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
  /**
   * عقار رقم: the building number, which social insurance Form 1 asks for apart from the address. Optional: left out by
   * an API from before October 2026.
   */
  buildingNo?: string | null;
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
  /**
   * The people whose current employment reports to this person; `status` is their employment's, `standing` where they
   * stand (employmentStanding: Trainee or Intern for a trainee's or an intern's Active; 19 October 2026), left out by an
   * older API.
   */
  reports: { id: string; employeeCode: string; fullNameEn: string; status: EmployeeStatus; standing?: Standing; jobTitle: { titleEn: string } | null }[];
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
  /**
   * The person's last training or internship agreement (owner, 19 October 2026: "a new trainee contract can be issued
   * after 6 months of the expiration of the last trainee contract"): the day it ended and the first day a new one may
   * start (YYYY-MM-DD); null when they never had one. Left out by an older API.
   */
  nextTraining?: { lastEnded: string; from: string } | null;
  /**
   * The person is C-level (owner, 19 October 2026: "make C level Employees details not visible to HR"): only the CEO,
   * the Super Admin and the person themself get their full profile; anyone else gets their card (EmployeeCard). Left
   * out by an API from before it.
   */
  confidential?: boolean;
  restricted?: false;
}

/**
 * GET /employees/:id of a C-level person for someone who may not see them (owner, 19 October 2026): their directory
 * card, not a profile, with the note that says why (CONFIDENTIAL_NOTE). No tabs, no actions: every other record of
 * theirs answers 404.
 */
export interface EmployeeCard {
  id: string;
  employeeCode: string;
  fullNameEn: string;
  fullNameAr: string;
  displayName: string | null;
  workEmail: string | null;
  photoId?: string | null;
  photoCrop?: PhotoCrop | null;
  standing: Standing;
  /** May be a team: then `parent` is its department. */
  employment: { id: string; status: EmployeeStatus; department: EmploymentPlace | null; jobTitle: { id: string; titleEn: string; titleAr?: string | null } | null } | null;
  confidential: true;
  restricted: true;
  note: string;
  access: { edit: false; delete: false; identity: false; bank: false };
  isSelf: false;
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
  /**
   * The employee is C-level (owner, 19 October 2026): the CEO decides it, or a Super Admin (as Admin), not HR. Left out
   * by an API from before it.
   */
  confidential?: boolean;
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
/**
 * A session still open (owner, 20 October 2026: sessions kept on the server, one on the website and one in the app a
 * user), as Your Sessions and the Users page list it: where it was signed in, when, and its last activity.
 */
export interface OpenSession {
  id: string;
  kind: SessionKind;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  /** The browser's or the app's, as it said at signing in; null when it said nothing. */
  userAgent: string | null;
  /** A Claude connector's (owner, 21 October 2026: "the connection method"): the client's name, "Claude"; else null. */
  client?: string | null;
  /** The session this page was asked with: "This device". */
  current: boolean;
}

/**
 * A phone that signs in to the Trendlix People app with a fingerprint (owner, 20 October 2026: chose Face ID /
 * fingerprint sign-in for the app; README: "Sign-in: Face ID / fingerprint after the first password sign-in"), as Your
 * Sessions and the Users page list it (GET /auth/devices, GET /users/:id/devices): only the ones that still sign in,
 * newest first. `lastUsedAt`: its last fingerprint sign-in; null when never used.
 */
export interface FingerprintDevice {
  id: string;
  deviceName: string;
  platform: DevicePlatform;
  createdAt: string;
  lastUsedAt: string | null;
}

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
  /**
   * The Assets access set on the Users page (owner, 21 October 2026: "3 levels per user"), and the one in effect: a
   * Super Admin is always a manager, the CEO and Finance at least viewers. Left out by an API from before the Assets
   * module.
   */
  assetsAccess?: AssetsAccess;
  assetsAccessInEffect?: AssetsAccess;
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
    /**
     * Spelled from the Arabic name, never read (the card is in Arabic only): as the employees on file spell each part,
     * else as a list of common names does, else letter by letter (then a note says so).
     */
    fullNameEn?: string;
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
  /** The stored photos and their text (null when that side could not be read), never with the religion on the back. */
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
  /**
   * The basic wage social insurance Form 1 prints for an employee who has none of their own (410 EGP by default; owner,
   * 16 October 2026). Optional: left out by an API from before it.
   */
  insuranceBasicDefault?: number;
  /**
   * The basic salary's share of the gross a new contract or offer starts with, in percent (80 to start with; owner, 16
   * October 2026: edited on Payroll Setup). Optional: left out by an API from before it.
   */
  basicPercentDefault?: number;
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
  /**
   * The last day to tell the employee it won't be renewed: 45 working days before the end; null for a trainee's or an
   * intern's agreement, which is renewed once, converted to full-time or ended, with no non-renewal notice.
   */
  nonRenewalNoticeBy: string | null;
  /** A renewal (the next contract version, not a conversion to full-time) is already drafted. */
  renewalDraft: boolean;
  /** Past its end with the work going on and no signed renewal: open-ended by the law (Art. 88(3)). Left out by an older API. */
  becameOpenEnded?: boolean;
  /** A trainee's or an intern's agreement: which one it is and what follows it (ContractTraining); null otherwise, left out by an older API. */
  training?: ContractTraining | null;
  /** Its conversion to a full-time contract is already drafted. Left out by an older API. */
  conversionDraft?: boolean;
}

/**
 * One of GET /contracts/law-warnings (HR and the CEO; owner, 18 October 2026: "can we update the employment types based
 * on the labour law?"): a signed fixed-term contract past its end while the employment goes on without a signed renewal,
 * which the law counts as open-ended (Labour Law 14/2025 Art. 88(3)), by end date; then current casual work past its 6
 * months (Art. 1(7)), by join date. `since`: the fixed term's last day, or the day the 6 months were up (YYYY-MM-DD).
 * Since 19 October 2026 also a trainee's or an intern's agreement past its end while the employment goes on with
 * nothing signed after it (training_ended, `since` its end date): renewed once, converted to full-time or ended, never
 * open-ended.
 */
export interface LawWarningItem {
  kind: 'became_open_ended' | 'casual_too_long' | 'training_ended';
  employee: ContractEmployeeRef;
  employmentId: string;
  contractId: string | null;
  contractNumber: string | null;
  since: string | null;
  /** In plain words, with what to do. */
  message: string;
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
  /** A fixed term the company doesn't renew: Art. 154's note and estimate (as on `Ending`); null otherwise. */
  art154Note?: Ending['art154Note'];
  art154Estimate?: Ending['art154Estimate'];
}

/**
 * One row of GET /contracts?status=&q=&type=&endingWithin= (HR, CEO and Finance): a contract version in the
 * company-wide list of the Contracts page, with its person and employment. Without a status, drafts and signed ones
 * only; `endingWithin` keeps signed ones ending within that many days, overdue included. Signed by end date first, then
 * drafts, then the rest. The salary fields are null, with `salaryHidden`, for anyone but HR, Finance and the CEO.
 */
export interface ContractListItem extends ContractPay, Omit<ContractLaw, 'traineeStages' | 'traineeStage'> {
  id: string;
  number: string;
  version: number;
  /** Fixed-term (the default), open-ended or for a specific job (contractLengthText in employment-law.ts). */
  form: ContractForm;
  status: ContractStatus;
  startDate: string;
  /** Null for an open-ended contract, a specific-job one without an expected end, and one from before every contract was fixed-term. */
  endDate: string | null;
  probationMonths: number;
  probationEnd: string | null;
  signedOn: string | null;
  insuranceFiledOn: string | null;
  labourOfficeFiledOn: string | null;
  /** A signed fixed contract's last day to tell the employee it won't be renewed: 45 working days before it ends. */
  nonRenewalNoticeBy: string | null;
  /** A trainee's or an intern's agreement (ContractTraining), and a version converting one to full-time; left out by an older API. */
  training?: ContractTraining | null;
  convertsTo?: 'full_time' | null;
  /** In EGP: the gross (for pay by the hour, the monthly estimate), and the insured salary with the insured allowances. */
  grossSalary: number | null;
  insuredSalary: number | null;
  salaryHidden: boolean;
  employee: ContractEmployeeRef & { fullNameAr: string };
  employmentId: string;
  employmentType: EmploymentType;
  /**
   * The employment's, by the labour law: paid by commission (full-time only), the nature of the work, the work pattern
   * (Art. 96(1)), and casual work past its 6 months. Left out by an API from before them.
   */
  paidByCommission?: boolean;
  workNature?: WorkNature;
  workPattern?: WorkPattern;
  casualTooLong?: boolean;
  /** The employment hasn't ended. */
  employmentCurrent: boolean;
  /** As signed; a draft's are the employment's current ones. */
  jobTitleEn: string | null;
  departmentName: string | null;
}

/**
 * A trainee's training agreement or an intern's internship agreement (owner, 19 October 2026: "interns to be labeled
 * trainees instead of probation and their contracts are never renewed", then "or can be only renewed 1 time, after that
 * it should be converted to a full time contract"): `agreement` 1 for the first, 2 for its one renewal; `next`, what
 * follows it: renewed once or converted to full-time (renew_or_convert), or converted or ended (convert_or_end).
 */
export interface ContractTraining {
  agreement: number;
  next: TrainingNext;
}

/** A training stage as a contract shows it: its pay null, with the salary, for anyone but HR, Finance and the CEO. */
export interface TraineeStageView {
  name: string;
  months: number;
  pay: number | null;
}

/**
 * What a contract carries of the labour law's dimensions (owner, 18 October 2026: "can we update the employment types
 * based on the labour law?"): the job of a contract for a specific job ("إذا أبرم عقد العمل لإنجاز عمل معين، انتهى العقد
 * بإنجاز هذا العمل", Labour Law 14/2025 Art. 155); a trainee's contract is the training agreement, with its stages, each
 * with its months and pay a month, rising from stage to stage (Art. 29), and the stage in force today; and HR's warning
 * that a fixed-term contract past its end date while the work goes on without a signed renewal counts as open-ended
 * (Art. 88(3)). Each left out by an API from before them.
 */
export interface ContractLaw {
  /** A specific-job contract's job; null otherwise. */
  jobToDo?: string | null;
  /** A trainee's training stages, in order; null for any other contract. */
  traineeStages?: TraineeStageView[] | null;
  /** The training's whole length (its stages' months); null for any other contract. */
  traineeMonths?: number | null;
  /** The stage in force today (the first before the start), numbered from 1; null for any other contract. */
  traineeStage?: { number: number; name: string; pay: number | null } | null;
  becameOpenEnded?: boolean;
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
export interface Contract extends ContractPay, ContractLaw {
  id: string;
  number: string;
  version: number;
  /**
   * Fixed-term, the default (owner, 15 October 2026: every contract for a year); since 18 October 2026 open-ended (no end
   * date, no length, no renewal: ended by notice, Art. 156) or for a specific job (Art. 155) too.
   */
  form: ContractForm;
  startDate: string;
  /** Null for an open-ended contract, a specific-job one without an expected end, and one from before every contract was fixed-term. */
  endDate: string | null;
  /** A fixed-term contract's length (a trainee's, the training's months); null for an open-ended or specific-job one. */
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
  /**
   * A fixed contract's last day to tell the employee it won't be renewed: 45 working days before it ends; null for a
   * trainee's or an intern's agreement (renewed once, then converted to full-time or ended).
   */
  nonRenewalNoticeBy: string | null;
  /** A trainee's or an intern's agreement: which one it is and what follows it; null for any other contract. Left out by an older API. */
  training?: ContractTraining | null;
  /**
   * A version converting a trainee's or an intern's agreement to a full-time contract on the same employment (signing it
   * makes the employment full-time); null for any other. Left out by an older API.
   */
  convertsTo?: 'full_time' | null;
  salaryHidden?: boolean;
  /** A whole contract, or a salary amendment (owner's decisions, 16 October 2026); missing from an older API. */
  kind?: ContractKind;
  /** Where it stands: draft, returned, with the CEO, approved, signed, replaced or ended (raises.ts). */
  stage?: PayStage;
  /** A version that changes the pay (a raise, or a renewal with new pay): its CEO step; null otherwise. */
  raise?: ContractRaise | null;
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
  /**
   * The company not renewing a fixed-term contract (owner, 18 October 2026): "فإذا كان الإنهاء من جانب صاحب العمل استحق
   * العامل مكافأة تعادل أجر شهر عن كل سنة من سنوات الخدمة" (Labour Law 14/2025 Art. 154). The note to check it with the
   * lawyer, and the estimate: the years of service (to two decimals, from the join date to the last working day) × the
   * last monthly wage (the last signed contract's gross and allowances), the wage and the amount in EGP, null for anyone
   * but HR, Finance and the CEO. Information only: no money is moved. Null for any other ending; left out by an API from
   * before them.
   */
  art154Note?: string | null;
  art154Estimate?: { serviceYears: number; lastMonthlyWage: number | null; amount: number | null } | null;
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
  /**
   * A Sales slot (owner, 18 October 2026: Sales became Full-time paid by commission): chosen for a full-time employment
   * or offer paid by commission while it has a published version, else the full-time slot is. Left out by an API from
   * before it.
   */
  paidByCommission?: boolean;
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
 * placed on it; `editable`: false for a version that was replaced (the API then refuses a save); `standardLayout`:
 * whether the system has a standard layout for its form, which Use the standard layout puts on it (owner, 16 October
 * 2026). Optional: left out by an API from before it.
 */
export interface TemplateFields {
  version: TemplateVersion;
  pages: PdfPageSize[];
  fields: PdfField[];
  editable: boolean;
  standardLayout?: boolean;
}

// ---------- documents generated from the templates: the profile's Employment and Social Insurance tabs ----------
// The company issues them from its published templates; each one goes Generated → Printed → Signed copy uploaded →
// Verified. HR generates and moves them along, the CEO views and downloads them, only a Super Admin deletes one. Dates
// are "YYYY-MM-DD"; moments are ISO.

/** The parts of the documents, in this order; social insurance is listed on its own tab, the others on Employment. */
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

/** GET /employees/:id/documents (HR and the CEO): the Employment tab's documents, part by part. */
export interface DocumentsTab {
  sections: { key: DocumentSectionKey; items: DocumentItem[] }[];
}

/**
 * Where a missing detail is filled in: a profile tab and the field's cell there (#field-<key>, on Documents the paper's
 * row #paper-<key>; `insurance`: the Social Insurance tab, e.g. key `occupationCode`), the company profile (`company`),
 * or the contract, on the Employment tab (`contracts`).
 */
export interface DocumentDetailPlace {
  tab: ProfileGap['tab'] | 'contracts' | 'insurance' | 'company';
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
  /**
   * `tab`: 'offer' (a field of the offer: `key`; `template` for what an offer never has, such as the social insurance
   * occupation), 'company' (the company profile), or another place the API names.
   */
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
  /** The applicant it was made from (recruitment, 22 October 2026: Make offer); left out by an API from before. */
  application?: { id: string; number: string } | null;
  employmentType: EmploymentType;
  /**
   * Full-time only: paid by commission, as Sales was (owner, 18 October 2026), and the nature of the work (Labour Law Art.
   * 1(6–8)), both carried to the employment on acceptance. Left out by an API from before them.
   */
  paidByCommission?: boolean;
  workNature?: WorkNature;
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

// ---------- payroll (owner's decisions, 16 October 2026) ----------
// HR prepares a month's run, the CEO approves it, HR marks it paid. Amounts in EGP to the piaster; a month is "YYYY-MM",
// dates "YYYY-MM-DD", moments ISO. Salary data: HR, Finance and the CEO only. The terms, inputs and results of a line
// are @trendlix/shared's (payroll.ts), as the API works them out.

/** A run's totals: its lines added up. */
export interface PayrollTotals {
  employees: number;
  earned: number;
  allowances: number;
  employeeInsurance: number;
  employerInsurance: number;
  monthlyTax: number;
  martyrsFund: number;
  deductions: number;
  net: number;
  released: number;
  transfer: number;
  companyCost: number;
}

/** Which bank file pays a line: CIB's own Payroll System file for CIB accounts, the ACH file for every other bank. */
export type PayrollBankFile = 'cib' | 'ach';

/** One employee on a run: who (as when the run was made or refreshed), the month's inputs and what they work out to. */
export interface PayrollLineView {
  id: string;
  employeeId: string;
  employeeCode: string;
  name: string;
  department: string | null;
  jobTitle: string | null;
  employmentType: EmploymentType;
  payBasis: PayBasis;
  /** Left out of the bank files this month. */
  onHold: boolean;
  comments: string | null;
  terms: PayrollTerms;
  /**
   * As saved: a line saved before 17 October 2026 has the grid's bonus and penalty days, commission and settlements
   * (since then on Additions / Deductions), and the CEO's attendance waiver once given.
   */
  inputs: SavedPayrollInputs;
  result: PayrollResult;
  /**
   * The bank file the line goes in, from the live bank details before the CEO approves and the snapshot taken then
   * after; `problem` says why it can't be paid by either file (no bank details, an account of the wrong length …).
   */
  bank: { file: PayrollBankFile | null; bankShort: string | null; problem: string | null };
  /**
   * Whether the line's payslip is drawn and stored, in English and in Arabic (owner's decisions, 16 October 2026: the
   * English one is issued when HR marks the run paid, the Arabic one on request). Left out by an API from before payslips
   * (October 2026), hence optional.
   */
  payslips?: { en: boolean; ar: boolean };
  /**
   * A C-level person's line (owner, 19 October 2026: "make C level Employees details not visible to HR"): only the CEO
   * and the Super Admin get it, and the CEO fills its inputs. Left out by an API from before it.
   */
  confidential?: boolean;
  /**
   * Whether the caller may change the line's inputs, hold and comments now: the run is a draft and the line is theirs to
   * fill (HR's, a C-level one the CEO's: changesPayrollLine in @trendlix/shared). Left out by an API from before it,
   * when HR changed every line of a draft.
   */
  editable?: boolean;
  /**
   * The inputs an attendance import filled (owner, 19 October 2026: Zoho People), still as it filled them: the grid
   * marks them "from Zoho". Null: none; left out by an API from before it.
   */
  attendanceImport?: AttendanceImportMark | null;
}

/** Someone employed in the month but not on the run, and why ("No signed contract for this month"). */
export interface PayrollExclusion {
  employeeId: string;
  employeeCode: string;
  name: string;
  reason: string;
}

/** GET /payroll/runs/:id (and what every change to a run answers). */
export interface PayrollRunView {
  id: string;
  month: string;
  status: PayrollStatus;
  /** The rules the run was worked out with: copied from the payroll settings when it was made or last refreshed. */
  rules: PayrollRules;
  createdAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
  approvedBy: { id: string; name: string } | null;
  /** Why the CEO returned it to HR, while it is a draft again. */
  returnedReason: string | null;
  paidOn: string | null;
  totals: PayrollTotals;
  lines: PayrollLineView[];
  exclusions: PayrollExclusion[];
  /** How many lines each bank file pays, and how many can't be paid by either. */
  bankCheck: { cib: number; ach: number; problems: number };
  /** How many English payslips are stored for the run (issued when it is marked paid). Optional like a line's `payslips`. */
  payslips?: number;
  /**
   * The rates set by law the run is worked out with (owner's request, 16 October 2026): a copy of its year's, taken
   * when it was made or last refreshed. Left out by an API from before them.
   */
  lawRates?: LawRates;
  /**
   * The month's pending additions and deductions for people not on the run (owner, 17 October 2026: Additions /
   * Deductions), by person: no line takes them. Left out by an API from before them.
   */
  adjustmentsNotOnRun?: { employeeId: string; employeeCode: string; name: string; count: number }[];
  /**
   * The C-level people's lines kept from the caller (owner, 19 October 2026): how many, and the row that stands for them
   * ("C-level (2 people) — hidden"); null when the caller sees every line or there are none. The totals, the bank check,
   * the payslips, the exclusions and the additions not on the run already leave them out. Left out by an older API.
   */
  hidden?: { count: number; label: string } | null;
}

/**
 * GET /employees/:id/payslips (HR, Finance and the CEO): one per run the employee was on, newest month first. The
 * payslips are drawn from the run once it is paid; `issued` is when each was drawn (ISO), null while it isn't yet (the
 * Arabic one is drawn the first time it is opened). A line on hold that month has none.
 */
export interface EmployeePayslip {
  lineId: string;
  runId: string;
  /** "YYYY-MM". */
  month: string;
  /** The day the run was paid (YYYY-MM-DD). */
  paidOn: string | null;
  net: number;
  transfer: number;
  onHold: boolean;
  issued: { en: string | null; ar: string | null };
}

/** GET /payroll/runs: every run, newest month first. */
export interface PayrollRunSummary {
  id: string;
  month: string;
  status: PayrollStatus;
  totals: PayrollTotals;
  createdAt: string;
  approvedAt: string | null;
  paidOn: string | null;
  /** How many C-level people's lines the totals leave out for the caller (19 October 2026); 0 or left out: none. */
  hidden?: number;
}

/** GET /payroll/settings: the rules new runs are worked out with, and what the bank files need. */
export interface PayrollSettingsView extends PayrollRules {
  /** The company's CIB account the salaries are paid from: 12 digits. */
  cibDebitAccount: string | null;
  /** The account's name, as CIB has it. */
  cibDebitAccountName: string | null;
  /** The ACH file's transaction purpose ("CASH"). */
  achPurpose: string;
  /**
   * The day of the month salaries are paid, 1 to 31; null when not set (owner's request, 16 October 2026: Payroll
   * Setup). The date a run is marked paid on, to start with. Optional: left out by an API from before it.
   */
  payday?: number | null;
  /**
   * Salary review due after this many months without a raise, 1 to 60 (owner's decision, 16 October 2026: the Salary
   * Raises report lists who is due). Optional: left out by an API from before it.
   */
  salaryReviewMonths?: number;
  /**
   * The most a month's installments (advances' recoveries and loans' installments, all the employee's together) may
   * take of the wage, 1 to 10: the Labour Law's limit (owner, 18 October 2026, after reading the law: "Block above 10%";
   * Law 14/2025 Art. 113), a plan past it refused. Optional: left out by an API from before it.
   */
  installmentLimitPercent?: number;
  /**
   * The office's addresses as Zoho People writes a check-in's location (owner, 19 October 2026: "13 and 17 al mahrouki
   * is also in office"): a check-in at one of them is a day at the office, anywhere else remote. Optional: left out by an
   * API from before it.
   */
  officeAddresses?: string[];
}

/**
 * An official holiday, from GET /payroll/holidays?year= (every signed-in user since 17 October 2026, for the employee's
 * dashboard; HR and Admin change them), in date order (owner's request, 16 October 2026: Payroll Setup). One day each;
 * on a shift's working day, it takes that day's hours out of the expected hours a run works out.
 */
export interface Holiday {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  nameEn: string;
  nameAr: string | null;
}

/**
 * GET /payroll/law-rates (HR, Finance, the CEO, Admin and the Super Admin), oldest year first: the rates set by law of
 * each year kept (owner's request, 16 October 2026), with who changed them last and when (ISO). `updatedBy` is null for
 * the rows the law rates migration added. PUT /payroll/law-rates/:year answers one (the Super Admin only).
 */
export interface LawRatesView extends LawRates {
  updatedAt: string;
  updatedBy: { id: string; name: string } | null;
}

/**
 * What happens to a day of an imported holiday list (owner's request, 16 October 2026: "allow me to import yearly
 * holiday list"): added (new); skipped as already on file (a holiday that day with the same English name); not imported
 * as a clash (a holiday that day with another name); or skipped as given again further down the file (duplicate).
 */
export type HolidayImportStatus = 'new' | 'on_file' | 'clash' | 'duplicate';

/** A day of an imported list: its row in the file, the day (YYYY-MM-DD), the names and what happens to it. */
export interface HolidayImportDay {
  row: number;
  date: string;
  nameEn: string;
  nameAr: string | null;
  status: HolidayImportStatus;
  /** The holiday on file that day (on_file and clash). */
  onFile?: { nameEn: string; nameAr: string | null };
  /** The row that gives the day first (duplicate). */
  firstRow?: number;
}

/**
 * POST /payroll/holidays/import/preview (HR and Admin): the file read and set against the holidays on file, nothing
 * saved. `fingerprint` confirms the import of this very file; `rows`: its rows of holidays, blank ones left out;
 * `problems`: the rows that can't be imported, each message starting "Row N:".
 */
export interface HolidayImportPreview {
  fingerprint: string;
  rows: number;
  days: HolidayImportDay[];
  problems: { row: number; message: string }[];
}

/** POST /payroll/holidays/import: the file as checked when imported, and the holidays added, in date order. */
export interface HolidayImportResult extends HolidayImportPreview {
  imported: Holiday[];
}

// ---------- reimbursements (owner, 18 October 2026: "allow the employee to add reimbursement request … for specific
// preset up conditions", "in the setup i need to enter for it a cap"; packages/shared/src/reimbursements.ts) ----------
// HR sets up the types in Payroll Setup; an employee claims one from My Requests; the direct manager, HR, then Finance
// decide it; Finance's approval adds it, untaxed, to the next payroll. Amounts in EGP with 2 decimals, dates
// YYYY-MM-DD, moments ISO.

/**
 * GET /reimbursement-types (HR, Finance, the CEO), active first, then by English name: a type and its conditions. A cap
 * or the deadline left empty (null) has no limit; an empty list of departments, grades or employment types, everyone.
 * `claims`: how many claims use it, which keeps it from being deleted.
 */
export interface ReimbursementTypeView {
  id: string;
  nameEn: string;
  nameAr: string;
  description: string | null;
  receiptRequired: boolean;
  capPerClaim: number | null;
  capPerMonth: number | null;
  capPerYear: number | null;
  claimWithinDays: number | null;
  departmentIds: string[];
  gradeIds: string[];
  employmentTypes: string[];
  active: boolean;
  claims: number;
}

/** What POST /reimbursement-types takes, and PATCH /reimbursement-types/:id (all of it, or part). */
export type ReimbursementTypeBody = Omit<ReimbursementTypeView, 'id' | 'claims'>;

/**
 * GET /me/reimbursement-types?expenseDate=: the active types the employee may claim, with what their claims of each
 * already take of its caps in that expense date's month and year (the claims being decided and those approved).
 */
export interface MyReimbursementType extends Omit<ReimbursementTypeView, 'departmentIds' | 'gradeIds' | 'employmentTypes' | 'claims'> {
  usedInMonth: number;
  usedInYear: number;
}

/** A step logged on a claim: sent, sent straight to HR, each stage's decision, cancelled, added to a payroll. */
export interface ReimbursementClaimStep {
  id: string;
  kind: ReimbursementStepKind;
  decision: ReimbursementDecision | null;
  /** The amount approved at that step, or claimed on `submitted`. */
  amount: number | null;
  comment: string | null;
  /** The payroll month it was added to (`added_to_payroll`), its first day. */
  payMonth: string | null;
  /** Who, by their display name; null for a user since removed. */
  actor: string | null;
  at: string;
}

/**
 * A claim, as GET /reimbursements, GET /me/reimbursements and GET /reimbursements/:id give it to the caller (the
 * claimant, the claim's manager, HR, Finance and the CEO). `waitingForYou`: the caller decides it now; `canCancel`: the
 * caller is the claimant and it is still being decided.
 */
export interface ReimbursementClaimView {
  id: string;
  employee: { id: string; fullNameEn: string; fullNameAr: string | null; photoId?: string | null; department: string | null; team?: string | null };
  type: { id: string; nameEn: string; nameAr: string; receiptRequired: boolean };
  expenseDate: string;
  /** As claimed. */
  amount: number;
  /** As last approved at any stage; the final amount once approved. */
  approvedAmount: number | null;
  description: string;
  status: ReimbursementStatus;
  stage: ReimbursementStage | null;
  waitingForYou: boolean;
  canCancel: boolean;
  /** Who decides its manager stage, and as what: see `RequestApprover`. Null: nobody, it went straight to HR. */
  manager: RequestApprover | null;
  rejectedStage: ReimbursementStage | null;
  rejectReason: string | null;
  /** The payroll month it was added to, its first day. */
  payMonth: string | null;
  /** Its payroll addition, once Finance approved it. */
  payroll: { status: 'pending' | 'applied' | 'cancelled'; runMonth: string } | null;
  receipts: { id: string; fileName: string; mimeType: string; sizeBytes: number }[];
  steps: ReimbursementClaimStep[];
  createdAt: string;
  /**
   * The claimant is C-level (owner, 19 October 2026): HR's and Finance's stages are the CEO's (or a Super Admin's with
   * the role). Left out by an API from before it.
   */
  confidential?: boolean;
}

/** GET /reimbursements/counts: how many claims wait for the caller, for the sidebar. */
export interface ReimbursementCounts {
  waiting: number;
}

// ---------- installments and recurring deductions (owner, 18 October 2026: "in the deductions i might have a loan of
// a medical subscription or something that needs to be deducted as installments on the employee. how will it be
// managed?"; packages/shared/src/installments.ts) ----------
// An advance or a loan recorded with installments has one pending deduction a month, made at once; a recurring
// deduction (e.g. the employee's share of a medical subscription) adds one to each month's payroll until it ends or HR
// stops it. Leaving before an advance is paid back: "taken from the final settlement, unless waived". Months YYYY-MM,
// amounts in EGP with 2 decimals.

/** A month's installment of an advance or loan: its deduction (the id is the deduction's), in month order. */
export interface AdvanceInstallment {
  id: string;
  month: string;
  amount: number;
  status: 'pending' | 'applied' | 'cancelled';
  /** Its month's run is approved or paid, or it was applied: it can't be moved or changed. */
  locked: boolean;
}

/**
 * GET /payroll/advances/limit (HR, Finance and the CEO): what the forms check the Labour Law's limits with as they are
 * typed (owner, 18 October 2026, after reading the law: "Block above 10%", "Warn above 25%, record the consent"): the
 * current contract's gross (the wage; null without one), the most a month's installments may take of it in percent,
 * the employee's installments by month, about what the gross comes to in tax and their insurance (null without a
 * gross), and their recurring deductions not ended. The last three are left out by an API from before the law's limits.
 */
export interface AdvanceLimitView {
  gross: number | null;
  percent: number | null;
  byMonth: Record<string, number>;
  tax?: number | null;
  insurance?: number | null;
  recurring?: { id: string; amount: number; startMonth: string; endMonth: string | null; stoppedFrom: string | null }[];
}

export type RecurringDeductionStatus = 'upcoming' | 'running' | 'ended';

/**
 * GET /payroll/recurring-deductions (HR, Finance and the CEO): a fixed amount deducted every month, e.g. "Medical
 * subscription (family)", from its first month to its last (none: until stopped), or until HR stopped it
 * (`stoppedFrom`: the first month no longer deducted). `deducted`: its deduction of each month a run took it in.
 */
export interface RecurringDeductionView {
  id: string;
  employee: { id: string; fullNameEn: string; department: string | null; team: string | null };
  name: string;
  amount: number;
  startMonth: string;
  endMonth: string | null;
  stoppedFrom: string | null;
  stopNote: string | null;
  /**
   * "Deducted before tax (lowers taxable pay)" (owner, 20 October 2026, asked whether the employee's medical share is
   * taken before or after tax: "Before Tax i think"): its months' deductions lower the taxable pay before the income
   * tax. False by default: after tax. Left out by an API from before it.
   */
  beforeTax?: boolean;
  status: RecurringDeductionStatus;
  deducted: { month: string; amount: number; status: 'pending' | 'applied' | 'cancelled' }[];
  /**
   * The employee's written consent (Labour Law 14/2025 Art. 114; owner, 18 October 2026, after reading the law: "record
   * the consent"): when HR recorded it was on file and who, and the signed consent attached (a paper in the employee
   * file); null: not recorded. Left out by an API from before it.
   */
  consent?: { recordedAt: string; recordedBy: { id: string; name: string } | null; paper: { id: string; fileName: string } | null } | null;
  createdAt: string;
}

/**
 * GET /employees/:id/deduction-plans (HR, Finance, the CEO, and the employee themself): the open advances and loans
 * with what is paid so far, what is left and the next installment, and the recurring deductions running or to come.
 */
export interface DeductionPlansView {
  advances: {
    id: string;
    kind: 'advance' | 'loan';
    reason: string;
    amount: number;
    recovered: number;
    outstanding: number;
    nextInstallment: { month: string; amount: number } | null;
    status: 'open' | 'settled';
  }[];
  recurring: { id: string; name: string; amount: number; startMonth: string; endMonth: string | null; status: RecurringDeductionStatus }[];
}

// ---------- leave (owner, 18 October 2026: "if we will work on the attendance and leaves, how will we build it?",
// leaves first, then "can you apply the leaves according to the law?" and "make it with decision with the year
// closing"; Labour Law 14/2025, Arts. 54–57 and 124–133; packages/shared/src/leaves.ts) ----------
// The leave types the law gives (annual, casual, a child's birth, exams, Hajj, sick, maternity, childcare, unpaid) are
// seeded for HR to change, turn off or add to; an employee asks from My Requests, their direct manager then HR decide
// (no manager: straight to HR), every step logged; HR records leave on someone's behalf, approved at once. The annual
// balance follows the calendar year; HR's Year Closing decides, per employee, what of the unused days is carried into
// the new year and what is paid. Days are numbers, half days allowed; dates YYYY-MM-DD, moments ISO.

/**
 * GET /leave/types (every signed-in user the active ones; HR, the CEO and Admin all of them), in their order: a type of
 * leave and its rules. A limit left empty (null) has none. `requests`: how many requests use it, which keeps it from
 * being deleted; left out by an API that doesn't send it.
 */
export interface LeaveTypeView {
  id: string;
  key: string;
  /** One of the law's (LEAVE_KINDS), or 'custom' for a type HR added. */
  kind: string;
  nameEn: string;
  nameAr: string;
  paid: LeavePay;
  /** The share of the pay a partly paid type pays, 0 to 100; null for the others. */
  payPercent: number | null;
  balance: LeaveBalanceKind;
  daysPerYear: number | null;
  maxPerRequest: number | null;
  maxTimesInService: number | null;
  minServiceMonths: number | null;
  /** Days of notice an employee's request needs; HR recording one on someone's behalf needs none. */
  noticeDays: number | null;
  documentRequired: boolean;
  /** For men only, women only, or anyone (null). */
  gender: Gender | null;
  /** Counted in calendar days (Hajj, maternity) rather than working days. */
  calendarDays: boolean;
  /** May be taken as half a day. */
  halfDays: boolean;
  active: boolean;
  sortOrder: number;
  requests?: number;
}

/** What POST /leave/types takes (a type of HR's own: its kind is custom), and PATCH /leave/types/:id (all of it, or part). */
export type LeaveTypeBody = Omit<LeaveTypeView, 'id' | 'requests' | 'key' | 'kind'>;

/**
 * GET /leave/settings (all staff; HR changes it): the annual leave's tiers (Art. 124), each editable: the first year's
 * days, from the second year, after so many years of service (with any employer) or over an age, for a person with a
 * disability, the days added for hazardous work, the months served before a first year's leave may be used, and within
 * how many years days carried over must be settled (Art. 125).
 */
export interface LeaveSettingsView {
  firstYearDays: number;
  standardDays: number;
  longServiceDays: number;
  longServiceYears: number;
  longServiceAge: number;
  disabilityDays: number;
  hazardousExtraDays: number;
  firstYearMinMonths: number;
  settleWithinYears: number;
  /**
   * Permission (owner, 19 October 2026: "4 hours per month with a maximum 2 hours per day", "Yes, in Leave Setup"): the
   * hours a month someone may be away from a working day (0: no permission), and the most hours of one day, in half
   * hours. Left out by an API from before permission.
   */
  permissionHoursPerMonth?: number;
  permissionMaxHoursPerDay?: number;
}

/** A step logged on a leave request: sent, sent straight to HR, recorded by HR, each stage's decision, cancelled. */
export interface LeaveRequestStep {
  id: string;
  kind: LeaveStepKind;
  decision: LeaveDecision | null;
  comment: string | null;
  /** Who, by their display name; null for a user since removed. */
  actor: string | null;
  at: string;
}

/**
 * A leave request, as GET /leave/requests, GET /me/leave/requests and GET /leave/requests/:id give it to the caller (the
 * employee, their manager, HR and the CEO). `waitingForYou`: the caller decides it now; `canCancel` and `hrCanCancel`:
 * who may cancel it now (the employee while it is being decided, or approved and not started; HR an approved one).
 * `balanceAfter`: for leave from the annual balance, what is available of it once this is taken.
 */
export interface LeaveRequestView {
  id: string;
  employee: { id: string; fullNameEn: string; fullNameAr: string | null; department: string | null; team: string | null };
  type: { id: string; key: string; nameEn: string; nameAr: string; paid: LeavePay };
  startDate: string;
  endDate: string;
  halfDay: boolean;
  days: number;
  reason: string | null;
  status: LeaveStatus;
  stage: LeaveStage | null;
  waitingForYou: boolean;
  /** The employee may cancel it now: theirs, being decided, or approved and not started. */
  canCancel: boolean;
  /** HR may cancel it now: approved, and not HR's own. Optional: left out by an API that doesn't send it. */
  hrCanCancel?: boolean;
  /** Who decides its manager stage, and as what: see `RequestApprover`. Null: nobody, it went straight to HR. */
  manager: RequestApprover | null;
  rejectedStage: LeaveStage | null;
  rejectReason: string | null;
  recordedByHr: boolean;
  documents: { id: string; fileName: string; mimeType: string; sizeBytes: number }[];
  steps: LeaveRequestStep[];
  balanceAfter: number | null;
  createdAt: string;
  /**
   * The employee is C-level (owner, 19 October 2026): HR's stage is the CEO's (or HR with Super Admin); `waitingForYou`
   * says whether it waits for the caller. Left out by an API from before it.
   */
  confidential?: boolean;
}

/**
 * The annual balance of a calendar year: the entitlement for the year (Art. 124, pro rata in a first year), the first
 * day it may be used (6 months after joining, in a first year), what was carried in from the year before and HR's
 * adjustments, the days taken (approved, started), booked (approved, to come) and waiting (being decided), and what is
 * available.
 */
export interface AnnualLeaveBalance {
  entitlement: number;
  usableFrom: string;
  carriedIn: number;
  adjustments: number;
  taken: number;
  booked: number;
  pending: number;
  available: number;
}

/** The other types: the days used (in the year, or in the service for a type taken so many times), and what is left (null: no limit). */
export interface LeaveTypeBalance {
  typeId: string;
  nameEn: string;
  nameAr: string;
  used: number;
  timesInService: number;
  left: number | null;
}

/** GET /me/leave/balances?year=: the employee's own. */
export interface LeaveBalances {
  year: number;
  annual: AnnualLeaveBalance;
  types: LeaveTypeBalance[];
}

/** An adjustment HR made to someone's annual balance, with its reason. */
export interface LeaveAdjustmentView {
  id: string;
  year: number;
  days: number;
  reason: string;
  by: string | null;
  at: string;
}

/**
 * GET /employees/:id/leave?year= (HR, the CEO, Finance, the employee and their manager): the balances, and the requests;
 * `adjustments`, HR's to the year, when the API sends them.
 */
export interface EmployeeLeave extends LeaveBalances {
  requests: LeaveRequestView[];
  adjustments?: LeaveAdjustmentView[];
}

/**
 * GET /leave/calendar?from=&to=&departmentId=: who is off when (approved leave, and for HR those being decided too), and
 * since 19 October 2026 the permissions the same way (`kind: 'permission'`): one day each (its startDate and endDate),
 * with its hours and times, its type named Permission, never half a day.
 */
export interface LeaveCalendarEntry {
  /** The request's id when the API sends it. */
  id?: string;
  /** Leave, or a permission (19 October 2026); left out by an API from before permission: leave. */
  kind?: 'leave' | 'permission';
  employee: { id: string; fullNameEn: string; department: string | null; team: string | null };
  type: { nameEn: string };
  startDate: string;
  endDate: string;
  halfDay: boolean;
  status: LeaveStatus;
  /** A permission's hours, and its times (HH:MM) when given. */
  hours?: number;
  fromTime?: string | null;
  toTime?: string | null;
}

/**
 * GET /leave/requests/counts: how many requests wait for the caller, for the sidebar: `waiting`, the leave and the
 * permission requests together (19 October 2026), and each (left out by an API from before permission).
 */
export interface LeaveCounts {
  waiting: number;
  leave?: number;
  permissions?: number;
}

// ---------- permission (owner, 19 October 2026: "this is an option given by us .. 4 hours per month with a maximum 2
// hours per day", asked how it is asked for, "In the system, like leave"; packages/shared/src/permissions.ts) ----------
// A few hours away from a working day, in half hours, at most the Leave Setup's hours a day and a month; asked for from
// My Requests or recorded by HR, decided as leave is (the direct manager, else the team lead, else the department's
// head, then HR; a C-level person's HR stage by the CEO), every step logged. Its approved hours count as worked on the
// month's payroll line.

/**
 * A permission request, as GET /leave/permissions, GET /me/permissions and GET /leave/permissions/:id give it: shaped as
 * a leave request is for what they share (its status, stage, who decides it, the steps), with its day (also as its
 * startDate and endDate), its hours and times instead of a type and days. `monthLeft`: what is left of its month's hours
 * with it counted; null when the caller doesn't see the person's figures (a C-level person's manager).
 */
export interface PermissionRequestView {
  id: string;
  kind: 'permission';
  employee: { id: string; fullNameEn: string; fullNameAr: string | null; department: string | null; team: string | null };
  type: { id: string; key: string; nameEn: string; nameAr: string };
  date: string;
  startDate: string;
  endDate: string;
  hours: number;
  /** HH:MM (Cairo), as given or worked out from the hours; null without times. */
  fromTime: string | null;
  toTime: string | null;
  reason: string | null;
  status: LeaveStatus;
  stage: LeaveStage | null;
  waitingForYou: boolean;
  /** The employee may cancel it now: theirs, being decided, or approved and its day still to come. */
  canCancel: boolean;
  /** HR may cancel it now: approved, and not HR's own. */
  hrCanCancel?: boolean;
  manager: RequestApprover | null;
  rejectedStage: LeaveStage | null;
  rejectReason: string | null;
  recordedByHr: boolean;
  steps: LeaveRequestStep[];
  monthLeft: number | null;
  createdAt: string;
  /** The employee is C-level: HR's stage is the CEO's (or HR with Super Admin). */
  confidential?: boolean;
}

/**
 * A person's permission hours of a month (GET /me/permissions/allowance?month=): the Leave Setup's hours a month and most
 * a day, those approved, those being decided, what is left to ask for, and the hours asked for on each day.
 */
export interface PermissionMonthView {
  month: string;
  hoursPerMonth: number;
  maxHoursPerDay: number;
  approved: number;
  pending: number;
  left: number;
  days: { date: string; hours: number }[];
}

/** GET /employees/:id/permissions?month= (HR, the CEO, Finance, the person, their manager now): their month, with its requests. */
export interface EmployeePermissionMonth extends PermissionMonthView {
  requests: PermissionRequestView[];
}

/**
 * One employee of a year's closing: their unused annual days, the days carried in by the year they were first carried
 * (`carriedByYear`, "2024": 3), those carried for `settleWithinYears` years or more (Art. 125: settled every three
 * years at most), what is carried and paid (as proposed, or as decided once closed), the day rate (the gross ÷ the
 * payroll's day divisor) and what the pay comes to.
 */
export interface YearClosingRow {
  employee: { id: string; fullNameEn: string; department: string | null; team: string | null };
  employmentId?: string;
  unused: number;
  carriedByYear: Record<string, number>;
  mustSettle: number;
  carry: number;
  pay: number;
  dayRate: number;
  payAmount: number;
  /** What the law asks for that can't be enforced (Art. 125: at least 15 days a year, 6 of them in a row): flagged, not blocked. */
  flags?: string[];
  /** Once closed with days paid: the Unused leave paid addition, as Additions / Deductions has it now (month YYYY-MM). */
  payout?: { adjustmentId: string; month: string; status: 'pending' | 'applied' | 'cancelled' } | null;
}

/** GET /leave/year-closing/:year (HR and the CEO); `closedAt`: when it was closed (ISO), null while open. */
export interface YearClosingView {
  year: number;
  closed: boolean;
  closedAt?: string | null;
  rows: YearClosingRow[];
  /**
   * How many C-level people the rows leave out for the caller (owner, 19 October 2026); 0 for the CEO and the Super
   * Admin. Left out by an older API.
   */
  confidentialExcluded?: number;
}
