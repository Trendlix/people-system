// The Developer role (owner, 22 October 2026: "i want to create a role for develoeprs, not showing the real numbers";
// asked what a developer may do and what to hide: "act as super admin with numbers hidden and real sensitve numbers as
// national ids hidden changing nothing, and no act as", and "Money and personal IDs"). A developer:
// - sees every page and module a Super Admin sees, C-level people included (the API answers them as a Super Admin who
//   is also HR, the CEO and Finance: DEVELOPER_ACTS_AS);
// - changes nothing: every request but a read is refused, save signing out, ending their own sessions and changing their
//   own password; never views as anyone;
// - never receives money or personal IDs: the API masks them in every answer (maskForDeveloper, by the explicit lists
//   below), and refuses the files that carry them (payslips, bank files, exports, generated documents, scans).
// - and, since the owner's "make all real employees data encrypted for developer role" (22 October 2026), never
//   receives real personal data either: every person is a pseudonym ("Employee EMP-0182", "Applicant APP-2026-0001",
//   "User 3f9a2c"), consistent across every page; emails pseudonymous; addresses, birth dates, education, emergency
//   contacts, photos and any free text about a person hidden; real names and emails scrubbed from every text; a search
//   by name finds nothing (only codes).
// Pure code: the API applies it, the web shows the banner. Tested in apps/api/src/common/developer.spec.ts.

import type { Role } from './index.js';
import { TEMPLATE_TAGS } from './templates.js';

/** The role's key, as the roles table keeps it. */
export const DEVELOPER_ROLE = 'developer' as const;

/**
 * The roles a developer's requests are answered with: a Super Admin who is also HR, the CEO and Finance (and an
 * employee), so every page opens as it does for the owner; read only, the values masked.
 */
export const DEVELOPER_ACTS_AS: readonly Role[] = ['employee', 'hr', 'finance', 'ceo', 'admin', 'super_admin'];

/** The roles a developer may hold beside it: an employee's, for their own profile. Nothing that changes anything. */
export const DEVELOPER_ROLE_WITH: readonly Role[] = ['employee'];

/** The refusal of any change. */
export const DEVELOPER_READ_ONLY = 'Developers can look but not change anything.';

/** The refusal of a file that carries pay or personal IDs. */
export const DEVELOPER_NO_FILES = 'Files with pay or personal IDs aren’t open to developers.';

/** The banner on every page of a developer's. */
export const DEVELOPER_BANNER = 'Developer view: names are pseudonyms, amounts and personal data are hidden, and nothing can be changed.';

/** A hidden personal ID, or a hidden text. */
export const HIDDEN = '••••';

/** Whether a user holds the Developer role (as the database keeps their roles). */
export const isDeveloperRole = (roles: readonly string[]): boolean => roles.includes(DEVELOPER_ROLE);

/** What is wrong with a set of roles holding the Developer role: nothing else but an employee's. Null: fine. */
export function developerRolesProblem(roles: readonly string[]): string | null {
  if (!isDeveloperRole(roles)) return null;
  return roles.every((r) => r === DEVELOPER_ROLE || (DEVELOPER_ROLE_WITH as readonly string[]).includes(r))
    ? null
    : 'A developer holds no other role but Employee: they look at everything and change nothing.';
}

// ---------- what is masked ----------

/**
 * Money, by the name of the field that holds it, wherever it is in an answer: a number becomes 0, a number written as
 * text "0", any other text has its digits hidden. Every pay figure, payroll line and total, payslip, loan and advance,
 * deduction, settlement, reimbursement, raise, job offer and vacancy salary, expected salary, asset value and repair
 * cost. Days, hours, percents, scores and counts have other names and stay.
 */
