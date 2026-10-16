// The profile's tabs, the Employment tab's sub-tabs, and their addresses. Pure code (no JSX, no @/ imports), so tested
// helpers can build links to a tab; ui.tsx passes these on to the screens.

/**
 * The profile's tabs, as `?tab=` in its address (Basic Data has none). Social Insurance gathers the social insurance
 * work, moved out of the Contracts tab (owner's request, 16 October 2026), and is HR's and Admin's (owner, 17 October
 * 2026: "Social Insurance tab to be by HR - Admin users"). The Contracts tab itself was merged into Employment the same
 * day (owner: "there is no point of adding employment then adding contract and no active employment without a contract,
 * its like a loop for me"): the job, its contract, the documents generated from the templates and the payslips are all
 * on Employment, in its sub-tabs (below). Education is on Basic Data, under its other sections (owner, 17 October 2026:
 * "add the education table under the basic data instead of a separate tab").
 */
export const PROFILE_TABS = [
  { key: 'basic', label: 'Basic Data' },
  { key: 'employment', label: 'Employment' },
  { key: 'insurance', label: 'Social Insurance' },
  { key: 'documents', label: 'Documents' },
] as const;

export type ProfileTabKey = (typeof PROFILE_TABS)[number]['key'];

/**
 * Tabs that are gone, by their old `?tab=` key, and the tab now showing what they did: bookmarks and links to
 * ?tab=contracts (with #contract or #payslips) open Employment, where both anchors are (on its sub-tabs); ?tab=education
 * opens Basic Data, where Education now is.
 */
const MOVED_TABS = new Map([
  ['contracts', 'employment'],
  ['education', 'basic'],
] as const);

/** A tab that is gone, by its old key: still named by the profile's missing items (their `tab`), e.g. education. */
export type MovedTabKey = typeof MOVED_TABS extends Map<infer K, unknown> ? K : never;

/** The tab showing a tab's content: itself, or for a tab that is gone, the tab it moved to (education → basic). */
export function tabShowing(tab: ProfileTabKey | MovedTabKey): ProfileTabKey {
  return isProfileTab(tab) ? tab : MOVED_TABS.get(tab)!;
}

/** The address of a profile tab, e.g. /employees/<id>?tab=employment; a tab that is gone, the tab now showing it. */
export function profileHref(id: string, tab: ProfileTabKey | MovedTabKey = 'basic'): string {
  const shown = tabShowing(tab);
  return shown === 'basic' ? `/employees/${id}` : `/employees/${id}?tab=${shown}`;
}

export function isProfileTab(value: string): value is ProfileTabKey {
  return PROFILE_TABS.some((t) => t.key === value);
}

/** The tab an address asks for: a tab's own key, the tab a moved one is now on, else null (Basic Data is shown then). */
export function askedTab(value: string): ProfileTabKey | null {
  return isProfileTab(value) ? value : (MOVED_TABS.get(value as MovedTabKey) ?? null);
}

// ---------- the Employment tab's sub-tabs ----------

/**
 * The Employment tab's sub-tabs, as `&sub=` in its address (Details has none). The owner, 17 October 2026: "move the
 * salary history from the employment tab, it looks very busy now, or make subtabs, Employment Details, Salary History,
 * Documents", and chose sub-tabs: Details, the job and its contract; Salary, the salary history, the raise requests and
 * the pay received; Issued Documents, the documents generated from the templates, named so they aren't taken for the
 * profile's Documents tab (the papers the employee brings).
 */
export const EMPLOYMENT_SUB_TABS = [
  { key: 'details', label: 'Details' },
  { key: 'salary', label: 'Salary' },
  { key: 'documents', label: 'Issued Documents' },
] as const;

export type EmploymentSubTabKey = (typeof EMPLOYMENT_SUB_TABS)[number]['key'];

/** The address of an Employment sub-tab: /employees/<id>?tab=employment for Details, …&sub=salary for Salary. */
export function employmentHref(id: string, sub: EmploymentSubTabKey = 'details'): string {
  const tab = profileHref(id, 'employment');
  return sub === 'details' ? tab : `${tab}&sub=${sub}`;
}

/** The current employment's contract, on Details (#contract): its versions, a draft to sign, Renew or Raise. */
export const contractHref = (id: string) => `${employmentHref(id)}#contract`;

