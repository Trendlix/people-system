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
//   receives real personal data either: every person is a pseudonym, consistent across every page; emails pseudonymous;
//   addresses, birth dates, education, emergency contacts, photos and any free text about a person hidden; real names
//   and emails scrubbed from every text.
// - and, since the owner's "in developer view use **** instead of IDs" (23 October 2026), never a person's code: an
//   employee's, an application's or a general CV's, a candidate's, an offer's and a contract's codes are "••••" wherever
//   they are, texts included (PERSON_CODE_IN_TEXT); a pseudonym is a tag read with the server's key from the record's id
//   ("Employee 7K3Q", "Applicant 9TX2", "Candidate M4P8", "User 4HJK"), never the code; a search for people finds
//   nothing, only assets, kits, custody and vacancies by their codes (developerQuery).
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
export const DEVELOPER_BANNER = 'Developer view: names are pseudonyms; amounts, personal data, job details and social insurance are hidden; nothing can be changed.';

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
  // the social insurance wages Form 1 prints (22 October 2026: "and the social insurance"); a developer's profile
  // leaves them out anyway, as they lack the salary right
  'insuranceBasicWage',
  'insuranceComprehensiveWage',
  'insuranceBasicDefault',
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
  // client accounts (25 October 2026): an account's and a size tier's default amount a month (an assignment's is `amount`)
  'defaultAmount',
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
  // the number printed on a paper of the employee file: a card's, a passport's, the social insurance print's (22 October
  // 2026: "and the social insurance")
  'documentNo',
  // WhatsApp (24 October 2026): the business number on the settings; people's own numbers are `mobile` (an opt-in, HR's
  // view of it, the log), all on routes a developer is refused anyway
  'displayPhone',
  // and Twilio's WhatsApp sender (25 October 2026: "Add Twilio as a choice"), the same business number, whatsapp:+20…
  'sender',
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
    createdAt?: Date | string | null;
  }[];
  /** Sign-in accounts: an employee's when linked to one (users.employee_id, else its email is theirs), else a "User" of its own. */
  users: readonly { id: string; email: string; employeeId?: string | null; createdAt?: Date | string | null }[];
  /** Job applications and general CVs (APP-…): their candidate's tag when they have one. */
  applicants: readonly { id: string; number: string; fullName: string; email: string; candidateId?: string | null; createdAt?: Date | string | null }[];
  /** Job offers (OFF-…): the employee's tag when made for one, else their application's. */
  offers: readonly {
    id: string;
    number: string;
    fullNameEn: string;
    fullNameAr: string | null;
    email: string;
    employeeId?: string | null;
    applicationId?: string | null;
    createdAt?: Date | string | null;
  }[];
  /** Candidate profiles (CAN-…; 22 October 2026: one profile per candidate): their employee's tag when linked to one. */
  candidates?: readonly { id: string; code: string; fullName: string; employeeId?: string | null; createdAt?: Date | string | null }[];
}

/** The people, ready for masking: by id, email, code and real name, with the scrub of every real name in a text. */
export interface DeveloperPeople {
  byId: ReadonlyMap<string, PersonLabel>;
  byEmail: ReadonlyMap<string, PersonLabel>;
  /** By a person's code in capitals (EMP-0182, APP-2026-0001, OFF-2026-0003, CAN-0001): their pseudonym. */
  byCode: ReadonlyMap<string, PersonLabel>;
  /** By a real name in lower case: the pseudonym it becomes (Arabic names the Arabic one); "••••" for names never shown. */
  byName: ReadonlyMap<string, string>;
  /** Every real name, as whole words, longest first; null with none. */
  names: RegExp | null;
  /** A keyed tag (6 letters) of what the people don't have: an id the API names nobody by, an email nobody's. "••••" without a key. */
  tagOf: (text: string) => string;
}

// ---------- tags (owner, 23 October 2026: "in developer view use **** instead of IDs") ----------
// A pseudonym was the person's code ("Employee EMP-0182"), so the code was the link between the pseudonym and the real
// person. It is now a tag: 4 letters from a keyed hash (HMAC-SHA256, the server's key: apps/api developer-tags.ts) of the
// record's id, so a developer who sees ids in answers and links can't work a tag out from one. Uppercase letters and
// digits without the look-alikes (0, O, 1, I). Never the code's own digits. Two people never share one: a tag already
// taken lengthens to 5, then 6 letters (the first one to have it keeps it, by when they were added). The same person has
// the same tag as an employee, a sign-in account, a candidate, an applicant and an offer, where the records link them.

/** A tag's letters: capitals and digits without the look-alikes 0, O, 1 and I (32 of them, 5 bits each). */
export const TAG_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** A keyed digest of a text (HMAC-SHA256 under the server's key; the API's developer-tags.ts): what a tag is read from. */
export type DeveloperDigest = (text: string) => Uint8Array;

/** The tag of `length` letters a digest gives, from its `window`-th run of bits (5 bits a letter; 0: the first). */
export function tagFromDigest(digest: Uint8Array, length = 4, window = 0): string {
  if (!digest.length) return HIDDEN;
  const bits = digest.length * 8;
  let out = '';
  for (let i = 0; i < length; i++) {
    let v = 0;
    for (let b = 0; b < 5; b++) {
      const at = (window * length * 5 + i * 5 + b) % bits;
      v = (v << 1) | ((digest[at >> 3] >> (7 - (at & 7))) & 1);
    }
    out += TAG_ALPHABET[v];
  }
  return out;
}

/** Whether a tag shows a code's own number: all digits, and among the code's digits (EMP-2345 is never "2345"). */
const showsCode = (tag: string, codes: readonly string[]): boolean => /^\d+$/.test(tag) && codes.some((c) => c.replace(/\D/g, '').includes(tag));

/** The first tag of a digest not taken and not showing its codes: 4 letters, else 5, else 6, else 6 from further on. */
export function freeTag(digest: Uint8Array, codes: readonly string[], taken: ReadonlySet<string>): string {
  const fits = (tag: string) => !taken.has(tag) && !showsCode(tag, codes);
  for (const length of [4, 5, 6]) {
    const tag = tagFromDigest(digest, length);
    if (fits(tag)) return tag;
  }
  for (let window = 1; window < 64; window++) {
    const tag = tagFromDigest(digest, 6, window);
    if (fits(tag)) return tag;
  }
  // never in practice (2^30 tags of 6 letters): one more letter until it is free
  const base = tagFromDigest(digest, 6);
  for (let n = 0; ; n++) {
    const tag = `${base}${TAG_ALPHABET[n % 32]}${n >= 32 ? n : ''}`;
    if (fits(tag)) return tag;
  }
}

