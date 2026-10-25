// Values shared by the web app and the API.
// Source of truth: the enums in trendlix-hrms-handoff/db/schema.sql.

/**
 * Super Admin sits above Admin: it can do everything an Admin can, and it is the only role that deletes records
 * (owner's decision, 15 October 2026). It does not bring the HR, CEO, Finance or manager powers: someone who needs
 * those holds those roles too.
 */
// 'developer' (owner, 22 October 2026: "i want to create a role for develoeprs, not showing the real numbers"): sees what
// a Super Admin sees, changes nothing, never the money or personal IDs (developer.ts)
export const ROLES = ['employee', 'manager', 'hr', 'finance', 'ceo', 'admin', 'super_admin', 'developer'] as const;
export type Role = (typeof ROLES)[number];

/** Role names as the screens show them, and as the database seed stores them (apps/api/prisma/seed.ts). */
export const ROLE_LABELS: Record<Role, string> = {
  employee: 'Employee',
  manager: 'Direct manager',
  hr: 'HR',
  finance: 'Finance',
  ceo: 'CEO',
  admin: 'Admin',
  super_admin: 'Super Admin',
  developer: 'Developer',
};

/**
 * The employment types, by Labour Law 14/2025 (owner, 18 October 2026: "can we update the employment types based on the
 * labour law?"). Sales became Full-time paid by commission (Employment.paidByCommission: the law's wage includes "العمولة
 * أو النسبة المئوية", Art. 1(4)(أ), so a sales person is a full-time worker); Internship became Trainee, the law's
 * المتدرج (Art. 1(2): "كل من التحق لدى صاحب عمل بقصد تعلم مهنة أو صنعة أو حرفة لقاء أجر"), with a written training
 * agreement (Arts. 28–30); Freelance is kept, outside the labour law, whose worker works for an employer "تحت إدارته أو
 * إشرافه" (Art. 1(1)): a freelancer doesn't, so they get no leave, no company social insurance and a service agreement
 * rather than an employment contract. More of the law's dimensions: employment-types.ts.
 *
 * The unpaid internship (owner, 19 October 2026: "in case of trainee, we are not paying them salary, its just
 * transportation allowance. can i add the gross with 0?"): the law's trainee is paid (Art. 1(2): "لقاء أجر", the last
 * stage at least the minimum wage, Art. 29), so the owner chose a type of its own, outside the labour law like freelance:
 * Intern, whose internship agreement pays no wage, only allowances (the transportation allowance), with no leave and no
 * company social insurance. Trainee stays for paid trainees under the law.
 */
export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'trainee', 'intern', 'freelance'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

/**
 * Whether an employment type is under the labour law: all but freelance (Art. 1(1)) and the unpaid internship (owner,
 * 19 October 2026: outside the law, since the law's trainee is paid); see EMPLOYMENT_TYPES.
 */
export const underLabourLaw = (type: EmploymentType | string): boolean => type !== 'freelance' && type !== 'intern';

