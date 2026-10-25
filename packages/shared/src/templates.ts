// Document templates (spec §8): HR uploads each Word file exactly as used today, with merge tags such as
// {{full_name_ar}} where the data goes; the system only replaces the tags, never the wording. The slots and the tag
// dictionary come from the handoff pack (config/document-rules.json, config/field-dictionary.json), with the owner's
// additions of 15 October 2026: the bank account letter and the social insurance forms are generated from templates,
// and contracts carry the insurance number (Labour Law 14/2025 Art. 89).

import type { EmploymentType } from './index.js';

/** Where a template is filed in the library. */
export const TEMPLATE_FOLDERS = ['contracts', 'job_offers', 'nda', 'certificates', 'letters', 'social_insurance', 'payslips', 'resignation'] as const;
export type TemplateFolder = (typeof TEMPLATE_FOLDERS)[number];
export const TEMPLATE_FOLDER_LABELS: Record<TemplateFolder, string> = {
  contracts: 'Contracts',
  job_offers: 'Job Offers',
  nda: 'NDA',
  certificates: 'Certificates',
  letters: 'Letters',
  social_insurance: 'Social Insurance',
  payslips: 'Payslips',
  resignation: 'Resignation',
};

/** When a document is offered for an employee. */
export const TEMPLATE_TRIGGERS = [
  'offer_stage',
  'on_hire',
  'renewal',
  'on_request',
  'monthly_payroll',
  'resignation_recorded',
  'last_working_day',
  'end_of_service',
  'end_of_internship',
  'raise',
] as const;
export type TemplateTrigger = (typeof TEMPLATE_TRIGGERS)[number];
export const TEMPLATE_TRIGGER_LABELS: Record<TemplateTrigger, string> = {
  offer_stage: 'At the offer stage',
  on_hire: 'On hiring',
  renewal: 'On renewal',
  on_request: 'On request',
  monthly_payroll: 'Each month, from payroll',
  resignation_recorded: 'When a resignation is recorded',
  last_working_day: 'On the last working day',
  end_of_service: 'At the end of service',
  end_of_internship: 'At the end of the training',
  raise: 'On a raise',
};

/**
 * A template's language. A bilingual one (owner's NDA, 15 October 2026) has both side by side: its tags that depend on
 * the language print in Arabic, and their _ar and _en forms ({{job_title_en}} …) print the language they name.
 */
export const TEMPLATE_LANGUAGES = ['ar', 'en', 'bilingual'] as const;
export type TemplateLanguage = (typeof TEMPLATE_LANGUAGES)[number];

/** Who signs the printed document. */
export const TEMPLATE_SIGNERS = ['both', 'employee', 'company', 'none'] as const;
export type TemplateSigners = (typeof TEMPLATE_SIGNERS)[number];

const ALL: readonly EmploymentType[] = ['full_time', 'part_time', 'trainee', 'intern', 'freelance'];

export interface TemplateSlot {
  key: string;
  name: string;
  folder: TemplateFolder;
  /** The language when known; null: set when the file is uploaded. */
  language: TemplateLanguage | null;
  appliesTo: readonly EmploymentType[];
  triggers: readonly TemplateTrigger[];
  signers: TemplateSigners;
  /** A second printed copy of another slot's file, with no file of its own (no slot uses this today). */
  copyOf?: string;
  /** Tags that read another value on this document (tag → the tag whose value it takes), e.g. the insured salary. */
  overrides?: Readonly<Record<string, string>>;
  /**
   * For a full-time employment or offer paid by commission (the Sales slots, since 18 October 2026): chosen for one
   * when a version is published, else the full-time slot is (contractSlotKeys, offerSlotKeys).
   */
  paidByCommission?: boolean;
}

