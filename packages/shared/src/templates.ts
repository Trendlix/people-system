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
  end_of_internship: 'At the end of an internship',
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

const ALL: readonly EmploymentType[] = ['full_time', 'part_time', 'internship', 'freelance', 'sales'];

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
    overrides: { gross_salary: 'insured_salary', gross_salary_words: 'insured_salary_words', gross_salary_words_en: 'insured_salary_words_en' },
  },
  { key: 'contract_part_time', name: 'Contract · Part-time', folder: 'contracts', language: null, appliesTo: ['part_time'], triggers: ['on_hire', 'renewal'], signers: 'both' },
  { key: 'contract_internship', name: 'Contract · Internship', folder: 'contracts', language: null, appliesTo: ['internship'], triggers: ['on_hire'], signers: 'both' },
  { key: 'contract_sales', name: 'Contract · Sales', folder: 'contracts', language: null, appliesTo: ['sales'], triggers: ['on_hire', 'renewal'], signers: 'both' },
  { key: 'agreement_freelance', name: 'Freelance agreement', folder: 'contracts', language: null, appliesTo: ['freelance'], triggers: ['on_hire'], signers: 'both' },
  { key: 'offer_full_time', name: 'Job offer · Full-time', folder: 'job_offers', language: null, appliesTo: ['full_time'], triggers: ['offer_stage'], signers: 'both' },
  { key: 'offer_part_time', name: 'Job offer · Part-time', folder: 'job_offers', language: null, appliesTo: ['part_time'], triggers: ['offer_stage'], signers: 'both' },
  { key: 'offer_freelance', name: 'Job offer · Freelance', folder: 'job_offers', language: null, appliesTo: ['freelance'], triggers: ['offer_stage'], signers: 'both' },
  { key: 'offer_internship', name: 'Job offer · Internship', folder: 'job_offers', language: null, appliesTo: ['internship'], triggers: ['offer_stage'], signers: 'both' },
  { key: 'offer_sales', name: 'Job offer · Sales', folder: 'job_offers', language: null, appliesTo: ['sales'], triggers: ['offer_stage'], signers: 'both' },
  { key: 'nda', name: 'NDA', folder: 'nda', language: null, appliesTo: ALL, triggers: ['on_hire'], signers: 'both' },
  { key: 'cert_experience', name: 'Experience certificate', folder: 'certificates', language: null, appliesTo: ALL, triggers: ['end_of_service', 'on_request'], signers: 'company' },
  { key: 'cert_internship', name: 'Internship certificate', folder: 'certificates', language: null, appliesTo: ['internship'], triggers: ['end_of_internship'], signers: 'company' },
  { key: 'hr_letter_en', name: 'HR letter · English', folder: 'letters', language: 'en', appliesTo: ALL, triggers: ['on_request'], signers: 'company' },
  { key: 'hr_letter_ar', name: 'HR letter · Arabic', folder: 'letters', language: 'ar', appliesTo: ALL, triggers: ['on_request'], signers: 'company' },
  { key: 'bank_letter', name: 'Bank account letter', folder: 'letters', language: null, appliesTo: ALL, triggers: ['on_hire', 'on_request'], signers: 'company' },
  { key: 'insurance_form_1', name: 'Social insurance Form 1 (joining)', folder: 'social_insurance', language: 'ar', appliesTo: ['full_time'], triggers: ['on_hire'], signers: 'both' },
  { key: 'insurance_form_6', name: 'Social insurance Form 6 (leaving)', folder: 'social_insurance', language: 'ar', appliesTo: ['full_time'], triggers: ['end_of_service'], signers: 'both' },
  { key: 'payslip_en', name: 'Payslip · English', folder: 'payslips', language: 'en', appliesTo: ALL, triggers: ['monthly_payroll', 'on_request'], signers: 'none' },
  { key: 'payslip_ar', name: 'Payslip · Arabic', folder: 'payslips', language: 'ar', appliesTo: ALL, triggers: ['monthly_payroll', 'on_request'], signers: 'none' },
  { key: 'resignation_request', name: 'Resignation request (طلب استقالة)', folder: 'resignation', language: 'ar', appliesTo: ALL, triggers: ['resignation_recorded'], signers: 'employee' },
  { key: 'clearance_dues', name: 'Clearance and dues (إقرار إخلاء طرف واستلام مستحقات)', folder: 'resignation', language: 'ar', appliesTo: ALL, triggers: ['last_working_day'], signers: 'both' },
];

