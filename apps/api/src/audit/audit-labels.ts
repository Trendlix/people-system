// The audit log in words (owner, 19 October 2026: "an Audit Log page showing who changed what and when"): what each
// kind of record and each action written to audit_log is called on the Audit Log page and in its Excel export. The
// keys are the entityType and action values the services pass to AuditService.record (grep `entityType:` and `action:`
// in apps/api/src); audit-labels.spec.ts reads the sources and fails when one has no words here. A value that isn't
// here still reads: its key with the underscores as spaces ("waive_attendance" → "Waive attendance").

/** Each kind of record, in sentence case, as the page names it ("Contract CON-2026-0007"). */
export const ENTITY_LABELS: Readonly<Record<string, string>> = {
  allowance_type: 'Allowance type',
  attendance_correction: 'Attendance correction',
  attendance_day: 'Attendance day',
  attendance_import: 'Attendance import',
  attendance_summary: 'Attendance summary',
  audit_log: 'Audit log',
  // Attendance → Check-in Setup (owner, 20 October 2026: "Own page, several locations"; the office network's lock; the
  // switch refusing presses without a location, "Company switch + exceptions")
  check_in_location: 'Check-in location',
  check_in_location_rule: 'Check-ins without a location',
  company: 'Company',
  contract: 'Contract',
  contract_settings: 'Contract defaults',
  department: 'Department',
  employee: 'Employee',
  employment: 'Employment',
  employment_ending: 'Employment ending',
  ending_rule: 'Ending rule',
  final_settlement: 'Final settlement',
  generated_document: 'Issued document',
  grade: 'Grade',
  holiday: 'Holiday',
  // home locations (owner, 20 October 2026: "allow other users to request to add their home locations when working from home")
  home_location: 'Home location',
  job_offer: 'Job offer',
  job_title: 'Job title',
  // KPIs (owner, 21 October 2026: "lets start with the KPI's First"): the monthly scorecards, the templates per job title,
  // the deadlines, and the month's Excel export
  kpi_report: 'KPI report',
  kpi_scorecard: 'KPI scorecard',
  kpi_settings: 'KPI settings',
  kpi_template: 'KPI template',
  leave_adjustment: 'Leave balance change',
  leave_document: 'Leave document',
  leave_request: 'Leave request',
  leave_settings: 'Leave setup',
  leave_type: 'Leave type',
  leave_year_closing: 'Leave year closing',
  ocr_correction: 'Card reading fix',
  office_networks: 'Office networks',
  paperwork: 'Employee document',
  payroll_adjustment: 'Addition or deduction',
  payroll_advance: 'Advance or loan',
  payroll_law_rates: 'Rates set by law',
  payroll_line: 'Payroll line',
  payroll_run: 'Payroll run',
  payroll_settings: 'Payroll rules',
  payroll_statistics: 'Payroll statistics',
  permission_request: 'Permission request',
  profile_change_request: 'Details change request',
  profile_confirmation: 'Details confirmation',
  raise_request: 'Raise request',
  recurring_deduction: 'Recurring deduction',
  reimbursement_claim: 'Reimbursement claim',
  reimbursement_receipt: 'Reimbursement receipt',
  reimbursement_type: 'Reimbursement type',
  salary_raises_report: 'Salary raises report',
  shift: 'Shift',
  template_version: 'Template version',
  user: 'User account',
};

