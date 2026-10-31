import { APP_USER_AGENT_MARK } from './sessions.js';

// The Audit Log's shared words (owner, 31 October 2026: "i want a log for all actions taken on the system ,, same as the
// one on trendlix website"; chosen: "Sign-ins tab", "Refused attempts (Result)", "Module filter"; then "with location
// and ip capture", and the app's position "with each sign-in and action"). Pure: the API files and filters entries by
// these, the website shows them. Modelled on the Trendlix website's own log (its sign-in outcomes, its modules, "Chrome
// 141 on macOS", an address inside the host's own network shown as not recorded).

// ---------- modules ----------

/** The parts of the system an entry belongs to, in the order the Module filter lists them. */
export const AUDIT_MODULES = [
  'organisation',
  'employees',
  'documents',
  'attendance',
  'leave',
  'payroll',
  'reimbursements',
  'kpis',
  'assets',
  'recruitment',
  'lifecycle',
  'access',
  'settings',
  'other',
] as const;
export type AuditModule = (typeof AUDIT_MODULES)[number];

export const AUDIT_MODULE_LABELS: Readonly<Record<AuditModule, string>> = {
  organisation: 'Organisation',
  employees: 'Employees',
  documents: 'Documents',
  attendance: 'Attendance',
  leave: 'Leave',
  payroll: 'Payroll',
  reimbursements: 'Reimbursements',
  kpis: 'KPIs',
  assets: 'Assets',
  recruitment: 'Recruitment',
  lifecycle: 'Onboarding and offboarding',
  access: 'Users and sign-ins',
  settings: 'Settings',
  other: 'Other',
};

export const isAuditModule = (value: unknown): value is AuditModule => typeof value === 'string' && (AUDIT_MODULES as readonly string[]).includes(value);

/**
 * The module of each kind of record the services write (audit_log.entity_type). The API's test reads the sources and
 * fails when a kind written there has no module here. A refused attempt (below) is written on its module's own key.
 */
export const AUDIT_ENTITY_MODULES: Readonly<Record<string, AuditModule>> = {
  // organisation
  company: 'organisation',
  department: 'organisation',
  job_title: 'organisation',
  grade: 'organisation',
  // employees
  employee: 'employees',
  employment: 'employees',
  contract: 'employees',
  contract_settings: 'employees',
  contracts_report: 'employees',
  paperwork: 'employees',
  profile_change_request: 'employees',
  profile_confirmation: 'employees',
  // a request for a new profile photo (being built alongside, 31 October 2026)
  profile_photo_request: 'employees',
  raise_request: 'employees',
  salary_raises_report: 'employees',
  // documents
  generated_document: 'documents',
  template_version: 'documents',
  ocr_correction: 'documents',
  // attendance
  attendance_correction: 'attendance',
  attendance_day: 'attendance',
  attendance_record_removal: 'attendance',
  attendance_import: 'attendance',
  attendance_summary: 'attendance',
  check_in_location: 'attendance',
  check_in_location_rule: 'attendance',
  check_in_gps_lock: 'attendance',
  check_in_exemption: 'attendance',
  home_location: 'attendance',
  office_networks: 'attendance',
  shift: 'attendance',
  holiday: 'attendance',
  wfh_request: 'attendance',
  od_request: 'attendance',
  zoho_people_connection: 'attendance',
  zoho_people_run: 'attendance',
  zoho_people_exclusion: 'attendance',
  // leave
  leave_adjustment: 'leave',
  leave_document: 'leave',
  leave_import: 'leave',
  leave_request: 'leave',
  leave_settings: 'leave',
  leave_staffing_limit: 'leave',
  leave_type: 'leave',
  leave_year_closing: 'leave',
  leave_report: 'leave',
  permission_request: 'leave',
  compensatory_request: 'leave',
  // payroll
  allowance_type: 'payroll',
  final_settlement: 'payroll',
  payroll_adjustment: 'payroll',
  payroll_advance: 'payroll',
  payroll_law_rates: 'payroll',
  payroll_line: 'payroll',
  payroll_locked_change: 'payroll',
  payroll_run: 'payroll',
  payroll_settings: 'payroll',
  payroll_statistics: 'payroll',
  payroll_vs_insurance: 'payroll',
  recurring_deduction: 'payroll',
  social_insurance_report: 'payroll',
  client_account: 'payroll',
  client_account_assignment: 'payroll',
  client_account_tier: 'payroll',
  // reimbursements
  reimbursement_claim: 'reimbursements',
  reimbursement_receipt: 'reimbursements',
  reimbursement_type: 'reimbursements',
  // KPIs
  kpi_framework: 'kpis',
  kpi_report: 'kpis',
  kpi_scorecard: 'kpis',
  kpi_settings: 'kpis',
  kpi_template: 'kpis',
  // assets
  asset: 'assets',
  asset_draft: 'assets',
  asset_count: 'assets',
  asset_kit: 'assets',
  asset_photo: 'assets',
  asset_room: 'assets',
  asset_report: 'assets',
  asset_settings: 'assets',
  custody_record: 'assets',
  // recruitment
  vacancy: 'recruitment',
  vacancy_suggestion: 'recruitment',
  job_application: 'recruitment',
  general_cv: 'recruitment',
  candidate: 'recruitment',
  screening_comment: 'recruitment',
  job_offer: 'recruitment',
  interview: 'recruitment',
  interview_settings: 'recruitment',
  interview_hours: 'recruitment',
  recruitment_settings: 'recruitment',
  recruitment_analytics: 'recruitment',
  linkedin_settings: 'recruitment',
  agency_mark: 'recruitment',
  meeting_settings: 'recruitment',
  meeting_connection: 'recruitment',
  calendar_settings: 'recruitment',
  calendar_connection: 'recruitment',
  // onboarding and offboarding
  onboarding_checklist: 'lifecycle',
  onboarding_defaults: 'lifecycle',
  employment_ending: 'lifecycle',
  ending_rule: 'lifecycle',
  offboarding_case: 'lifecycle',
  clearance_checklist: 'lifecycle',
  turnover_report: 'lifecycle',
  resignation_request: 'lifecycle',
  resignation_letter: 'lifecycle',
  // users and sign-ins (an account, its sessions, phones and access, the log itself)
  user: 'access',
  audit_log: 'access',
  // settings
  mail_settings: 'settings',
  maps_settings: 'settings',
  whatsapp_settings: 'settings',
  whatsapp_opt_in: 'settings',
};

