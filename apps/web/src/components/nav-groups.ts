// The sidebar's headings that open and close (owner, 20 October 2026: "make the side menu subs expandable - which means
// requests with an arrow beside it to expand and collapse the side menues"): each heading with pages under it (People,
// Payroll, Requests, Attendance …) is a button with an arrow beside it, no longer a link; its first page is its first
// item. Every heading starts closed when a page is loaded, after signing in or on a refresh, the one holding the page
// too (owner, 24 October 2026: "on login and refresh make sure all items are collapsed"); one the user opens stays open
// while they move between pages, until the next load. A closed heading shows its pages' counts added up, so nothing
// waiting is hidden. Pure, for the tests and for the menu (nav-links.tsx). Relative imports: the tests run without the
// "@/" alias.
import { isActive, type NavItem, type NavSubItem } from './nav';

/** How many things wait behind a link, by its href. */
export type NavCounts = Partial<Record<string, number>>;

/** An item with pages under it: a heading that opens and closes them. */
export type NavGroup = NavItem & { items: NavSubItem[] };

export const isGroup = (item: NavItem): item is NavGroup => !!item.items?.length;

/** A heading's key, from its label ("people", "payroll", "requests"): the same whichever pages the user sees. */
export const groupKey = (item: Pick<NavItem, 'label'>): string =>
  item.label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** The id of a heading's list of pages, which its button names in aria-controls. */
export const groupListId = (key: string): string => `nav-group-${key}`;

/** The key of the heading holding this page; null on a page of none (Home, Organization, Approvals). */
export function groupHolding(items: readonly NavItem[], pathname: string): string | null {
  const holding = items.find((item) => isGroup(item) && isActive(item, pathname));
  return holding ? groupKey(holding) : null;
}

// ---------- the headings opened while moving between pages ----------

/**
 * Where earlier versions kept the headings the user opened (localStorage, so they reopened on every load); removed once
 * the menu runs, as nothing is remembered across loads any more (24 October 2026).
 */
export const GROUPS_STORAGE_KEY = 'trendlix-people:sidebar-groups';

/** Each heading the user opened (true) or closed (false) since the page was loaded, by its key. */
export type Remembered = Readonly<Partial<Record<string, boolean>>>;

export const NOTHING_REMEMBERED: Remembered = Object.freeze({});

/** What is remembered once a heading is opened or closed (a new object: the old one is left as it was). */
export const remember = (remembered: Remembered, key: string, open: boolean): Remembered => ({ ...remembered, [key]: open });

/** Whether a heading shows its pages: only when the user opened it since the page was loaded (24 October 2026). */
export const isGroupOpen = (key: string, remembered: Remembered): boolean => remembered[key] === true;

// ---------- counts ----------

/** What a closed heading shows: the counts of the pages under it the user sees, added up (0: none). */
export function groupCount(item: Pick<NavItem, 'items'>, counts: NavCounts | undefined): number {
  return (item.items ?? []).reduce((sum, sub) => sum + (counts?.[sub.href] ?? 0), 0);
}