export const DEVELOPER_MONEY_FIELDS: ReadonlySet<string> = new Set([
  // salaries and terms
  'gross',
  'grossSalary',
  'currentGross',
  'startingGross',
  'suggestedGross',
  'averageGross',
  'medianGross',
  'previousGross',
  'newGross',
  'basicSalary',
  'netSalary',
  'totalSalary',
  'variableSalary',
  'insuredSalary',
  'insuredWage',
  'lastMonthlyWage',
  'hourlyRate',
  'netHourly',
  'netHourlyRate',
  'ratingPay',
  'pay',
  'allowances',
  'allowancesAr',
  'allowancesTotal',
  'taxableAllowances',
  // a payroll line's result and totals
  'fixed',
  'variable',
  'net',
  'earned',
  'earnings',
  'earningsTotal',
  'employeeInsurance',
  'employerInsurance',
  'companyInsurance',
  'healthInsurance',
  'socialInsured',
  'insurance',
  'monthlyTaxable',
  'annualNetIncome',
  'monthlyTax',
  'annualTax',
  'salaryTax',
  'tax',
  'taxed',
  'untaxed',
  'notTaxed',
  'taxedPay',
  'taxable',
  'martyrsFund',
  'penaltyCut',
  'attendanceCut',
  'kpiCut',
  'noShowCut',
  'unpaidLeaveCut',
  'deductions',
  'deductionsTotal',
  'adjustmentDeductions',
  'beforeTaxDeductions',
  'beforeTax',
  'taxableLowered',
  'additions',
  'additionsTaxed',
  'additionsUntaxed',
  'taxedAdditions',
  'untaxedAdditions',
  'overtime',
  'bonus',
  'commission',
  'settlements',
  'released',
  'transfer',
  'companyCost',
  'monthlyCost',
  'monthlyCostIncrease',
  'yearlyCostIncrease',
  'ytdEarnings',
  'ytdInsurance',
  'ytdNet',
  'ytdTax',
  'totals',
  '_sum',
  // amounts of loans, advances, deductions, claims, raises, endings
  'amount',
  'amountPaid',
  'approvedAmount',
  'increaseAmount',
  'noticeAmount',
  'payInLieu',
  'dayRate',
  'outstanding',
  'planned',
  'recovered',
  'recoveries',
  'unplanned',
  'paidOut',
  'deducted',
  'nextInstallment',
  'paid',
  'capPerClaim',
  'capPerMonth',
  'capPerYear',
  // recruitment
  'salaryMin',
  'salaryMax',
  'expectedSalary',
  // assets
  'purchasePrice',
  'purchaseCost',
  'marketValue',
  'priceLow',
  'priceHigh',
  'bookValue',
  'disposalAmount',
  'disposalBookValue',
  'valueAtOut',
  'cost',
  'repairCost',
]);

/**
 * Names that are money only on some pages (elsewhere a count or a choice): `total` (a pay version's or a claim's total;
 * an asset list's is a count), `value` (a raise's increase, a custody item's value; a select's option elsewhere), and a
 * claim type's `usedInMonth` / `usedInYear` (amounts; a leave type's are days). Masked when the API's path matches.
 */
export const DEVELOPER_MONEY_FIELDS_ON: Readonly<Record<string, RegExp>> = {
  total: /\/(payroll|salar|raise|reimburs|unsettled|offers|contracts|employments|settlement|advance|adjustment|deduction|installment|payslip|me\/pay)/i,
  value: /\/(raise|salar|custody|assets|contracts|offers)/i,
  usedInMonth: /\/(reimburs)/i,
  usedInYear: /\/(reimburs)/i,
};

/** Personal IDs, by the name of the field that holds them: shown as "••••". */
export const DEVELOPER_ID_FIELDS: ReadonlySet<string> = new Set([
  'nationalId',
  'nationalIdAr',
  'nationalIdMasked',
  'printedNo',
  'idPrintedNo',
  'accountNo',
  'accountNoMasked',
  'iban',
  'insuranceNo',
  'mobile',
  'mobile2',
  'emergencyMobile',
  'phone',
  'phones',
  'repNationalId',
  'repNationalIdMasked',
  'cibDebitAccount',
]);

/** Texts that may carry amounts in words (a payroll line's warnings): their digits hidden. */
export const DEVELOPER_MONEY_TEXT_FIELDS: ReadonlySet<string> = new Set(['warnings', 'lawWarnings', 'warning']);