/** The module an entry is in: its kind of record's, or a refused attempt's own; null for a kind not listed. */
export function auditModuleOf(entityType: string): AuditModule | null {
  return AUDIT_ENTITY_MODULES[entityType] ?? (isAuditModule(entityType) ? entityType : null);
}

/** The kinds of record (audit_log.entity_type) the Module filter matches: its own and its refused attempts' key. */
export function auditEntityTypesOf(module: AuditModule): string[] {
  return [...Object.entries(AUDIT_ENTITY_MODULES).filter(([, m]) => m === module).map(([type]) => type), module];
}

// ---------- refused attempts ----------

/**
 * A change a signed-in person tried and was refused (owner, 31 October 2026: "Also log what someone tried and was
 * refused (no permission, a locked month, a rule broken)"): written with this action, on the module's key, its diff the
 * method, the address's pattern, the answer's status and its message. Never what was sent.
 */
export const REFUSED_ACTION = 'refused';

/** The Result filter: done, or refused. */
export const AUDIT_RESULTS = ['succeeded', 'refused'] as const;
export type AuditResult = (typeof AUDIT_RESULTS)[number];
export const AUDIT_RESULT_LABELS: Readonly<Record<AuditResult, string>> = { succeeded: 'Succeeded', refused: 'Refused' };
export const isAuditResult = (value: unknown): value is AuditResult => typeof value === 'string' && (AUDIT_RESULTS as readonly string[]).includes(value);

/**
 * The actions that are refusals: a refused attempt, and those the services word themselves (a sign-in, a fingerprint
 * sign-in or a check-in refused, a sign-in while locked out, the connector ended for safety). Every other is Succeeded.
 */
export const REFUSAL_ACTIONS: readonly string[] = [REFUSED_ACTION, 'login_failed', 'login_locked_out', 'device_login_failed', 'check_in_refused', 'connector_refused'];

/** An entry's result, by its action. */
export const auditResultOf = (action: string): AuditResult => (REFUSAL_ACTIONS.includes(action) ? 'refused' : 'succeeded');

/** The answers a refused attempt is recorded for: a bad request, no permission, not found, a conflict, a rule broken. */
export const REFUSED_STATUSES: readonly number[] = [400, 403, 404, 409, 422];

/** The longest refusal message kept. */
export const REFUSED_MESSAGE_MAX = 500;

// ---------- sign-ins ----------

/** The audit_log actions the Sign-ins tab lists. */
export const SIGN_IN_ACTIONS = [
  'login',
  'login_failed',
  'login_locked_out',
  'device_login',
  'device_login_failed',
  'login_code_sent',
  'api_docs_open',
  'logout',
  'password_set',
] as const;

/** Why a sign-in was refused, kept with each refusal from 31 October 2026 (login_failed's `reason`). */
export const SIGN_IN_REFUSALS = ['wrong_password', 'unknown_email', 'inactive', 'not_allowed'] as const;
export type SignInRefusal = (typeof SIGN_IN_REFUSALS)[number];