/** The template library: one slot per document. */
export const TEMPLATE_SLOTS: readonly TemplateSlot[] = [
  { key: 'contract_full_time', name: 'Contract · Full-time (official copy)', folder: 'contracts', language: 'ar', appliesTo: ['full_time'], triggers: ['on_hire', 'renewal'], signers: 'both' },
  // its own file: the owner's Word file holds both copies one after the other, worded differently (the official copy
  // has the 80/20 split and two weeks' probation notice, this one neither and one week), so HR uploads copy 2 here
  {
    key: 'contract_full_time_insurance',
    name: 'Contract · Full-time (social insurance copy)',
    folder: 'contracts',
    language: 'ar',
    appliesTo: ['full_time'],
    triggers: ['on_hire', 'renewal'],
    signers: 'both',
    // its term is the subscription year (owner, 25 October 2026: "for the insurance, take the insurance start date make it
    // for 1 year"; asked, "Anniversary year"): insurance_year_start, _end and _duration in place of the contract's
    overrides: {
      gross_salary: 'insured_salary',
      gross_salary_words: 'insured_salary_words',
      gross_salary_words_en: 'insured_salary_words_en',
      start_date: 'insurance_year_start',
      end_date: 'insurance_year_end',
      duration: 'insurance_year_duration',
    },
  },
  { key: 'contract_part_time', name: 'Contract · Part-time', folder: 'contracts', language: null, appliesTo: ['part_time'], triggers: ['on_hire', 'renewal'], signers: 'both' },
  // employment types by the labour law (owner, 18 October 2026): every slot keeps its key, so the templates uploaded
  // keep working. Internship became Trainee, whose contract is the training agreement (Labour Law 14/2025 Art. 29: "يجب
  // أن يكون اتفاق التدرج مكتوبا"); Sales became Full-time paid by commission, its slots chosen for one (paidByCommission);
  // a freelancer, outside the labour law, signs a service agreement rather than an employment contract. The unpaid
  // internship (owner, 19 October 2026: an intern is paid no wage, only the transportation allowance): the owner's
  // internship slots were written for these interns, so they are the intern's again, and the paid trainee's training
  // agreement and offer have slots of their own; an agreement renewed once has its document again
  {
    key: 'contract_internship',
    name: 'Internship agreement · Unpaid internship',
    folder: 'contracts',
    language: null,
    appliesTo: ['intern'],
    triggers: ['on_hire', 'renewal'],
    signers: 'both',
  },
  { key: 'contract_trainee', name: 'Training agreement · Trainee', folder: 'contracts', language: null, appliesTo: ['trainee'], triggers: ['on_hire', 'renewal'], signers: 'both' },
  {
    key: 'contract_sales',
    name: 'Contract · Full-time, paid by commission',
    folder: 'contracts',
    language: null,
    appliesTo: ['full_time'],
    triggers: ['on_hire', 'renewal'],
    signers: 'both',
    paidByCommission: true,
  },
  { key: 'agreement_freelance', name: 'Service agreement · Freelance (outside the labour law)', folder: 'contracts', language: null, appliesTo: ['freelance'], triggers: ['on_hire'], signers: 'both' },
  // a raise by amendment (owner's decision, 16 October 2026): the new pay on the same contract, signed as a letter
  // added to it instead of a whole contract, for an amendment the CEO approved; its language set when it is uploaded
  { key: 'contract_amendment', name: 'Salary amendment (ملحق عقد)', folder: 'contracts', language: null, appliesTo: ALL, triggers: ['raise'], signers: 'both' },
  { key: 'offer_full_time', name: 'Job offer · Full-time', folder: 'job_offers', language: null, appliesTo: ['full_time'], triggers: ['offer_stage'], signers: 'both' },
  { key: 'offer_part_time', name: 'Job offer · Part-time', folder: 'job_offers', language: null, appliesTo: ['part_time'], triggers: ['offer_stage'], signers: 'both' },
  { key: 'offer_freelance', name: 'Job offer · Freelance', folder: 'job_offers', language: null, appliesTo: ['freelance'], triggers: ['offer_stage'], signers: 'both' },
  { key: 'offer_internship', name: 'Job offer · Unpaid internship', folder: 'job_offers', language: null, appliesTo: ['intern'], triggers: ['offer_stage'], signers: 'both' },
  { key: 'offer_trainee', name: 'Job offer · Trainee', folder: 'job_offers', language: null, appliesTo: ['trainee'], triggers: ['offer_stage'], signers: 'both' },
  {
    key: 'offer_sales',
    name: 'Job offer · Full-time, paid by commission',
    folder: 'job_offers',
    language: null,
    appliesTo: ['full_time'],
    triggers: ['offer_stage'],
    signers: 'both',
    paidByCommission: true,
  },
  { key: 'nda', name: 'NDA', folder: 'nda', language: null, appliesTo: ALL, triggers: ['on_hire'], signers: 'both' },
  { key: 'cert_experience', name: 'Experience certificate', folder: 'certificates', language: null, appliesTo: ALL, triggers: ['end_of_service', 'on_request'], signers: 'company' },
  { key: 'cert_internship', name: 'Internship or training certificate', folder: 'certificates', language: null, appliesTo: ['trainee', 'intern'], triggers: ['end_of_internship'], signers: 'company' },
  { key: 'hr_letter_en', name: 'HR letter · English', folder: 'letters', language: 'en', appliesTo: ALL, triggers: ['on_request'], signers: 'company' },
  { key: 'hr_letter_ar', name: 'HR letter · Arabic', folder: 'letters', language: 'ar', appliesTo: ALL, triggers: ['on_request'], signers: 'company' },
  { key: 'bank_letter', name: 'Bank account letter', folder: 'letters', language: null, appliesTo: ALL, triggers: ['on_hire', 'on_request'], signers: 'company' },
  { key: 'insurance_form_1', name: 'Social insurance Form 1 (joining)', folder: 'social_insurance', language: 'ar', appliesTo: ['full_time'], triggers: ['on_hire'], signers: 'both' },
  // the wage change after a raise (owner's decision, 16 October 2026: "From the next January unless amended in Form 2"):
  // generated from an approved raise, and HR records on the raise the date it changes the insured wage from
  { key: 'insurance_form_2', name: 'Social insurance Form 2 (wage change)', folder: 'social_insurance', language: 'ar', appliesTo: ['full_time'], triggers: ['raise'], signers: 'company' },
  { key: 'insurance_form_6', name: 'Social insurance Form 6 (leaving)', folder: 'social_insurance', language: 'ar', appliesTo: ['full_time'], triggers: ['end_of_service'], signers: 'both' },
  { key: 'payslip_en', name: 'Payslip · English', folder: 'payslips', language: 'en', appliesTo: ALL, triggers: ['monthly_payroll', 'on_request'], signers: 'none' },
  { key: 'payslip_ar', name: 'Payslip · Arabic', folder: 'payslips', language: 'ar', appliesTo: ALL, triggers: ['monthly_payroll', 'on_request'], signers: 'none' },
  { key: 'resignation_request', name: 'Resignation request (طلب استقالة)', folder: 'resignation', language: 'ar', appliesTo: ALL, triggers: ['resignation_recorded'], signers: 'employee' },
  { key: 'clearance_dues', name: 'Clearance and dues (إقرار إخلاء طرف واستلام مستحقات)', folder: 'resignation', language: 'ar', appliesTo: ALL, triggers: ['last_working_day'], signers: 'both' },
];

/**
 * The commission slots and the full-time slot each stands in for (owner, 18 October 2026: Sales became Full-time paid by
 * commission): a full-time employment or offer paid by commission is given the commission slot when it has a published
 * version, else the full-time slot; one not paid by commission the full-time slot only.
 */
export const COMMISSION_SLOTS: Readonly<Record<string, string>> = { contract_sales: 'contract_full_time', offer_sales: 'offer_full_time' };

/**
 * Whether a slot is chosen by the pay (see COMMISSION_SLOTS): a commission slot for one paid by commission when
 * `published(it)`; the full-time slot it stands in for unless that one is; every other slot always (its employment
 * types are checked apart).
 */
export function slotChosenByPay(slotKey: string, paidByCommission: boolean, published: (slotKey: string) => boolean): boolean {
  if (COMMISSION_SLOTS[slotKey]) return paidByCommission && published(slotKey);
  const commission = Object.keys(COMMISSION_SLOTS).find((k) => COMMISSION_SLOTS[k] === slotKey);
  return !(commission && paidByCommission && published(commission));
}

/** The groups the tags are listed in. */
export const TAG_GROUPS = ['employee', 'national_id', 'job_contract', 'pay', 'raise', 'offer', 'bank', 'ending', 'letters', 'payslip', 'company', 'auto'] as const;
export type TagGroup = (typeof TAG_GROUPS)[number];
export const TAG_GROUP_LABELS: Record<TagGroup, string> = {
  employee: 'Employee',
  national_id: 'National ID',
  job_contract: 'Job and contract',
  pay: 'Pay',
  raise: 'Raise',
  offer: 'Job offer',
  bank: 'Bank',
  ending: 'Resignation and ending',
  letters: 'Letters and certificates',
  payslip: 'Payslip',
  company: 'Company',
  auto: 'Dates',
};

export interface TemplateTag {
  tag: string;
  group: TagGroup;
  labelEn: string;
  labelAr: string;
  /** Where the value comes from, for HR (not code). */
  source: string;
  /** Restricted data (national ID, salary, bank): only those who may see it can generate a document with it. */
  restricted?: boolean;
  note?: string;
}