/**
 * The template tags whose values are pay or personal IDs (their restricted ones, the pay, payslip, raise and ending
 * groups', and the phone), by their names: a document check or preview answering by tag hides them too.
 */
export const DEVELOPER_TAG_FIELDS: ReadonlySet<string> = new Set(
  TEMPLATE_TAGS.filter((t) => t.restricted || ['pay', 'payslip', 'raise', 'ending', 'bank', 'national_id'].includes(t.group) || t.tag === 'phone').map((t) => t.tag),
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_LIKE = /^\d{4}-\d{2}(-\d{2})?([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;
const NUMBER_TEXT = /^\s*[-−]?[\d٠-٩][\d٠-٩,٬\s]*([.٫][\d٠-٩]+)?\s*$/;

/** A Prisma Decimal (or anything that turns itself into a number). */
const isDecimalLike = (v: object): boolean => typeof (v as { toNumber?: unknown }).toNumber === 'function' && typeof (v as { toFixed?: unknown }).toFixed === 'function';

/** A text with its digits hidden; a date, a moment or an id kept (they say when or which, not how much). */
export function hiddenDigits(text: string): string {
  if (DATE_LIKE.test(text) || UUID.test(text)) return text;
  if (NUMBER_TEXT.test(text)) return '0';
  return text.replace(/[0-9٠-٩]/g, '•');
}

type Kind = 'money' | 'id' | 'text';

/** A value under a money, ID or money-text field, masked. */
function masked(value: unknown, kind: Kind): unknown {
  if (value === null || value === undefined || typeof value === 'boolean') return value;
  if (typeof value === 'number') return 0;
  if (typeof value === 'bigint') return 0;
  if (typeof value === 'string') {
    if (!value) return value;
    return kind === 'id' ? HIDDEN : hiddenDigits(value);
  }
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((v) => masked(v, kind));
  if (typeof value === 'object') {
    if (isDecimalLike(value)) return 0;
    return maskObject(value, kind);
  }
  return value;
}

/** An object under a masked field (a diff's { from, to }, an allowance { name, amount }): every number and digit in it. */
function maskObject(obj: object, kind: Kind): unknown {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    // ids, codes and names inside say which, not how much: kept unless they are money or IDs themselves
    if (typeof v === 'string' && (k === 'id' || k.endsWith('Id') || k === 'name' || k === 'nameAr' || k === 'nameEn' || k === 'label' || k === 'code' || k === 'key' || k === 'kind' || k === 'type')) {
      out[k] = v;
      continue;
    }
    out[k] = masked(v, kind);
  }
  return out;
}

/** Whether a field's path (an audit change's "grossSalary", "bank.accountNo", "values.purchasePrice") names money or an ID. */
function pathKind(path: string, apiPath: string): Kind | null {
  const parts = path.split(/[.[\]]+/).filter(Boolean);
  for (const p of parts) {
    if (DEVELOPER_ID_FIELDS.has(p)) return 'id';
    if (DEVELOPER_MONEY_FIELDS.has(p) || DEVELOPER_TAG_FIELDS.has(p) || DEVELOPER_MONEY_FIELDS_ON[p]?.test(apiPath)) return 'money';
  }
  return null;
}

/** The kind of masking a field gets on this API path, or null when it is shown. */
function fieldKind(key: string, apiPath: string): Kind | null {
  if (DEVELOPER_ID_FIELDS.has(key)) return 'id';
  if (DEVELOPER_TAG_FIELDS.has(key)) return /national_id|printed|account|iban|phone|insurance_no/.test(key) ? 'id' : 'money';
  if (DEVELOPER_MONEY_FIELDS.has(key)) return 'money';
  if (DEVELOPER_MONEY_FIELDS_ON[key]?.test(apiPath)) return 'money';
  if (DEVELOPER_MONEY_TEXT_FIELDS.has(key)) return 'text';
  return null;
}

// ---------- people (owner, 22 October 2026: "make all real employees data encrypted for developer role") ----------

/** A person as a developer sees them: a pseudonym in English and Arabic, and a pseudonymous email. */
export interface PersonLabel {
  en: string;
  ar: string;
  email: string;
}

/** The people the API knows, as the developer's masking reads them (the interceptor loads them, a minute at a time). */
export interface DeveloperPeopleRows {
  employees: readonly {
    id: string;
    employeeCode: string;
    fullNameEn: string;
    fullNameAr: string | null;
    displayName: string | null;
    workEmail: string | null;
    personalEmail: string | null;
    emergencyName: string | null;
  }[];
  /** Sign-in accounts: an employee's when its email is theirs, else a "User" of its own. */
  users: readonly { id: string; email: string }[];
  /** Job applications and general CVs (APP-…). */
  applicants: readonly { id: string; number: string; fullName: string; email: string }[];
  /** Job offers (OFF-…). */
  offers: readonly { id: string; number: string; fullNameEn: string; fullNameAr: string | null; email: string }[];
}

/** The people, ready for masking: by id, email and real name, with the scrub of every real name in a text. */
export interface DeveloperPeople {
  byId: ReadonlyMap<string, PersonLabel>;
  byEmail: ReadonlyMap<string, PersonLabel>;
  /** By a real name in lower case: the pseudonym it becomes (Arabic names the Arabic one); "••••" for names never shown. */
  byName: ReadonlyMap<string, string>;
  /** Every real name, as whole words, longest first; null with none. */
  names: RegExp | null;
}

/** A short, stable tag of a text (FNV-1a, 6 hex): the same id always the same tag. Not a secret, only a handle. */
export function personTag(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0').slice(0, 6);
}

/** An employee's pseudonym, by their code. */
export const employeeLabel = (code: string): PersonLabel => ({ en: `Employee ${code}`, ar: `موظف ${code}`, email: `${code.toLowerCase()}@hidden.invalid` });
/** An applicant's or a general CV's pseudonym, by its APP- number. */
export const applicantLabel = (number: string): PersonLabel => ({ en: `Applicant ${number}`, ar: `متقدم ${number}`, email: `${number.toLowerCase()}@hidden.invalid` });
/** A job offer's candidate, by its OFF- number. */
export const candidateLabel = (number: string): PersonLabel => ({ en: `Candidate ${number}`, ar: `مرشح ${number}`, email: `${number.toLowerCase()}@hidden.invalid` });
/** Anyone else (a sign-in account without an employee, a person the API names by id only), by a tag of their id. */
export const otherLabel = (id: string, kind = 'User'): PersonLabel => {
  const tag = personTag(id);
  return { en: `${kind} ${tag}`, ar: `${kind === 'User' ? 'مستخدم' : 'شخص'} ${tag}`, email: `${kind.toLowerCase()}-${tag}@hidden.invalid` };
};
/** An email the API doesn't know as anyone's: a pseudonym of its own, the same each time. */
export const unknownEmail = (email: string): string => `hidden-${personTag(email.trim().toLowerCase())}@hidden.invalid`;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LETTERS = /[\p{L}]/u;
/** A real name worth scrubbing: three letters at least (a shorter one would hit parts of other words). */
const scrubbable = (name: string | null | undefined): name is string => typeof name === 'string' && name.trim().length >= 3 && LETTERS.test(name);

/**
 * The people, ready for masking. When a name or an email is two people's, the first wins: employees, then offers, then
 * applicants, then accounts. Emergency contacts' names are scrubbed to "••••".
 */
export function developerPeople(rows: DeveloperPeopleRows): DeveloperPeople {
  const byId = new Map<string, PersonLabel>();
  const byEmail = new Map<string, PersonLabel>();
  const byName = new Map<string, string>();
  const email = (e: string | null | undefined, label: PersonLabel) => {
    if (e && !byEmail.has(e.trim().toLowerCase())) byEmail.set(e.trim().toLowerCase(), label);
  };
  const name = (n: string | null | undefined, as: string) => {
    if (scrubbable(n) && !byName.has(n.trim().toLowerCase())) byName.set(n.trim().toLowerCase(), as);
  };
  for (const e of rows.employees) {
    const label = employeeLabel(e.employeeCode);
    byId.set(e.id, label);
    email(e.workEmail, label);
    email(e.personalEmail, label);
    name(e.fullNameEn, label.en);
    name(e.fullNameAr, label.ar);
    name(e.displayName, label.en);
  }
  for (const o of rows.offers) {
    const label = candidateLabel(o.number);
    byId.set(o.id, label);
    email(o.email, label);
    name(o.fullNameEn, label.en);
    name(o.fullNameAr, label.ar);
  }
  for (const a of rows.applicants) {
    const label = applicantLabel(a.number);
    byId.set(a.id, label);
    email(a.email, label);
    name(a.fullName, label.en);
  }
  for (const u of rows.users) {
    const label = byEmail.get(u.email.trim().toLowerCase()) ?? otherLabel(u.id);
    byId.set(u.id, label);
    email(u.email, label);
  }
  for (const e of rows.employees) name(e.emergencyName, HIDDEN);
  const all = [...byName.keys()].sort((a, b) => b.length - a.length).map(escapeRe);
  const names = all.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${all.join('|')})(?![\\p{L}\\p{N}])`, 'giu') : null;
  return { byId, byEmail, byName, names };
}

const NO_PEOPLE: DeveloperPeople = { byId: new Map(), byEmail: new Map(), byName: new Map(), names: null };

const EMAIL_IN_TEXT = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
/** A phone number in a text: +… or 0… with 10 digits at least (dates and codes never start so). */
const PHONE_IN_TEXT = /(?<![\w+])(?:\+\d[\d \-]{8,17}\d|0\d[\d \-]{8,15}\d)(?![\w])/g;
/** A national ID in a text: 14 digits starting 2 or 3. */
const NATIONAL_ID_IN_TEXT = /(?<!\d)[23]\d{13}(?!\d)/g;
const PSEUDONYM_EMAIL = /@hidden\.invalid$/i;

/** A text with every real name the API knows, every email, phone number and national ID in it replaced. */
export function scrubText(text: string, people: DeveloperPeople = NO_PEOPLE): string {
  if (!text || UUID.test(text) || DATE_LIKE.test(text)) return text;
  let out = text;
  if (people.names) out = out.replace(people.names, (m) => people.byName.get(m.toLowerCase()) ?? HIDDEN);
  out = out.replace(EMAIL_IN_TEXT, (m) => (PSEUDONYM_EMAIL.test(m) ? m : (people.byEmail.get(m.toLowerCase())?.email ?? unknownEmail(m))));
  out = out.replace(PHONE_IN_TEXT, (m) => (m.replace(/\D/g, '').length >= 10 ? HIDDEN : m));
  return out.replace(NATIONAL_ID_IN_TEXT, HIDDEN);
}

/**
 * A person's personal data, hidden as "••••" (a text) wherever it is: addresses, place of birth, education, the
 * emergency contact, links to their profiles elsewhere, and what was read from their CV.
 */
export const DEVELOPER_HIDDEN_TEXT_FIELDS: ReadonlySet<string> = new Set([
  'address',
  'addressAr',
  'addressEn',
  'addressLine',
  'city',
  'buildingNo',
  'street',
  'area',
  'district',
  'birthPlace',
  'placeOfBirth',
  'emergencyName',
  'emergencyRelation',
  'university',
  'faculty',
  'major',
  'qualification',
  'qualificationAr',
  'previousEmployer',
  'previousEmployers',
  'linkedin',
  'portfolio',
  'cvText',
  'signature',
  'referrer',
  'zohoName',
  'acceptedName',
  'disposalApprovedBy',
  'handedOverByName',
]);

/**
 * Free text written about a person (notes, reasons, comments, descriptions, answers…), hidden as "••••" unless it is a
 * code from a list ("resigned", "contract_ended": the enums some of these names hold). Also every name ending in
 * Reason, Note, Notes, Comment or Comments.
 */
export const DEVELOPER_FREE_TEXT_FIELDS: ReadonlySet<string> = new Set(['notes', 'note', 'reason', 'reasons', 'comment', 'comments', 'description', 'answer', 'textAnswer', 'feedback', 'purpose', 'remarks', 'bio']);
const FREE_TEXT_NAME = /[a-z](Reason|Reasons|Note|Notes|Comment|Comments)$/;
const ENUM_VALUE = /^[a-z][a-z0-9_]*$/;

/** A person's data hidden as nothing (null): dates and years of their life, the lists' values about them, their photo. */
export const DEVELOPER_HIDDEN_NULL_FIELDS: ReadonlySet<string> = new Set([
  'dateOfBirth',
  'birthDate',
  'age',
  'graduationYear',
  'gender',
  'nationality',
  'maritalStatus',
  'militaryStatus',
  'religion',
  'governorate',
  'educationGrade',
  'degree',
  'photoId',
  'photoCrop',
]);

/** Fields that hold a person's name, wherever they are: their pseudonym. */
export const DEVELOPER_PERSON_NAME_FIELDS: ReadonlySet<string> = new Set([
  'fullNameEn',
  'fullNameAr',
  'fullName',
  'displayName',
  'employeeName',
  'managerName',
  'holderName',
  'userName',
  'byName',
  'candidateName',
  'applicantName',
  'personName',
  'leaverName',
  'requesterName',
  'approverName',
  'receivedByName',
  'createdByName',
  'interviewerName',
  'hiringManagerName',
  // the company's representative, who signs its documents: a person too
  'repName',
  'repNameEn',
  'companyRepName',
]);

/** Emails, wherever they are: the person's pseudonymous email. */
export const DEVELOPER_EMAIL_FIELDS: ReadonlySet<string> = new Set(['email', 'workEmail', 'personalEmail', 'signInEmail', 'emails', 'cvEmails', 'userEmail', 'byEmail']);

/**
 * Keys whose value is a person (an object with their name, or their name as text): the employee, their manager, the
 * holder of an asset, who did something (every key ending in By), the people of a list.
 */
export const DEVELOPER_PERSON_KEYS: ReadonlySet<string> = new Set([
  'employee',
  'employees',
  'manager',
  'managers',
  'holder',
  'user',
  'users',
  'person',
  'people',
  'candidate',
  'applicant',
  'requester',
  'interviewer',
  'interviewers',
  'hiringManager',
  'scorer',
  'recipient',
  'recipients',
  'actor',
  'head',
  'lead',
  'approver',
  'author',
  'viewer',
  'who',
  'owner',
  'member',
  'members',
  'leaver',
  'signer',
  'sender',
  'custodian',
  'custodians',
  'reportsTo',
  'directReports',
]);
const PERSON_NAME_KEYS_IN_PERSON = new Set(['name', 'nameEn', 'nameAr', 'shortName', 'label']);
const BY_KEY = /[a-z]By$/;
/** Names ending in By that hold no person: how a list is sorted or grouped. */
const NOT_PERSON_KEYS = new Set(['orderBy', 'sortBy', 'groupBy', 'filterBy', 'splitBy']);
const APP_NUMBER = /^APP-\d{4}-\d+$/;
const OFF_NUMBER = /^OFF-\d{4}-\d+$/;

/** Whether an object is a person: it has an employee code, a full name, a work or personal email, or an email and a name. */
function personLike(obj: Record<string, unknown>): boolean {
  const str = (k: string) => typeof obj[k] === 'string';
  return str('employeeCode') || str('fullNameEn') || str('fullNameAr') || str('fullName') || str('workEmail') || str('personalEmail') || (str('email') && str('name'));
}

/** The pseudonym of a person object: by its code or number, else its ids or email in the people, else a tag of its id. */
function labelOf(obj: Record<string, unknown>, people: DeveloperPeople): PersonLabel | null {
  const str = (k: string) => (typeof obj[k] === 'string' ? (obj[k] as string) : null);
  const code = str('employeeCode');
  if (code) return employeeLabel(code);
  const number = str('number');
  if (number && APP_NUMBER.test(number)) return applicantLabel(number);
  if (number && OFF_NUMBER.test(number)) return candidateLabel(number);
  for (const k of ['employeeId', 'userId', 'id']) {
    const id = str(k);
    if (id && people.byId.has(id)) return people.byId.get(id)!;
  }
  for (const k of ['email', 'workEmail', 'personalEmail', 'signInEmail']) {
    const e = str(k);
    if (e && people.byEmail.has(e.toLowerCase())) return people.byEmail.get(e.toLowerCase())!;
  }
  const id = str('id') ?? str('employeeId') ?? str('userId');
  return id ? otherLabel(id, 'Person') : null;
}

/** A name as text, its pseudonym: the people's by name, else the person object's, else "••••". */
function nameAs(value: string, arabic: boolean, label: PersonLabel | null, people: DeveloperPeople): string {
  if (!value) return value;
  if (label) return arabic ? label.ar : label.en;
  return people.byName.get(value.trim().toLowerCase()) ?? HIDDEN;
}

const isArabicKey = (k: string) => /Ar$/.test(k);
/** The company's own page: its address is the company's, not a person's, and stays. */
const COMPANY_PATH = /^\/api\/company(\/|$)/;
const COMPANY_ADDRESS = new Set(['address', 'addressAr', 'addressEn', 'city', 'buildingNo', 'street', 'area', 'district']);

/** Whether a field's path (an audit change's "fullNameEn", "emergency.name", "notes") names a person's data. */
function personalPath(path: string): boolean {
  const parts = path.split(/[.[\]]+/).filter(Boolean);
  return parts.some(
    (p) =>
      DEVELOPER_PERSON_NAME_FIELDS.has(p) ||
      DEVELOPER_EMAIL_FIELDS.has(p) ||
      DEVELOPER_HIDDEN_TEXT_FIELDS.has(p) ||
      DEVELOPER_HIDDEN_NULL_FIELDS.has(p) ||
      DEVELOPER_FREE_TEXT_FIELDS.has(p) ||
      FREE_TEXT_NAME.test(p) ||
      /^(emergency|address|education|birth)/i.test(p),
  );
}

/** A value under a personal field, hidden: a text "••••", anything else as nothing (null); a list, each of it. */
function hiddenPersonal(value: unknown): unknown {
  if (value === null || value === undefined || value === '') return value;
  if (Array.isArray(value)) return value.map(hiddenPersonal);
  return typeof value === 'string' ? HIDDEN : null;
}

/**
 * An API answer as a developer receives it (`apiPath`: the request's path, e.g. "/api/payroll/runs/…"; `people`: the
 * people the API knows, for pseudonyms that match from page to page):
 * - every money field 0 (its text's digits hidden), every personal ID "••••" (as before);
 * - every person a pseudonym: their name fields, a person object's name, a person's email; every real name, email,
 *   phone number and national ID in any text replaced;
 * - addresses, birth, education, the emergency contact, photos and free text about a person hidden;
 * - an audit change's from and to hidden when its field is money, an ID or a person's data.
 * A new value: the answer itself is never changed.
 */
export function maskForDeveloper(body: unknown, apiPath: string, people: DeveloperPeople = NO_PEOPLE): unknown {
  const walk = (value: unknown, person: boolean): unknown => {
    if (typeof value === 'string') return scrubText(value, people);
    if (value === null || value === undefined || typeof value !== 'object' || value instanceof Date) return value;
    if (Array.isArray(value)) return value.map((v) => walk(v, person));
    if (isDecimalLike(value)) return value;
    const obj = value as Record<string, unknown>;
    const isPerson = person || personLike(obj);
    const label = isPerson ? labelOf(obj, people) : null;
    const out: Record<string, unknown> = {};
    // an audit change: { field, from, to }
    const field = typeof obj.field === 'string' && ('from' in obj || 'to' in obj) ? obj.field : null;
    const changeKind = field ? pathKind(field, apiPath) : null;
    const changePersonal = field ? personalPath(field) : false;
    for (const [k, v] of Object.entries(obj)) {
      if (changeKind && (k === 'from' || k === 'to')) {
        out[k] = masked(v, changeKind === 'id' ? 'id' : 'money');
        continue;
      }
      if (changePersonal && (k === 'from' || k === 'to')) {
        out[k] = hiddenPersonal(v);
        continue;
      }
      const kind = fieldKind(k, apiPath);
      if (kind) {
        // a money text (a payroll line's warnings) may name people too
        out[k] = kind === 'text' ? walk(masked(v, kind), false) : masked(v, kind);
        continue;
      }
      if (DEVELOPER_HIDDEN_NULL_FIELDS.has(k)) {
        out[k] = v === undefined ? v : null;
        continue;
      }
      if (DEVELOPER_HIDDEN_TEXT_FIELDS.has(k) && !(COMPANY_PATH.test(apiPath) && COMPANY_ADDRESS.has(k))) {
        out[k] = hiddenPersonal(v);
        continue;
      }
      if ((DEVELOPER_FREE_TEXT_FIELDS.has(k) || FREE_TEXT_NAME.test(k)) && (typeof v === 'string' || Array.isArray(v))) {
        out[k] = typeof v === 'string' ? (ENUM_VALUE.test(v) ? v : HIDDEN) : v.map((x) => (typeof x === 'string' ? (ENUM_VALUE.test(x) ? x : HIDDEN) : walk(x, false)));
        continue;
      }
      if (typeof v === 'string' && (DEVELOPER_PERSON_NAME_FIELDS.has(k) || (isPerson && PERSON_NAME_KEYS_IN_PERSON.has(k)))) {
        out[k] = nameAs(v, isArabicKey(k), DEVELOPER_PERSON_NAME_FIELDS.has(k) && !isPerson ? null : label, people);
        continue;
      }
      if (DEVELOPER_EMAIL_FIELDS.has(k) && (typeof v === 'string' || Array.isArray(v))) {
        const one = (e: unknown) =>
          typeof e === 'string' && e ? (isPerson && label && k !== 'emails' && k !== 'cvEmails' ? label.email : (people.byEmail.get(e.trim().toLowerCase())?.email ?? unknownEmail(e))) : e;
        out[k] = Array.isArray(v) ? v.map(one) : one(v);
        continue;
      }
      if ((DEVELOPER_PERSON_KEYS.has(k) || BY_KEY.test(k)) && !NOT_PERSON_KEYS.has(k)) {
        // a date ("noticeBy"), an id or a code from a list says when or which, not who
        out[k] = typeof v === 'string' ? (UUID.test(v) || DATE_LIKE.test(v) || ENUM_VALUE.test(v) ? v : nameAs(v, false, null, people)) : walk(v, true);
        continue;
      }
      out[k] = walk(v, false);
    }
    return out;
  };
  return walk(body, false);
}

// ---------- searches (22 October 2026) ----------

/** A search by a code (EMP-0182, APP-2026-0001, PK-CAM-0003, CUS-0042, a part of one): a developer's only search. */
export const DEVELOPER_CODE_SEARCH = /^\s*[A-Za-z]{2,4}(-[A-Za-z0-9]{1,8}){1,3}-?\s*$/;
/** What a developer's name search becomes: matches nothing. */
export const DEVELOPER_NO_MATCH = 'developer-search-hidden';
const SEARCH_PARAMS = new Set(['q', 'search']);
const PERSON_PARAMS = new Set(['name', 'fullName', 'email', 'nationalId', 'mobile', 'phone']);

/**
 * A developer's query, made safe (null: as it is): a search finds by a code only, never by a name, so a real name can't be
 * confirmed by searching for it; a person's name, email, national ID or phone as a filter finds nothing.
 */
export function developerQuery(query: Readonly<Record<string, unknown>>): Record<string, unknown> | null {
  let changed = false;
  const out: Record<string, unknown> = { ...query };
  for (const [k, v] of Object.entries(query)) {
    if (typeof v !== 'string' || !v.trim()) continue;
    if (SEARCH_PARAMS.has(k) && !DEVELOPER_CODE_SEARCH.test(v)) {
      out[k] = DEVELOPER_NO_MATCH;
      changed = true;
    } else if (PERSON_PARAMS.has(k)) {
      out[k] = DEVELOPER_NO_MATCH;
      changed = true;
    }
  }
  return changed ? out : null;
}