/** A sign-in's outcome, as the Sign-ins tab shows it ("failed": refused before the reason was kept). */
export const SIGN_IN_OUTCOMES = [
  'signed_in',
  'wrong_password',
  'unknown_email',
  'inactive',
  'not_allowed',
  'locked_out',
  'code_sent',
  'code_refused',
  'fingerprint_refused',
  'signed_out',
  'password_set',
  'failed',
] as const;
export type SignInOutcome = (typeof SIGN_IN_OUTCOMES)[number];

export const SIGN_IN_OUTCOME_LABELS: Readonly<Record<SignInOutcome, string>> = {
  signed_in: 'Signed in',
  wrong_password: 'Wrong password',
  unknown_email: 'Unknown email',
  inactive: 'Access turned off',
  not_allowed: 'Not allowed',
  locked_out: 'Locked out',
  code_sent: 'Code sent',
  code_refused: 'Code refused',
  fingerprint_refused: 'Fingerprint refused',
  signed_out: 'Signed out',
  password_set: 'Password set',
  failed: 'Refused',
};

export const isSignInOutcome = (value: unknown): value is SignInOutcome => typeof value === 'string' && (SIGN_IN_OUTCOMES as readonly string[]).includes(value);

/** Whether an outcome went through (shown green), or was refused (red). */
export const signInOutcomeOk = (outcome: SignInOutcome): boolean => ['signed_in', 'code_sent', 'signed_out', 'password_set'].includes(outcome);

/** How someone signed in, or tried to. */
export const SIGN_IN_METHODS = ['password', 'fingerprint', 'email_code', 'api_docs', 'link'] as const;
export type SignInMethod = (typeof SIGN_IN_METHODS)[number];
export const SIGN_IN_METHOD_LABELS: Readonly<Record<SignInMethod, string>> = {
  password: 'Password',
  fingerprint: 'Fingerprint',
  email_code: 'Email code',
  api_docs: 'API docs',
  link: 'Set-password link',
};
export const isSignInMethod = (value: unknown): value is SignInMethod => typeof value === 'string' && (SIGN_IN_METHODS as readonly string[]).includes(value);

// ---------- where it came from ----------

/**
 * The visitor's browser and place as the website (on Vercel) saw them, signed with WEB_KEY like the address (owner, 31
 * October 2026: "with location and ip capture"): a header holding them as JSON (base64url), and its HMAC-SHA256 over
 * clientMetaPayload. Apart from the address's signature, so an API still on an older version ignores it and check-ins'
 * network lock reads the address as ever. The place comes from Vercel's own headers; nothing is looked up elsewhere.
 */
export const CLIENT_META_HEADER = 'x-people-client-meta';
export const CLIENT_META_SIGNATURE_HEADER = 'x-people-client-meta-signature';

/** The browser and place, as signed: when (milliseconds since 1970), the user agent, the country code, region and city. */
export interface ClientMeta {
  at: number;
  ua?: string;
  country?: string;
  region?: string;
  city?: string;
}

/** The longest user agent kept, and the longest region or city. */
export const USER_AGENT_MAX = 500;
const PLACE_MAX = 100;

/** What is signed: the version, the encoded meta and the session token's SHA-256 (hex), a line each. */
export const clientMetaPayload = (encoded: string, tokenHash: string): string => ['people-client-meta-v1', encoded, tokenHash].join('\n');

const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const t = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return t ? t.slice(0, max) : undefined;
};

/** The meta as read from its JSON, strictly: a time, and each of the rest only as text (cut to length), else null. */
export function readClientMeta(value: unknown): ClientMeta | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.at !== 'number' || !Number.isSafeInteger(v.at) || v.at <= 0) return null;
  const country = text(v.country, 3)?.toUpperCase();
  return {
    at: v.at,
    ...(text(v.ua, USER_AGENT_MAX) && { ua: text(v.ua, USER_AGENT_MAX) }),
    ...(country && /^[A-Z]{2}$/.test(country) && { country }),
    ...(text(v.region, PLACE_MAX) && { region: text(v.region, PLACE_MAX) }),
    ...(text(v.city, PLACE_MAX) && { city: text(v.city, PLACE_MAX) }),
  };
}

/** Vercel's city, URL-encoded ("S%C3%A3o%20Paulo"), as text; the text as it came when it can't be decoded. */
export function vercelCity(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** A country's name in English from its code ("EG" → "Egypt"); the code when it isn't known. */
export function countryName(code: string | null | undefined): string | null {
  if (!code) return null;
  const upper = code.toUpperCase();
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'code' }).of(upper);
    return name && name !== 'Unknown Region' ? name : upper;
  } catch {
    return upper;
  }
}