export const EMPLOYEE_STATUSES = ['active', 'probation', 'on_leave', 'notice_period', 'resigned', 'terminated'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

/**
 * The statuses HR chooses, for a current employment that has one of them. Probation and Notice period are the system's
 * (a new employment's probation, Confirm probation, an approved ending) and Resigned and Terminated come from ending it
 * (owner's decision, 16 October 2026).
 */
export const CHOSEN_STATUSES = ['active', 'on_leave'] as const satisfies readonly EmployeeStatus[];
export type ChosenStatus = (typeof CHOSEN_STATUSES)[number];

export const WORK_ARRANGEMENTS = ['office', 'outdoor', 'indoor_outdoor', 'hybrid', 'wfh'] as const;
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
  employmentType: {
    full_time: 'Full-time',
    part_time: 'Part-time',
    trainee: 'Trainee',
    intern: 'Unpaid internship (outside the labour law)',
    freelance: 'Freelance (outside the labour law)',
  },
  status: {
    active: 'Active',
    probation: 'Probation',
    on_leave: 'On leave',
    notice_period: 'Notice period',
    resigned: 'Resigned',
    terminated: 'Terminated',
  },
  workArrangement: {
    office: 'Indoor (office)',
    outdoor: 'Outdoor (field work)',
    indoor_outdoor: 'Indoor and outdoor',
    hybrid: 'Hybrid (office and home)',
    wfh: 'Work from home',
  },
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

/**
 * The work arrangements in Arabic, as an Arabic document prints them ({{work_arrangement_ar}}: owner's request, 15
 * October 2026); the screens show LABELS.workArrangement.
 */
export const WORK_ARRANGEMENT_LABELS_AR: Record<WorkArrangement, string> = {
  office: 'داخل المكتب',
  outdoor: 'ميداني (خارج المكتب)',
  indoor_outdoor: 'داخل المكتب وخارجه',
  hybrid: 'هجين (المكتب والمنزل)',
  wfh: 'العمل من المنزل',
};

/**
 * The employment types in Arabic, as an Arabic document prints them ({{employment_type_ar}}); the screens show
 * LABELS.employmentType. Part-time in the law's words, "العمل بعض الوقت" (Art. 96(2)); the trainee "المتدرج" (Art. 1(2)).
 */
export const EMPLOYMENT_TYPE_LABELS_AR: Record<EmploymentType, string> = {
  full_time: 'دوام كامل',
  part_time: 'عمل بعض الوقت',
  trainee: 'متدرج',
  intern: 'تدريب غير مدفوع (غير خاضع لقانون العمل)',
  freelance: 'عمل حر (غير خاضع لقانون العمل)',
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
  'insurance_print', // برنت التأمينات: the social insurance statement of the person's insured periods (owner, 15 October 2026)
  'personal_photo',
  'syndicate_card', // كارنيه النقابة, for members of a professional syndicate: optional, never on the checklist
  // the employee's signed consent to a recurring deduction (Labour Law 14/2025 Art. 114: "أن تصدر به موافقة مكتوبة من
  // العامل"; owner, 18 October 2026, after reading the law: "record the consent"): attached on Recurring Deductions,
  // optional, never on the checklist
  'deduction_consent',
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
  insurance_print: 'Social insurance print',
  personal_photo: 'Personal photo',
  syndicate_card: 'Syndicate card',
  deduction_consent: 'Deduction consent (signed)',
  other: 'Other document',
};

/** Restricted like the national ID itself: HR and CEO only. */
export const RESTRICTED_PAPERWORK: readonly PaperworkKind[] = ['national_id_front', 'national_id_back'];

/**
 * The scans an employee's file needs (spec §8.5), by employment type (see paperworkType). Full-time: the full list;
 * military papers for men only (a woman's military status is always Not applicable). Other employment types: the
 * national ID (their signed job offer and NDA come from document generation). While the gender is not recorded,
 * military papers are listed as needed. Someone not employed yet (null) needs the full-time list: HR collects the
 * papers before the start date, and full time is the usual hire (owner, 15 October 2026). The social insurance print
 * is on the full-time list too (owner, 15 October 2026).
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
    'insurance_print',
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

/**
 * Why an employment ended. Resigned gives the status Resigned; the others give Terminated. Training completed (owner,
 * 19 October 2026: "interns to be labeled trainees instead of probation and their contracts are never renewed"): a
 * trainee's training agreement, or an intern's internship agreement, that ended with its term (Labour Law Arts. 28–30),
 * in Arabic "انتهاء التدرج".
 */
export const END_REASONS = ['resigned', 'terminated', 'contract_ended', 'training_completed', 'mutual_agreement', 'retired', 'deceased', 'disability', 'other'] as const;
export type EndReason = (typeof END_REASONS)[number];

export const END_REASON_LABELS: Record<EndReason, string> = {
  resigned: 'Resigned',
  terminated: 'Terminated',
  contract_ended: 'Contract ended',
  training_completed: 'Training completed',
  mutual_agreement: 'Mutual agreement',
  retired: 'Retired',
  deceased: 'Deceased',
  disability: 'Disability',
  other: 'Other',
};

/**
 * Where someone stands, for the directory: their current employment's status, or no current employment. A trainee
 * stands as Trainee and an intern as Intern rather than Probation or Active (owner, 19 October 2026: "interns to be
 * labeled trainees instead of probation"): a training or internship agreement has no probation, the probation of Labour
 * Law Art. 90 being an employment contract's. On leave and Notice period still show when they apply (employmentStanding).
 */
export const STANDINGS = ['active', 'probation', 'trainee', 'intern', 'on_leave', 'notice_period', 'former', 'not_employed'] as const;
export type Standing = (typeof STANDINGS)[number];

export const STANDING_LABELS: Record<Standing, string> = {
  active: 'Active',
  probation: 'Probation',
  trainee: 'Trainee',
  intern: 'Intern',
  on_leave: 'On leave',
  notice_period: 'Notice period',
  former: 'Former employee',
  not_employed: 'Not employed yet',
};

/**
 * Where someone with a current employment stands: its status, except that a trainee's or an intern's Active (or a
 * Probation from before 19 October 2026) is Trainee or Intern; On leave and Notice period show as they are.
 */
export function employmentStanding(e: { status: EmployeeStatus | string; employmentType: EmploymentType | string }): Standing {
  if ((e.employmentType === 'trainee' || e.employmentType === 'intern') && (e.status === 'active' || e.status === 'probation')) return e.employmentType;
  return e.status as Standing;
}

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

// ---------- document templates ----------

export * from './templates.js';

// ---------- salary: gross to net ----------

export * from './salary.js';

// ---------- the rates set by law, by year (Organization → Payroll) ----------

export * from './law-rates.js';

// job offers: statuses, how long an offer stays open, the template slot of each employment type
export * from './offers.js';

// PDF templates: an official form uploaded as a PDF, with its fields placed on it
export * from './pdf-fields.js';

// the social insurance occupation codes (Form 1's كود المهنة), each employee's own
export * from './occupations.js';

// nationalities in Arabic, in the person's gender, for the Arabic documents
export * from './nationalities.js';

// monthly payroll: a line worked out from the contract, the profile and the month's inputs
export * from './payroll.js';

// attendance's rules, for the attendance module: the most hours counted a day
export * from './attendance.js';

// the square of the personal photo shown in the circle beside the name
export * from './photo-crop.js';

// pay raises during a contract, renewals with new pay and raise requests: the ways, the CEO's step, the insured wage
export * from './raises.js';

// an employment's salary history: its pay events and the summary
export * from './salary-history.js';

// the company-wide Salary Raises report: the raises in a period, their totals, by department, and who is due for review
export * from './salary-raises.js';

// one-off additions and deductions on a month's pay, advances and loans, final settlements and held pay: Unsettled
export * from './payroll-adjustments.js';

// payroll statistics: what the approved runs paid and cost, by month, department and team, and this year to date
export * from './payroll-statistics.js';

// reimbursement claims: the types HR sets up (caps, receipt, deadline, who may claim), the claim's statuses and steps
export * from './reimbursements.js';

// installments of advances and loans made at once, recurring deductions (e.g. a medical share), and the Labour Law's
// limits on them: 10% of the wage for installments, 25% for other deductions, 5 days' wage for damage
export * from './installments.js';

// employment types by the labour law (owner, 18 October 2026): the nature of the work (temporary, casual, seasonal),
// remote work, the trainee's training stages, and when a fixed-term contract has become open-ended (Art. 88)
export * from './employment-types.js';

// leave (Labour Law 14/2025, Arts. 54–57 and 124–133): the law's leave types, the annual leave's days, counting a leave's
// days, the requests' statuses and steps, their problems, Year Closing, and the month's leave days for the payroll
export * from './leaves.js';

// leave coverage (owner, 25 October 2026: "if there are leaves applied by an employee and another employee in the same
// department is on a leave, how can we manage it without affecting the workflow?"; asked, "Warn and need HR", "Required
// over 2 days", "To a stand-in", "Names, no leave types"): who else is off, a team's staffing limit, the colleague who
// covers, and the stand-in who approves while an approver is away
export * from './leave-coverage.js';

// department heads and team leads (owner, 19 October 2026: "i want to add department lead person, the person in
// charge"): what they are called, the default direct manager when hiring, and who approves when there is no manager
export * from './department-leads.js';

// C-level people kept from HR (owner, 19 October 2026: "make C level Employees details not visible to HR"): who sees
// them (the CEO, the Super Admin, the person themself), who decides their requests' HR stages and fills their payroll
// lines (the CEO), and what the screens say of those left out
export * from './confidential.js';

// permission (owner, 19 October 2026: "this is an option given by us .. 4 hours per month with a maximum 2 hours per
// day", asked "In the system, like leave"): its Leave Setup limits, a request's problems, and the month's hours the
// payroll counts as worked
export * from './permissions.js';

// attendance from Zoho People (owner, 19 October 2026: "Import Zoho now, replace it later"): office or remote by the
// check-in's address, people matched by name (and their Zoho ID once confirmed), and a person's month by the system's
// shift, leave, holidays and permission: the hours counted, the absent days, the permission hours
export * from './attendance-import.js';

// the Attendance section (owner, 19 October 2026: "the attendance is not active in the side menu"): the days kept from
// the imports read back for HR, the CEO and Finance, a manager's team and an employee's own month: a day's short hours
// and missing check-out, a month's figures, Daily Attendance's filters, the Summary's period and its rows by department
// and team
export * from './attendance-days.js';

// checking in on the system (owner, 19 October 2026: "Check-in through the system (phone or web with the office location
// check, or a device) to replace Zoho"): the office's point and radius, office, remote or unknown, the rules by work
// arrangement and their flags, punches made a day, who checks in, and where a day came from (a device's later)
export * from './check-in.js';

// attendance corrections (owner, 19 October 2026: "Attendance corrections with approval ("I forgot to check out")"): what
// was wrong with a day, the checks, the day a correction makes (the day it corrects kept), and when it can be applied
export * from './attendance-corrections.js';

// sessions kept on the server (owner, 20 October 2026: "make any admin or HR session to be valid for 15 minutes inactive,
// then session to be terminated; only 1 active session per user online and 1 active mobile session"): the website and
// the app's kinds, why one ends, the 15 minutes for HR, Admin and Super Admin, and the sign-in page's words
export * from './sessions.js';

// fingerprint sign-in in the app (owner, 20 October 2026: "Sign-in: Face ID / fingerprint after the first password
// sign-in"): the phones, why a credential stops working, the 90 days without use, and the refused sign-in's words
export * from './device-credentials.js';

// check-ins locked to the office network (owner, 20 October 2026: "allow me to lock checkin's to wifi name or ip,
// whatever is right"): IP addresses and ranges, the office's networks, who is locked (Office staff, unless HR lets them
// check in from anywhere), and the address the website signs for the API
export * from './office-network.js';

// where each press was (owner, 20 October 2026: "simplify this, i want to view if it is remote or office, and location
// link"; "Yes, keep the spot"): the point kept, who sees it (HR, the CEO, the Super Admin and the employee), and the
// switch refusing presses without a location, with its exemption and the office network ("Allow as Office")
export * from './punch-location.js';

// home locations (owner, 20 October 2026: "allow other users to request to add their home locations when working from
// home"; "Label Home, flag elsewhere", HR then the CEO): asked by anyone, decided by HR then the CEO, one approved a
// person, its point kept only while decided or in force, and who sees and decides each
export * from './home-locations.js';

// notifications (owner, 20 October 2026: "Push notifications: yes (decisions, things waiting for someone, a check-in
// reminder)"): what each one is about, the inbox's page, the two reminders and the person's switches, the phones' push
// tokens and the Android channel
export * from './notifications.js';

// the main office and its sub-locations (owner, 20 October 2026: "main office location is the hero and other locations
// are like sub locations. shown with their name and linked users"; "(Remote - Location name)"): where a press was read in
// order, a sub-location's people, its words, and the office network's lock waived at one's own sub-location
export * from './sub-locations.js';

// KPIs (owner, 21 October 2026: "lets start with the KPI's First"): the four pillars and their weights, the levels, the
// templates' metrics and criteria, scoring (capped at 110%), the automatic Attendance metric, the scorecard's steps
// (self-rating, the manager, HR's calibration, the sign-off), its deadlines and reminders, who scores, the payroll's
// KPI (last month's final %, in full at 80% or more), the three sample templates, and the API's views
export * from './kpis.js';

// the KPI role library (owner, 21 October 2026: "can you add templetes for all departments and job roles"): templates
// for an agency's roles, a general one per kind of department and a universal one; matching a job title to one (its
// title, then its department), the leadership metric for those who lead people, and linking metrics to the JD's duties
export * from './kpi-library.js';

// the KPI framework (owner, 21 October 2026: "am i able to edit the pillars of the KPIs?", "Fully flexible"): pillars
// HR adds, removes, renames and weighs (1 to 8, adding up to 100%) and the Attendance metric's pillar, from next month;
// templates placing their metrics in them by name, the old pillars kept by the versions published with them
export * from './kpi-framework.js';

// practice KPI scorecards (owner, 22 October 2026: "i want to test the KPI's .. and it is locked to dates, HR and
// Admin.. how?", "Practice scorecards"): started by HR or a Super Admin for anyone and any month, from a draft or a
// published version; no deadline holds a step back; its starter or a Super Admin stands in for each step, or a Super
// Admin views as the person; marked Practice everywhere, never in payroll, the reports, the exports or a notification
export * from './kpi-practice.js';

// Assets (owner, 21 October 2026: "i want to add this module with a special permission to the system"; "use the main ERP
// system specs .. dont stick to the MD file"): the Assets access per user (none, viewer, custodian, manager; a Super Admin
// always a manager) and the values rule ("CEO and Finance"), the five groups, the type codes, the statuses and conditions,
// the asset, kit and custody codes, the book value, the fields each group shows, the status rules and the API's answers
export * from './assets.js';

// importing leave in bulk (owner, 21 October 2026: "how to import bulk leaves?", "Both" and "Our Excel template"; Zoho
// People's leave export too, and "make sure there will be no duplicates from the previous imported files"): the template's
// sheets, reading a cell's text and Zoho's columns, matching people, a row's checks and statuses, and the review's words
export * from './leave-import.js';

// working from home (owner, 21 October 2026: "think about how should we handle the working from home in out erp"): a
// working day in another place, not leave; "Manager, then HR", "its 2 days per month with a gap of 1 week between each
// record (Biweekly)" and "A day before"; who needs it by work arrangement, the limits in Leave Setup, HR recording one
export * from './wfh.js';

// the Claude connector (owner, 21 October 2026: "the connection method" / "option a"): a remote MCP server on the website
// with its OAuth sign-in, scoped to Assets: the addresses, the scope, the lifetimes, Claude's return addresses, the
// sign-in request's checks, the consent page's words, the tools and the API's answers
export * from './connector.js';

// Assets, step 2: the drafts from Claude (never an asset until a person confirms one) and what the connector reads
// besides the register: who holds what, overdue returns, stock levels and the counts due
export * from './asset-drafts.js';

// the product images Claude adds to a draft from a link (owner, 21 October 2026: "let the mcp connector fetch the
// product photo and add it / yes build it"): at most 3, each marked as the maker's image, checked by its bytes
export * from './product-images.js';

// Assets, step 3: custody (owner, 21 October 2026: "Yes, My custody"; "Record it; HR decides a deduction"): shoots and
// long-term assignments on CUS-0042 records, received back good, damaged or missing, overdue and not signed, the terms
// printed on the form, the kit quick-add, what each person holds, an asset's repairs and its lost and found
export * from './custody.js';

// Assets, step 4: accessories (owner, 22 October 2026: "we might need to add accessories under assets, like laptop
// charger under the charger, DJI ronin accessories"; "Both kinds"): a checklist on an asset ticked at handover and return,
// and assets attached to a main one that go out with it; then the kits' items and status, stock moves, the maintenance
// log by hand and disposal (spec §6.9)
export * from './asset-accessories.js';
export * from './asset-upkeep.js';

// Assets, step 5 (owner, 22 October 2026: "Assets step 5 (stock counts, label sheets, the Assets dashboard, exports) …
// work on this"): counts by group, room or kit (found, missing, out; a lost one found is available again; Mark lost
// apart), the A4 label sheets of 3 × 8, the dashboard's figures and chips, and the Excel exports
export * from './asset-counts.js';

// the contract status the Employees list shows in place of the employee code (owner, 21 October 2026: "instead of the
// Emp code, add contract status"; "State + end date"): signed and when it ends, the probation, a draft, the notice of an
// approved ending, ended, none, the agreements of trainees and interns, freelance; an end within 30 days in amber
export * from './contract-status.js';

// offboarding (owner, 21 October 2026: "when an employee resigns or contract ends with no renewal, where will the data be
// stored? will it be another tab?"; 22 October 2026, the full module): a case per ending employment, its clearance
// checklist (HR's defaults, Assets returned and Final settlement paid ticked by the system), the exit interview, rehire
// eligibility, the turnover's figures and the API's answers
export * from './offboarding.js';

// recruitment, the ATS (owner, 22 October 2026: "where will we include the ATS?"; Phase 1): vacancies approved by the CEO,
// the public careers page with its application form, screening questions with must-haves and match points, and the
// applicants' stages up to the job offer
export * from './recruitment.js';

// recruitment, Phase 2 (owner, 22 October 2026: "where will we include the ATS?"; "interview invites go by email through
// the owner's SMTP settings"): the pipeline board, interviews with their calendar invitations, the interviewers' and the
// hiring manager's feedback, the rejection email and the analytics; onboarding, offboarding's mirror
export * from './recruitment-hiring.js';

// General CVs and the applicants by posted job (owner, 22 October 2026: "i want a proper viweing, what came out of the
// posted jobs and what cam on randomly"; "Both"): "Send us your CV" on the careers page, the CVs HR adds, moving one to
// a vacancy, each vacancy's applicants by source, and the bulk upload of CVs ("is there a way to easy apply from
// linkedin?" … "why not")
export * from './general-cvs.js';

// CV reading and its simple rules (owner, 22 October 2026: "make the OCR egine reads the CV and analyse it", "Built-in
// rules only"): the reading's status, what the rules find (contacts, years, education, languages) and a vacancy's key
// skills (the CV match %)
export * from './cv-analysis.js';
// the skills every CV is looked through for (owner, 24 October 2026: "CV years in list + more rules"), in a file HR can
// later edit
export * from './skills-dictionary.js';
export * from './onboarding.js';

// the Developer role (owner, 22 October 2026: "i want to create a role for develoeprs, not showing the real numbers"):
// read only, money and personal IDs masked by the API
export * from './developer.js';

// every active employee gets access (owner, 22 October 2026: "any active employee with active contract should have
// access"): the account linked to the employee, made automatically, its first password by a set-password link, managed
// on the profile's Access tab
export * from './employee-access.js';

// a developer who is also an employee chooses at sign-in, and switches later, between using the system as themselves and
// as a developer (owner, 22 October 2026: "when a developer signin, give hin a switched to use the account as the main
// role assigned to him or as a developer, to not confuse him"): kept on the session
export * from './session-modes.js';

// candidate profiles (owner, 22 October 2026: "how to make like a profile for each candidate to store history and prevent
// duplication? even if the same candidate applied for 2 jobs"; "Email or mobile", "Link and show rehire"; "HR decides
// from suggested match"): one profile per person, CAN-0001, joined by the same email or mobile, the other signs only
// suggested to HR, a former employee linked with their rehire eligibility
export * from './candidates.js';

// the company's email (SMTP) set up in the system (owner, 23 October 2026: "why dont we add SMTP setup in the
// organization setup"): Organization → Email Settings, a Super Admin's only; the server's deploy/.env the fallback
export * from './mail-settings.js';

// official duty, OD (owner, 23 October 2026: "Official duty (OD) requests. The plan has OD as a third attendance mode
// beside Office and WFH, needing an approved request"; asked, "Manager, then HR", "Ahead or up to 3 days after", "Check in
// from anywhere"): the request's checks, its days and hours, and how an approved one counts in the attendance
export * from './official-duty.js';

// a person's attendance history on their profile (owner, 23 October 2026: "Attendance history on the profile. Since
// joining: on-time %, average check-in time, late days by weekday and trends; an Excel export"; "HR, CEO and Finance
// only"): the periods, each day of the log, the figures, the on-time trend, the check-in times and late days by weekday
export * from './attendance-history.js';

// Google Maps for every map (owner, 24 October 2026, on Check-in Setup's map: "is there another map provider?", then
// "Google Maps"): the browser key a Super Admin pastes on Check-in Setup, how it is shown, and who receives it
export * from './maps-settings.js';

// online interview meetings made by the system (owner, 24 October 2026: "can i link an online meeting service provider to
// automatically generate meeting links?"; asked, "Google Meet, Microsoft Teams, Zoom", hosted "both" ways: a company
// account a Super Admin connects once, and each HR person's own): the providers, the scopes, the choices, the views
export * from './meetings.js';

// screening comments with a verdict (owner, 24 October 2026, on a candidate's profile: "is there a way to add screening
// comments?", "and i can add genearrl comments"; asked, "Yes: Good fit / Maybe / Not a fit" and "HR + hiring manager &
// interviewers"): on an application, a general CV or the person in general, @mentions that notify, the latest verdict
// as a badge and a filter; HR's single notes box of before moved into them
export * from './screening.js';

// Suggested From Earlier CVs on each open vacancy (owner, 24 October 2026: "does the system automatically add recomended
// general cv's to the opened posts?"; asked, "Suggest; HR adds", "General CVs + past applicants", "Yes, HR presses
// 'Invite to apply'"): the pool and its exclusions, the score and its reasons, the invitation's words, the views
export * from './suggested-cvs.js';

// Office staff's check-ins locked to the check-in locations by GPS (owner, 24 October 2026: "Yes, add a GPS lock too"):
// the switch and its accuracy allowance, a press's verdict (inside a circle, too rough, no location), the two locks
// together (either passing is enough), and the words of the refusals
export * from './gps-lock.js';

// WhatsApp notifications (owner, 24 October 2026: "how to make whatsapp notifications?"; asked, "Employees and
// candidates", "Approvals waiting, Request decisions, Check-in reminders, Interviews", "Directly to Meta"): one more
// channel beside the bell, push and email, for those who opt in, with Meta's approved templates in English and Arabic
export * from './whatsapp.js';

// Twilio as a second way to send them (owner, 25 October 2026: "Add Twilio as a choice"; "No, WhatsApp only"): the same
// templates as Twilio Content, the requests' parts, the sender, the settings' checks and the owner's steps in Twilio
export * from './whatsapp-twilio.js';

// people exempt from check-in (owner, 25 October 2026: "allow me to select people that are not eligable for attendance
// checkins and outs, trat them as if they achived their full working hours"; asked, "Optional check-in" and "Profile + a
// list in Check-in Setup"): the dated periods, what an exempt day counts, and the checks of adding and ending one
export * from './check-in-exemptions.js';
