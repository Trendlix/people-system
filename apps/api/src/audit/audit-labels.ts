// The audit log in words (owner, 19 October 2026: "an Audit Log page showing who changed what and when"): what each
// kind of record and each action written to audit_log is called on the Audit Log page and in its Excel export. The
// keys are the entityType and action values the services pass to AuditService.record (grep `entityType:` and `action:`
// in apps/api/src); audit-labels.spec.ts reads the sources and fails when one has no words here. A value that isn't
// here still reads: its key with the underscores as spaces ("waive_attendance" → "Waive attendance").

/** Each kind of record, in sentence case, as the page names it ("Contract CON-2026-0007"). */
export const ENTITY_LABELS: Readonly<Record<string, string>> = {
  allowance_type: 'Allowance type',
  // Assets (owner, 21 October 2026: "i want to add this module with a special permission to the system"): the register's
  // assets, their photos, the rooms they are kept in, the production kits and the settings (the capitalization threshold)
  asset: 'Asset',
  // an asset drafted by Claude through the connector (step 2, 21 October 2026: "the connection method"), confirmed into
  // an asset or discarded by a person
  asset_draft: 'Asset draft',
  // Assets step 5 (22 October 2026): a count of a group, room or kit, and an Assets export downloaded
  asset_count: 'Asset count',
  asset_kit: 'Production kit',
  asset_photo: 'Asset photo',
  asset_room: 'Asset room',
  asset_report: 'Assets export',
  asset_settings: 'Asset settings',
  attendance_correction: 'Attendance correction',
  attendance_day: 'Attendance day',
  attendance_import: 'Attendance import',
  attendance_summary: 'Attendance summary',
  audit_log: 'Audit log',
  // Attendance → Check-in Setup (owner, 20 October 2026: "Own page, several locations"; the office network's lock; the
  // switch refusing presses without a location, "Company switch + exceptions")
  check_in_location: 'Check-in location',
  check_in_location_rule: 'Check-ins without a location',
  // the GPS lock (owner, 24 October 2026: "Yes, add a GPS lock too"): Office staff's check-ins held to the check-in locations
  check_in_gps_lock: 'Check-ins locked to the check-in locations',
  // people exempt from check-in (owner, 25 October 2026: "allow me to select people that are not eligable for attendance
  // checkins and outs"): a period added, ended or removed
  check_in_exemption: 'Exemption from check-in',
  // Clients → Client Accounts (owner, 25 October 2026: an allowance per client account): an account, a person on it, a size
  agency_mark: 'Marketing agency mark',
  client_account: 'Client account',
  client_account_assignment: 'Client account assignment',
  client_account_tier: 'Client account size',
  company: 'Company',
  contract: 'Contract',
  contract_settings: 'Contract defaults',
  // Assets, step 3 (21 October 2026): a custody record, CUS-0042, handed over, received back and its signed copy attached
  custody_record: 'Custody record',
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
  // recruitment (owner, 22 October 2026: "where will we include the ATS?"): an application from the careers page
  job_application: 'Job application',
  // a CV sent or added without a posted job (22 October 2026: "what came out of the posted jobs and what cam on randomly")
  general_cv: 'General CV',
  // a candidate's profile (22 October 2026: "how to make like a profile for each candidate to store history and prevent
  // duplication?"): merged, a merge undone, a pair dismissed, an application split off, the backfill of those from before
  candidate: 'Candidate',
  // a screening comment on an application, a general CV or a candidate in general (owner, 24 October 2026: "is there a
  // way to add screening comments?"): written, edited, deleted by a Super Admin; HR's notes of before moved into them
  screening_comment: 'Screening comment',
  // an earlier CV suggested for an open vacancy (owner, 24 October 2026: "Suggest; HR adds"): added, invited to apply,
  // dismissed by HR; closed once the person is on the vacancy
  vacancy_suggestion: 'Suggested CV',
  job_offer: 'Job offer',
  job_title: 'Job title',
  // KPIs (owner, 21 October 2026: "lets start with the KPI's First"): the monthly scorecards, the templates per job title,
  // the deadlines, and the month's Excel export; the pillars (owner, 21 October 2026: "Fully flexible")
  kpi_framework: 'KPI pillars',
  kpi_report: 'KPI report',
  kpi_scorecard: 'KPI scorecard',
  kpi_settings: 'KPI settings',
  kpi_template: 'KPI template',
  leave_adjustment: 'Leave balance change',
  leave_document: 'Leave document',
  // a leave file imported (owner, 21 October 2026: "how to import bulk leaves?"): uploaded, its choices, applied, undone, deleted
  leave_import: 'Leave import',
  leave_request: 'Leave request',
  leave_settings: 'Leave setup',
  // a team's staffing limit for annual leave (owner, 25 October 2026: "Warn and need HR")
  leave_staffing_limit: 'Staffing limit',
  leave_type: 'Leave type',
  leave_year_closing: 'Leave year closing',
  // Organization → Email Settings (owner, 23 October 2026: "why dont we add SMTP setup in the organization setup")
  mail_settings: 'Email settings',
  // Organization → Check-in Setup → Google Maps (owner, 24 October 2026: "Google Maps"): the browser key, only as changed
  maps_settings: 'Google Maps settings',
  // online interview meetings (owner, 24 October 2026: "Google Meet, Microsoft Teams, Zoom"; "make it both"): a
  // provider's app and the default (Organization → Meetings), and a meetings connection, the company's or a person's own
  meeting_settings: 'Meeting settings',
  meeting_connection: 'Meetings connection',
  // interviewers' availability (owner, 25 October 2026: "Hours + calendar"; "its zoho mails"): the company's interview
  // defaults, someone's interview hours, the Zoho Calendar app (Organization → Calendars) and a calendar connection
  interview_settings: 'Interview defaults',
  interview_hours: 'Interview hours',
  calendar_settings: 'Calendar settings',
  calendar_connection: 'Calendar connection',
  // Zoho People's attendance pulled in (owner, 25 October 2026: "Yes, daily + backfill"): the connection a Super Admin
  // makes once, and each fetch (the nightly one, or HR's "Fetch from Zoho")
  zoho_people_connection: 'Zoho People connection',
  zoho_people_run: 'Fetch from Zoho People',
  // WhatsApp notifications (owner, 24 October 2026: "how to make whatsapp notifications?"; "Directly to Meta"): the
  // settings (Organization → Company → WhatsApp), and a person's own choice to get them
  whatsapp_settings: 'WhatsApp settings',
  whatsapp_opt_in: 'WhatsApp messages choice',
  ocr_correction: 'Card reading fix',
  // offboarding (owner, 22 October 2026: the full module): a leaver's case (clearance, exit interview, rehire
  // eligibility), the default clearance checklist, and the turnover's Excel
  clearance_checklist: 'Clearance checklist',
  offboarding_case: 'Offboarding case',
  turnover_report: 'Turnover report',
  office_networks: 'Office networks',
  paperwork: 'Employee document',
  payroll_adjustment: 'Addition or deduction',
  payroll_advance: 'Advance or loan',
  payroll_law_rates: 'Rates set by law',
  payroll_line: 'Payroll line',
  // a leave or attendance change made after the month's payroll moved on (27 October 2026)
  payroll_locked_change: 'Change after the payroll moved on',
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
  // the Contracts report (25 October 2026): its workbook downloaded
  contracts_report: 'Contracts report',
  // the Leave report (26 October 2026): its workbook downloaded
  leave_report: 'Leave report',
  payroll_vs_insurance: 'Payroll vs social insurance report',
  // the Social Insurance report (27 October 2026): a view's workbook downloaded (the register, a month's contributions, the missing data)
  social_insurance_report: 'Social insurance report',
  shift: 'Shift',
  template_version: 'Template version',
  user: 'User account',
  // recruitment (22 October 2026): a vacancy, approved by the CEO before the careers page shows it
  vacancy: 'Vacancy',
  // recruitment, Phase 2 (22 October 2026): an interview, the rejection email's words, the analytics' Excel; onboarding
  interview: 'Interview',
  recruitment_settings: 'Recruitment settings',
  // "Fill in with LinkedIn" on the careers forms (25 October 2026), a Super Admin's
  linkedin_settings: 'LinkedIn sign-in settings',
  recruitment_analytics: 'Recruitment analytics',
  onboarding_checklist: 'Onboarding checklist',
  onboarding_defaults: 'Onboarding checklist defaults',
  // working from home (owner, 21 October 2026: "think about how should we handle the working from home in out erp")
  wfh_request: 'Work from home request',
  // an employee's resignation request (owner, 26 October 2026)
  resignation_request: 'Resignation request',
  resignation_letter: 'Resignation letter',
  // official duty (owner, 23 October 2026: "Official duty (OD) requests")
  od_request: 'Official duty request',
  // compensatory days (owner, 26 October 2026)
  compensatory_request: 'Compensatory day request',
};