/** Where an entry came from in words: "Cairo, Egypt", "Egypt"; null when nothing is known. */
export function placeText(p: { city?: string | null; region?: string | null; country?: string | null }): string | null {
  const country = countryName(p.country);
  const local = p.city || null;
  if (local && country) return `${local}, ${country}`;
  return local ?? country;
}

/**
 * The phone's last known position, sent by the app on every request (owner, 31 October 2026: "Yes, with each sign-in
 * and action"): "<lat>,<lng>,<accuracy metres>[,mock]", decimal degrees, ",mock" when the phone says it is a made-up
 * position. Read only from the app's own requests; never from the website's.
 */
export const APP_LOCATION_HEADER = 'x-people-location';

export interface AppLocation {
  latitude: number;
  longitude: number;
  accuracyMetres: number;
  mock: boolean;
}

const DEGREES = /^-?\d{1,3}(\.\d{1,6})?$/;

/** The app's position from its header, strictly (latitude −90..90, longitude −180..180, accuracy 0..100,000 m), else null. */
export function parseAppLocation(value: string | string[] | null | undefined): AppLocation | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const parts = value.split(',').map((p) => p.trim());
  if (parts.length < 3 || parts.length > 4) return null;
  const [lat, lng, acc, mark] = parts;
  if (!DEGREES.test(lat) || !DEGREES.test(lng) || !/^\d{1,6}$/.test(acc)) return null;
  if (mark !== undefined && mark !== 'mock') return null;
  const latitude = Number(lat);
  const longitude = Number(lng);
  const accuracyMetres = Number(acc);
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || accuracyMetres > 100_000) return null;
  return { latitude: latitude + 0, longitude: longitude + 0, accuracyMetres, mock: mark === 'mock' };
}

/** Where a request's address came from: the website's, signed with WEB_KEY, or the connection's own (the app's, or unsigned). */
export const AUDIT_IP_SOURCES = ['website', 'connection'] as const;
export type AuditIpSource = (typeof AUDIT_IP_SOURCES)[number];

/**
 * An address inside a private or local network (10.x, 192.168.x, 127.x, ::1 …): the host's own, never the visitor's,
 * so it isn't shown as theirs (as the Trendlix website's log does).
 */
export const INTERNAL_ADDRESS = /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$|f[cd][0-9a-f]{2}:|fe80:)/i;

/** The address as the log shows it: without an IPv4-mapped prefix; null for none, or one inside the host's own network. */
export function shownAddress(ip: string | null | undefined): string | null {
  const address = (ip ?? '').trim().replace(/^::ffff:/i, '');
  return address && !INTERNAL_ADDRESS.test(address) ? address : null;
}

// ---------- the browser or app ----------

const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/iPhone|\(ios\)/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android|\(android\)/, 'Android'],
  [/CrOS/, 'ChromeOS'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh|\(macos\)/, 'macOS'],
  [/Linux/, 'Linux'],
];

// Edge, Opera and Samsung's also say Chrome, and Chrome says Safari, so they are asked first
const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/Edg(?:e|A|iOS)?\/(\d+)/, 'Edge'],
  [/OPR\/(\d+)/, 'Opera'],
  [/SamsungBrowser\/(\d+)/, 'Samsung Internet'],
  [/(?:Firefox|FxiOS)\/(\d+)/, 'Firefox'],
  [/(?:Chrome|CriOS)\/(\d+)/, 'Chrome'],
  [/Version\/(\d+)[^ ]* .*Safari\//, 'Safari'],
];

/**
 * A user agent in a few words (as the Trendlix website's log writes it): "Chrome 141 on macOS", "Safari 18 on iPhone",
 * "Trendlix People app 0.6.13 on Android"; the line itself (cut short) when it names none of these; null for none.
 */
export function userAgentSummary(userAgent: string | null | undefined): string | null {
  const ua = userAgent?.trim() ?? '';
  if (!ua) return null;
  const system = SYSTEMS.find(([named]) => named.test(ua))?.[1];
  const on = system ? ` on ${system}` : '';
  if (ua.endsWith(APP_USER_AGENT_MARK)) {
    const version = /Trendlix People\/([0-9][0-9A-Za-z.+-]{0,20})/.exec(ua)?.[1];
    return `Trendlix People app${version ? ` ${version}` : ''}${on}`;
  }
  for (const [pattern, name] of BROWSERS) {
    const version = pattern.exec(ua)?.[1];
    if (version) return `${name} ${version}${on}`;
  }
  return ua.length > 60 ? `${ua.slice(0, 60)}…` : ua;
}