/** Each action, in the past tense and sentence case ("Updated", "Sent for approval"). */
export const ACTION_LABELS: Readonly<Record<string, string>> = {
  answer: 'Recorded the answer',
  apply: 'Applied',
  approve: 'Approved',
  attendance_summary_file: 'Downloaded the attendance summary',
  audit_log_file: 'Downloaded the audit log',
  // HR's calibration of a KPI scorecard (owner, 21 October 2026: "Self, manager, HR, sign-off"), each pick changed with its reason
  calibrate: 'Calibrated',
  cancel: 'Cancelled',
  change: 'Changed the amount',
  change_installment: 'Changed the installments',
  // a check-in or check-out refused off the office network (owner, 20 October 2026), or without a location (the same
  // day: "Company switch + exceptions"), its reason in the change; never the address, never a point
  check_in_refused: 'Check-in or check-out refused',
  close: 'Closed',
  complete: 'Completed',
  confirm: 'Confirmed',
  confirm_probation: 'Confirmed after probation',
  correct: 'Corrected',
  create: 'Created',
  decline: 'Declined',
  delete: 'Deleted',
  // fingerprint sign-in in the app (owner, 20 October 2026: "Sign-in: Face ID / fingerprint after the first password
  // sign-in"); never the secret
  device_add: 'Turned on fingerprint sign-in',
  device_login: 'Signed in with fingerprint',
  device_login_failed: 'Fingerprint sign-in refused',
  device_revoke: 'Turned off fingerprint sign-in',
  done: 'Completed',
  download_unprotected: 'Downloaded unprotected',
  end: 'Ended',
  // a KPI scorecard made final by its sign-off day without every signature (21 October 2026)
  finalize: 'Made final',
  generate: 'Generated',
  hire: 'Hired from the offer',
  import: 'Imported',
  issue_payslip: 'Issued the payslip',
  kpi_file: 'Downloaded the KPIs',
  learn: 'Learned a fix',
  // a person linked to a sub-location, or unlinked, and a location made the main office (owner, 20 October 2026: "main
  // office location is the hero and other locations are like sub locations. shown with their name and linked users")
  link_person: 'Linked a person',
  login: 'Signed in',
  login_failed: 'Sign-in failed',
  logout: 'Signed out',
  make_main: 'Made it the main office',
  move: 'Moved to another month',
  // last month's KPI scorecards opened at once by HR (21 October 2026)
  open: 'Opened the scorecards',
  paid: 'Marked paid',
  paid_out: 'Paid out held pay',
  password_change: 'Changed the password',
  password_reset: 'Reset the password',
  payroll_bank_file: 'Downloaded a bank file',
  payroll_statistics_file: 'Downloaded the payroll statistics',
  payslip_file: 'Downloaded payslips',
  postpone_installment: 'Postponed an installment',
  prepare: 'Prepared the raise',
  print: 'Marked printed',
  publish: 'Published',
  record: 'Recorded by HR',
  record_consent: 'Recorded the signed consent',
  refresh: 'Refreshed',
  refresh_attendance: 'Refreshed from attendance',
  reject: 'Rejected',
  // an approved home location removed (its point deleted), and one replaced by a newer approved one (20 October 2026)
  remove: 'Removed',
  reopen: 'Reopened',
  reorder: 'Reordered',
  replace: 'Replaced by a newer one',
  restore_attendance: 'Restored the attendance cut',
  return: 'Returned',
  salary_raises_file: 'Downloaded the salary raises',
  // a KPI scorecard's scoring sent by its manager, HR or the CEO (21 October 2026)
  score: 'Scored',
  // an employee's KPI self-rating sent (21 October 2026)
  self_rate: 'Sent the self-rating',
  send: 'Sent',
  // sessions kept on the server (owner, 20 October 2026)
  session_idle: 'Signed out after 15 minutes without activity',
  session_replaced: 'Signed out by a newer sign-in',
  session_revoked: 'Ended the sessions',
  settle: 'Settled',
  sign: 'Signed',
  stop: 'Stopped',
  submit: 'Sent for approval',
  undo: 'Undid',
  unlink_person: 'Unlinked a person',
  unsign: 'Undid the signing',
  unused_leave_paid: 'Paid unused leave',
  update: 'Updated',
  verify: 'Verified',
  view_as_act: 'Turned Act as them on or off',
  view_as_start: 'Started viewing as',
  view_as_stop: 'Stopped viewing as',
  view_restricted: 'Viewed restricted data',
  waive_attendance: 'Waived the attendance cut',
  withdraw: 'Withdrew',
};

/** "waive_attendance" → "Waive attendance": a key with no words of its own. */
export function humanized(key: string): string {
  const words = key.replace(/_/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

export const entityLabel = (entityType: string): string => ENTITY_LABELS[entityType] ?? humanized(entityType);

export const actionLabel = (action: string): string => ACTION_LABELS[action] ?? humanized(action);

/** The words of a few fields whose name alone doesn't say it well; every other field is its name split into words. */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  employeeId: 'Employee',
  employmentId: 'Employment',
  managerId: 'Direct manager',
  departmentId: 'Department',
  jobTitleId: 'Job title',
  gradeId: 'Grade',
  shiftId: 'Shift',
  runId: 'Payroll run',
  lineId: 'Payroll line',
  iban: 'IBAN',
  accountNo: 'Account number',
  nationalId: 'National ID',
  printedNo: 'Printed number',
  insuranceNo: 'Insurance number',
  documentNo: 'Document number',
  repNationalId: "Representative's national ID",
  from: 'From',
  to: 'To',
  // check-ins locked to the office network (20 October 2026)
  officeNetworks: 'Office networks',
  officeNetworkLock: 'Lock check-ins to the office network',
  checkInAnywhere: 'Can check in from anywhere',
  // refusing presses without a location (20 October 2026)
  refuseWithoutLocation: 'Refuse check-ins and check-outs without a location',
  checkInWithoutLocation: 'Can check in without a location',
  // home locations (20 October 2026)
  radiusMetres: 'Radius (metres)',
  // the main office and its sub-locations (20 October 2026)
  isMain: 'Main office',
  formerMainId: 'Former main office',
};

/**
 * A field of a change in words: "grossSalary" → "Gross salary", "fullNameEn" → "Full name (English)", "nameAr" →
 * "Name (Arabic)", "contractId" → "Contract ID"; a few named above.
 */
export function fieldLabel(field: string): string {
  const named = FIELD_LABELS[field];
  if (named) return named;
  let language = '';
  let base = field;
  const lang = /^(.+?)(En|Ar)$/.exec(field);
  if (lang) {
    base = lang[1];
    language = lang[2] === 'En' ? ' (English)' : ' (Arabic)';
  }
  const words = base
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      const lower = w.toLowerCase();
      if (lower === 'id') return 'ID';
      if (lower === 'ceo' || lower === 'hr' || lower === 'kpi' || lower === 'pdf' || lower === 'ocr' || lower === 'url') return lower.toUpperCase();
      if (lower === 'no') return 'number';
      return lower;
    });
  if (!words.length) return field;
  const text = words.join(' ');
  return text[0].toUpperCase() + text.slice(1) + language;
}