const emailTag = (tag: string, kind: string) => `${tag === HIDDEN ? kind : `${kind}-${tag.toLowerCase()}`}@hidden.invalid`;

/** An employee's pseudonym, by their tag: "Employee 7K3Q", "موظف 7K3Q", employee-7k3q@hidden.invalid. */
export const employeeLabel = (tag: string): PersonLabel => ({ en: `Employee ${tag}`, ar: `موظف ${tag}`, email: emailTag(tag, 'employee') });
/** An applicant's or a general CV's pseudonym, by their tag. */
export const applicantLabel = (tag: string): PersonLabel => ({ en: `Applicant ${tag}`, ar: `متقدم ${tag}`, email: emailTag(tag, 'applicant') });
/** A candidate's (their profile's, their job offer's) pseudonym, by their tag. */
export const candidateLabel = (tag: string): PersonLabel => ({ en: `Candidate ${tag}`, ar: `مرشح ${tag}`, email: emailTag(tag, 'candidate') });
/** Anyone else (a sign-in account without an employee, a person the API names by id only), by their tag. */
export const otherLabel = (tag: string, kind = 'User'): PersonLabel => ({ en: `${kind} ${tag}`, ar: `${kind === 'User' ? 'مستخدم' : 'شخص'} ${tag}`, email: emailTag(tag, kind.toLowerCase()) });
/** An email the API doesn't know as anyone's: a pseudonym of its own, the same each time (a keyed tag of it). */
export const unknownEmail = (email: string, people: DeveloperPeople = NO_PEOPLE): string => emailTag(people.tagOf(email.trim().toLowerCase()), 'hidden');

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LETTERS = /[\p{L}]/u;
/** A real name worth scrubbing: three letters at least (a shorter one would hit parts of other words). */
const scrubbable = (name: string | null | undefined): name is string => typeof name === 'string' && name.trim().length >= 3 && LETTERS.test(name);

/** When a record was added, for who keeps a tag two people's digests share: the first added; none, as the rows come. */
const addedAt = (at: Date | string | null | undefined): number => {
  const t = at instanceof Date ? at.getTime() : typeof at === 'string' ? Date.parse(at) : NaN;
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
};

/**
 * The people, ready for masking, their tags read with `digest` (the server's key). The same person is one tag: a sign-in
 * account its employee's (users.employee_id, else the employee's email), a candidate their employee's, an application or
 * a general CV its candidate's, an offer its employee's or its application's; anyone else a tag of their own record's id.
 * When a name or an email is two people's, the first wins: employees, then offers, then applicants, then accounts.
 * Emergency contacts' names are scrubbed to "••••".
 */
