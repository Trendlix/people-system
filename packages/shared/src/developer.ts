// The Developer role (owner, 22 October 2026: "i want to create a role for develoeprs, not showing the real numbers";
// asked what a developer may do and what to hide: "act as super admin with numbers hidden and real sensitve numbers as
// national ids hidden changing nothing, and no act as", and "Money and personal IDs"). A developer:
// - sees every page and module a Super Admin sees, C-level people included (the API answers them as a Super Admin who
//   is also HR, the CEO and Finance: DEVELOPER_ACTS_AS);
// - changes nothing: every request but a read is refused, save signing out, ending their own sessions and changing their
//   own password; never views as anyone;
// - never receives money or personal IDs: the API masks them in every answer (maskForDeveloper, by the explicit lists
//   below), and refuses the files that carry them (payslips, bank files, exports, generated documents, scans).
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
export const DEVELOPER_BANNER = 'Developer view: amounts and personal IDs are hidden, and nothing can be changed.';

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

/**
 * An API answer as a developer receives it (`apiPath`: the request's path, e.g. "/api/payroll/runs/…"): every money
 * field 0 (its text's digits hidden), every personal ID "••••", an audit change's from and to hidden when its field is
 * either; everything else as it is. A new value: the answer itself is never changed.
 */
export function maskForDeveloper(body: unknown, apiPath: string): unknown {
  const walk = (value: unknown): unknown => {
    if (value === null || value === undefined || typeof value !== 'object' || value instanceof Date) return value;
    if (Array.isArray(value)) return value.map(walk);
    if (isDecimalLike(value)) return value;
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    // an audit change: { field, from, to }
    const changeKind = typeof obj.field === 'string' && ('from' in obj || 'to' in obj) ? pathKind(obj.field, apiPath) : null;
    for (const [k, v] of Object.entries(obj)) {
      if (changeKind && (k === 'from' || k === 'to')) {
        out[k] = masked(v, changeKind === 'id' ? 'id' : 'money');
        continue;
      }
      const kind = fieldKind(k, apiPath);
      out[k] = kind ? masked(v, kind) : walk(v);
    }
    return out;
  };
  return walk(body);
}
