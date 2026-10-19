// Values shared by the web app and the API.
// Source of truth: the enums in trendlix-hrms-handoff/db/schema.sql.

/**
 * Super Admin sits above Admin: it can do everything an Admin can, and it is the only role that deletes records
 * (owner's decision, 15 October 2026). It does not bring the HR, CEO, Finance or manager powers: someone who needs
 * those holds those roles too.
 */
export const ROLES = ['employee', 'manager', 'hr', 'finance', 'ceo', 'admin', 'super_admin'] as const;
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

// department heads and team leads (owner, 19 October 2026: "i want to add department lead person, the person in
// charge"): what they are called, the default direct manager when hiring, and who approves when there is no manager
export * from './department-leads.js';

// C-level people kept from HR (owner, 19 October 2026: "make C level Employees details not visible to HR"): who sees
// them (the CEO, the Super Admin, the person themself), who decides their requests' HR stages and fills their payroll
// lines (the CEO), and what the screens say of those left out
export * from './confidential.js';