export function developerPeople(rows: DeveloperPeopleRows, digest: DeveloperDigest): DeveloperPeople {
  const employeeIds = new Set(rows.employees.map((e) => e.id));
  // whose tag each record has: the id of the person's first record (its root)
  const rootOf = new Map<string, string>();
  const roots = new Map<string, { at: number; codes: string[] }>();
  const add = (id: string, root: string, code: string | null, at: Date | string | null | undefined) => {
    rootOf.set(id, root);
    const r = roots.get(root) ?? { at: Number.POSITIVE_INFINITY, codes: [] };
    if (root === id) r.at = addedAt(at);
    if (code) r.codes.push(code);
    roots.set(root, r);
  };
  const employeeByEmail = new Map<string, string>();
  for (const e of rows.employees) {
    add(e.id, e.id, e.employeeCode, e.createdAt);
    for (const m of [e.workEmail, e.personalEmail]) if (m && !employeeByEmail.has(m.trim().toLowerCase())) employeeByEmail.set(m.trim().toLowerCase(), e.id);
  }
  const linked = (id: string | null | undefined) => (id && rootOf.has(id) ? rootOf.get(id)! : null);
  for (const c of rows.candidates ?? []) add(c.id, (c.employeeId && employeeIds.has(c.employeeId) ? c.employeeId : null) ?? c.id, c.code, c.createdAt);
  for (const a of rows.applicants) add(a.id, linked(a.candidateId) ?? a.id, a.number, a.createdAt);
  for (const o of rows.offers) add(o.id, (o.employeeId && employeeIds.has(o.employeeId) ? o.employeeId : null) ?? linked(o.applicationId) ?? o.id, o.number, o.createdAt);
  for (const u of rows.users) {
    const employee = (u.employeeId && employeeIds.has(u.employeeId) ? u.employeeId : null) ?? employeeByEmail.get(u.email.trim().toLowerCase()) ?? null;
    add(u.id, employee ?? u.id, null, u.createdAt);
  }
  // the tags: the first added keeps the shortest free one (a later one's lengthens, so nobody's changes when someone joins)
  const tags = new Map<string, string>();
  const taken = new Set<string>();
  const order = [...roots.entries()].map(([id, r], i) => ({ id, ...r, i })).sort((a, b) => a.at - b.at || a.i - b.i);
  for (const r of order) {
    const tag = freeTag(digest(r.id), r.codes, taken);
    taken.add(tag);
    tags.set(r.id, tag);
  }
  const tagOfRecord = (id: string) => tags.get(rootOf.get(id) ?? id) ?? HIDDEN;

  const byId = new Map<string, PersonLabel>();
  const byEmail = new Map<string, PersonLabel>();
  const byCode = new Map<string, PersonLabel>();
  const byName = new Map<string, string>();
  const email = (e: string | null | undefined, label: PersonLabel) => {
    if (e && !byEmail.has(e.trim().toLowerCase())) byEmail.set(e.trim().toLowerCase(), label);
  };
  const name = (n: string | null | undefined, as: string) => {
    if (scrubbable(n) && !byName.has(n.trim().toLowerCase())) byName.set(n.trim().toLowerCase(), as);
  };
  const code = (c: string, label: PersonLabel) => {
    if (!byCode.has(c.toUpperCase())) byCode.set(c.toUpperCase(), label);
  };
  for (const e of rows.employees) {
    const label = employeeLabel(tagOfRecord(e.id));
    byId.set(e.id, label);
    code(e.employeeCode, label);
    email(e.workEmail, label);
    email(e.personalEmail, label);
    name(e.fullNameEn, label.en);
    name(e.fullNameAr, label.ar);
    name(e.displayName, label.en);
  }
  for (const o of rows.offers) {
    const label = candidateLabel(tagOfRecord(o.id));
    byId.set(o.id, label);
    code(o.number, label);
    email(o.email, label);
    name(o.fullNameEn, label.en);
    name(o.fullNameAr, label.ar);
  }
  for (const a of rows.applicants) {
    const label = applicantLabel(tagOfRecord(a.id));
    byId.set(a.id, label);
    code(a.number, label);
    email(a.email, label);
    name(a.fullName, label.en);
  }
  // a candidate's profile (its name is its applications' already, so theirs is scrubbed first)
  for (const c of rows.candidates ?? []) {
    const label = candidateLabel(tagOfRecord(c.id));
    byId.set(c.id, label);
    code(c.code, label);
    name(c.fullName, label.en);
  }
  for (const u of rows.users) {
    const root = rootOf.get(u.id);
    const label = root && root !== u.id ? byId.get(root)! : otherLabel(tagOfRecord(u.id));
    byId.set(u.id, label);
    email(u.email, label);
  }
  for (const e of rows.employees) name(e.emergencyName, HIDDEN);
  // the words of a name apart by spaces, or by _ . - as in a file name ("Ahmed_Ali_CV.pdf"); one so found, not kept as
  // written, is hidden ("••••")
  const all = [...byName.keys()].sort((a, b) => b.length - a.length).map((n) => escapeRe(n).replace(/\s+/g, '[\\s_.\\-]+'));
  const names = all.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${all.join('|')})(?![\\p{L}\\p{N}])`, 'giu') : null;
  return { byId, byEmail, byCode, byName, names, tagOf: (text) => tagFromDigest(digest(text), 6) };
}

const NO_PEOPLE: DeveloperPeople = { byId: new Map(), byEmail: new Map(), byCode: new Map(), byName: new Map(), names: null, tagOf: () => HIDDEN };

const EMAIL_IN_TEXT = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
/** A phone number in a text: +… or 0… with 10 digits at least (dates and codes never start so). */
const PHONE_IN_TEXT = /(?<![\w+])(?:\+\d[\d \-]{8,17}\d|0\d[\d \-]{8,15}\d)(?![\w])/g;
/** A national ID in a text: 14 digits starting 2 or 3. */
const NATIONAL_ID_IN_TEXT = /(?<!\d)[23]\d{13}(?!\d)/g;
const PSEUDONYM_EMAIL = /@hidden\.invalid$/i;
/**
 * A person's code, alone or in a text (owner, 23 October 2026: "in developer view use **** instead of IDs"), each one
 * person's: an employee's EMP-0182, an application's or a general CV's APP-2026-0001 (one series: a general CV's
 * reference is its number), a candidate's CAN-0001, an offer's OFF-2026-0003, and a contract's CON-2026-0007 (with an
 * amendment's -A1), as a printed contract carries it. In any case ("emp-0182.pdf"). Not a person's, and kept: assets'
 * and kits' codes (PK-CAM-0003, PK-KIT-A), custody records' (CUS-0042), vacancies' (VAC-2026-0001).
 */
export const PERSON_CODE_IN_TEXT = /(?<![\p{L}\p{N}])(?:EMP-\d{3,}|APP-\d{4}-\d+|CAN-\d{3,}|OFF-\d{4}-\d+|CON-\d{4}-\d+(?:-A\d+)?)(?![\p{L}\p{N}])/giu;
/**
 * A student's expected graduation in a text (owner, 25 October 2026: "Add a Student option"): Missing Details' "Expected
 * to graduate in June 2026: …" and a draft's "(expected to graduate June 2026)", the month hidden as the field is.
 */
const GRADUATION_IN_TEXT = /(?<=\bgraduate (?:in )?)(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4}/g;

/** A text with every real name the API knows, every email, phone number, national ID and person's code in it replaced. */
export function scrubText(text: string, people: DeveloperPeople = NO_PEOPLE): string {
  if (!text || UUID.test(text) || DATE_LIKE.test(text)) return text;
  let out = text;
  if (people.names) out = out.replace(people.names, (m) => people.byName.get(m.toLowerCase()) ?? HIDDEN);
  out = out.replace(EMAIL_IN_TEXT, (m) => (PSEUDONYM_EMAIL.test(m) ? m : (people.byEmail.get(m.toLowerCase())?.email ?? unknownEmail(m, people))));
  out = out.replace(PHONE_IN_TEXT, (m) => (m.replace(/\D/g, '').length >= 10 ? HIDDEN : m));
  return out.replace(NATIONAL_ID_IN_TEXT, HIDDEN).replace(PERSON_CODE_IN_TEXT, HIDDEN).replace(GRADUATION_IN_TEXT, HIDDEN);
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
  // every portfolio link sent on the careers forms (owner, 25 October 2026: "Portfolio per position"), each "••••"
  'portfolioLinks',
  'cvText',
  // a candidate's CV's file name, often their own name (candidate profiles, 22 October 2026), and why they left; an
  // application's earlier CVs' names too (applying again, 25 October 2026: their files are never a developer's)
  'cvFileName',
  'endReasonLabel',
  // more read from a CV (owner, 24 October 2026: "CV years in list + more rules"): the jobs of the person's past (each
  // title and company, the latest's on the lists too), their schools and universities, their certifications (free text);
  // their city is `city` above, an education's degree and graduation year are hidden as nothing (below). The skills
  // found, from the dictionary, stay
  'latestTitle',
  'latestCompany',
  'pastTitle',
  'pastCompany',
  'institution',
  'certifications',
  // Suggested From Earlier CVs (owner, 24 October 2026: "Suggest; HR adds"): the title a suggestion's reason found like
  // the job's ("Video Editor before"), a CV's latest or a job applied for before; its row's people are pseudonyms, its
  // codes "••••", its email and the invitation's address (sentTo) pseudonymous, a dismissal's reason "••••" (…Reason)
  'matchedTitle',
  // what was read from a paper of the employee file (an ID card, the social insurance print), and a search's quote of it
  // (22 October 2026: "and the social insurance")
  'ocrText',
  'snippet',
  'signature',
  'referrer',
  'zohoName',
  'acceptedName',
  'disposalApprovedBy',
  'handedOverByName',
  // the company's sending server (Email Settings, owner, 23 October 2026: "why dont we add SMTP setup in the
  // organization setup"): the settings themselves are never a developer's (@NotForDevelopers); their audit entries are
  'host',
  // where an official duty is (owner, 23 October 2026: "Official duty (OD) requests"): a client's site, an address, free
  // text about the person's day (its reason is a free text field already)
  'dutyPlace',
  // the Google Maps key (24 October 2026: "Google Maps"): its routes are never a developer's (@NotForDevelopers)
  'browserKey',
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
  // a contract document's date to start with, its contract's start date (25 October 2026)
  'defaultDate',
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
  // a student's (owner, 25 October 2026: "Add a Student option"): still studying, the year and the expected graduation
  'stillStudying',
  'studyYear',
  'expectedGraduation',
  'photoId',
  'photoCrop',
  // their national ID card's issue and expiry dates (found 23 October 2026, with the contracts' dates): the card's own
  'issueDate',
  'expiryDate',
  // an online interview's meeting (owner, 24 October 2026: "automatically generate meeting links"): its join link (a
  // developer could join an interview with it) and its id at Google, Microsoft or Zoom (a Zoom meeting's id joins it
  // too), in the interviews' answers and the audit log's entries
  'joinUrl',
  'meetingUrl',
  'meetingId',
  // the careers forms (owner, 25 October 2026): the PDF case study sent as a portfolio (its file is never a developer's:
  // @NotForDevelopers), and the email LinkedIn confirmed ("Fill in with LinkedIn"), hidden as the CV's contacts are
  'portfolioFile',
  'emailConfirmedBy',
]);

/**
 * Names that are a person's data only on some pages: a paper of the employee file's expiry (a passport's, an ID card's),
 * where a job offer's expiry stays. Null when the API's path matches.
 */
export const DEVELOPER_HIDDEN_NULL_FIELDS_ON: Readonly<Record<string, RegExp>> = {
  expiresOn: /^\/api\/(employees\/[^/]+\/paperwork|paperwork)(\/|$)/,
  // people's points on a map (found 24 October 2026, as every map turned Google's: owner, "Google Maps"): where a
  // check-in or a check-out was pressed (its point and the reading's accuracy) and a home location's point, null on every
  // page but Check-in Setup's locations, which are the company's own; and a home's label, often its address
  latitude: /^\/api\/(?!attendance\/check-in-setup\/locations(\/|$))/,
  longitude: /^\/api\/(?!attendance\/check-in-setup\/locations(\/|$))/,
  accuracyMetres: /^\/api\/(?!attendance\/check-in-setup\/locations(\/|$))/,
  label: /^\/api\/(me\/)?home-locations(\/|$)/,
  // requested check-in locations (24 October 2026: "Home Location - Remote Site - Client Location"): how far a request's
  // circle is from the places it overlaps (a home's distance from the office tells where it is), on the requests' pages;
  // and the name of the place a press was within, which is a person's own remote site's name since then, on every page but
  // Check-in Setup's (its client locations and sub-locations are the company's)
  distanceMetres: /^\/api\/(me\/)?home-locations(\/|$)/,
  locationName: /^\/api\/(?!attendance\/check-in-setup(\/|$))/,
  // an interview's place (24 October 2026): an online one's is its meeting's join link, pasted or made by the system,
  // so null on every recruitment page (an applicant's interviews, Interviews, My Hiring)
  location: /^\/api\/recruitment(\/|$)/,
};

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
  // the sender's name the company's emails carry (Email Settings, 23 October 2026), often a person's
  'fromName',
]);

/** Emails, wherever they are: the person's pseudonymous email. */
export const DEVELOPER_EMAIL_FIELDS: ReadonlySet<string> = new Set([
  'email',
  'workEmail',
  'personalEmail',
  'signInEmail',
  'emails',
  'cvEmails',
  'userEmail',
  'byEmail',
  // the company's mailbox in the email settings' audit entries (23 October 2026): its sign-in, its sender and reply-to
  // addresses, and where a test email went; a job offer's sentTo is its candidate's email
  'username',
  'fromAddress',
  'replyTo',
  'sentTo',
  // the meetings connections' accounts in their audit entries (24 October 2026): the Google account, the host mailbox or
  // Zoom user (the settings themselves are never a developer's: @NotForDevelopers)
  'accountEmail',
  'hostEmail',
]);

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
  // screening comments (owner, 24 October 2026: "is there a way to add screening comments?"; screening.ts): the
  // colleagues mentioned in one, and those who may be. A comment's author is `author` above, its text `comment` (a free
  // text field below, "••••"), the list of them `comments`
  'mentions',
  'mentionable',
]);
const PERSON_NAME_KEYS_IN_PERSON = new Set(['name', 'nameEn', 'nameAr', 'shortName', 'label']);
const BY_KEY = /[a-z]By$/;
/** Names ending in By that hold no person: how a list is sorted or grouped. */
const NOT_PERSON_KEYS = new Set(['orderBy', 'sortBy', 'groupBy', 'filterBy', 'splitBy']);
const APP_NUMBER = /^APP-\d{4}-\d+$/;
const OFF_NUMBER = /^OFF-\d{4}-\d+$/;
/** A candidate profile's code (22 October 2026): CAN-0001. */
const CAN_CODE = /^CAN-\d{4,}$/;

/** Whether an object is a person: it has an employee code, a full name, a work or personal email, or an email and a name. */
function personLike(obj: Record<string, unknown>): boolean {
  const str = (k: string) => typeof obj[k] === 'string';
  return str('employeeCode') || str('fullNameEn') || str('fullNameAr') || str('fullName') || str('workEmail') || str('personalEmail') || (str('email') && str('name'));
}

/**
 * The pseudonym of a person object: by its code or number in the people, else its ids or email in the people, else a
 * keyed tag of its id (someone added since the people were read: an employee by their code's kind, anyone else a
 * "Person"). Never by the code itself (23 October 2026: "in developer view use **** instead of IDs").
 */
function labelOf(obj: Record<string, unknown>, people: DeveloperPeople): PersonLabel | null {
  const str = (k: string) => (typeof obj[k] === 'string' ? (obj[k] as string) : null);
  const code = str('employeeCode');
  const number = str('number');
  const applicant = !!number && APP_NUMBER.test(number);
  const offer = !!number && OFF_NUMBER.test(number);
  const candidate = str('code');
  const profile = !!candidate && CAN_CODE.test(candidate);
  const coded = code ?? (applicant || offer ? number : null) ?? (profile ? candidate : null);
  if (coded && people.byCode.has(coded.toUpperCase())) return people.byCode.get(coded.toUpperCase())!;
  for (const k of ['employeeId', 'userId', 'id']) {
    const id = str(k);
    if (id && people.byId.has(id)) return people.byId.get(id)!;
  }
  for (const k of ['email', 'workEmail', 'personalEmail', 'signInEmail']) {
    const e = str(k);
    if (e && people.byEmail.has(e.toLowerCase())) return people.byEmail.get(e.toLowerCase())!;
  }
  const id = (code ? str('employeeId') : null) ?? str('id') ?? str('employeeId') ?? str('userId');
  if (!id) return null;
  const tag = people.tagOf(id);
  return code ? employeeLabel(tag) : applicant ? applicantLabel(tag) : offer || profile ? candidateLabel(tag) : otherLabel(tag, 'Person');
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
 * - an audit change's from and to hidden when its field is money, an ID or a person's data;
 * - and a person's employment and social insurance details hidden, company pages readable with their people cut off
 *   (hideJobForDeveloper, 22 October 2026).
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
      if (DEVELOPER_HIDDEN_NULL_FIELDS.has(k) || (Object.hasOwn(DEVELOPER_HIDDEN_NULL_FIELDS_ON, k) && DEVELOPER_HIDDEN_NULL_FIELDS_ON[k].test(apiPath))) {
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
          typeof e === 'string' && e ? (isPerson && label && k !== 'emails' && k !== 'cvEmails' ? label.email : (people.byEmail.get(e.trim().toLowerCase())?.email ?? unknownEmail(e, people))) : e;
        // a list of objects ([{ email, … }]) is walked, so each email in it is hidden too
        out[k] = Array.isArray(v) ? v.map((e) => (e && typeof e === 'object' ? walk(e, false) : one(e))) : one(v);
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
  return hideJobForDeveloper(walk(body, false), apiPath);
}

// ---------- searches (22 October 2026; people's off since 23 October 2026) ----------

/**
 * A developer's only search (owner, 23 October 2026: "in developer view use **** instead of IDs"): by the code of an asset
 * (ST-, PK-, IT-, OF-, CS-…), a kit (PK-KIT-…), a custody record (CUS-…) or a vacancy (VAC-…), or its start. None is a
 * person's code or a part of one (EMP-, APP-, CAN-, OFF-, CON-), so a search that also matches a holder's code finds no
 * person by it.
 */
export const DEVELOPER_CODE_SEARCH = /^\s*(?:ST|PK|IT|OF|CS|CUS|VAC)-(?:[A-Za-z0-9]{1,8}(?:-[A-Za-z0-9]{1,8}){0,2}-?)?\s*$/i;
/** What a developer's search for people becomes: matches nothing. */
export const DEVELOPER_NO_MATCH = 'developer-search-hidden';
const SEARCH_PARAMS = new Set(['q', 'search']);
/** Filters by a person's name, email, national ID, phone or code; `holder`: the assets list's, by its holder's name or code. */
const PERSON_PARAMS = new Set(['name', 'fullName', 'email', 'nationalId', 'mobile', 'phone', 'employeeCode', 'holder']);

/**
 * Where a developer's search by a code is kept (DEVELOPER_CODE_SEARCH): assets, kits, custody records and vacancies. Not
 * their lists of people (who holds what): those, and every other search, are a search for people.
 */
export const DEVELOPER_CODE_SEARCH_PATHS: readonly RegExp[] = [/^\/api\/assets(?!\/custody\/people|\/reports\/holders)(\/|$)/, /^\/api\/recruitment\/vacancies$/];

/**
 * A developer's query, made safe (null: as it is). A search for people (employees, the directory, applicants, candidates,
 * general CVs, offers, contracts, users, the audit log, pickers) finds nothing, whatever it is (23 October 2026): by a
 * name it would confirm a real name, by a code it would link a real code to its tag. Only an asset's, a kit's, a custody
 * record's or a vacancy's code finds, on their pages (DEVELOPER_CODE_SEARCH_PATHS). A person's name, email, national ID,
 * phone or code as a filter finds nothing. With the API's path (22 October 2026: "Hide per-person details"), a filter by
 * department, team, job title, grade or employment type is dropped from a list of people, so it lists everyone rather
 * than say who is where (DEVELOPER_JOB_PARAMS); a company page keeps them (its job titles by department).
 */
export function developerQuery(query: Readonly<Record<string, unknown>>, apiPath?: string): Record<string, unknown> | null {
  let changed = false;
  const out: Record<string, unknown> = { ...query };
  const people = apiPath !== undefined && !isDeveloperCompanyPath(apiPath);
  const byCode = apiPath !== undefined && DEVELOPER_CODE_SEARCH_PATHS.some((re) => re.test(apiPath));
  for (const [k, v] of Object.entries(query)) {
    if (people && (DEVELOPER_JOB_PARAMS.has(k) || (k === 'type' && EMPLOYMENT_TYPE_PARAM_PATH.test(apiPath)))) {
      delete out[k];
      changed = true;
      continue;
    }
    if (!SEARCH_PARAMS.has(k) && !PERSON_PARAMS.has(k)) continue;
    if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) continue;
    // a list or an object (?q=a&q=b, ?q[x]=…) is no code
    if (SEARCH_PARAMS.has(k) && byCode && typeof v === 'string' && DEVELOPER_CODE_SEARCH.test(v)) continue;
    out[k] = DEVELOPER_NO_MATCH;
    changed = true;
  }
  return changed ? out : null;
}

// ---------- employment and social insurance details (22 October 2026) ----------
// The owner, 22 October 2026: "why is the employment data can be viewed by developer access". A job title, a department
// and a hire date can point to one real person in a small company, even under a pseudonym; they chose "Hide per-person
// details", then added "and the social insurance". So on anything about a person (every page but the company's setup,
// DEVELOPER_COMPANY_PATHS) a developer gets none of a person's employment details nor their social insurance:
// - job title, department, team, grade, employment type, work arrangement, nature of work, pay basis, and the social
//   insurance occupation, office and sector: "••••" (DEVELOPER_JOB_TEXT_FIELDS; an object naming one, a department or a
//   job title, has every text in it hidden and its ids and numbers null);
// - the hire date, the probation's end, the last working day, the social insurance start and registration, the years of
//   service: null (DEVELOPER_JOB_DATE_FIELDS), so pages show nothing rather than break; an employment's or a contract's
//   own start, end and signing too (DEVELOPER_EMPLOYMENT_DATE_FIELDS), while a leave's, a request's, an attendance day's
//   and a scorecard's dates stay, as they are activity;
// - the ids pointing at a department, team, job title or grade (DEVELOPER_JOB_ID_FIELDS): null, so they can't be mapped
//   back through the company pages; whether registered with social insurance, paid by commission and the like: null;
// - an audit change of any of them: from and to hidden;
// - a filter by any of them doesn't narrow a list of people (developerQuery with the API's path).
// Company setup pages stay readable (departments and teams, job titles, grades, KPI templates and pillars, payroll and
// leave settings, Check-in Setup's locations…), with the people on them cut off: no name, code, email or id, as a
// department's head would otherwise say which department a pseudonym works in. Aggregates stay (headcount, turnover or
// raises by department: DEVELOPER_AGGREGATE_KEYS) as long as no row of them is a person.

/**
 * The company's setup pages, by the API's path: their departments, job titles and grades are the company's, not a
 * person's, and stay. Everything else is about people. The org chart's job titles name nobody to a developer
 * (OrgChartService); a vacancy's board lists applicants, so it is a page about people.
 */
export const DEVELOPER_COMPANY_PATHS: readonly RegExp[] = [
  /^\/api\/company(\/|$)/,
  /^\/api\/(departments|job-titles|grades|shifts|org-chart|allowance-types|contract-settings|ending-rules|reimbursement-types)(\/|$)/,
  /^\/api\/kpis\/(templates|framework|settings)(\/|$)/,
  /^\/api\/payroll\/(settings|law-rates|holidays)(\/|$)/,
  /^\/api\/leave\/(types|settings)(\/|$)/,
  /^\/api\/wfh\/settings$/,
  /^\/api\/attendance\/check-in-setup\/(locations|networks|location-rule)(\/|$)/,
  /^\/api\/(onboarding|offboarding)\/checklist$/,
  // the positions on "Send us your CV" (25 October 2026): the job titles with their levels merged, the company's
  /^\/api\/recruitment\/(vacancies(\/[^/]+)?|settings(\/positions)?)$/,
  /^\/api\/public\/careers(\/|$)/,
  /^\/api\/templates(\/(?!versions\/[^/]+\/preview-people)|$)/,
];

/** Whether the API's path is one of the company's setup pages (DEVELOPER_COMPANY_PATHS). */
export const isDeveloperCompanyPath = (apiPath: string): boolean => DEVELOPER_COMPANY_PATHS.some((re) => re.test(apiPath));

/**
 * Where a person works and on what terms, as text: "••••" on a page about people. An object under one of these names (an
 * employment's department with its parent, its job title, its grade) has every text in it "••••" and its ids and
 * numbers null; a list, each of it; a count under one of them ("team": 3 waiting) stays.
 */
export const DEVELOPER_JOB_TEXT_FIELDS: ReadonlySet<string> = new Set([
  'jobTitle',
  'jobTitleEn',
  'jobTitleAr',
  'jobTitleName',
  'newJobTitle',
  'newJobTitleEn',
  'newJobTitleAr',
  'previousJobTitle',
  'department',
  'departmentName',
  'departmentNameEn',
  'departmentNameAr',
  'departmentEn',
  'departmentAr',
  'team',
  'teamName',
  'grade',
  'gradeCode',
  'gradeName',
  'gradeLevel',
  'gradeLevelEn',
  'gradeLevelAr',
  'newGrade',
  'previousGrade',
  'employmentType',
  'employmentTypes',
  'convertsTo',
  'workArrangement',
  'workNature',
  'workPattern',
  'payBasis',
  // social insurance (22 October 2026: "and the social insurance"): the occupation, and the office and sector Form 1
  // prints; the company's own, on its page, stay
  'occupationCode',
  'occupationName',
  'insuranceOffice',
  'insuranceSectorCode',
  'insuranceEmployerNo',
]);

/** A person's dates of employment and social insurance, and their service: null on a page about people. */
export const DEVELOPER_JOB_DATE_FIELDS: ReadonlySet<string> = new Set([
  'joinDate',
  'hireDate',
  'hiredOn',
  'hiredAt',
  'probationEnd',
  'lastWorkingDay',
  'endingOn',
  'leftOn',
  'contractStart',
  'contractEnd',
  'contractStartDate',
  'contractEndDate',
  'nonRenewalNoticeBy',
  'serviceYears',
  'serviceMonths',
  'yearsOfService',
  'tenureMonths',
  'priorServiceMonths',
  // social insurance: the subscription's start, the contract's registration with the office, Form 2's date, and from
  // when the insured wage follows a raise
  'insuranceStartDate',
  'insuranceFiledOn',
  'labourOfficeFiledOn',
  'form2From',
  'insuredWageFrom',
  'insuredWageAsBefore',
  // when an intern's last agreement ended, and a new one may start
  'nextTraining',
  // an ending's (23 October 2026, found missed when the home page showed a contract's end): the notice given, its
  // certified letter, the CEO's decision due, and the deadlines counted from the last day; the days a person was employed
  // from and to (a month's attendance) and when they acknowledged their job description (on joining)
  'noticeGivenOn',
  'certifiedOn',
  'decisionDueOn',
  'finalDuesBy',
  'labourOfficeFilingBy',
  'employedFrom',
  'employedTo',
  'jdAcknowledgedAt',
  // the first day a new exemption from check-in starts with (26 October 2026): a contract's start and number, or a join
  // date, with where it came from; the whole of it null
  'suggestedFrom',
]);

/** The ids pointing at a department, team, job title or grade: null (a list of them empty) on a page about people. */
export const DEVELOPER_JOB_ID_FIELDS: ReadonlySet<string> = new Set([
  'departmentId',
  'teamId',
  'jobTitleId',
  'gradeId',
  'newJobTitleId',
  'newGradeId',
  'parentDepartmentId',
  'departmentIds',
  'teamIds',
  'jobTitleIds',
  'gradeIds',
]);

/** A person's terms as a yes or no (registered with social insurance, paid by commission…): null on a page about people. */
export const DEVELOPER_JOB_FLAG_FIELDS: ReadonlySet<string> = new Set([
  'socialInsured',
  'paidByCommission',
  'underLabourLaw',
  'hazardousWork',
  'training',
  // C-level (G9 Executive): a grade, and one that points to very few people; the grades page keeps its own mark
  'confidential',
]);

/**
 * An employment's or a contract's own dates (its start, its end, its signing, the end a warning dates from): null within
 * one, an object with an employment's or a contract's marks (EMPLOYMENT_MARKS) or under EMPLOYMENT_KEYS. A leave's start
 * and end are the same names, and stay. And the days left to a contract's end (the Contracts report, 25 October 2026),
 * which would give its end away.
 */
export const DEVELOPER_EMPLOYMENT_DATE_FIELDS: ReadonlySet<string> = new Set(['startDate', 'endDate', 'signedOn', 'effectiveDate', 'since', 'renewAt', 'daysLeft']);
const EMPLOYMENT_MARKS = [
  'joinDate',
  'employmentType',
  'probationEnd',
  'signedOn',
  'lastWorkingDay',
  'endReason',
  'insuranceFiledOn',
  'jobTitleEn',
  'gradeCode',
  'departmentName',
  'leaverKind',
  'tenureMonths',
  'contractNumber',
  // a contract ending soon (GET /contracts/expiring, 23 October 2026): its row carries its end beside the person
  'nonRenewalNoticeBy',
  'becameOpenEnded',
] as const;
const EMPLOYMENT_KEYS = new Set(['employment', 'employments', 'contract', 'contracts', 'lastEnded', 'ending', 'endings', 'pay', 'versions']);

/**
 * The API's paths whose answers are contracts, employments, their endings and raises, all of them about one person each
 * (owner, 23 October 2026, as a developer, on the home page's Contracts Ending Soon: "Ends 11/03/2024"; its row has the
 * contract's end beside the person, with none of an employment's marks): every start, end, signing and effective date in
 * them null (DEVELOPER_EMPLOYMENT_DATE_FIELDS), and the dates written in their texts hidden, wherever they are in the
 * answer. The contracts list, the contracts ending, the law's warnings, the probations ending, the endings (the CEO's
 * Approvals among them), the raises waiting and the raise requests, a person's employments, contracts, pay history and
 * hiring, the raises report, the Contracts report (25 October 2026) and a final settlement.
 */
export const DEVELOPER_EMPLOYMENT_PATHS: readonly RegExp[] = [
  /^\/api\/(contracts|employments|endings|raises|raise-requests)(\/|$)/,
  /^\/api\/employees\/[^/]+\/(employments|salary-history|raise-requests|hire)(\/|$)/,
  /^\/api\/reports\/(salary-raises|contracts)(\/|$)/,
  /^\/api\/payroll\/final-settlements(\/|$)/,
];

/** Whether the API's path answers with contracts, employments, their endings or raises (DEVELOPER_EMPLOYMENT_PATHS). */
export const isDeveloperEmploymentPath = (apiPath: string): boolean => DEVELOPER_EMPLOYMENT_PATHS.some((re) => re.test(apiPath));

/**
 * Aggregates (headcount by department, turnover or raises by department, the department rows of a dashboard): a row that
 * is no person, and has none in it, stays as it is.
 */
export const DEVELOPER_AGGREGATE_KEYS: ReadonlySet<string> = new Set(['byDepartment', 'byTeam', 'byJobTitle', 'byGrade', 'byEmploymentType', 'departments', 'teams', 'jobTitles', 'grades']);

/**
 * The template tags whose values are a person's job, terms or social insurance (a document's check or preview answering
 * by tag): "••••" on a page about people. Their manager (a pseudonym) and shift stay; the contract number is a person's
 * code, "••••" as every one is (PERSON_CODE_IN_TEXT).
 */
export const DEVELOPER_JOB_TAG_FIELDS: ReadonlySet<string> = new Set([
  ...TEMPLATE_TAGS.filter((t) => t.group === 'job_contract' && !/^(manager_name|shift|contract_number|duration$)/.test(t.tag)).map((t) => t.tag),
  'contract_date',
  'last_working_day',
  'new_job_title',
  'new_job_title_ar',
  'new_job_title_en',
  'new_grade',
  'amended_contract_date',
  'raise_effective_date',
  'insured_wage_from',
  'insurance_office',
  'insurance_sector_code',
  'insurance_employer_no',
]);

/** The filters a list of people takes that would say who is where: dropped for a developer (developerQuery). */
export const DEVELOPER_JOB_PARAMS: ReadonlySet<string> = new Set([
  'departmentId',
  'departmentIds',
  'teamId',
  'jobTitleId',
  'jobTitleIds',
  'gradeId',
  'gradeIds',
  'department',
  'team',
  'jobTitle',
  'grade',
  'employmentType',
  'workArrangement',
]);
/** Where `type` is the employment type (the contracts list and the Contracts report), not a leave's or an adjustment's. */
const EMPLOYMENT_TYPE_PARAM_PATH = /^\/api\/(contracts|employees|employments|reports\/contracts)(\/|$)/;

/**
 * Audit entries about the company's setup (a vacancy among them): their job details stay, but a department's head, a
 * vacancy's hiring manager and interviewers are people (PERSON_CHANGES).
 */
const COMPANY_AUDIT_ENTITIES = new Set([
  'company',
  'department',
  'job_title',
  'grade',
  'shift',
  'allowance_type',
  'contract_settings',
  'ending_rule',
  'holiday',
  'payroll_settings',
  'payroll_law_rates',
  'template_version',
  'leave_type',
  'leave_settings',
  // a team's staffing limit (25 October 2026): its numbers and the team's name, no person
  'leave_staffing_limit',
  'reimbursement_type',
  'kpi_template',
  'kpi_framework',
  'kpi_settings',
  'vacancy',
]);
/** Audit entries whose start and end dates are an employment's or a contract's (a leave request's stay). */
const EMPLOYMENT_AUDIT_ENTITIES = new Set(['employment', 'contract', 'employment_ending', 'job_offer', 'offboarding_case']);
/** Changes naming a person on a company entry (a department's head, a team's lead). */
const PERSON_CHANGES = new Set(['headId', 'leadId', 'teamLeadId', 'departmentHeadId', 'hiringManagerId', 'interviewerIds', 'interviewers']);

/** A date written in a text ("ended on 12/07/2027", "since 2026-07-13", "13 July 2026"), within an employment's texts. */
const DATE_IN_TEXT = /\b\d{1,2}\/\d{1,2}\/\d{4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December) \d{4}\b/g;

/** A value naming where a person works, hidden: its texts "••••", its ids, numbers and flags null, as deep as it goes. */
function hiddenJob(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value ? HIDDEN : value;
  if (Array.isArray(value)) return value.map(hiddenJob);
  if (typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === 'id' || k.endsWith('Id') ? (v === undefined ? v : null) : k.endsWith('Ids') && Array.isArray(v) ? [] : hiddenJob(v)]));
  }
  return null;
}

/** Whether an audit change's field (on an entry of `entity`) is a person's job, terms or social insurance. */
function jobChange(field: string, entity: string | null): boolean {
  const parts = field.split(/[.[\]]+/).filter(Boolean);
  if (entity !== null && COMPANY_AUDIT_ENTITIES.has(entity)) return parts.some((p) => PERSON_CHANGES.has(p));
  return parts.some(
    (p) =>
      DEVELOPER_JOB_TEXT_FIELDS.has(p) ||
      DEVELOPER_JOB_DATE_FIELDS.has(p) ||
      DEVELOPER_JOB_ID_FIELDS.has(p) ||
      DEVELOPER_JOB_FLAG_FIELDS.has(p) ||
      PERSON_CHANGES.has(p) ||
      p === 'officeDays' ||
      (entity !== null && EMPLOYMENT_AUDIT_ENTITIES.has(entity) && DEVELOPER_EMPLOYMENT_DATE_FIELDS.has(p)),
  );
}

/** Whether a value is a person or has one in it: a person-like object, or a row about one (its employeeId). */
function containsPerson(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsPerson);
  if (value === null || typeof value !== 'object' || value instanceof Date) return false;
  const obj = value as Record<string, unknown>;
  if (personLike(obj) || typeof obj.employeeId === 'string' || typeof obj.employmentId === 'string') return true;
  return Object.entries(obj).some(([k, v]) => (DEVELOPER_PERSON_KEYS.has(k) && v !== null && typeof v === 'object') || containsPerson(v));
}

/** A page about people: every person's employment and social insurance details hidden, aggregates as they are. */
function hiddenJobs(value: unknown, employment: boolean, entity: string | null, whole = false): unknown {
  // a text in a list, on a page of contracts and employments (`whole`: DEVELOPER_EMPLOYMENT_PATHS): its dates hidden
  if (whole && typeof value === 'string') return DATE_LIKE.test(value) || UUID.test(value) ? value : value.replace(DATE_IN_TEXT, HIDDEN);
  if (value === null || typeof value !== 'object' || value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((v) => hiddenJobs(v, employment, entity, whole));
  if (isDecimalLike(value)) return value;
  const obj = value as Record<string, unknown>;
  const inEmployment = whole || employment || EMPLOYMENT_MARKS.some((m) => m in obj);
  const at = typeof obj.entityType === 'string' ? obj.entityType : entity;
  // an audit change: { field, from, to }
  const change = typeof obj.field === 'string' && ('from' in obj || 'to' in obj) && jobChange(obj.field, at);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) out[k] = v;
    else if (change && (k === 'from' || k === 'to')) out[k] = hiddenPersonal(v);
    else if (DEVELOPER_AGGREGATE_KEYS.has(k) && Array.isArray(v)) out[k] = v.map((row) => (containsPerson(row) ? hiddenJobs(row, false, at, whole) : row));
    else if (DEVELOPER_JOB_TEXT_FIELDS.has(k) || DEVELOPER_JOB_TAG_FIELDS.has(k)) out[k] = typeof v === 'number' || typeof v === 'boolean' ? v : hiddenJob(v);
    else if (DEVELOPER_JOB_DATE_FIELDS.has(k)) out[k] = null;
    else if (DEVELOPER_JOB_ID_FIELDS.has(k)) out[k] = Array.isArray(v) ? [] : null;
    else if (DEVELOPER_JOB_FLAG_FIELDS.has(k) && typeof v === 'boolean') out[k] = null;
    // a payroll line's terms: whether the person is registered with social insurance
    else if (k === 'insured' && typeof v === 'boolean' && 'insuredWage' in obj) out[k] = null;
    // a hybrid employment's office days say its work arrangement
    else if (k === 'officeDays' && Array.isArray(v)) out[k] = [];
    else if (inEmployment && DEVELOPER_EMPLOYMENT_DATE_FIELDS.has(k)) out[k] = null;
    // a text of an employment's (a law warning's message): the dates written in it
    else if (inEmployment && typeof v === 'string') out[k] = DATE_LIKE.test(v) || UUID.test(v) ? v : v.replace(DATE_IN_TEXT, HIDDEN);
    else out[k] = hiddenJobs(v, EMPLOYMENT_KEYS.has(k), at, whole);
  }
  return out;
}

/** A pseudonym in a text ("Employee 7K3Q", "User 4HJK9X"; 23 October 2026: a tag, never the code), and a pseudonymous email. */
const PSEUDONYM_IN_TEXT = /(?:Employee|موظف|Applicant|متقدم|Candidate|مرشح|User|مستخدم|Person|شخص) (?:[2-9A-HJ-NP-Z]{4,7}|••••)(?![\p{L}\p{N}])/gu;
const PSEUDONYM_EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@hidden\.invalid/gi;
/** Keys holding the id of a person, besides `id` within one: the employee's, the head's, who did something. */
const PERSON_ID_KEY = /^(employee|user|manager|head|lead|teamLead|departmentHead|hiringManager|holder|custodian|approver|requester|owner|interviewer|scorer|member|person|signer|author|recipient)Ids?$|[a-z]By(User)?Ids?$/;
const PERSON_CODE_KEYS = new Set(['employeeCode', 'number']);

/** A company page: its people cut off (no name, code, email or id), so none of them can be placed by it. */
function cutOff(value: unknown, person: boolean): unknown {
  if (typeof value === 'string') return value.replace(PSEUDONYM_IN_TEXT, HIDDEN).replace(PSEUDONYM_EMAIL_IN_TEXT, HIDDEN);
  if (value === null || typeof value !== 'object' || value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((v) => cutOff(v, person));
  if (isDecimalLike(value)) return value;
  const obj = value as Record<string, unknown>;
  const isPerson = person || personLike(obj);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) out[k] = v;
    else if (PERSON_ID_KEY.test(k) || (isPerson && k === 'id')) out[k] = Array.isArray(v) ? [] : null;
    else if (isPerson && PERSON_CODE_KEYS.has(k) && typeof v === 'string') out[k] = v ? HIDDEN : v;
    else if ((DEVELOPER_PERSON_KEYS.has(k) || BY_KEY.test(k)) && !NOT_PERSON_KEYS.has(k)) out[k] = cutOff(v, true);
    else out[k] = cutOff(v, false);
  }
  return out;
}

/**
 * A developer's answer without the employment and social insurance details of anyone in it (22 October 2026: "Hide
 * per-person details", "and the social insurance"): on a company page (DEVELOPER_COMPANY_PATHS) its departments, job
 * titles and grades as they are and its people cut off; on any other page each person's job, terms, employment dates and
 * social insurance hidden, aggregates kept. maskForDeveloper ends with it. A new value: the answer is never changed.
 */
export function hideJobForDeveloper(body: unknown, apiPath: string): unknown {
  return isDeveloperCompanyPath(apiPath) ? cutOff(body, false) : hiddenJobs(body, false, null, isDeveloperEmploymentPath(apiPath));
}
