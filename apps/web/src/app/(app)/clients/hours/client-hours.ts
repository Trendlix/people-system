import { isMonth, type ClientHoursGroup } from '@trendlix/shared';
import { focusedAccount } from '../accounts/accounts';

// Clients → Client Hours (owner, 4 November 2026: "Full salary, hours tracked", the hours of those on timesheets kept for
// the clients; the "client reports" still to do): a month's hours logged on timesheets, by client account and by person,
// the approved hours apart from those still waiting for approval. For those who see the client accounts (HR, the CEO,
// Finance and a Super Admin). The addresses (the page, the API's report and workbook, the download), the month asked
// for, a client's link to its account, and the hours as the table writes them. Pure code (relative imports), tested in
// client-hours.test.ts; the API checks who reads it again.

export const CLIENT_HOURS_PATH = '/clients/hours';

type Query = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined | null) => (Array.isArray(v) ? v[0] : (v ?? undefined));

/** The month asked for in the address (?month=YYYY-MM); this month without a valid one. */
export function readMonth(query: Query, today: string): string {
  const m = one(query.month)?.trim();
  return m && isMonth(m) ? m : today.slice(0, 7);
}

/** The page at a month: this month without ?month=. */
export const clientHoursHref = (month: string, thisMonth: string): string => (month === thisMonth ? CLIENT_HOURS_PATH : `${CLIENT_HOURS_PATH}?month=${month}`);

/** The API's report for a month (the month always sent). */
export const apiClientHoursPath = (month: string): string => `/reports/client-hours?month=${month}`;

/** Where the browser downloads the month's workbook (a plain link, never prefetched). */
export const excelHref = (month: string): string => `${CLIENT_HOURS_PATH}/excel?month=${month}`;

/** The API's workbook for the month a download asks for (excel/route.ts), read as the page reads it. */
export const apiExcelPath = (params: URLSearchParams, today: string): string => `/reports/client-hours.xlsx?month=${readMonth(Object.fromEntries(params), today)}`;

/** A client's account on Client Accounts, marked and scrolled to (its ?account=); null for "No client". */
export function accountHref(client: ClientHoursGroup['client']): string | null {
  if (!client || !focusedAccount({ account: client.id })) return null;
  return `/clients/accounts?account=${client.id}`;
}

/** Hours as the table writes them: "38.5", "7.75", "0" for none; thousands grouped. */
export const hoursFigure = (hours: number): string => (Math.round(hours * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });

/** "1 person", "3 people". */
export const peopleText = (n: number): string => `${n} ${n === 1 ? 'person' : 'people'}`;

/** "1 client", "4 clients": the groups with a client (not "No client"). */
export const clientsText = (n: number): string => `${n} ${n === 1 ? 'client' : 'clients'}`;

/** How many of the month's groups are clients (the lines without a client left out). */
export const clientCount = (groups: readonly Pick<ClientHoursGroup, 'client'>[]): number => groups.filter((g) => g.client !== null).length;