/** The employee's Salary History, on Salary (#salary-history). */
export const salaryHistoryHref = (id: string) => `${employmentHref(id, 'salary')}#salary-history`;

/** The employee's raise requests, on Salary (#raise-requests). */
export const employeeRaiseRequestsHref = (id: string) => `${employmentHref(id, 'salary')}#raise-requests`;

/** The employee's payslips, with the pay received on Salary (#payslips). */
export const payslipsHref = (id: string) => `${employmentHref(id, 'salary')}#payslips`;

/** The employee's advances and loans, on Salary (#advances: owner, 17 October 2026). */
export const advancesHref = (id: string) => `${employmentHref(id, 'salary')}#advances`;

/** The documents generated for each contract version, on Issued Documents (#contract-documents). */
export const contractDocumentsHref = (id: string) => `${employmentHref(id, 'documents')}#contract-documents`;

export function isEmploymentSubTab(value: string): value is EmploymentSubTabKey {
  return EMPLOYMENT_SUB_TABS.some((t) => t.key === value);
}

/** What the viewer may see on the Employment tab, as the screens know it (the API checks it again). */
export interface SubTabAccess {
  /** Salaries: HR, Finance and the CEO (the Salary History and the pay received). */
  pay: boolean;
  /** A Raise Requests section for them: the employee's own, their manager's (the API decides who). */
  raiseRequests: boolean;
  /** The documents generated from the templates: HR and the CEO, as the employee file. */
  issuedDocuments: boolean;
}

/**
 * The sub-tabs a viewer sees, in order: Details always; Salary to those who see salaries, and to anyone else with raise
 * requests there for them (the employee, their manager: only the requests); Issued Documents to HR and the CEO.
 */
export function visibleSubTabs(can: SubTabAccess): (typeof EMPLOYMENT_SUB_TABS)[number][] {
  return EMPLOYMENT_SUB_TABS.filter((t) => (t.key === 'salary' ? can.pay || can.raiseRequests : t.key === 'documents' ? can.issuedDocuments : true));
}

/** The sub-tab to open: the one the address asks for if the viewer sees it, else Details. */
export function openSubTab(asked: string, visible: readonly EmploymentSubTabKey[]): EmploymentSubTabKey {
  return isEmploymentSubTab(asked) && visible.includes(asked) ? asked : 'details';
}

/** Where each anchor on the Employment tab is, for links from before the sub-tabs (17 October 2026), hash only. */
const ANCHOR_SUB_TABS: ReadonlyMap<string, EmploymentSubTabKey> = new Map([
  ['contract', 'details'],
  ['salary-history', 'salary'],
  ['raise-requests', 'salary'],
  ['payslips', 'salary'],
  ['advances', 'salary'],
  ['contract-documents', 'documents'],
]);

/**
 * The sub-tab holding an anchor ("#payslips" or "payslips"): a field's cell (#field-<key>, from the missing details) is
 * on Details. Null for one it doesn't know.
 */
export function subTabOfAnchor(hash: string): EmploymentSubTabKey | null {
  const id = hash.replace(/^#/, '');
  if (id.startsWith('field-')) return 'details';
  return ANCHOR_SUB_TABS.get(id) ?? null;
}

/**
 * Where a link to the Employment tab should be to show its anchor: the same address on the sub-tab holding it (the hash
 * and any other parameter kept, an old ?tab=contracts as Employment), or null to stay. Links from before the sub-tabs
 * have only the anchor (?tab=employment#payslips: Details would open, without it). Nothing moves to a sub-tab the
 * viewer doesn't see, or off the profile's other tabs. `address`: the path, query and hash, e.g. from window.location.
 */
export function anchorAddress(address: string, visible: readonly EmploymentSubTabKey[]): string | null {
  const url = new URL(address, 'http://profile.invalid');
  if (askedTab(url.searchParams.get('tab') ?? '') !== 'employment') return null;
  const target = subTabOfAnchor(url.hash);
  if (!target || !visible.includes(target)) return null;
  if (target === openSubTab(url.searchParams.get('sub') ?? '', visible)) return null;
  url.searchParams.set('tab', 'employment');
  if (target === 'details') url.searchParams.delete('sub');
  else url.searchParams.set('sub', target);
  return `${url.pathname}${url.search}${url.hash}`;
}
