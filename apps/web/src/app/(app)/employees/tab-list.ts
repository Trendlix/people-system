// The profile's tabs and their addresses. Pure code (no JSX, no @/ imports), so tested helpers can build links to a tab;
// ui.tsx passes these on to the screens.

/**
 * The profile's tabs, as `?tab=` in its address (Basic Data has none). Social Insurance gathers the social insurance
 * work, moved out of the Contracts tab (owner's request, 16 October 2026). The Contracts tab itself was merged into
 * Employment the same day (owner: "there is no point of adding employment then adding contract and no active employment
 * without a contract, its like a loop for me"): the job, its contract, the documents generated from the templates and
 * the payslips are all on Employment.
 */
export const PROFILE_TABS = [
  { key: 'basic', label: 'Basic Data' },
  { key: 'education', label: 'Education' },
  { key: 'employment', label: 'Employment' },
  { key: 'insurance', label: 'Social Insurance' },
  { key: 'documents', label: 'Documents' },
] as const;

export type ProfileTabKey = (typeof PROFILE_TABS)[number]['key'];

/**
 * Tabs that are gone, by their old `?tab=` key, and the tab now showing what they did: bookmarks and links to
 * ?tab=contracts (with #contract or #payslips) open Employment, where both anchors are.
 */
const MOVED_TABS: ReadonlyMap<string, ProfileTabKey> = new Map([['contracts', 'employment']]);

/** The address of a profile tab, e.g. /employees/<id>?tab=employment. */
export function profileHref(id: string, tab: ProfileTabKey = 'basic'): string {
  return tab === 'basic' ? `/employees/${id}` : `/employees/${id}?tab=${tab}`;
}

/** The current employment's contract, on the Employment tab (#contract): its versions, a draft to sign, New contract or Renew. */
export const contractHref = (id: string) => `${profileHref(id, 'employment')}#contract`;

/** The employee's payslips, on the Employment tab (#payslips). */
export const payslipsHref = (id: string) => `${profileHref(id, 'employment')}#payslips`;

export function isProfileTab(value: string): value is ProfileTabKey {
  return PROFILE_TABS.some((t) => t.key === value);
}

/** The tab an address asks for: a tab's own key, the tab a moved one is now on, else null (Basic Data is shown then). */
export function askedTab(value: string): ProfileTabKey | null {
  return isProfileTab(value) ? value : (MOVED_TABS.get(value) ?? null);
}
