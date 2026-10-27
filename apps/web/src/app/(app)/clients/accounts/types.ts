// Clients → Client Accounts as the API sends it (owner, 25 October 2026: "if an employee has an allowance per account,
// how can we deal with it?"; apps/api client-accounts views.ts). Dates are "YYYY-MM-DD". The amounts (an account's
// default, a size's, an assignment's) are null for anyone who doesn't see salaries (HR, Finance and the CEO; an Admin or
// a Super Admin only with one of them; never a developer). A C-level person's assignments are left out for anyone they
// are hidden from, the account counting them (`hidden`).

/** Where an assignment stands today: held now, yet to start, or ended. */
export type AssignmentStanding = 'current' | 'upcoming' | 'past';

/** A person on an account, from a day to a day (none: still held), at an amount a month. */
export interface AssignmentView {
  id: string;
  accountId: string;
  employee: { id: string; employeeCode: string; fullNameEn: string };
  employmentId: string;
  fromDate: string;
  toDate: string | null;
  amount: number | null;
  /**
   * The amount per account their signed contract sets (owner, 27 October 2026), which payroll pays in place of `amount`;
   * null: none (each assignment's amount is paid), or not seen. Missing from an API before it: none.
   */
  contractAmount?: number | null;
  note: string | null;
  standing: AssignmentStanding;
}

/** A client account, with its people: current first, then those yet to start, then the past ones. */
export interface ClientAccountView {
  id: string;
  nameEn: string;
  nameAr: string | null;
  code: string | null;
  status: 'active' | 'ended';
  endedOn: string | null;
  notes: string | null;
  tier: { id: string; nameEn: string } | null;
  /** The department or team that serves it: "Marketing › Content Team". */
  department: { id: string; name: string } | null;
  defaultAmount: number | null;
  assignments: AssignmentView[];
  /** The C-level people's assignments left out for the caller. */
  hidden: number;
}

/** A size of account (Small, Medium, Large …) and its default amount a month; `accounts`: how many have it. */
export interface TierView {
  id: string;
  nameEn: string;
  defaultAmount: number | null;
  sortOrder: number;
  accounts: number;
}

/** GET /client-accounts: every account, the sizes, whether the caller sees the amounts and whether they change them. */
export interface ClientAccountsList {
  accounts: ClientAccountView[];
  tiers: TierView[];
  seesAmounts: boolean;
  edits: boolean;
}

/** Someone the Assign form offers: their id, and their name · code · team. */
export interface PersonOption {
  value: string;
  label: string;
}