/** Each action, in the past tense and sentence case ("Updated", "Sent for approval"). */
export const ACTION_LABELS: Readonly<Record<string, string>> = {
  answer: 'Recorded the answer',
  // an earlier job offer (25 October 2026): marked sent outside the system on a past day, with no email and no link
  record_sent: 'Recorded as sent earlier',
  apply: 'Applied',
  // the same person applying again for the job while it is open (owner, 25 October 2026: "Update their application")
  reapply: 'Updated their application',
  approve: 'Approved',
  attendance_summary_file: 'Downloaded the attendance summary',
  // a person's attendance history as Excel (owner, 23 October 2026: "Attendance history on the profile … an Excel export")
  attendance_history_file: 'Downloaded the attendance history',
  audit_log_file: 'Downloaded the audit log',
  // HR's calibration of a KPI scorecard (owner, 21 October 2026: "Self, manager, HR, sign-off"), each pick changed with its reason
  calibrate: 'Calibrated',
  cancel: 'Cancelled',
  change: 'Changed the amount',
  change_installment: 'Changed the installments',
  // a check-in or check-out refused off the office network (owner, 20 October 2026), or without a location (the same
  // day: "Company switch + exceptions"), or outside the check-in locations by GPS (24 October 2026: "Yes, add a GPS lock
  // too"), its reason in the change; never the address, never a point
  check_in_refused: 'Check-in or check-out refused',
  close: 'Closed',
  // recruitment (owner, 22 October 2026): a vacancy put on hold, sent back by the CEO, filled at its headcount; an
  // applicant moved to a stage, restored, HR's notes on them
  hold: 'Put on hold',
  send_back: 'Sent back',
  fill: 'Filled',
  stage: 'Moved to a stage',
  restore: 'Restored',
  notes: 'Changed the notes',
  // a general CV marked reviewed, archived, moved to a vacancy (22 October 2026)
  review: 'Marked as reviewed',
  archive: 'Archived',
  move_to_vacancy: 'Moved to a vacancy',
  complete: 'Completed',
  confirm: 'Confirmed',
  confirm_probation: 'Confirmed after probation',
  // the Claude connector (owner, 21 October 2026: "the connection method"): Allow on its consent page, the connection
  // made (its session started), and a connection ended because a used refresh token came again; never a token
  connector_allow: 'Allowed the Claude connector',
  connector_connect: 'Connected Claude',
  connector_refused: 'Claude connection ended for safety',
  // an asset count saved (Assets step 5, 22 October 2026)
  count: 'Counted',
  correct: 'Corrected',
  create: 'Created',
  decline: 'Declined',
  delete: 'Deleted',
  // an asset draft from Claude set aside (step 2, 21 October 2026)
  discard: 'Discarded',
  // a product image Claude found added to a draft through the connector, and one a person took off it (21 October 2026:
  // "let the mcp connector fetch the product photo and add it"), with its source page, never the picture
  add_product_image: 'Added a product image',
  remove_product_image: 'Removed a product image',
  // custody (Assets step 3, 21 October 2026): a custody record's signed copy attached; assets handed over and received
  // back (on the record and on each asset); an asset sent to repair and back, marked lost and found
  // an Assets export downloaded (Assets step 5, 22 October 2026)
  asset_file: 'Downloaded an assets export',
  attach_signed: 'Attached the signed copy',
  back_from_repair: 'Back from repair',
  hand_over: 'Handed over',
  // a leave or attendance change made after the payroll moved on, corrected by hand on a later payroll (27 October 2026)
  handled: 'Marked handled',
  mark_found: 'Marked found',
  mark_lost: 'Marked lost',
  // Assets step 4 (22 October 2026: accessories, "Both kinds"; kits, stock, repairs, disposal): an asset's accessories'
  // checklist changed, attached to a main asset or detached, a consumable used or restocked, a maintenance entry by hand,
  // disposed of; assets put in a kit or taken out
  accessories: 'Changed the accessories',
  attach: 'Attached',
  detach: 'Detached',
  use: 'Used from stock',
  restock: 'Restocked',
  maintenance: 'Added a maintenance entry',
  dispose: 'Disposed of',
  items: 'Changed the kit’s assets',
  receive_back: 'Received back',
  send_to_repair: 'Sent to repair',
  // fingerprint sign-in in the app (owner, 20 October 2026: "Sign-in: Face ID / fingerprint after the first password
  // sign-in"); never the secret
  device_add: 'Turned on fingerprint sign-in',
  device_login: 'Signed in with fingerprint',
  device_login_failed: 'Fingerprint sign-in refused',
  device_revoke: 'Turned off fingerprint sign-in',
  done: 'Completed',
  download_unprotected: 'Downloaded unprotected',
  // "Draft templates for every job title" from the KPI role library (owner, 21 October 2026: "can you add templetes for
  // all departments and job roles"), each draft made also audited as created
  draft_all: 'Drafted KPI templates for every job title',
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
  // an asset's label printed (21 October 2026)
  label: 'Marked the label printed',
  login_failed: 'Sign-in failed',
  logout: 'Signed out',
  // an asset's photo made the one its lists show (21 October 2026)
  make_first: 'Made it the main photo',
  make_main: 'Made it the main office',
  move: 'Moved to another month',
  // a developer who holds another role chooses, at sign-in, or switches how they use the system (22 October 2026: "give
  // hin a switched to use the account as the main role assigned to him or as a developer"); a Super Admin viewing as one
  // sees them as a developer or as themselves
  mode_chosen: 'Chose how to use the system',
  mode_switched: 'Switched how they use the system',
  view_as_mode: 'Switched seeing them as a developer or as themselves',
  // last month's KPI scorecards opened at once by HR (21 October 2026)
  open: 'Opened the scorecards',
  paid: 'Marked paid',
  paid_out: 'Paid out held pay',
  password_change: 'Changed the password',
  // set-password links (22 October 2026): an invitation to the first password, one made for a reset, and a password
  // set with a link
  invite: 'Invited to sign in',
  password_link: 'Made a set-password link',
  password_reset: 'Reset the password',
  password_set: 'Set the password with a link',
  // access follows the contract (owner, 23 October 2026: "Active - Grace - Hold - No Access"): HR's 7 days' grace, and each
  // change of where someone's access stands (Active, Grace, Hold, No access), recorded once
  give_grace: 'Gave 7 days’ grace',
  access_standing: 'Access standing changed',
  // no contract entered (23 October 2026: "Hold them after 7 days"): first seen, the day their access holds from set
  access_no_contract: 'Recorded no contract entered',
  payroll_bank_file: 'Downloaded a bank file',
  payroll_eta_file: 'Downloaded the ETA salary-tax file',
  payroll_statistics_file: 'Downloaded the payroll statistics',
  payslip_file: 'Downloaded payslips',
  postpone_installment: 'Postponed an installment',
  prepare: 'Prepared the raise',
  // practice KPI scorecards (owner, 22 October 2026: "Practice scorecards"): one started, and one started again as its
  // draft was saved changed; each step on one is marked practice, with for whom it was stood in
  practice_reset: 'Started the practice scorecard again',
  practice_start: 'Started a practice scorecard',
  print: 'Marked printed',
  publish: 'Published',
  // "Publish selected drafts" of KPI templates (21 October 2026), each draft published also audited as published
  publish_drafts: 'Published the selected drafts',
  record: 'Recorded by HR',
  record_consent: 'Recorded the signed consent',
  refresh: 'Refreshed',
  // a change made after the payroll moved on (27 October 2026): handled by the month's run, returned to draft and refilled
  refilled: 'Handled by a refill',
  refresh_attendance: 'Refreshed from attendance',
  reject: 'Rejected',
  // the email settings' saved password removed, and a test email sent (23 October 2026); never the password
  remove_password: 'Removed the saved password',
  // the Google Maps key removed, every map back on OpenStreetMap (24 October 2026); never the key
  remove_key: 'Removed the Google Maps key',
  send_test: 'Sent a test email',
  // online interview meetings (24 October 2026): a connection made, removed, refused or needing connecting again (the
  // provider refused its sign-in), a test meeting, the default; an interview's meeting created, moved, deleted, refused,
  // or its link pasted after; never a token or a secret
  connect: 'Connected',
  connect_failed: 'Couldn’t connect',
  disconnect: 'Disconnected',
  needs_reconnecting: 'Needs connecting again',
  test_meeting: 'Created a test meeting',
  // a calendar connection's test (25 October 2026): its busy times read, never what they are
  test_calendar: 'Tested the calendar',
  // Zoho People's test (25 October 2026): today's attendance read, in counts; and a person's month of days a fetch kept
  test_zoho_people: 'Tested Zoho People',
  zoho_fetch: 'Kept days fetched from Zoho People',
  set_default: 'Changed the default',
  meeting_create: 'Created the online meeting',
  meeting_update: 'Moved the online meeting',
  meeting_delete: 'Deleted the online meeting',
  meeting_failed: 'The online meeting was refused',
  meeting_link: 'Pasted the meeting link',
  // WhatsApp (24 October 2026): a test message, a new verify token, the templates submitted and their status synced;
  // a person turning their messages on, changing what they get, turning them off, or replying STOP; never the token,
  // the app secret or a number
  send_test_message: 'Sent a test message',
  new_verify_token: 'Made a new verify token',
  submit_templates: 'Submitted the WhatsApp templates',
  sync_templates: 'Synced the WhatsApp templates’ status',
  whatsapp_opt_in: 'Turned WhatsApp messages on',
  whatsapp_choices: 'Changed what they get on WhatsApp',
  whatsapp_opt_out: 'Turned WhatsApp messages off',
  whatsapp_stop: 'Replied STOP on WhatsApp',
  // an approved home location removed (its point deleted), and one replaced by a newer approved one (20 October 2026)
  remove: 'Removed',
  reopen: 'Reopened',
  reorder: 'Reordered',
  replace: 'Replaced by a newer one',
  restore_attendance: 'Restored the attendance cut',
  return: 'Returned',
  salary_raises_file: 'Downloaded the salary raises',
  contracts_report_file: 'Downloaded the contracts report',
  leave_report_file: 'Downloaded the leave report',
  payroll_vs_insurance_file: 'Downloaded the payroll vs social insurance report',
  social_insurance_report_file: 'Downloaded the social insurance report',
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
  // an asset's values set by the CEO, Finance or a Super Admin (21 October 2026: "CEO and Finance"), as the fact only
  update_values: 'Updated the values',
  verify: 'Verified',
  view_as_act: 'Turned Act as them on or off',
  view_as_start: 'Started viewing as',
  view_as_stop: 'Stopped viewing as',
  view_restricted: 'Viewed restricted data',
  // a developer's look at it, the values hidden (22 October 2026)
  view_hidden: 'Viewed with amounts and IDs hidden',
  waive_attendance: 'Waived the attendance cut',
  withdraw: 'Withdrew',
  // offboarding (22 October 2026): a case opened (or opened again after a withdrawn ending), a clearance item cleared or
  // put back, one added, rehire eligibility set, the exit interview sent or recorded, or declined; the turnover's Excel
  add_item: 'Added a clearance item',
  clear_item: 'Changed a clearance item',
  decline_interview: 'Declined the exit interview',
  exit_interview: 'Sent the exit interview',
  open_case: 'Opened the offboarding case',
  rehire: 'Set the rehire eligibility',
  reopen_case: 'Opened the offboarding case again',
  turnover_file: 'Downloaded the turnover',
  // recruitment, Phase 2 (22 October 2026): an interview scheduled, moved, done or a no-show; an interviewer's scorecard
  // given or changed; the hiring manager's suggestion; a rejection emailed; the analytics' Excel; an onboarding
  // checklist opened, an item of it cleared or put back, one added
  schedule: 'Scheduled',
  reschedule: 'Moved to another time',
  interview_done: 'Marked done',
  no_show: 'Marked a no-show',
  feedback: 'Gave the scorecard',
  feedback_change: 'Changed the scorecard',
  suggest: 'Suggested the next step',
  rejection_email: 'Emailed the rejection',
  analytics_file: 'Downloaded the recruitment analytics',
  open_onboarding: 'Opened the onboarding checklist',
  // candidate profiles (22 October 2026): two candidates merged ("Merge with…", or a suggested match confirmed), a merge
  // undone by a Super Admin, a pair dismissed ("Not the same person"), an application moved to a new candidate, and the
  // applications and general CVs from before joined to theirs
  merge: 'Merged',
  undo_merge: 'Undid the merge',
  dismiss_match: 'Marked not the same person',
  // Suggested From Earlier CVs (24 October 2026): one added to the vacancy, invited to apply (to whom, never the words),
  // dismissed
  add_suggestion: 'Added to the vacancy',
  invite_to_apply: 'Invited to apply',
  dismiss_suggestion: 'Dismissed the suggestion',
  split: 'Moved to a new candidate',
  backfill: 'Joined the earlier ones to their candidates',
  // a day as the sum of its pairs (owner, 25 October 2026: "the working hours to be calculated between the checkin and
  // out only, not the first and last"): the days of the months not yet paid recounted once
  recount_hours: 'Recounted the hours by check-in → check-out pairs',
  // approved work from home days counted full (owner, 26 October 2026: "Full day, always"): the draft lines refilled once
  refill_wfh_days: 'Refilled the draft payroll lines for approved work from home days',
  // Recount past days on the current shifts (owner, 26 October 2026)
  recount_past_days: 'Recounted past days on the current shifts',
  // HR's notes of before moved into first screening comments (24 October 2026)
  move_notes: 'Moved the earlier notes into comments',
  mark_onboarding_item: 'Changed an onboarding item',
  add_onboarding_item: 'Added an onboarding item',
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
  // a vacancy's key skills, each CV checked for them (22 October 2026)
  keySkills: 'Key skills',
  // an application updated by the candidate applying again (25 October 2026): a new CV, the must-haves now not met
  newCv: 'New CV',
  mustHavesNotMet: 'Must-have questions not met',
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
  // Assets (21 October 2026): a user's Assets access, and an asset's fields and values
  assetsAccess: 'Assets access',
  assetClass: 'Class',
  roomId: 'Room',
  kitId: 'Kit',
  usefulLifeYears: 'Useful life (years)',
  labeledAt: 'Label printed',
  purchasePrice: 'Purchase cost',
  priceLow: 'Market value (low)',
  marketValue: 'Market value',
  priceHigh: 'Market value (high)',
  priceNote: 'Market value note',
  // a product image's (21 October 2026)
  sourcePageUrl: 'Source page',
  imageUrl: 'Image link',
  productImages: 'Product images',
  productImagesRemoved: 'Product images removed',
  // KPI pillars by department, weights by job title (22 October 2026)
  followsCompany: 'Back to the company’s pillars',
  ownWeights: 'Own weights',
  pillarsOf: 'Pillars of',
  // custody (Assets step 3, 21 October 2026)
  custodyTerms: 'Custody terms',
  custodyTermsAr: 'Custody terms in Arabic', // 24 October 2026: the form in "Arabic and English"
  custodyItemId: 'Custody item',
  dueDate: 'Return date',
  handedOverBy: 'Handed over by',
  valueAtOut: 'Value when handed over',
  // Assets step 4 (22 October 2026)
  attachedTo: 'Attached to',
  missingAccessories: 'Accessories missing',
  disposalApprovedBy: 'Approved by',
  leftKit: 'Left the kit',
  detachedFrom: 'Detached from',
  // offboarding (22 October 2026)
  endingId: 'Ending',
  overrideReason: 'Completed anyway because',
  rehire: 'Rehire eligibility',
  exitInterview: 'Exit interview',
  filledBy: 'Filled in by',
  // the email an employee signs in with, as HR chose it (22 October 2026)
  signInEmail: 'Sign-in email',
  // a practice KPI scorecard's step taken standing in (22 October 2026)
  stoodInFor: 'Stood in for',
  // the email settings (23 October 2026): the sending server, the sender, and where a test email went
  host: 'Server',
  fromName: 'Sender’s name',
  fromAddress: 'Sender’s address',
  replyTo: 'Reply-to address',
  sentTo: 'Sent to',
  // the Google Maps settings (24 October 2026): the browser key (only ever "changed") and the Map ID
  browserKey: 'Google Maps key',
  mapId: 'Map ID',
  // the meeting settings (24 October 2026): a provider's app (only ever "changed"), and the hosts and accounts
  clientId: 'Client ID',
  clientSecret: 'Client secret',
  tenantId: 'Tenant ID',
  accountId: 'Account ID',
  userClientId: 'General app’s client ID',
  userClientSecret: 'General app’s client secret',
  hostEmail: 'Host',
  accountEmail: 'Account',
  meetingId: 'Meeting ID',
  // interview hours and their defaults (25 October 2026); the Zoho app's data centre
  windows: 'Weekly hours',
  changes: 'One-off changes',
  effectiveFrom: 'Counts from',
  noticeHours: 'Minimum notice (hours)',
  bufferMinutes: 'Buffer (minutes)',
  dataCentre: 'Data centre',
  warnings: 'Warnings',
  // the WhatsApp settings (24 October 2026): the ids, the business number, the secrets (only ever "changed"), quiet
  // hours; a person's choices
  phoneNumberId: 'Phone number ID',
  businessAccountId: 'WhatsApp Business Account ID',
  displayPhone: 'Business number',
  accessToken: 'Access token',
  appSecret: 'App secret',
  verifyToken: 'Verify token',
  quietFrom: 'Quiet hours from',
  quietTo: 'Quiet hours to',
  groups: 'Messages chosen',
  // leave coverage (25 October 2026): the colleague who covers and the note to them, the staffing limit and a request over
  // it, an approver's stand-in, and a decision taken standing in
  coverId: 'Covered by',
  handoverNote: 'Handover note',
  maxOff: 'At most on annual leave at once',
  minAtWorkPercent: 'At least at work (%)',
  overStaffingLimit: 'Over the staffing limit',
  standInId: 'Stand-in',
  standInHr: 'HR stands in',
  standingInFor: 'Standing in for',
  // the positions on the CV form (25 October 2026): those HR hid, showed again or named otherwise
  positionsOnCvForm: 'Positions on the CV form',
  shownAgain: 'Shown again',
  publicNames: 'Public names',
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