/** The tags a template may use; any other {{tag}} stops a version from being published. */
export const TEMPLATE_TAGS: readonly TemplateTag[] = [
  { tag: 'employee_code', group: 'employee', labelEn: 'Employee code', labelAr: 'كود الموظف', source: 'Profile' },
  { tag: 'full_name_ar', group: 'employee', labelEn: 'Full name (Arabic)', labelAr: 'الاسم الكامل بالعربي', source: 'Profile' },
  { tag: 'full_name_en', group: 'employee', labelEn: 'Full name (English)', labelAr: 'الاسم بالإنجليزية', source: 'Profile' },
  { tag: 'display_name', group: 'employee', labelEn: 'Display name', labelAr: 'الاسم المختصر', source: 'Profile' },
  // how an Arabic document addresses the person (owner, 22 October 2026: "if male = السيد / if female = السيدة"; "if no
  // gender leave blank"): from the profile's gender, nothing printed without one (it never stops a document)
  { tag: 'title_ar', group: 'employee', labelEn: 'Mr / Ms (Arabic)', labelAr: 'السيد / السيدة', source: 'Profile: gender', note: 'السيد or السيدة; blank without a gender' },
  // in the template's language (owner, 16 October 2026: Form 1 printed "Egyptian"): in Arabic, in the person's gender
  { tag: 'nationality', group: 'employee', labelEn: 'Nationality', labelAr: 'الجنسية', source: 'Profile: in the template’s language' },
  { tag: 'nationality_ar', group: 'employee', labelEn: 'Nationality (Arabic)', labelAr: 'الجنسية بالعربي', source: 'Profile: in Arabic, in the person’s gender' },
  { tag: 'nationality_en', group: 'employee', labelEn: 'Nationality (English)', labelAr: 'الجنسية بالإنجليزية', source: 'Profile: as typed' },
  { tag: 'date_of_birth', group: 'employee', labelEn: 'Date of birth', labelAr: 'تاريخ الميلاد', source: 'Profile', note: 'DD/MM/YYYY' },
  { tag: 'address', group: 'employee', labelEn: 'Address (Arabic)', labelAr: 'المقيم في / العنوان', source: 'Profile: address, city and governorate' },
  // social insurance Forms 1 and 6 (owner, 15 October 2026): the address in its parts, and the building number
  { tag: 'address_line', group: 'employee', labelEn: 'Street address (Arabic)', labelAr: 'شارع / حارة', source: 'Profile: the address, without the city and governorate' },
  { tag: 'city', group: 'employee', labelEn: 'City or district (Arabic)', labelAr: 'قسم / مركز', source: 'Profile' },
  { tag: 'governorate', group: 'employee', labelEn: 'Governorate (Arabic)', labelAr: 'محافظة', source: 'Profile' },
  { tag: 'building_no', group: 'employee', labelEn: 'Building number', labelAr: 'عقار رقم', source: 'Profile: address' },
  { tag: 'phone', group: 'employee', labelEn: 'Mobile', labelAr: 'تليفون', source: 'Profile', note: 'With its country code, e.g. +201012345678' },
  { tag: 'work_email', group: 'employee', labelEn: 'Work email', labelAr: 'البريد الإلكتروني للعمل', source: 'Profile' },
  // the owner's request of 15 October 2026, "add the missing fields": this one and, further down, the direct manager,
  // the grade's level, the work arrangement, the working hours, the probation period, the basic salary's share and the
  // net per hour, each with a value for an employee and for a job offer
  { tag: 'personal_email', group: 'employee', labelEn: 'Personal email', labelAr: 'البريد الإلكتروني الشخصي', source: 'Profile, or the email a job offer is sent to' },
  { tag: 'qualification', group: 'employee', labelEn: 'Qualification (Arabic)', labelAr: 'المؤهل العلمي', source: 'Profile: education' },
  { tag: 'insurance_no', group: 'employee', labelEn: 'Social insurance number', labelAr: 'الرقم التأميني', source: 'Profile' },
  { tag: 'national_id', group: 'national_id', labelEn: 'National ID number', labelAr: 'رقم قومي', source: 'National ID', note: 'In English digits, e.g. 29001011234567', restricted: true },
  { tag: 'national_id_ar', group: 'national_id', labelEn: 'National ID number (Arabic digits)', labelAr: 'الرقم القومي بالأرقام العربية', source: 'National ID', note: 'In Arabic digits, e.g. ٢٩٠٠١٠١١٢٣٤٥٦٧', restricted: true },
  { tag: 'id_printed_no', group: 'national_id', labelEn: 'Printed number', labelAr: 'رقم مطبوع', source: 'National ID', restricted: true },
  { tag: 'id_issue_date', group: 'national_id', labelEn: 'Issue date', labelAr: 'تاريخ الإصدار', source: 'National ID', note: 'MM/YYYY' },
  { tag: 'job_title', group: 'job_contract', labelEn: 'Job title', labelAr: 'الوظيفة', source: 'Employment: in the template’s language' },
  { tag: 'job_title_ar', group: 'job_contract', labelEn: 'Job title (Arabic)', labelAr: 'الوظيفة بالعربي', source: 'Employment' },
  { tag: 'job_title_en', group: 'job_contract', labelEn: 'Job title (English)', labelAr: 'الوظيفة بالإنجليزية', source: 'Employment' },
  // the employee's occupation in the social insurance table (occupations.ts), set on the profile's Social Insurance tab
  // (owner's decision, 16 October 2026: no longer the job title's); none on a job offer
  { tag: 'occupation_code', group: 'job_contract', labelEn: 'Occupation code (social insurance)', labelAr: 'كود المهنة', source: 'Social Insurance tab: the employee’s occupation in the social insurance table', note: '6 digits' },
  { tag: 'occupation_name', group: 'job_contract', labelEn: 'Occupation (social insurance)', labelAr: 'المسمى (المهنة)', source: 'Social Insurance tab: the employee’s occupation in the social insurance table' },
  // the selected role's duties on its job offer (owner's request, 15 October 2026: "map each job description to the
  // selected role"; then "we can just add the duties and responsibilities section")
  {
    tag: 'job_duties',
    group: 'job_contract',
    labelEn: 'Duties and responsibilities',
    labelAr: 'المهام والمسؤوليات',
    source: 'Job title: its duties and responsibilities (Organization › Departments & Job Titles)',
    note: 'On a line of its own: the duties as written, in paragraphs, with their bold and indented points. Inside a sentence: as plain text',
  },
  { tag: 'department', group: 'job_contract', labelEn: 'Department or team', labelAr: 'الإدارة', source: 'Employment: in the template’s language' },
  { tag: 'department_ar', group: 'job_contract', labelEn: 'Department or team (Arabic)', labelAr: 'الإدارة بالعربي', source: 'Employment' },
  { tag: 'department_en', group: 'job_contract', labelEn: 'Department or team (English)', labelAr: 'الإدارة بالإنجليزية', source: 'Employment' },
  { tag: 'manager_name', group: 'job_contract', labelEn: 'Direct manager', labelAr: 'المدير المباشر', source: 'Employment or offer: the manager’s full name, in the template’s language' },
  { tag: 'manager_name_ar', group: 'job_contract', labelEn: 'Direct manager (Arabic)', labelAr: 'المدير المباشر بالعربي', source: 'Employment or offer: the manager’s full name' },
  { tag: 'manager_name_en', group: 'job_contract', labelEn: 'Direct manager (English)', labelAr: 'المدير المباشر بالإنجليزية', source: 'Employment or offer: the manager’s full name' },
  { tag: 'grade', group: 'job_contract', labelEn: 'Grade', labelAr: 'الدرجة', source: 'Employment' },
  { tag: 'grade_level', group: 'job_contract', labelEn: 'Grade level', labelAr: 'المستوى الوظيفي', source: 'Employment or offer: the grade’s level, in the template’s language', note: 'e.g. Senior' },
  { tag: 'grade_level_ar', group: 'job_contract', labelEn: 'Grade level (Arabic)', labelAr: 'المستوى الوظيفي بالعربي', source: 'Employment or offer: the grade’s level' },
  { tag: 'grade_level_en', group: 'job_contract', labelEn: 'Grade level (English)', labelAr: 'المستوى الوظيفي بالإنجليزية', source: 'Employment or offer: the grade’s level', note: 'e.g. Senior' },
  { tag: 'employment_type', group: 'job_contract', labelEn: 'Employment type', labelAr: 'نوع التعاقد', source: 'Employment: in the template’s language' },
  { tag: 'employment_type_ar', group: 'job_contract', labelEn: 'Employment type (Arabic)', labelAr: 'نوع التعاقد بالعربي', source: 'Employment' },
  { tag: 'employment_type_en', group: 'job_contract', labelEn: 'Employment type (English)', labelAr: 'نوع التعاقد بالإنجليزية', source: 'Employment' },
  { tag: 'join_date', group: 'job_contract', labelEn: 'Join date', labelAr: 'تاريخ الالتحاق', source: 'Employment', note: 'DD/MM/YYYY' },
  // the social insurance subscription start Form 1 prints, the employee's own on the Social Insurance tab (owner, 16
  // October 2026)
  { tag: 'insurance_start_date', group: 'job_contract', labelEn: 'Subscription start (social insurance)', labelAr: 'تاريخ بدء الاشتراك', source: 'Social Insurance tab: the employee’s, else the join date', note: 'DD/MM/YYYY' },
  // the subscription year a contract version falls in (owner, 25 October 2026: "take the insurance start date make it for
  // 1 year"; "Anniversary year"): the social insurance copy's term
  { tag: 'insurance_year_start', group: 'job_contract', labelEn: 'Subscription year start (social insurance)', labelAr: 'بداية سنة الاشتراك', source: 'The subscription start’s anniversary the contract version starts in (up to 3 months early takes the next one)', note: 'DD/MM/YYYY; the social insurance copy’s start date' },
  { tag: 'insurance_year_end', group: 'job_contract', labelEn: 'Subscription year end (social insurance)', labelAr: 'نهاية سنة الاشتراك', source: 'A year after the subscription year’s start, less a day', note: 'DD/MM/YYYY; the social insurance copy’s end date' },
  { tag: 'insurance_year_duration', group: 'job_contract', labelEn: 'Subscription year length (social insurance)', labelAr: 'مدة سنة الاشتراك', source: 'One year', note: 'سنة ميلادية واحدة; the social insurance copy’s duration' },
  {
    tag: 'work_arrangement',
    group: 'job_contract',
    labelEn: 'Work arrangement',
    labelAr: 'طبيعة العمل',
    source: 'Employment or offer: in the template’s language',
    note: 'Indoor (office) / Outdoor (field work) / Indoor and outdoor / Hybrid (office and home) / Work from home',
  },
  {
    tag: 'work_arrangement_ar',
    group: 'job_contract',
    labelEn: 'Work arrangement (Arabic)',
    labelAr: 'طبيعة العمل بالعربي',
    source: 'Employment or offer',
    note: 'داخل المكتب / ميداني (خارج المكتب) / داخل المكتب وخارجه / هجين (المكتب والمنزل) / العمل من المنزل',
  },
  {
    tag: 'work_arrangement_en',
    group: 'job_contract',
    labelEn: 'Work arrangement (English)',
    labelAr: 'طبيعة العمل بالإنجليزية',
    source: 'Employment or offer',
    note: 'Indoor (office) / Outdoor (field work) / Indoor and outdoor / Hybrid (office and home) / Work from home',
  },
  {
    tag: 'shift',
    group: 'job_contract',
    labelEn: 'Working hours',
    labelAr: 'مواعيد العمل',
    source: 'Employment or offer: the shift’s times and working days, in the template’s language',
    note: 'e.g. 9:00 AM – 5:00 PM, Sunday to Thursday',
  },
  { tag: 'shift_ar', group: 'job_contract', labelEn: 'Working hours (Arabic)', labelAr: 'مواعيد العمل بالعربي', source: 'Employment or offer: the shift’s times and working days', note: 'e.g. من 9:00 ص إلى 5:00 م، من الأحد إلى الخميس' },
  { tag: 'shift_en', group: 'job_contract', labelEn: 'Working hours (English)', labelAr: 'مواعيد العمل بالإنجليزية', source: 'Employment or offer: the shift’s times and working days', note: 'e.g. 9:00 AM – 5:00 PM, Sunday to Thursday' },
  { tag: 'contract_number', group: 'job_contract', labelEn: 'Contract number', labelAr: 'رقم العقد', source: 'Contract' },
  { tag: 'duration', group: 'job_contract', labelEn: 'Duration', labelAr: 'المدة', source: 'Contract', note: 'In Arabic, e.g. سنة ميلادية واحدة' },
  { tag: 'start_date', group: 'job_contract', labelEn: 'Start date', labelAr: 'اعتبارا من', source: 'Contract', note: 'DD/MM/YYYY' },
  { tag: 'end_date', group: 'job_contract', labelEn: 'End date', labelAr: 'وحتى / انتهاء المدة', source: 'Contract', note: 'DD/MM/YYYY' },
  { tag: 'probation_months', group: 'job_contract', labelEn: 'Probation period', labelAr: 'فترة الاختبار', source: 'Contract or offer: in the template’s language', note: 'e.g. 3 months / No probation' },
  { tag: 'probation_months_ar', group: 'job_contract', labelEn: 'Probation period (Arabic)', labelAr: 'فترة الاختبار بالعربي', source: 'Contract or offer', note: 'e.g. ثلاثة أشهر / لا توجد فترة اختبار' },
  { tag: 'probation_months_en', group: 'job_contract', labelEn: 'Probation period (English)', labelAr: 'فترة الاختبار بالإنجليزية', source: 'Contract or offer', note: 'e.g. 3 months / No probation' },
  { tag: 'probation_end', group: 'job_contract', labelEn: 'Probation end date', labelAr: 'نهاية فترة الاختبار', source: 'Contract', note: 'DD/MM/YYYY' },
  { tag: 'pay_basis', group: 'job_contract', labelEn: 'Pay basis', labelAr: 'طريقة الأجر', source: 'Contract or offer: in the template’s language', note: 'Monthly salary / By the hour' },
  { tag: 'pay_basis_ar', group: 'job_contract', labelEn: 'Pay basis (Arabic)', labelAr: 'طريقة الأجر بالعربي', source: 'Contract or offer', note: 'راتب شهري / بالساعة' },
  { tag: 'pay_basis_en', group: 'job_contract', labelEn: 'Pay basis (English)', labelAr: 'طريقة الأجر بالإنجليزية', source: 'Contract or offer', note: 'Monthly salary / By the hour' },
  { tag: 'days_per_week', group: 'job_contract', labelEn: 'Working days a week', labelAr: 'أيام العمل أسبوعياً', source: 'Contract or offer' },
  { tag: 'hours_per_week', group: 'job_contract', labelEn: 'Hours a week', labelAr: 'ساعات العمل أسبوعياً', source: 'Contract or offer: by the hour' },
  // employment types by the labour law (owner, 18 October 2026): the contract's length (Labour Law 14/2025 Arts. 87, 88,
  // 155), the job of a specific-job contract, the nature of the work (Art. 1(6–8)), remote work (Art. 96(1)) and the pay
  // by commission (Art. 1(4)(أ)); each in Arabic and English
  { tag: 'contract_form', group: 'job_contract', labelEn: 'Contract length', labelAr: 'مدة العقد', source: 'Contract: in the template’s language', note: 'Fixed-term / Open-ended / For a specific job' },
  { tag: 'contract_form_ar', group: 'job_contract', labelEn: 'Contract length (Arabic)', labelAr: 'مدة العقد بالعربي', source: 'Contract', note: 'محدد المدة / غير محدد المدة / لإنجاز عمل معين' },
  { tag: 'contract_form_en', group: 'job_contract', labelEn: 'Contract length (English)', labelAr: 'مدة العقد بالإنجليزية', source: 'Contract', note: 'Fixed-term / Open-ended / For a specific job' },
  { tag: 'job_to_do', group: 'job_contract', labelEn: 'The job (specific-job contract)', labelAr: 'العمل المتفق على إنجازه', source: 'Contract: for a specific job, as typed (Labour Law Art. 155)' },
  {
    tag: 'work_nature',
    group: 'job_contract',
    labelEn: 'Nature of the work',
    labelAr: 'نوع العمل',
    source: 'Employment or offer: in the template’s language (Labour Law Art. 1)',
    note: 'Regular / Temporary / Casual / Seasonal',
  },
  { tag: 'work_nature_ar', group: 'job_contract', labelEn: 'Nature of the work (Arabic)', labelAr: 'نوع العمل بالعربي', source: 'Employment or offer', note: 'عمل دائم / عمل مؤقت / عمل عرضي / عمل موسمي' },
  { tag: 'work_nature_en', group: 'job_contract', labelEn: 'Nature of the work (English)', labelAr: 'نوع العمل بالإنجليزية', source: 'Employment or offer', note: 'Regular / Temporary / Casual / Seasonal' },
  {
    tag: 'work_pattern',
    group: 'job_contract',
    labelEn: 'Remote work',
    labelAr: 'نمط العمل',
    source: 'Employment or offer: the work arrangement in the law’s words (Labour Law Art. 96), in the template’s language',
    note: 'On site / Partly remote work (Hybrid) / Remote work (Work from home)',
  },
  { tag: 'work_pattern_ar', group: 'job_contract', labelEn: 'Remote work (Arabic)', labelAr: 'نمط العمل بالعربي', source: 'Employment or offer', note: 'في موقع العمل / عمل عن بعد جزئيًا / عمل عن بعد' },
  { tag: 'work_pattern_en', group: 'job_contract', labelEn: 'Remote work (English)', labelAr: 'نمط العمل بالإنجليزية', source: 'Employment or offer', note: 'On site / Partly remote work / Remote work' },
  { tag: 'paid_by_commission', group: 'job_contract', labelEn: 'Paid by commission', labelAr: 'بالعمولة', source: 'Employment or offer: in the template’s language', note: 'Yes / No' },
  { tag: 'paid_by_commission_ar', group: 'job_contract', labelEn: 'Paid by commission (Arabic)', labelAr: 'بالعمولة بالعربي', source: 'Employment or offer', note: 'نعم / لا' },
  { tag: 'paid_by_commission_en', group: 'job_contract', labelEn: 'Paid by commission (English)', labelAr: 'بالعمولة بالإنجليزية', source: 'Employment or offer', note: 'Yes / No' },
  { tag: 'gross_salary', group: 'pay', labelEn: 'Gross salary', labelAr: 'راتب شامل', source: 'Contract', restricted: true },
  { tag: 'gross_salary_words', group: 'pay', labelEn: 'Gross salary in words (Arabic)', labelAr: 'تفقيط الراتب', source: 'Contract: in Arabic words, فقط … لا غير', restricted: true },
  { tag: 'gross_salary_words_en', group: 'pay', labelEn: 'Gross salary in words (English)', labelAr: 'تفقيط الراتب بالإنجليزية', source: 'Contract or offer: in English words', note: 'E.g. Fifteen thousand Egyptian pounds only', restricted: true },
  { tag: 'basic_salary', group: 'pay', labelEn: 'Basic salary', labelAr: 'الأساسي', source: 'Contract or payroll', restricted: true },
  { tag: 'basic_percent', group: 'pay', labelEn: 'Basic share of the gross', labelAr: 'نسبة الأساسي', source: 'Contract or offer', restricted: true, note: 'e.g. 80%' },
  { tag: 'variable_salary', group: 'pay', labelEn: 'Variable salary', labelAr: 'المتغير', source: 'Contract', restricted: true },
  { tag: 'net_salary', group: 'pay', labelEn: 'Approximate net salary', labelAr: 'الصافي تقريباً', source: 'Contract', restricted: true },
  { tag: 'net_salary_words', group: 'pay', labelEn: 'Net salary in words (Arabic)', labelAr: 'تفقيط الصافي', source: 'Contract: in Arabic words', restricted: true },
  { tag: 'net_salary_words_en', group: 'pay', labelEn: 'Net salary in words (English)', labelAr: 'تفقيط الصافي بالإنجليزية', source: 'Contract or offer: in English words', restricted: true },
  { tag: 'insured_salary', group: 'pay', labelEn: 'Insured salary', labelAr: 'المبلغ التأميني', source: 'Contract: the gross, capped at the maximum insurable wage', restricted: true },
  { tag: 'insured_salary_words', group: 'pay', labelEn: 'Insured salary in words (Arabic)', labelAr: 'تفقيط المبلغ التأميني', source: 'Contract: in Arabic words', restricted: true },
  { tag: 'insured_salary_words_en', group: 'pay', labelEn: 'Insured salary in words (English)', labelAr: 'تفقيط المبلغ التأميني بالإنجليزية', source: 'Contract or offer: in English words', restricted: true },
  { tag: 'hourly_rate', group: 'pay', labelEn: 'Hourly rate', labelAr: 'أجر الساعة', source: 'Contract or offer: by the hour', restricted: true },
  {
    tag: 'net_hourly_rate',
    group: 'pay',
    labelEn: 'Net per hour',
    labelAr: 'صافي أجر الساعة',
    source: 'Contract or offer: by the hour, the approximate net ÷ the hours of a month (hours a week × 52 ÷ 12)',
    restricted: true,
  },
  // a trainee's training agreement (owner, 18 October 2026; Labour Law Art. 29: "ومراحلها المتتابعة والمكافأة التى يحصل
  // عليها المتدرج فى كل مرحلة بصورة تصاعدية"): each stage, its months and its pay a month, in order
  {
    tag: 'trainee_stages',
    group: 'pay',
    labelEn: 'Training stages',
    labelAr: 'مراحل التدرج',
    source: 'Contract: a trainee’s training stages, each with its months and pay a month, in the template’s language',
    restricted: true,
    note: 'e.g. 1. Basics: 3 months, 4,000 a month; 2. Practice: 3 months, 5,500 a month',
  },
  { tag: 'trainee_stages_ar', group: 'pay', labelEn: 'Training stages (Arabic)', labelAr: 'مراحل التدرج بالعربي', source: 'Contract: a trainee’s training stages', restricted: true, note: 'e.g. 1. الأساسيات: ثلاثة أشهر، 4,000 شهريًا' },
  { tag: 'trainee_stages_en', group: 'pay', labelEn: 'Training stages (English)', labelAr: 'مراحل التدرج بالإنجليزية', source: 'Contract: a trainee’s training stages', restricted: true, note: 'e.g. 1. Basics: 3 months, 4,000 a month' },
  { tag: 'allowances', group: 'pay', labelEn: 'Allowances', labelAr: 'البدلات', source: 'Contract or offer: each allowance and its amount a month, in the template’s language', restricted: true },
  { tag: 'allowances_ar', group: 'pay', labelEn: 'Allowances (Arabic)', labelAr: 'البدلات بالعربي', source: 'Contract or offer: each allowance and its amount a month', restricted: true },
  { tag: 'allowances_en', group: 'pay', labelEn: 'Allowances (English)', labelAr: 'البدلات بالإنجليزية', source: 'Contract or offer: each allowance and its amount a month', restricted: true },
  { tag: 'allowances_total', group: 'pay', labelEn: 'Allowances in total', labelAr: 'إجمالي البدلات', source: 'Contract or offer: a month', restricted: true },
  // in words too (owner, 25 October 2026: "{{allowances_total}} i need it in arabic words")
  { tag: 'allowances_total_words', group: 'pay', labelEn: 'Allowances in total in words (Arabic)', labelAr: 'تفقيط إجمالي البدلات', source: 'Contract or offer: in Arabic words, فقط … لا غير', restricted: true },
  { tag: 'allowances_total_words_en', group: 'pay', labelEn: 'Allowances in total in words (English)', labelAr: 'تفقيط إجمالي البدلات بالإنجليزية', source: 'Contract or offer: in English words', note: 'E.g. One thousand Egyptian pounds only', restricted: true },
  { tag: 'total_salary', group: 'pay', labelEn: 'Gross salary and allowances', labelAr: 'إجمالي الراتب والبدلات', source: 'Contract or offer: a month', restricted: true },
  { tag: 'total_salary_words', group: 'pay', labelEn: 'Gross salary and allowances in words (Arabic)', labelAr: 'تفقيط إجمالي الراتب والبدلات', source: 'Contract or offer: in Arabic words', restricted: true },
  { tag: 'total_salary_words_en', group: 'pay', labelEn: 'Gross salary and allowances in words (English)', labelAr: 'تفقيط إجمالي الراتب والبدلات بالإنجليزية', source: 'Contract or offer: in English words', restricted: true },
  // the wages social insurance Form 1 prints (owner, 16 October 2026): the basic wage (أجر أساسي) and the comprehensive
  // wage (الأجر الشامل), each the employee's own on the Social Insurance tab; the insured wage (أجر الاشتراك), the
  // comprehensive wage within the year's insurable limits (owner's decision, 16 October 2026: no longer edited)
  { tag: 'insurance_basic_salary', group: 'pay', labelEn: 'Basic wage (social insurance)', labelAr: 'أجر أساسي (التأمينات)', source: 'Social Insurance tab: the employee’s, else the default in contract settings', restricted: true },
  { tag: 'insurance_insured_salary', group: 'pay', labelEn: 'Insured wage (social insurance)', labelAr: 'أجر الاشتراك (التأمينات)', source: 'Social Insurance tab: the comprehensive wage, within the year’s insurable limits', restricted: true },
  { tag: 'insurance_total_salary', group: 'pay', labelEn: 'Comprehensive wage (social insurance)', labelAr: 'الأجر الشامل (التأمينات)', source: 'Social Insurance tab: the employee’s, else the contract’s gross and allowances', restricted: true },
  // both in words too (owner, 25 October 2026: "i need arabic wordings for both of these to add them in the contract")
  { tag: 'insurance_insured_salary_words', group: 'pay', labelEn: 'Insured wage in words (Arabic)', labelAr: 'تفقيط أجر الاشتراك (التأمينات)', source: 'Social Insurance tab: in Arabic words, فقط … لا غير', restricted: true },
  { tag: 'insurance_insured_salary_words_en', group: 'pay', labelEn: 'Insured wage in words (English)', labelAr: 'تفقيط أجر الاشتراك بالإنجليزية', source: 'Social Insurance tab: in English words', restricted: true },
  { tag: 'insurance_total_salary_words', group: 'pay', labelEn: 'Comprehensive wage in words (Arabic)', labelAr: 'تفقيط الأجر الشامل (التأمينات)', source: 'Social Insurance tab: in Arabic words, فقط … لا غير', restricted: true },
  { tag: 'insurance_total_salary_words_en', group: 'pay', labelEn: 'Comprehensive wage in words (English)', labelAr: 'تفقيط الأجر الشامل بالإنجليزية', source: 'Social Insurance tab: in English words', restricted: true },
  // a raise (owner's decisions, 16 October 2026): the salary amendment letter and social insurance Form 2. The new pay is
  // the version's own (the pay tags above); these say what it was before, when it changes, why, and the promotion
  { tag: 'raise_effective_date', group: 'raise', labelEn: 'Effective date (raise)', labelAr: 'تاريخ سريان التعديل', source: 'Raise: the 1st of the month the new pay takes effect', note: 'DD/MM/YYYY' },
  { tag: 'raise_reason', group: 'raise', labelEn: 'Reason for the raise', labelAr: 'سبب التعديل', source: 'Raise: in the template’s language', note: 'Annual raise / Performance raise / Counter-offer raise / Promotion / Market adjustment / Cost of living / Other' },
  { tag: 'raise_reason_ar', group: 'raise', labelEn: 'Reason for the raise (Arabic)', labelAr: 'سبب التعديل بالعربي', source: 'Raise', note: 'زيادة سنوية / زيادة أداء / زيادة مقابل عرض عمل آخر / ترقية / تعديل وفق أجور السوق / زيادة غلاء المعيشة / أخرى' },
  { tag: 'raise_reason_en', group: 'raise', labelEn: 'Reason for the raise (English)', labelAr: 'سبب التعديل بالإنجليزية', source: 'Raise', note: 'Annual raise / Performance raise / Counter-offer raise / Promotion / Market adjustment / Cost of living / Other' },
  { tag: 'previous_gross_salary', group: 'raise', labelEn: 'Gross salary before the raise', labelAr: 'الراتب الشامل قبل التعديل', source: 'Raise: the version it replaces', restricted: true },
  { tag: 'previous_gross_salary_words', group: 'raise', labelEn: 'Gross salary before the raise in words (Arabic)', labelAr: 'تفقيط الراتب قبل التعديل', source: 'Raise: in Arabic words', restricted: true },
  { tag: 'previous_gross_salary_words_en', group: 'raise', labelEn: 'Gross salary before the raise in words (English)', labelAr: 'تفقيط الراتب قبل التعديل بالإنجليزية', source: 'Raise: in English words', restricted: true },
  { tag: 'previous_basic_salary', group: 'raise', labelEn: 'Basic salary before the raise', labelAr: 'الأساسي قبل التعديل', source: 'Raise: the version it replaces', restricted: true },
  { tag: 'previous_allowances', group: 'raise', labelEn: 'Allowances before the raise', labelAr: 'البدلات قبل التعديل', source: 'Raise: each allowance and its amount a month, in the template’s language', restricted: true },
  { tag: 'previous_allowances_ar', group: 'raise', labelEn: 'Allowances before the raise (Arabic)', labelAr: 'البدلات قبل التعديل بالعربي', source: 'Raise', restricted: true },
  { tag: 'previous_allowances_en', group: 'raise', labelEn: 'Allowances before the raise (English)', labelAr: 'البدلات قبل التعديل بالإنجليزية', source: 'Raise', restricted: true },
  { tag: 'previous_total_salary', group: 'raise', labelEn: 'Gross salary and allowances before the raise', labelAr: 'إجمالي الراتب والبدلات قبل التعديل', source: 'Raise: a month', restricted: true },
  { tag: 'raise_amount', group: 'raise', labelEn: 'Raise amount (gross)', labelAr: 'قيمة الزيادة', source: 'Raise: the new gross less the gross before', restricted: true },
  { tag: 'raise_amount_words', group: 'raise', labelEn: 'Raise amount in words (Arabic)', labelAr: 'تفقيط قيمة الزيادة', source: 'Raise: in Arabic words', restricted: true },
  { tag: 'raise_percent', group: 'raise', labelEn: 'Raise percent (gross)', labelAr: 'نسبة الزيادة', source: 'Raise: of the gross before', restricted: true, note: 'e.g. 12.5%' },
  { tag: 'new_job_title', group: 'raise', labelEn: 'Job title from the raise', labelAr: 'الوظيفة بعد التعديل', source: 'Raise: the promotion’s job title, else the job title as it is, in the template’s language' },
  { tag: 'new_job_title_ar', group: 'raise', labelEn: 'Job title from the raise (Arabic)', labelAr: 'الوظيفة بعد التعديل بالعربي', source: 'Raise: the promotion’s, else as it is' },
  { tag: 'new_job_title_en', group: 'raise', labelEn: 'Job title from the raise (English)', labelAr: 'الوظيفة بعد التعديل بالإنجليزية', source: 'Raise: the promotion’s, else as it is' },
  { tag: 'new_grade', group: 'raise', labelEn: 'Grade from the raise', labelAr: 'الدرجة بعد التعديل', source: 'Raise: the promotion’s grade, else the grade as it is' },
  { tag: 'amended_contract_number', group: 'raise', labelEn: 'Number of the contract amended', labelAr: 'رقم العقد الأصلي', source: 'Raise: the contract the amendment adds to', note: 'e.g. CON-2026-0007' },
  { tag: 'amended_contract_date', group: 'raise', labelEn: 'Start of the contract amended', labelAr: 'تاريخ العقد الأصلي', source: 'Raise: the contract the amendment adds to', note: 'DD/MM/YYYY' },
  // social insurance Form 2: the wage change
  { tag: 'insured_wage_from', group: 'raise', labelEn: 'Insured wage changes from (Form 2)', labelAr: 'تاريخ تعديل أجر الاشتراك', source: 'Raise: the Form 2 date recorded, else its effective date', note: 'DD/MM/YYYY' },
  { tag: 'previous_insured_wage', group: 'raise', labelEn: 'Insured wage before the raise (social insurance)', labelAr: 'أجر الاشتراك قبل التعديل', source: 'Raise: the comprehensive wage before it, within the year’s insurable limits', restricted: true },
  { tag: 'new_insured_wage', group: 'raise', labelEn: 'New insured wage (social insurance)', labelAr: 'أجر الاشتراك بعد التعديل', source: 'Raise: its gross and allowances, within the insurable limits of the year it changes', restricted: true },
  { tag: 'new_comprehensive_wage', group: 'raise', labelEn: 'New comprehensive wage (social insurance)', labelAr: 'الأجر الشامل بعد التعديل', source: 'Raise: its gross and allowances', restricted: true },
  { tag: 'offer_number', group: 'offer', labelEn: 'Offer number', labelAr: 'رقم العرض', source: 'Job offer' },
  { tag: 'offer_expiry', group: 'offer', labelEn: 'Offer valid until', labelAr: 'العرض سارٍ حتى', source: 'Job offer: its last day to accept', note: 'DD/MM/YYYY' },
  { tag: 'bank_name', group: 'bank', labelEn: 'Bank', labelAr: 'البنك', source: 'Bank details' },
  { tag: 'bank_bic', group: 'bank', labelEn: 'SWIFT/BIC', labelAr: 'كود السويفت', source: 'Bank details: from the EG-ACH list' },
  { tag: 'account_no', group: 'bank', labelEn: 'Account number', labelAr: 'رقم الحساب', source: 'Bank details', restricted: true },
  { tag: 'iban', group: 'bank', labelEn: 'IBAN', labelAr: 'رقم الآيبان', source: 'Bank details', restricted: true },
  { tag: 'holder_name', group: 'bank', labelEn: 'Account holder', labelAr: 'اسم صاحب الحساب', source: 'Bank details' },
  { tag: 'resignation_date', group: 'ending', labelEn: 'Resignation date', labelAr: 'تاريخ الاستقالة', source: 'Ending: the date notice was given', note: 'DD/MM/YYYY' },
  { tag: 'request_date', group: 'ending', labelEn: 'Request date', labelAr: 'تاريخ الطلب', source: 'Ending: the date notice was given', note: 'DD/MM/YYYY' },
  { tag: 'last_working_day', group: 'ending', labelEn: 'Last working day', labelAr: 'آخر يوم عمل', source: 'Ending: worked out from its rule’s notice', note: 'DD/MM/YYYY' },
  { tag: 'reason_ar', group: 'ending', labelEn: 'Reason (Arabic)', labelAr: 'السبب', source: 'Ending', note: 'Default: لأسباب شخصية' },
  // the final settlement on the clearance and dues (20 October 2026: the owner unsure, Claude recommended listing them;
  // once part of the Payslip group, always empty): the advances and loans still owed on leaving, deducted from it unless
  // waived (owner, 18 October 2026: "taken from the final settlement, unless waived"), and the unused annual leave it pays
  {
    tag: 'deductions',
    group: 'ending',
    labelEn: 'Final settlement deductions',
    labelAr: 'الاستقطاعات من المستحقات',
    source: 'Final settlement: the advances and loans still owed, deducted or waived, the unused annual leave paid and the total deducted, in the template’s language',
    restricted: true,
    note: 'One per line, e.g. Loan (Laptop): EGP 3,000 still owed, deducted / Unused leave: 5 days × EGP 300 = EGP 1,500 / Total deducted: EGP 3,000. None when there is nothing',
  },
  {
    tag: 'deductions_ar',
    group: 'ending',
    labelEn: 'Final settlement deductions (Arabic)',
    labelAr: 'الاستقطاعات من المستحقات بالعربي',
    source: 'Final settlement: one per line',
    restricted: true,
    note: 'e.g. قرض (لابتوب): المتبقي 3,000 جنيه، مخصوم من المستحقات / إجمالي المخصوم: 3,000 جنيه. Prints لا يوجد when there is nothing',
  },
  {
    tag: 'deductions_en',
    group: 'ending',
    labelEn: 'Final settlement deductions (English)',
    labelAr: 'الاستقطاعات من المستحقات بالإنجليزية',
    source: 'Final settlement: one per line',
    restricted: true,
    note: 'e.g. Loan (Laptop): EGP 3,000 still owed, deducted / Total deducted: EGP 3,000. None when there is nothing',
  },
  {
    tag: 'deductions_total',
    group: 'ending',
    labelEn: 'Final settlement deductions in total',
    labelAr: 'إجمالي الاستقطاعات من المستحقات',
    source: 'Final settlement: the advances and loans still owed and deducted, not those waived',
    restricted: true,
    note: 'e.g. 3,000; 0 when nothing is deducted',
  },
  { tag: 'letter_to', group: 'letters', labelEn: 'Addressed to', labelAr: 'موجه إلى', source: 'Typed when generating' },
  { tag: 'letter_purpose', group: 'letters', labelEn: 'Purpose of the letter', labelAr: 'الغرض من الخطاب', source: 'Typed when generating' },
  { tag: 'pay_month', group: 'payslip', labelEn: 'Pay month', labelAr: 'شهر الراتب', source: 'Payroll' },
  { tag: 'company_name_ar', group: 'company', labelEn: 'Company name (Arabic)', labelAr: 'اسم الشركة', source: 'Company profile' },
  { tag: 'company_name_en', group: 'company', labelEn: 'Company name (English)', labelAr: 'اسم الشركة بالإنجليزية', source: 'Company profile' },
  { tag: 'company_address_ar', group: 'company', labelEn: 'Company address (Arabic)', labelAr: 'مقر الشركة', source: 'Company profile' },
  { tag: 'company_address_en', group: 'company', labelEn: 'Company address (English)', labelAr: 'مقر الشركة بالإنجليزية', source: 'Company profile' },
  { tag: 'commercial_reg_no', group: 'company', labelEn: 'Commercial register number', labelAr: 'السجل التجاري', source: 'Company profile' },
  { tag: 'tax_reg_no', group: 'company', labelEn: 'Tax registration number', labelAr: 'رقم التسجيل الضريبي', source: 'Company profile' },
  { tag: 'insurance_employer_no', group: 'company', labelEn: 'Employer insurance number', labelAr: 'رقم المنشأة في التأمينات', source: 'Company profile' },
  { tag: 'insurance_office', group: 'company', labelEn: 'Social insurance office', labelAr: 'مكتب التأمينات', source: 'Company profile' },
  { tag: 'insurance_sector_code', group: 'company', labelEn: 'Sector code (social insurance)', labelAr: 'قطاع المنشأة', source: 'Company profile', note: 'As the insurance office gave it' },
  { tag: 'company_rep_name', group: 'company', labelEn: 'Company representative (Arabic)', labelAr: 'ممثل الشركة', source: 'Company profile' },
  { tag: 'company_rep_name_en', group: 'company', labelEn: 'Company representative (English)', labelAr: 'ممثل الشركة بالإنجليزية', source: 'Company profile' },
  { tag: 'company_rep_title', group: 'company', labelEn: 'Representative’s title (Arabic)', labelAr: 'صفة ممثل الشركة', source: 'Company profile' },
  { tag: 'company_rep_title_en', group: 'company', labelEn: 'Representative’s title (English)', labelAr: 'صفة ممثل الشركة بالإنجليزية', source: 'Company profile' },
  { tag: 'company_rep_national_id', group: 'company', labelEn: 'Representative’s national ID', labelAr: 'الرقم القومي لممثل الشركة', source: 'Company profile', restricted: true },
  { tag: 'company_rep_national_id_ar', group: 'company', labelEn: 'Representative’s national ID (Arabic digits)', labelAr: 'الرقم القومي لممثل الشركة بالأرقام العربية', source: 'Company profile', restricted: true },
  { tag: 'day_name', group: 'auto', labelEn: 'Weekday (Arabic)', labelAr: 'اليوم', source: 'The document’s date' },
  { tag: 'date', group: 'auto', labelEn: 'Date', labelAr: 'التاريخ / الموافق', source: 'The document’s date', note: 'DD/MM/YYYY' },
  { tag: 'contract_date', group: 'auto', labelEn: 'Contract date', labelAr: 'الموافق (العقد)', source: 'The day it is generated', note: 'DD/MM/YYYY' },
];

export const TEMPLATE_TAG_NAMES: ReadonlySet<string> = new Set(TEMPLATE_TAGS.map((t) => t.tag));

/** A {{tag}} as written in a template: letters, digits and underscores between double braces, spaces allowed inside. */
export const TAG_PATTERN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** A template version's progress: uploaded (draft), then published for use; a newer published version retires it. */
export const TEMPLATE_VERSION_STATUSES = ['draft', 'published', 'retired'] as const;
export type TemplateVersionStatus = (typeof TEMPLATE_VERSION_STATUSES)[number];
export const TEMPLATE_VERSION_STATUS_LABELS: Record<TemplateVersionStatus, string> = { draft: 'Draft', published: 'In use', retired: 'Replaced' };