/** The groups the tags are listed in. */
export const TAG_GROUPS = ['employee', 'national_id', 'job_contract', 'pay', 'offer', 'bank', 'ending', 'letters', 'payslip', 'company', 'auto'] as const;
export type TagGroup = (typeof TAG_GROUPS)[number];
export const TAG_GROUP_LABELS: Record<TagGroup, string> = {
  employee: 'Employee',
  national_id: 'National ID',
  job_contract: 'Job and contract',
  pay: 'Pay',
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
  { tag: 'phone', group: 'employee', labelEn: 'Mobile', labelAr: 'تليفون', source: 'Profile', note: 'As dialled in Egypt (010…) for an Egyptian number' },
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
  { tag: 'allowances', group: 'pay', labelEn: 'Allowances', labelAr: 'البدلات', source: 'Contract or offer: each allowance and its amount a month, in the template’s language', restricted: true },
  { tag: 'allowances_ar', group: 'pay', labelEn: 'Allowances (Arabic)', labelAr: 'البدلات بالعربي', source: 'Contract or offer: each allowance and its amount a month', restricted: true },
  { tag: 'allowances_en', group: 'pay', labelEn: 'Allowances (English)', labelAr: 'البدلات بالإنجليزية', source: 'Contract or offer: each allowance and its amount a month', restricted: true },
  { tag: 'allowances_total', group: 'pay', labelEn: 'Allowances in total', labelAr: 'إجمالي البدلات', source: 'Contract or offer: a month', restricted: true },
  { tag: 'total_salary', group: 'pay', labelEn: 'Gross salary and allowances', labelAr: 'إجمالي الراتب والبدلات', source: 'Contract or offer: a month', restricted: true },
  { tag: 'total_salary_words', group: 'pay', labelEn: 'Gross salary and allowances in words (Arabic)', labelAr: 'تفقيط إجمالي الراتب والبدلات', source: 'Contract or offer: in Arabic words', restricted: true },
  { tag: 'total_salary_words_en', group: 'pay', labelEn: 'Gross salary and allowances in words (English)', labelAr: 'تفقيط إجمالي الراتب والبدلات بالإنجليزية', source: 'Contract or offer: in English words', restricted: true },
  // the wages social insurance Form 1 prints, each the employee's own on the Social Insurance tab (owner, 16 October
  // 2026): the basic wage (أجر أساسي), the insured wage (أجر الاشتراك) and the comprehensive wage (الأجر الشامل)
  { tag: 'insurance_basic_salary', group: 'pay', labelEn: 'Basic wage (social insurance)', labelAr: 'أجر أساسي (التأمينات)', source: 'Social Insurance tab: the employee’s, else the default in contract settings', restricted: true },
  { tag: 'insurance_insured_salary', group: 'pay', labelEn: 'Insured wage (social insurance)', labelAr: 'أجر الاشتراك (التأمينات)', source: 'Social Insurance tab: the employee’s, else the contract’s insured salary', restricted: true },
  { tag: 'insurance_total_salary', group: 'pay', labelEn: 'Comprehensive wage (social insurance)', labelAr: 'الأجر الشامل (التأمينات)', source: 'Social Insurance tab: the employee’s, else the contract’s gross and allowances', restricted: true },
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
  { tag: 'letter_to', group: 'letters', labelEn: 'Addressed to', labelAr: 'موجه إلى', source: 'Typed when generating' },
  { tag: 'letter_purpose', group: 'letters', labelEn: 'Purpose of the letter', labelAr: 'الغرض من الخطاب', source: 'Typed when generating' },
  { tag: 'pay_month', group: 'payslip', labelEn: 'Pay month', labelAr: 'شهر الراتب', source: 'Payroll' },
  { tag: 'deductions', group: 'payslip', labelEn: 'Deductions', labelAr: 'الاستقطاعات', source: 'Payroll', restricted: true },
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
