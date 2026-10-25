// The employee's own check of their data (owner's decision, 15 October 2026): an employee confirms their personal,
// contact, emergency contact and education details once, and again after every change, accepting responsibility for
// what they confirmed. They don't edit the data themselves: they ask for a change, which HR or an Admin approves or
// rejects.

/** The parts of the profile the employee confirms, in the order they are shown. */
export const CONFIRM_SECTIONS = ['personal', 'contact', 'emergency', 'education'] as const;
export type ConfirmSection = (typeof CONFIRM_SECTIONS)[number];
export const CONFIRM_SECTION_LABELS: Record<ConfirmSection, string> = {
  personal: 'Personal',
  contact: 'Contact & Address',
  emergency: 'Emergency Contact',
  education: 'Education',
};

/** The fields the employee confirms and may ask to change, each with its label and section. */
export const CONFIRM_FIELDS = [
  { key: 'fullNameEn', label: 'Full name (English)', section: 'personal' },
  { key: 'fullNameAr', label: 'Full name (Arabic)', section: 'personal' },
  { key: 'displayName', label: 'Display name', section: 'personal' },
  { key: 'dateOfBirth', label: 'Date of birth', section: 'personal' },
  { key: 'gender', label: 'Gender', section: 'personal' },
  { key: 'nationality', label: 'Nationality', section: 'personal' },
  { key: 'maritalStatus', label: 'Marital status', section: 'personal' },
  { key: 'militaryStatus', label: 'Military status', section: 'personal' },
  { key: 'insuranceNo', label: 'Social insurance number', section: 'personal' },
  { key: 'workEmail', label: 'Work email', section: 'contact' },
  { key: 'personalEmail', label: 'Personal email', section: 'contact' },
  { key: 'mobile', label: 'Mobile', section: 'contact' },
  { key: 'mobile2', label: 'Second mobile', section: 'contact' },
  { key: 'governorate', label: 'Governorate', section: 'contact' },
  { key: 'city', label: 'City', section: 'contact' },
  { key: 'addressAr', label: 'Address (Arabic)', section: 'contact' },
  // social insurance Forms 1 and 6 print it on its own (owner, 15 October 2026)
  { key: 'buildingNo', label: 'Building number', section: 'contact' },
  { key: 'emergencyName', label: 'Name', section: 'emergency' },
  { key: 'emergencyRelation', label: 'Relation', section: 'emergency' },
  { key: 'emergencyMobile', label: 'Mobile', section: 'emergency' },
  // a student (owner, 25 October 2026: "Add a Student option"): the switch, the year (STUDY_YEARS) and the expected
  // graduation, a month kept as its first day (YYYY-MM-01)
  { key: 'stillStudying', label: 'Still studying', section: 'education' },
  { key: 'studyYear', label: 'Study year', section: 'education' },
  { key: 'expectedGraduation', label: 'Expected graduation', section: 'education' },
  { key: 'university', label: 'University', section: 'education' },
  { key: 'faculty', label: 'Faculty', section: 'education' },
  { key: 'degree', label: 'Degree', section: 'education' },
  { key: 'major', label: 'Major', section: 'education' },
  { key: 'graduationYear', label: 'Graduation year', section: 'education' },
  { key: 'educationGrade', label: 'Education grade', section: 'education' },
  { key: 'qualificationAr', label: 'Qualification (Arabic)', section: 'education' },
] as const satisfies readonly { key: string; label: string; section: ConfirmSection }[];
export type ConfirmField = (typeof CONFIRM_FIELDS)[number]['key'];
export const CONFIRM_FIELD_KEYS: readonly ConfirmField[] = CONFIRM_FIELDS.map((f) => f.key);

/**
 * The fields an employee may ask to change: all they confirm but the work email, which the company sets together with
 * the sign-in account (changing it alone would cut the employee off from their own profile).
 */
export const REQUESTABLE_FIELD_KEYS: readonly ConfirmField[] = CONFIRM_FIELD_KEYS.filter((key) => key !== 'workEmail');

/** What the employee accepts when confirming. A new wording gets a new version, so each confirmation records which one. */
export const PROFILE_DISCLAIMER = {
  version: 1,
  en: 'I confirm that the information above is correct and complete, and I accept responsibility for it. I will tell HR of any change.',
  ar: 'أقر بأن البيانات الواردة أعلاه صحيحة وكاملة، وأتحمل المسؤولية الكاملة عنها، وأتعهد بإخطار إدارة الموارد البشرية بأي تغيير يطرأ عليها.',
} as const;

/** A change request's progress: HR or an Admin approves (the change is made) or rejects it; the employee may cancel it while it waits. */
export const CHANGE_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type ChangeRequestStatus = (typeof CHANGE_REQUEST_STATUSES)[number];
export const CHANGE_REQUEST_STATUS_LABELS: Record<ChangeRequestStatus, string> = {
  pending: 'Waiting for HR',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};
